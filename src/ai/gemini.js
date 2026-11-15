// Gemini: turns any question into a one-tap poll, and checks dispute photos.
import { env, PRESETS } from "../config.js";

// Tries the main model, then any fallbacks, when one is overloaded (429/5xx) or too slow.
async function generate(parts, timeoutMs = 30000) {
  const models = [env.geminiModel, ...env.geminiFallbacks];
  let lastErr;
  for (const model of models) {
    try {
      return await generateWith(model, parts, timeoutMs);
    } catch (e) {
      lastErr = e;
      const retryable = /Gemini (429|5\d\d)|aborted|timeout|fetch failed/i.test(e.message);
      if (!retryable) throw e;
      if (models.length > 1) console.error(`Gemini ${model} unavailable (${e.message.slice(0, 60)}), trying next model`);
    }
  }
  throw lastErr;
}

async function generateWith(model, parts, timeoutMs) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.geminiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  // Newer models can return "thought" parts before the answer; use the answer text only.
  const out = data.candidates?.[0]?.content?.parts || [];
  const text = out.filter((x) => x.text && !x.thought).map((x) => x.text).join("").replace(/```(json)?/g, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new Error(`Gemini returned no JSON: ${text.slice(0, 120) || data.candidates?.[0]?.finishReason || "empty"}`);
  }
}

function presetFor(text) {
  const s = (text || "").toLowerCase();
  if (/(how many people|headcount|head count|number of people|count)/.test(s)) return "people_count";
  if (/(sunny|sun|sky|dark|cloud|rain|haboob|dust|storm|weather|smoke|look like|show me|photo|picture|open|closed|parking|shelf)/.test(s)) return "look";
  if (/(staff|ask them|in stock|available|do they have|special|menu)/.test(s)) return "ask_staff";
  if (/(line|queue|wait)/.test(s)) return "line_length";
  if (/(loud|noise|quiet)/.test(s)) return "noise";
  return "crowd";
}

// Free text -> { topic, question, options[3] }, options ordered low -> high.
export async function planQuestion(text, place) {
  const fallback = () => {
    const topic = presetFor(text);
    const pr = PRESETS[topic];
    return { topic, question: pr.question(place.name), options: pr.options, sensor: pr.sensor || "poll", thresholds: pr.thresholds };
  };
  if (!env.geminiKey || !text) return fallback();

  try {
    const plan = await generate([
      {
        text: `You turn questions about the physical world into one-tap polls for people standing at "${place.name}".
Question: "${text}"

Return JSON: {"topic": string, "question": string, "options": [string, string, string], "sensor": string, "thresholds": [number, number] or null}
Rules:
- sensor: how phones should answer.
  "noise": how loud/quiet it is (the phone's microphone measures it).
  "people_count": how many people are there (each phone takes a photo; people are counted).
  "photo": anything better answered by looking (sky, weather, dust storm/haboob, how full shelves are, is it open, what's on the menu board, what it looks like).
  "report": anything someone has to go and find out or ask a person (ask the staff, check if something is in stock, is a room booked, what's today's special).
  "poll": simple things a person standing there can answer with one tap (line length, is there pizza, are there free seats).
- For "noise": topic "noise", options ["Quiet","Chatty","Loud"], thresholds [55, 70] (decibels).
- For "people_count": topic "people_count", options like ["Under 15","15-40","40+"] sized for this kind of place, and thresholds = the two boundary numbers (e.g. [15, 40]).
- For "photo": 3 options ordered low -> high for what the photo will show (e.g. "how sunny is it" -> ["Cloudy","Partly sunny","Bright sun"]; haboob -> ["Mild dust","Hazy","Severe"]; parking -> ["Plenty","A few","Full"]); thresholds null.
- For "report": options ["Yes","Partly","No"] if it's a yes/no question, else any 3 short options; thresholds null.
- For "poll": thresholds null.
- topic: snake_case, 1-3 words, stable across rephrasings. Use "line_length" for any queue or wait question, "crowd" for busy/crowded/seats, "noise" for loud/quiet.
- question: short, ends with "?", mentions the place.
- options: exactly 3, max 3 words each, ordered from lowest/least to highest/most.
- If topic is line_length use ["0-5 min","5-15 min","15+ min"]; if crowd use ["Empty","Some space","Packed"]; if noise use ["Quiet","Chatty","Loud"].`,
      },
    ], 8000);
    if (!plan?.topic || !Array.isArray(plan.options) || plan.options.length !== 3) return fallback();
    plan.topic = plan.topic.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
    plan.sensor = ["noise", "people_count", "photo", "report"].includes(plan.sensor) ? plan.sensor : "poll";
    if (plan.sensor !== "poll" && !(Array.isArray(plan.thresholds) && plan.thresholds.length === 2)) {
      plan.thresholds = PRESETS[plan.sensor === "noise" ? "noise" : "people_count"].thresholds;
    }
    return plan;
  } catch (err) {
    console.error("planQuestion fell back:", err.message);
    return fallback();
  }
}

// Photo -> { shows_place, option (1-3 or null), confidence (0-1), reason }
export async function checkPhoto({ base64, mime, place, question, options }) {
  if (!env.geminiKey) return { shows_place: false, option: null, confidence: 0, reason: "Gemini key not set" };
  return generate([
    {
      text: `A person was asked to photograph "${place.name}" to settle this question: "${question}"
Options: 1 = "${options[0]}", 2 = "${options[1]}", 3 = "${options[2]}".
Look at the photo. Return JSON:
{"shows_place": boolean (does it plausibly show this kind of place, taken just now, not a screenshot or photo of a screen),
 "option": 1, 2, 3 or null (which option the photo supports),
 "confidence": number 0-1,
 "reason": one short sentence describing what you see, without describing anyone's identity or appearance,
 ${PII}}`,
    },
    { inline_data: { mime_type: mime || "image/jpeg", data: base64 } },
  ], 20000);
}


const PII = `"pii_boxes": every face, readable name badge or ID, phone/laptop screen with readable content, and license plate,
as [ymin, xmin, ymax, xmax] boxes normalized to 0-1000. Include small and partly visible faces in crowds.`;

// One photo from a phone -> what it shows, plus where the personal details are so they can be blurred.
// Returns { shows_place, option, count, description, pii_boxes }
export async function analyzePhoto({ base64, mime, place, question, options, sensor }) {
  if (!env.geminiKey) throw new Error("Gemini key not set");
  const ask =
    sensor === "people_count"
      ? `Count the people visible (estimate if it's a crowd).`
      : `Answer from what you can see. Options, from least to most: 1 = "${options[0]}", 2 = "${options[1]}", 3 = "${options[2]}".
Judge against the size of the space, not the raw number of people: a large room that is mostly empty seats or open floor is option 1;
roughly half full is option 2; packed, with few free seats or long lines, is option 3. Ignore people on a stage or behind a counter when judging crowding.`;
  return generate([
    {
      text: `A person at "${place.name}" took this photo just now to answer: "${question}"
${ask}
Return JSON:
{"shows_place": boolean (a real photo of a real place, not a screenshot or a photo of a screen),
 "count": integer or null (people visible),
 "option": 1, 2, 3 or null,
 "description": one sentence answering the question from the photo, without describing anyone's identity or appearance,
 ${PII}}`,
    },
    { inline_data: { mime_type: mime || "image/jpeg", data: base64 } },
  ]);
}

// Several people's written reports -> one short answer.
export async function summarizeReports({ question, place, reports }) {
  const plain = reports.map((r) => r.text).filter(Boolean);
  if (!env.geminiKey || plain.length <= 1) return plain[0] || null;
  const r = await generate([
    {
      text: `People at "${place}" were asked: "${question}". Their reports:
${plain.map((t, i) => `${i + 1}. ${t}`).join("\n")}
Return JSON: {"answer": one or two sentences combining what they found, noting any disagreement}`,
    },
  ]);
  return r.answer;
}

// A photo of a floor sign, elevator panel, stairwell number or room number -> which floor the person is on.
// Lets one person prove their floor without anyone else around.
export async function readFloorSign({ base64, mime, place }) {
  if (!env.geminiKey) throw new Error("Gemini key not set");
  return generate([
    {
      text: `Someone inside "${place.name}" took this photo to prove which floor they are on.
It should show a floor sign, an elevator panel or display, a stairwell floor number, or a room number.
Work out the floor. Room numbers usually start with the floor (room 312 is on floor 3, 2041 is floor 2, B12 or LL5 is the basement).
Return JSON:
{"floor": integer or null (0 = basement or lower level, 1 = ground or first floor, 2 = second floor, ...),
 "evidence": short phrase saying what you read, e.g. "elevator display shows 3" or "room 214",
 "real_photo": boolean (false if it is a screenshot, a photo of a screen, or a printed or handwritten note held up to the camera)}`,
    },
    { inline_data: { mime_type: mime || "image/jpeg", data: base64 } },
  ], 20000);
}
