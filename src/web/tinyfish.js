// TinyFish: for questions the place itself publishes an answer to (hours, schedules, menus),
// read the place's official web page. People on the ground still come first; this is the official source.
//
// A TinyFish page read takes 20 seconds to 2 minutes, far too slow to wait for while someone asks. So the
// facts are read in the background, kept for a few hours (shared between machines in Mongo `settings`),
// and Gemini answers a question from the stored facts in about a second.
import { env, PLACES } from "../config.js";
import * as mongo from "../db/mongo.js";
import { answerFromFacts } from "../ai/gemini.js";

export const tinyfishEnabled = () => Boolean(env.tinyfishKey);

// Questions a web page can answer. Live conditions (lines, crowds, noise) are never sent to the web.
const OFFICIAL = /\b(open|opens|opening|closed?|closes|closing|hours|schedule|agenda|menu|special|specials|price|prices|event|events|workshop|what time|when (does|do|is|are))\b/i;
export const webCanAnswer = (place, question) => tinyfishEnabled() && Boolean(place?.web) && OFFICIAL.test(String(question || ""));

const FRESH_MS = Number(process.env.WEB_FACTS_HOURS || 3) * 3600 * 1000;
const key = (place) => `web:${place.id}`;
const reading = new Map(); // place id -> in-flight page read

// One TinyFish run: open the official page and bring back the facts as plain text.
async function readPage(place) {
  const res = await fetch("https://agent.tinyfish.ai/v1/automation/run", {
    method: "POST",
    headers: { "X-API-Key": env.tinyfishKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      url: place.web.url,
      goal: `${place.web.goal} Read this page only; do not open other sites.
Return JSON only: {"facts": "everything the page says about today's hours, schedule or menu for ${place.name}, with times, in under 600 characters"}`,
    }),
    signal: AbortSignal.timeout(170000),
  });
  if (!res.ok) throw new Error(`TinyFish ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const run = await res.json();
  let result = run.result ?? run.resultJson ?? run.output;
  if (typeof result === "string") { try { result = JSON.parse(result.match(/\{[\s\S]*\}/)?.[0] || result); } catch { result = { facts: result }; } }
  const facts = String(result?.facts || "").trim().slice(0, 900);
  if (!facts) throw new Error("the page had nothing usable");
  return { facts, source_url: place.web.url, at: new Date().toISOString() };
}

// Refresh a place's facts in the background. Safe to call often: one read at a time per place.
export function refreshFacts(place) {
  if (!tinyfishEnabled() || !place?.web) return Promise.resolve(null);
  if (reading.has(place.id)) return reading.get(place.id);
  const job = readPage(place)
    .then(async (f) => { await mongo.setSetting(key(place), f); console.log(`TinyFish read ${place.web.url} for ${place.name}`); return f; })
    .catch((e) => { console.error(`TinyFish (${place.name}):`, e.name === "TimeoutError" ? "the page took too long" : e.message); return null; })
    .finally(() => reading.delete(place.id));
  reading.set(place.id, job);
  return job;
}

// Server start: read every configured page whose stored facts are missing or old.
export async function warmFacts() {
  if (!tinyfishEnabled()) return;
  for (const place of PLACES.filter((p) => p.web)) {
    const f = await mongo.getSetting(key(place)).catch(() => null);
    if (!f || Date.now() - new Date(f.at).getTime() > FRESH_MS) refreshFacts(place);
  }
}

// Answer a question from the official page. Returns { option, evidence, source_url, as_of } or null. Never throws.
export async function webAnswer(place, question, options, waitMs = 0) {
  if (!webCanAnswer(place, question)) return null;
  try {
    let f = await mongo.getSetting(key(place));
    const stale = !f || Date.now() - new Date(f.at).getTime() > FRESH_MS;
    if (stale) {
      const job = refreshFacts(place); // old facts are still used below if the new read is slow
      if (!f && waitMs > 0) f = await Promise.race([job, new Promise((r) => setTimeout(() => r(null), waitMs))]);
    }
    if (!f) return null;
    const a = await answerFromFacts({ place, question, options, facts: f.facts, readAt: f.at });
    const option = [1, 2, 3].includes(Number(a?.option)) ? Number(a.option) : null;
    const evidence = String(a?.evidence || "").slice(0, 300);
    return option || evidence ? { option, evidence, source_url: f.source_url, as_of: f.at } : null;
  } catch (e) {
    console.error("Web answer failed:", e.message);
    return null;
  }
}
