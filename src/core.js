// Oracle core: plan the question, check memory, ask people, weigh votes,
// settle disputes with photos, fall back to the web, pay and remember.
import { randomUUID, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { RULES, env, findPlace, PLACES, PRESETS } from "./config.js";
import * as mongo from "./db/mongo.js";
import * as tiger from "./db/tiger.js";
import { planQuestion, checkPhoto } from "./ai/gemini.js";
import { webAnswer } from "./web/tinyfish.js";
import { pay, solanaEnabled } from "./pay/solana.js";

export const events = new EventEmitter();
events.setMaxListeners(200);
const emit = (type, data = {}) => events.emit("event", { type, at: new Date().toISOString(), ...data });

// Messaging channels (discord, telegram, ...) register here: { sendPoll(user, q), sendText(user, text) }
const channels = {};
export const registerChannel = (name, impl) => { channels[name] = impl; };
const send = (user, fn, ...args) =>
  channels[user.channel]?.[fn]?.(user, ...args)?.catch?.((e) => console.error(`${user.channel} ${fn} failed:`, e.message));

const live = new Map(); // open questions by id
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- ask

export async function ask({ place, question, topic, askedBy = "agent", waitSeconds = RULES.waitSeconds }) {
  const p = findPlace(place);
  if (!p) throw new Error(`Unknown place "${place}". Known places: ${PLACES.map((x) => x.name).join(", ")}`);

  const plan =
    topic && PRESETS[topic] && !question
      ? { topic, question: PRESETS[topic].question(p.name), options: PRESETS[topic].options }
      : await planQuestion(question, p);

  // 1. Memory: a fresh agreed answer is free and instant.
  const mem = await tiger.recentConsensus(p.id, plan.topic, RULES.cacheMinutes);
  if (mem) {
    const result = {
      status: "answered", source: "memory", place: p.name, question: plan.question,
      answer: mem.answer_text, option: mem.option, votes: mem.n, as_of: mem.last_time,
      note: `Reported by people on the ground ${minutesAgo(mem.last_time)}.`,
    };
    emit("answer", { ...result, placeId: p.id });
    return result;
  }

  // 2. Ask the people who are there.
  const q = {
    _id: randomUUID().slice(0, 8), placeId: p.id, place: p.name, topic: plan.topic,
    question: plan.question, options: plan.options, askedBy, status: "open", votes: [], createdAt: new Date(),
  };
  await mongo.saveQuestion(q);
  const L = { q, dispute: null, settled: false };
  L.done = new Promise((resolve) => { L.resolve = resolve; });
  live.set(q._id, L);

  const people = await mongo.pickResponders(p.id);
  emit("question", { id: q._id, placeId: p.id, place: p.name, question: q.question, options: q.options, pinged: people.length, askedBy });
  for (const u of people) send(u, "sendPoll", q);

  L.deadline = setTimeout(() => onDeadline(L), RULES.deadlineSeconds * 1000);

  const result = await Promise.race([L.done, sleep(waitSeconds * 1000).then(() => null)]);
  return (
    result || {
      status: "pending", question_id: q._id, place: p.name, question: q.question,
      votes_so_far: q.votes.length, pinged: people.length,
      note: "Still collecting answers from people nearby. Call get_answer with this question_id shortly.",
    }
  );
}

export async function getAnswer(id) {
  const q = await mongo.getQuestion(id);
  if (!q) throw new Error(`No question ${id}`);
  if (q.status === "resolved") return q.result;
  return { status: q.status, question_id: id, place: q.place, question: q.question, votes_so_far: (q.votes || []).length };
}

// ---------------------------------------------------------------- votes

export async function recordVote(userId, questionId, option) {
  const L = live.get(questionId);
  if (!L || L.settled) return "This one is already answered. Thanks anyway! 🦉";
  option = Number(option);
  if (![1, 2, 3].includes(option)) return "That option doesn't exist.";
  if (L.q.votes.some((v) => v.userId === userId)) return "You already answered this one.";

  const user = await mongo.getUser(userId);
  const trust = user?.trust ?? 1;
  const vote = { userId, name: user?.name || "someone", option, trust, at: new Date() };
  L.q.votes.push(vote);

  await Promise.all([
    mongo.pushVote(questionId, vote),
    mongo.addCredits(userId, RULES.creditVote, { answered: 1 }),
    tiger.saveAnswer({
      questionId, placeId: L.q.placeId, topic: L.q.topic, option, answerText: L.q.options[option - 1],
      questionText: L.q.question, userId, trust, source: "people",
    }),
  ]);

  emit("vote", {
    id: questionId, placeId: L.q.placeId, place: L.q.place, name: vote.name, trust,
    option, answer: L.q.options[option - 1], tally: tally(L.q.votes), options: L.q.options,
  });
  checkConsensus(L);
  return `Got it: ${L.q.options[option - 1]}. +${RULES.creditVote} credit 🦉`;
}

function tally(votes) {
  return [1, 2, 3].map((option) => {
    const vs = votes.filter((v) => v.option === option);
    return { option, n: vs.length, weight: round(vs.reduce((s, v) => s + v.trust, 0)) };
  });
}

function checkConsensus(L) {
  if (L.settled) return;
  const t = tally(L.q.votes);
  const best = [...t].sort((a, b) => b.weight - a.weight)[0];
  const total = t.reduce((s, x) => s + x.weight, 0);
  if (best.n >= RULES.minVotes && best.weight >= RULES.minWeight) {
    return settle(L, { source: "people", option: best.option, votes: best.n, confidence: round(best.weight / total) });
  }
  if (L.q.votes.length >= RULES.disputeAt && !L.dispute) {
    startDispute(L).catch((e) => console.error("Dispute failed:", e.message));
  }
}

// ---------------------------------------------------------------- disputes

async function startDispute(L) {
  const voters = (await Promise.all(L.q.votes.map((v) => mongo.getUser(v.userId)))).filter(Boolean);
  const pick = voters.filter((u) => channels[u.channel]).sort((a, b) => b.trust - a.trust)[0];
  if (!pick || L.settled) return;

  const token = randomBytes(12).toString("base64url");
  L.dispute = { token, userId: pick._id, expires: Date.now() + RULES.photoMinutes * 60000 };
  await mongo.updateQuestion(L.q._id, { status: "disputed", dispute: { userId: pick._id, startedAt: new Date() } });

  const reward = solanaEnabled() ? ` and ${env.rewardPhotoSol} SOL` : "";
  send(pick, "sendText",
    `🦉 People disagree about "${L.q.question}"\nYou have the highest trust nearby. Settle it with one photo and earn ${RULES.creditPhoto} credits${reward}:\n${env.publicUrl}/verify/${token}`);
  emit("dispute", { id: L.q._id, placeId: L.q.placeId, place: L.q.place, name: pick.name, tally: tally(L.q.votes), options: L.q.options });
}

function findDispute(token) {
  for (const L of live.values()) {
    if (L.dispute?.token === token && !L.settled && Date.now() < L.dispute.expires) return L;
  }
  return null;
}

export function disputeInfo(token) {
  const L = findDispute(token);
  return L && { question: L.q.question, place: L.q.place, options: L.q.options };
}

export async function submitPhoto(token, { image, mime = "image/jpeg", lat, lng }) {
  const L = findDispute(token);
  if (!L) return { ok: false, message: "This link has expired or the question is already settled." };
  const p = findPlace(L.q.placeId);

  let distanceM = null;
  let locationOk = null;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    distanceM = Math.round(haversineM(lat, lng, p.lat, p.lng));
    locationOk = distanceM <= p.radiusM;
  }

  const base64 = String(image).replace(/^data:[^,]+,/, "");
  let v;
  try {
    v = await checkPhoto({ base64, mime, place: p, question: L.q.question, options: L.q.options });
  } catch (e) {
    console.error("Photo check failed:", e.message);
    return { ok: false, message: "Couldn't check the photo right now. Try again." };
  }
  const option = Number(v.option);
  const passed = Boolean(v.shows_place) && [1, 2, 3].includes(option) && Number(v.confidence) >= 0.5 && locationOk !== false;

  emit("photo", {
    id: L.q._id, placeId: L.q.placeId, place: L.q.place, passed, reason: v.reason, distanceM,
    answer: passed ? L.q.options[option - 1] : null, image: `data:${mime};base64,${base64}`,
  });

  if (!passed) {
    return {
      ok: false,
      message: locationOk === false ? `This photo was taken ${distanceM} m from ${p.name}.` : `Not accepted: ${v.reason}`,
    };
  }

  const user = await mongo.getUser(L.dispute.userId);
  await tiger.saveAnswer({
    questionId: L.q._id, placeId: L.q.placeId, topic: L.q.topic, option, answerText: L.q.options[option - 1],
    questionText: L.q.question, userId: user?._id, trust: user?.trust, source: "photo",
  });
  if (user) {
    await mongo.addCredits(user._id, RULES.creditPhoto);
    if (solanaEnabled()) payUser(user, env.rewardPhotoSol, "verified photo");
  }
  await settle(L, {
    source: "photo", option, votes: L.q.votes.filter((x) => x.option === option).length,
    confidence: round(Number(v.confidence)), evidence: v.reason, location_verified: locationOk === true,
  });
  return { ok: true, message: `Verified: ${v.reason} You earned ${RULES.creditPhoto} credits.` };
}

