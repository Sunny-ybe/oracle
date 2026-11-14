// TinyFish: when nobody nearby answers, read live web pages for the place.
import { env } from "../config.js";

export const tinyfishEnabled = () => Boolean(env.tinyfishKey);

// Returns { option: 1-3 | null, evidence } or null.
export async function webAnswer(place, question, options) {
  if (!env.tinyfishKey || !place.web) return null;
  const goal = `${place.web.goal}
Then decide which option best answers: "${question}"
Options: 1 = "${options[0]}", 2 = "${options[1]}", 3 = "${options[2]}".
If the page cannot tell you, use null.
Return JSON only: {"option": 1, 2, 3 or null, "evidence": "one short fact from the page"}`;

  const res = await fetch("https://agent.tinyfish.ai/v1/automation/run", {
    method: "POST",
    headers: { "X-API-Key": env.tinyfishKey, "Content-Type": "application/json" },
    body: JSON.stringify({ url: place.web.url, goal }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`TinyFish ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const run = await res.json();

  let result = run.result ?? run.resultJson ?? run.output;
  if (typeof result === "string") {
    const m = result.match(/\{[\s\S]*\}/);
    try { result = JSON.parse(m ? m[0] : result); } catch { result = { option: null, evidence: result }; }
  }
  if (!result) return null;
  const option = [1, 2, 3].includes(Number(result.option)) ? Number(result.option) : null;
  return { option, evidence: String(result.evidence || "").slice(0, 300), source_url: place.web.url };
}
