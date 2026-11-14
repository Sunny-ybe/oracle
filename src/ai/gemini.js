// Gemini: turns any question into a one-tap poll, and checks dispute photos.
import { env, PRESETS } from "../config.js";

async function generate(parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(text);
}

function presetFor(text) {
  const s = (text || "").toLowerCase();
  if (/(line|queue|wait)/.test(s)) return "line_length";
  if (/(loud|noise|quiet)/.test(s)) return "noise";
  return "crowd";
}

// Free text -> { topic, question, options[3] }, options ordered low -> high.
export async function planQuestion(text, place) {
  const fallback = () => {
    const topic = presetFor(text);
    return { topic, question: PRESETS[topic].question(place.name), options: PRESETS[topic].options };
  };
  if (!env.geminiKey || !text) return fallback();

  try {
    const plan = await generate([
      {
        text: `You turn questions about the physical world into one-tap polls for people standing at "${place.name}".
Question: "${text}"

Return JSON: {"topic": string, "question": string, "options": [string, string, string]}
Rules:
- topic: snake_case, 1-3 words, stable across rephrasings. Use "line_length" for any queue or wait question, "crowd" for busy/crowded/seats, "noise" for loud/quiet.
- question: short, ends with "?", mentions the place.
- options: exactly 3, max 3 words each, ordered from lowest/least to highest/most.
- If topic is line_length use ["0-5 min","5-15 min","15+ min"]; if crowd use ["Empty","Some space","Packed"]; if noise use ["Quiet","Chatty","Loud"].`,
      },
    ]);
    if (!plan?.topic || !Array.isArray(plan.options) || plan.options.length !== 3) return fallback();
    plan.topic = plan.topic.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40);
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
 "reason": one short sentence describing what you see}`,
    },
    { inline_data: { mime_type: mime || "image/jpeg", data: base64 } },
  ]);
}