// ---------------------------------------------------------------- deadline + web fallback

async function onDeadline(L) {
  if (L.settled) return;
  if (L.dispute && Date.now() < L.dispute.expires) {
    L.deadline = setTimeout(() => onDeadline(L), L.dispute.expires - Date.now() + 1000);
    return;
  }

  if (L.q.votes.length === 0) {
    const p = findPlace(L.q.placeId);
    emit("web", { id: L.q._id, placeId: p.id, place: p.name, url: p.web?.url });
    try {
      const w = await webAnswer(p, L.q.question, L.q.options);
      if (w?.option) {
        await tiger.saveAnswer({
          questionId: L.q._id, placeId: p.id, topic: L.q.topic, option: w.option,
          answerText: L.q.options[w.option - 1], questionText: L.q.question, source: "web",
        });
        return settle(L, { source: "web", option: w.option, confidence: 0.5, evidence: w.evidence, source_url: w.source_url });
      }
      if (w) return settle(L, { source: "web", option: null, evidence: w.evidence, source_url: w.source_url, note: "The web had related info but no live answer." });
    } catch (e) {
      console.error("Web fallback failed:", e.message);
    }
    return settle(L, { source: "none", option: null, note: "No one nearby answered and the web had no live info." });
  }

  const t = tally(L.q.votes);
  const best = [...t].sort((a, b) => b.weight - a.weight)[0];
  const total = t.reduce((s, x) => s + x.weight, 0);
  return settle(L, {
    source: "people", option: best.option, votes: best.n, confidence: round(best.weight / total),
    lowConfidence: true, note: "Low confidence: not enough people agreed.",
  });
}

// ---------------------------------------------------------------- settle, pay, remember

async function settle(L, r) {
  if (L.settled) return;
  L.settled = true;
  clearTimeout(L.deadline);
  live.delete(L.q._id);

  const q = L.q;
  const result = {
    status: "answered", question_id: q._id, place: q.place, question: q.question,
    answer: r.option ? q.options[r.option - 1] : null, option: r.option ?? null, source: r.source,
    votes: r.votes ?? 0, total_votes: q.votes.length, confidence: r.confidence ?? null,
    answered_in_s: Math.round((Date.now() - q.createdAt.getTime()) / 1000),
  };
  for (const k of ["evidence", "source_url", "note", "location_verified"]) if (r[k] !== undefined) result[k] = r[k];

  await mongo.updateQuestion(q._id, { status: "resolved", result, resolvedAt: new Date() });
  emit("answer", { ...result, placeId: q.placeId });
  L.resolve(result);

  // Reward and re-weight only when the answer is solid.
  if (!r.option || r.lowConfidence || !["people", "photo"].includes(r.source)) return;
  await mongo.updateTrust(q.votes, r.option);
  for (const v of q.votes) {
    const u = await mongo.getUser(v.userId);
    if (!u) continue;
    if (v.option !== r.option) {
      send(u, "sendText", `🦉 Settled: ${q.place} is "${result.answer}". Others saw it differently this time.`);
    } else if (solanaEnabled()) {
      payUser(u, env.rewardVoteSol, "matching answer");
    } else {
      send(u, "sendText", `🦉 Settled: ${q.place} is "${result.answer}". You matched! Trust is now ${u.trust}.`);
    }
  }
}

async function payUser(user, amount, reason) {
  try {
    const { signature, url } = await pay(user.wallet.pub, amount);
    await tiger.savePayout({ userId: user._id, amountSol: amount, reason, signature, url });
    await mongo.addCredits(user._id, 0, { earnedSol: amount });
    emit("payout", { name: user.name, amount, reason, url });
    send(user, "sendText", `🦉 You earned ${amount} SOL for a ${reason}.\n${url}`);
  } catch (e) {
    console.error("Payout failed:", e.message);
    emit("payout_failed", { name: user.name, reason: e.message });
  }
}

// ---------------------------------------------------------------- views

export async function liveStatus() {
  const [latest, counts] = await Promise.all([mongo.latestAnswers(), mongo.peopleByPlace()]);
  const byPlace = Object.fromEntries(latest.map((x) => [x._id, x.q]));
  return PLACES.map((p) => {
    const q = byPlace[p.id];
    return {
      id: p.id, name: p.name, lat: p.lat, lng: p.lng, people_here: counts[p.id] || 0,
      latest: q ? { question: q.question, answer: q.result.answer, option: q.result.option, source: q.result.source, at: q.resolvedAt } : null,
    };
  });
}

export async function insights(place, topic = "line_length") {
  const p = findPlace(place);
  if (!p) throw new Error(`Unknown place "${place}"`);
  const [trend, busiest, topics] = await Promise.all([
    tiger.trend(p.id, topic), tiger.busiestHours(p.id, topic), tiger.topicsForPlace(p.id),
  ]);
  const scale = PRESETS[topic]?.options;
  const fmt = (h) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
  const summary = busiest.length
    ? `${p.name} is usually worst around ${busiest.map((b) => fmt(b.hour)).join(", ")}` +
      (scale ? ` (avg ${busiest[0].avg_option} on a 1 = "${scale[0]}" to 3 = "${scale[2]}" scale).` : ".")
    : `Not enough history yet for ${p.name}.`;
  return { place: p.name, topic, summary, busiest_hours: busiest, last_24h: trend, known_topics: topics };
}

export const openQuestions = () =>
  [...live.values()].map((L) => ({ id: L.q._id, place: L.q.place, question: L.q.question, options: L.q.options, votes: L.q.votes.length }));

// ---------------------------------------------------------------- helpers

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function minutesAgo(t) {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  return m <= 0 ? "just now" : `${m} min ago`;
}
