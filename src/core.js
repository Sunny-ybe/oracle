// Oracle core: plan the question, check memory, ask people, weigh votes,
// settle disputes with photos, fall back to past reports, pay and remember.
import { randomUUID, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { RULES, env, findPlace, PLACES, PRESETS } from "./config.js";
import * as mongo from "./db/mongo.js";
import * as tiger from "./db/tiger.js";
import { planQuestion, checkPhoto, analyzePhoto, summarizeReports, estimateAnswer } from "./ai/gemini.js";
import { maskPII } from "./ai/privacy.js";
import { geocode } from "./web/geo.js";
import { pay, solanaEnabled } from "./pay/solana.js";
import { webAnswer, webCanAnswer } from "./web/tinyfish.js";

export const events = new EventEmitter();
events.setMaxListeners(200);
const emit = (type, data = {}) => events.emit("event", { type, at: new Date().toISOString(), ...data });

// Messaging channels (discord, telegram, ...) register here: { sendPoll(user, q), sendText(user, text) }
const channels = {};
export const registerChannel = (name, impl) => { channels[name] = impl; };
const send = (user, fn, ...args) =>
  channels[user.channel]?.[fn]?.(user, ...args)?.catch?.((e) => console.error(`${user.channel} ${fn} failed:`, e.message));

const live = new Map(); // open questions by id
const WEB_BUDGET_MS = 30000; // if the official facts aren't stored yet, wait this long for the page read, counted from the ask
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- ask

// Turn whatever the agent said ("MU", "the gym", "Trader Joe's on Mill Ave") into a place with coordinates.
export async function resolvePlace(query) {
  const s = String(query || "").toLowerCase().replace(/[?.!,]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const exact = PLACES.find((p) => p.id === s || p.name.toLowerCase() === s || p.aliases?.includes(s));
  if (exact) return exact;
  const named = PLACES.find((p) => s.includes(p.name.toLowerCase()));
  if (named) return named;
  // Short campus shorthand ("the gym", "starbucks at mu") matches known places by keyword.
  const words = s.split(" ");
  if (words.length <= 3) {
    const byWord = PLACES.find((p) => p.aliases?.some((a) => words.includes(a)));
    if (byWord) return byWord;
  }
  // Anything else: look it up on the map.
  const g = await geocode(query).catch(() => null);
  if (g) {
    const known = PLACES.find((p) => haversineM(g.lat, g.lng, p.lat, p.lng) < 120);
    if (known) return known;
    const slug = g.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "place";
    const p = {
      id: `${slug}-${randomBytes(2).toString("hex")}`, name: g.name, aliases: [g.name.toLowerCase(), s],
      lat: g.lat, lng: g.lng, radiusM: 200, kind: g.kind, tagline: g.address, dynamic: true,
    };
    PLACES.push(p);
    await mongo.addPlace(p).catch(() => {});
    emit("place", { id: p.id, name: p.name, lat: p.lat, lng: p.lng, kind: p.kind });
    return p;
  }
  return findPlace(query);
}

// A place someone clicked on the map (from OpenStreetMap) becomes an Oracle place, so it can get answers.
export async function ensurePlace({ name, lat, lng, kind }) {
  name = String(name || "").trim().slice(0, 80); lat = Number(lat); lng = Number(lng);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Need a name and a location.");
  const known = PLACES.find((p) => (p.name.toLowerCase() === name.toLowerCase() && haversineM(lat, lng, p.lat, p.lng) < 300) || haversineM(lat, lng, p.lat, p.lng) < 12);
  if (known) return { id: known.id, name: known.name, lat: known.lat, lng: known.lng, kind: known.kind };
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "place";
  const p = { id: `${slug}-${randomBytes(2).toString("hex")}`, name, aliases: [name.toLowerCase()], lat, lng, radiusM: 80, kind: kind || "place", tagline: "", dynamic: true };
  PLACES.push(p);
  await mongo.addPlace(p).catch(() => {});
  emit("place", { id: p.id, name: p.name, lat: p.lat, lng: p.lng, kind: p.kind });
  return { id: p.id, name: p.name, lat: p.lat, lng: p.lng, kind: p.kind };
}

export async function ask({ place, question, topic, askedBy = "agent", waitSeconds = RULES.waitSeconds }) {
  const p = await resolvePlace(place);
  if (!p) throw new Error(`Couldn't find "${place}" on the map. Try adding the street or city.`);

  const plan =
    topic && PRESETS[topic] && !question
      ? { topic, question: PRESETS[topic].question(p.name), options: PRESETS[topic].options, sensor: PRESETS[topic].sensor || "poll", thresholds: PRESETS[topic].thresholds }
      : await planQuestion(question, p);

  // 1. Memory: a fresh agreed answer is free and instant.
  const mem = await tiger.recentConsensus(p.id, plan.topic, RULES.cacheMinutes);
  if (mem) {
    let answer = mem.answer_text;
    if (mem.avg_value != null && plan.sensor === "people_count") answer = `About ${Math.round(mem.avg_value)} people`;
    if (mem.avg_value != null && plan.sensor === "noise") answer = `${mem.answer_text} (~${Math.round(mem.avg_value)} dB)`;
    if (mem.avg_value != null && plan.sensor === "wifi") answer = `${mem.answer_text} (~${Math.round(mem.avg_value * 10) / 10} Mbps)`;
    const result = {
      status: "answered", source: "memory", place: p.name, question: plan.question,
      answer, option: mem.option, votes: mem.n, as_of: mem.last_time,
      note: `Reported by people on the ground ${minutesAgo(mem.last_time)}.`,
    };
    emit("answer", { ...result, placeId: p.id });
    console.log(`Ask "${plan.question}" @ ${p.name}: answered from memory (${minutesAgo(mem.last_time)})`);
    return result;
  }

  // 2. Ask the people who are there.
  const q = {
    _id: randomUUID().slice(0, 8), placeId: p.id, place: p.name, topic: plan.topic,
    question: plan.question, options: plan.options, sensor: plan.sensor || "poll", thresholds: plan.thresholds || null,
    askedBy, status: "open", votes: [], createdAt: new Date(),
  };
  await mongo.saveQuestion(q);
  const L = { q, dispute: null, settled: false, tasks: new Map() };
  L.done = new Promise((resolve) => { L.resolve = resolve; });
  live.set(q._id, L);

  // Hours, schedules, menus: the place publishes these, so read its official page while people are being asked.
  if (webCanAnswer(p, question || q.question)) {
    L.web = webAnswer(p, q.question, q.options, WEB_BUDGET_MS).then((w) => (L.webResult = w));
    L.web.catch(() => {});
    emit("web", { id: q._id, placeId: p.id, place: p.name, url: p.web.url });
  }
  const people = await mongo.pickResponders(p);
  L.pinged = people.length;
  L.pingedIds = new Set(people.map((u) => u._id));
  // Too few people to reach a vote: one photo, read by Gemini, settles it instead.
  if (q.sensor === "poll" && people.length > 0 && people.length < RULES.minVotes) {
    q.sensor = "photo";
    q.fewPeople = people.length;
    await mongo.updateQuestion(q._id, { sensor: "photo", fewPeople: people.length });
  }
  console.log(`Ask "${q.question}" @ ${p.name} (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}): sent to ${people.length}` +
    (people.length ? ` -> ${people.map((u) => `${u.name} [${u.channel}]`).join(", ")}` : " (nobody nearby or active)"));
  emit("question", {
    id: q._id, placeId: p.id, place: p.name, question: q.question, options: q.options, askedBy,
    pinged: people.length, pingedNames: people.map((u) => u.name), sensor: q.sensor,
  });
  for (const u of people) {
    // Each person gets the request where they chose at sign-up. Chat apps answer natively;
    // only people who chose the Oracle app get a notification that opens the app.
    const url = u.channel === "app" ? `${env.publicUrl}/app?q=${q._id}` : null;
    // Tell each person how far away it is, so they can tell whether they can answer.
    const mine = { ...q, note: u.distM > 80 ? `📍 ${(u.distM / 1609.34).toFixed(1)} mi from you` : null };
    if (q.sensor === "poll" || !channels[u.channel]?.sendTask) send(u, "sendPoll", mine, url);
    else send(u, "sendTask", mine, url);
  }

  // Nobody nearby: don't make the agent wait, answer from past reports now.
  L.deadline = setTimeout(() => onDeadline(L), people.length ? RULES.deadlineSeconds * 1000 : 0);

  const result = await Promise.race([L.done, sleep(waitSeconds * 1000).then(() => null)]);
  return (
    result || {
      status: "pending", question_id: q._id, place: p.name, question: q.question,
      votes_so_far: q.votes.length, pinged: people.length,
      note: "Still collecting answers from people nearby. Call get_answer with this question_id shortly.",
    }
  );
}

export async function getAnswer(id, waitSeconds = 0) {
  // If it's still being answered, wait a little for it to settle instead of making the agent poll.
  const L = live.get(id);
  if (L && !L.settled && waitSeconds > 0) {
    const r = await Promise.race([L.done, sleep(Math.min(waitSeconds, 40) * 1000).then(() => null)]);
    if (r) return r;
  }
  const q = await mongo.getQuestion(id);
  if (!q) throw new Error(`No question ${id}`);
  if (q.status === "resolved") return q.result;
  return { status: q.status, question_id: id, place: q.place, question: q.question, votes_so_far: (q.votes || []).length };
}

// ---------------------------------------------------------------- votes

export async function recordVote(userId, questionId, option, value = null, extra = {}) {
  const L = live.get(questionId);
  if (!L || L.settled) return "This one is already answered. Thanks anyway! 🦉";
  option = option == null ? null : Number(option);
  if (option !== null && ![1, 2, 3].includes(option)) return "That option doesn't exist.";
  if (option === null && L.q.sensor !== "report") return "That option doesn't exist.";
  if (L.q.votes.some((v) => v.userId === userId)) return "You already answered this one.";

  const user = await mongo.getUser(userId);
  const trust = user?.trust ?? 1;
  const vote = { userId, name: user?.name || "someone", option, trust, at: new Date(), ...(value != null && { value }), ...extra };
  L.q.votes.push(vote);

  await Promise.all([
    mongo.pushVote(questionId, vote),
    mongo.addCredits(userId, RULES.creditVote, { answered: 1 }),
    tiger.saveAnswer({
      questionId, placeId: L.q.placeId, topic: L.q.topic, option: option ?? 0,
      answerText: option ? L.q.options[option - 1] : (extra.text || "").slice(0, 300),
      questionText: L.q.question, userId, trust, source: extra.photoId ? "photo" : "people", value,
    }),
  ]);

  emit("vote", {
    id: questionId, placeId: L.q.placeId, place: L.q.place, name: vote.name, trust,
    option, answer: option ? L.q.options[option - 1] : extra.text, tally: tally(L.q.votes), options: L.q.options,
    value, unit: unitOf(L.q.sensor), sensor: L.q.sensor, text: extra.text, photoId: extra.photoId,
  });
  checkConsensus(L);
  return option ? `Got it: ${L.q.options[option - 1]}. +${RULES.creditVote} point 🦉` : `Got it, thanks! +${RULES.creditVote} point 🦉`;
}

function tally(votes) {
  return [1, 2, 3].map((option) => {
    const vs = votes.filter((v) => v.option === option);
    return { option, n: vs.length, weight: round(vs.reduce((s, v) => s + v.trust, 0)) };
  });
}

function best(L) {
  const t = tally(L.q.votes);
  const top = [...t].sort((a, b) => b.weight - a.weight)[0];
  const total = t.reduce((s, x) => s + x.weight, 0) || 1;
  return { top, confidence: round(top.weight / total) };
}

function checkConsensus(L) {
  if (L.settled) return;
  const everyoneAnswered = L.pinged > 0 && L.q.votes.length >= L.pinged;

  // Sensor readings are measurements, not opinions: once enough phones report, take the median.
  if (L.q.sensor && L.q.sensor !== "poll") {
    const n = L.q.votes.length;
    if (everyoneAnswered && n > 0) return finalize(L);
    if (L.q.fewPeople && L.q.votes.some((v) => v.photoId)) return finalize(L);
    if (n >= RULES.minVotes && !L.grace) {
      emit("consensus", { id: L.q._id, placeId: L.q.placeId, answer: `${n} readings in`, waiting: L.pinged - n, seconds: RULES.graceSeconds });
      L.grace = setTimeout(() => finalize(L), RULES.graceSeconds * 1000);
    }
    return;
  }

  const { top } = best(L);
  if (top.n >= RULES.minVotes && top.weight >= RULES.minWeight) {
    // Consensus. Give the rest of the room a few seconds so every vote shows, then settle.
    if (everyoneAnswered || RULES.graceSeconds <= 0) return finalize(L);
    if (!L.grace) {
      emit("consensus", { id: L.q._id, placeId: L.q.placeId, answer: L.q.options[top.option - 1], waiting: L.pinged - L.q.votes.length, seconds: RULES.graceSeconds });
      L.grace = setTimeout(() => finalize(L), RULES.graceSeconds * 1000);
    }
    return;
  }
  if (L.grace && everyoneAnswered) return finalize(L);
  if (L.q.votes.length >= RULES.disputeAt && !L.dispute && !L.grace) {
    return startDispute(L).catch((e) => console.error("Dispute failed:", e.message));
  }
  // Everyone has answered, no agreement, too few for a photo dispute: report the split now.
  if (everyoneAnswered && !L.dispute) {
    const { confidence } = best(L);
    return settle(L, { source: "people", option: top.option, votes: top.n, confidence, lowConfidence: true, note: "People disagreed; this is the most common answer." });
  }
}

function finalize(L) {
  clearTimeout(L.grace);
  if (L.q.sensor === "report" && !L.q.votes.some((v) => v.text)) {
    const { top, confidence } = best(L);
    return settle(L, { source: "people", option: top.option, votes: top.n, confidence });
  }
  if (L.q.sensor === "report") {
    return summarizeReports({ question: L.q.question, place: L.q.place, reports: L.q.votes })
      .catch(() => L.q.votes.map((v) => v.text).join(" / "))
      .then((summary) => settle(L, { source: "people", option: null, answerText: summary, votes: L.q.votes.length }));
  }
  if (L.q.sensor === "photo") {
    const { top, confidence } = best(L);
    const few = L.q.fewPeople ? `Only ${L.q.fewPeople} ${L.q.fewPeople === 1 ? "person" : "people"} nearby, so Oracle asked for a photo. ` : "";
    // With only 1-2 people, a tap alone isn't proof; only a photo Gemini has read makes it a solid answer.
    if (L.q.fewPeople && !L.q.votes.some((v) => v.photoId && v.option === top.option)) {
      return settle(L, { source: "people", option: top.option, votes: top.n, confidence, lowConfidence: true, note: `${few}No photo came in, so this is one tap, unverified.` });
    }
    return settle(L, { source: "photo", option: top.option, votes: top.n, confidence, note: few ? `${few}Gemini read the photo.` : undefined });
  }
  if (L.q.sensor && L.q.sensor !== "poll") {
    const values = L.q.votes.filter((v) => v.value != null).map((v) => v.value);
    if (!values.length) {
      const { top, confidence } = best(L);
      return settle(L, { source: "people", option: top.option, votes: top.n, confidence });
    }
    const option = bucket(median(values), L.q.thresholds);
    const spread = Math.max(...values) - Math.min(...values);
    const confidence = round(Math.max(0.3, 1 - spread / (Math.abs(median(values)) + 1) / 2));
    return settle(L, { source: "people", option, votes: values.length, confidence });
  }
  const { top, confidence } = best(L);
  return settle(L, { source: "people", option: top.option, votes: top.n, confidence });
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

  // Blur personal details before the photo goes anywhere; the original is dropped.
  const { buffer } = await maskPII(Buffer.from(base64, "base64"), v.pii_boxes || []);
  const photoId = passed ? await mongo.savePhoto({ questionId: L.q._id, placeId: L.q.placeId, buffer }) : null;
  emit("photo", {
    id: L.q._id, placeId: L.q.placeId, place: L.q.place, passed, reason: v.reason, distanceM,
    answer: passed ? L.q.options[option - 1] : null, image: `data:image/jpeg;base64,${buffer.toString("base64")}`,
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
  if (photoId) L.q.votes.push({ userId: user?._id, name: user?.name, option, trust: user?.trust ?? 1, photoId, description: v.reason, disputePhoto: true });
  await settle(L, {
    source: "photo", option, votes: L.q.votes.filter((x) => x.option === option && !x.disputePhoto).length,
    confidence: round(Number(v.confidence)), evidence: v.reason, location_verified: locationOk === true,
  });
  return { ok: true, message: `Verified: ${v.reason} You earned ${RULES.creditPhoto} credits.` };
}

// ---------------------------------------------------------------- phone sensors

function findTask(token) {
  for (const L of live.values()) {
    const t = L.tasks?.get(token);
    if (t && !L.settled) return { L, t };
  }
  return null;
}

export function senseInfo(token) {
  const f = findTask(token);
  if (!f) return null;
  const p = findPlace(f.L.q.placeId);
  return {
    question: f.L.q.question, place: f.L.q.place, placeId: f.L.q.placeId, lat: p?.lat, lng: p?.lng,
    sensor: f.L.q.sensor || "poll", options: f.L.q.options, done: f.t.done,
    votes: f.L.q.votes.length, pinged: f.L.pinged ?? 0,
  };
}

// Privacy-mask a photo and store only the masked version. Returns { photoId, dataUrl, analysis }.
async function maskedPhoto(L, body) {
  const base64 = String(body.image || "").replace(/^data:[^,]+,/, "");
  if (!base64) throw new Error("No photo received.");
  const p = findPlace(L.q.placeId);
  let analysis;
  try {
    analysis = await analyzePhoto({ base64, mime: body.mime, place: p, question: L.q.question, options: L.q.options || ["Low", "Medium", "High"], sensor: L.q.sensor });
  } catch (e) {
    // If the vision check is down, still take the photo but blur all of it, so nothing personal ever leaks.
    console.error("Photo check failed, blurring the whole photo:", e.message);
    analysis = { failed: true, shows_place: true, count: null, option: null, description: "Photo received (fully blurred for privacy).", pii_boxes: [[0, 0, 1000, 1000]] };
  }
  if (!analysis.shows_place) throw new Error(`Not accepted: ${analysis.description || "that doesn't look like a photo of the place"}`);
  const { buffer, masked } = await maskPII(Buffer.from(base64, "base64"), analysis.pii_boxes || []);
  const photoId = await mongo.savePhoto({ questionId: L.q._id, placeId: L.q.placeId, buffer });
  return { photoId, masked, analysis, dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}` };
}

// The Live Request screen submits here. Body may hold:
//   option (1-3), db (noise reading), image (photo), text (report), lat/lng.
// What's required depends on the question's sensor; the rest are optional extras.
export async function submitReading(token, body) {
  const f = findTask(token);
  if (!f) return { ok: false, message: "This request has expired or the question is already answered." };
  const { L, t } = f;
  if (t.done) return { ok: false, message: "You already answered this one." };
  const sensor = L.q.sensor || "poll";
  let option = [1, 2, 3].includes(Number(body.option)) ? Number(body.option) : null;
  let value = null, extra = {}, shown = null;
  const db = Number.isFinite(Number(body.db)) && body.db !== null && body.db !== "" ? Math.round(Math.min(120, Math.max(20, Number(body.db)))) : null;
  const mbps = Number.isFinite(Number(body.mbps)) && body.mbps !== null && body.mbps !== "" ? Math.round(Math.min(2000, Math.max(0, Number(body.mbps))) * 10) / 10 : null;

  try {
    // Every request can be answered with one tap; a reading or photo just makes it precise.
    if (sensor === "noise") {
      if (db != null) { value = db; option = bucket(db, L.q.thresholds); }
      else if (!option) return { ok: false, message: "Tap an answer or send a voice note." };
    } else if (sensor === "wifi") {
      // The phone downloaded the 1 MB test file and reports the speed it got.
      if (mbps != null) { value = mbps; option = bucket(mbps, L.q.thresholds); }
      else if (!option) return { ok: false, message: "Tap an answer or run the speed test." };
    } else if (sensor === "report") {
      const text = String(body.text || "").trim().slice(0, 500);
      if (!text && !option) return { ok: false, message: "Reply with what you found out." };
      if (text) extra.text = text;
    } else if (sensor === "people_count" && !body.image && typedCount(body) != null) {
      // Someone typed the number they can see. It counts like a tap; a photo is what earns the bonus.
      value = typedCount(body); option = bucket(value, L.q.thresholds); extra.typed = true;
    } else if ((sensor === "people_count" || sensor === "photo") && !body.image && !option) {
      return { ok: false, message: sensor === "people_count" ? "Tap an answer, type the number, or send a photo." : "Tap an answer or send a photo." };
    } else if (sensor === "poll" && !option) {
      return { ok: false, message: "Pick an answer first." };
    }

    if (body.image) {
      const m = await maskedPhoto(L, body);
      shown = m.dataUrl;
      extra.photoId = m.photoId;
      extra.description = m.analysis.description;
      if (m.analysis.failed && !option) {
        // The photo couldn't be read right now: don't guess. The person taps the answer instead.
        return { ok: false, message: `Couldn't read the photo right now. Tap the answer that fits: ${(L.q.options || []).map((o, n) => `${n + 1} = ${o}`).join(", ")}.` };
      }
      if (sensor === "people_count" && !m.analysis.failed) { value = Math.max(0, Math.round(Number(m.analysis.count) || 0)); option = bucket(value, L.q.thresholds); }
      if (sensor === "photo" && !option) option = [1, 2, 3].includes(Number(m.analysis.option)) ? Number(m.analysis.option) : 2;
      emit("photo", { id: L.q._id, placeId: L.q.placeId, place: L.q.place, passed: true, masked: m.masked, reason: extra.text || m.analysis.description, image: m.dataUrl });
    }
  } catch (e) {
    console.error("Reading failed:", e.message);
    return { ok: false, message: /^(Not accepted|No photo)/.test(e.message) ? e.message : "Couldn't process that. Try again." };
  }

  // A noise reading attached to any other question still becomes noise data for the place.
  if (db != null && sensor !== "noise") {
    const nb = bucket(db, [55, 70]);
    tiger.saveAnswer({ questionId: L.q._id, placeId: L.q.placeId, topic: "noise", option: nb, answerText: ["Quiet", "Chatty", "Loud"][nb - 1], questionText: `How loud is ${L.q.place}?`, userId: t.userId, source: "people", value: db }).catch(() => {});
    extra.noiseDb = db;
  }

  t.done = true;
  // A real measurement (photo, noise reading or speed test) earns the sensor bonus.
  const photoBonus = extra.photoId || (sensor === "noise" && db != null) || (sensor === "wifi" && mbps != null) ? RULES.creditPhoto - RULES.creditVote : 0;
  if (photoBonus > 0) await mongo.addCredits(t.userId, photoBonus);
  await recordVote(t.userId, L.q._id, option, value, extra);
  const unit = unitOf(sensor);
  const what = value != null ? `${value} ${unit}` : option ? L.q.options[option - 1] : extra.text ? "your report" : "your photo";
  return { ok: true, value, unit, image: shown, points: RULES.creditVote + photoBonus, message: `Sent: ${what}. +${RULES.creditVote + photoBonus} point${RULES.creditVote + photoBonus === 1 ? "" : "s"} 🦉` };
}

// "23", "about 23", "23 people" -> 23. Anything else (or an absurd number) is not a count.
function typedCount(body) {
  const raw = body.count ?? body.text;
  if (raw == null || raw === "") return null;
  const m = String(raw).trim().match(/^\D{0,15}(\d{1,4})\D{0,15}$/);
  return m ? Number(m[1]) : null;
}
const unitOf = (sensor) => (sensor === "noise" ? "dB" : sensor === "people_count" ? "people" : sensor === "wifi" ? "Mbps" : "");
export const photoById = (id) => mongo.getPhoto(id);
const bucket = (v, th) => (!th ? 2 : v < th[0] ? 1 : v < th[1] ? 2 : 3);
function median(xs) {
  const a = [...xs].sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// ---------------------------------------------------------------- deadline + web fallback

async function onDeadline(L) {
  if (L.settled) return;
  if (L.dispute && Date.now() < L.dispute.expires) {
    L.deadline = setTimeout(() => onDeadline(L), L.dispute.expires - Date.now() + 1000);
    return;
  }

  if (L.q.votes.length === 0) return answerFromHistory(L);
  if (L.q.sensor === "photo" && L.q.votes.some((v) => v.photoId)) return finalize(L);
  // A phone measured it (people counted in a photo, decibels, Mbps): that reading stands even if few answered.
  if (["people_count", "noise", "wifi"].includes(L.q.sensor) && L.q.votes.some((v) => v.value != null && !v.typed)) return finalize(L);

  const t = tally(L.q.votes);
  const best = [...t].sort((a, b) => b.weight - a.weight)[0];
  const total = t.reduce((s, x) => s + x.weight, 0);
  return settle(L, {
    source: "people", option: best.option, votes: best.n, confidence: round(best.weight / total),
    lowConfidence: true, note: "Low confidence: not enough people agreed.",
  });
}

// ---------------------------------------------------------------- nobody answered: past reports

const ago = (t) => minutesAgo(t);

// Nobody is there. Best to worst: what people reported here before, what people reported
// at a similar place (plus an estimate), and finally a plain estimate. Each is labeled so the agent knows.
async function answerFromHistory(L) {
  const q = L.q, p = findPlace(q.placeId) || { id: q.placeId, name: q.place };
  try {
    if (L.web) {
      // Wait for the official page only as long as its budget allows, so nobody waits past 40 seconds.
      const left = Math.max(0, WEB_BUDGET_MS - (Date.now() - q.createdAt.getTime()));
      const w = await Promise.race([L.web, sleep(left).then(() => null)]);
      if (w?.option) {
        tiger.saveAnswer({ questionId: q._id, placeId: p.id, topic: q.topic, option: w.option, answerText: q.options[w.option - 1], questionText: q.question, source: "web" }).catch(() => {});
        return settle(L, {
          source: "web", option: w.option, confidence: 0.5, evidence: w.evidence, source_url: w.source_url, as_of: w.as_of,
          note: `Nobody at ${p.name} answered. This comes from the place's official page, not from a person there.`,
        });
      }
    }
    const last = await tiger.lastAnswer(p.id, q.topic);
    if (last) {
      return settle(L, {
        source: "past_report", option: last.option, answerText: last.answer_text || q.options[last.option - 1],
        confidence: 0.4, as_of: last.time,
        note: `Nobody is at ${p.name} right now. This is the last report from people here, ${ago(last.time)}.`,
      });
    }
    const others = await tiger.sameTopicElsewhere(p.id, q.topic);
    const known = others.map((r) => ({ r, place: findPlace(r.place_id) })).filter((x) => x.place);
    const pick = known.find((x) => x.place.kind && x.place.kind === p.kind) || known[0];
    const similar = pick && { place: pick.place.name, answer: pick.r.answer_text || q.options[pick.r.option - 1], ago: ago(pick.r.time) };
    const est = await estimateAnswer({ place: p, question: q.question, options: q.options, similar }).catch(() => null);
    const option = [1, 2, 3].includes(Number(est?.option)) ? Number(est.option) : similar ? pick.r.option : null;
    if (similar) {
      return settle(L, {
        source: "similar_place", option, confidence: 0.25, similar_place: similar,
        note: `Nobody has reported from ${p.name} yet. At ${similar.place}, people reported "${similar.answer}" ${similar.ago}, so this is an estimate.${est?.reason ? " " + est.reason : ""}`,
      });
    }
    if (option) {
      return settle(L, {
        source: "estimate", option, confidence: 0.15,
        note: `Nobody is at ${p.name} and nobody has reported on this before. This is an AI estimate, not a report.${est?.reason ? " " + est.reason : ""}`,
      });
    }
  } catch (e) {
    console.error("History fallback failed:", e.message);
  }
  return settle(L, { source: "none", option: null, note: `Nobody is at ${p.name} right now and there are no past reports.` });
}

// ---------------------------------------------------------------- settle, pay, remember

async function settle(L, r) {
  if (L.settled) return;
  L.settled = true;
  clearTimeout(L.deadline);
  clearTimeout(L.grace);
  live.delete(L.q._id);

  const q = L.q;
  const result = {
    status: "answered", question_id: q._id, place: q.place, question: q.question,
    answer: r.option ? q.options[r.option - 1] : null, option: r.option ?? null, source: r.source,
    votes: r.votes ?? 0, total_votes: q.votes.length, confidence: r.confidence ?? null,
    answered_in_s: Math.round((Date.now() - q.createdAt.getTime()) / 1000),
  };
  for (const k of ["evidence", "source_url", "note", "location_verified", "as_of", "similar_place"]) if (r[k] !== undefined) result[k] = r[k];
  if (r.answerText) result.answer = r.answerText;
  const photos = q.votes.filter((v) => v.photoId).map((v) => v.photoId);
  if (photos.length) result.photos = photos.map((id) => `${env.publicUrl}/api/photos/${id}`);
  const seen = q.votes.filter((v) => v.description).map((v) => v.description);
  if (seen.length) result.observations = seen;
  if (q.sensor === "report") result.reports = q.votes.filter((v) => v.text).map((v) => ({ from: v.name, text: v.text }));
  if (photos.length) result.privacy = "Faces, name badges, screens and plates are blurred; originals are never stored.";
  const readings = q.votes.filter((v) => v.value != null).map((v) => v.value);
  if (q.sensor !== "poll" && readings.length) {
    const mid = median(readings), unit = unitOf(q.sensor);
    result.measured = { sensor: q.sensor, median: mid, unit, readings, phones: readings.length };
    result.answer = q.sensor === "people_count"
      ? `About ${Math.round(mid)} people`
      : `${result.answer || q.options[bucket(mid, q.thresholds) - 1]} (~${q.sensor === "wifi" ? Math.round(mid * 10) / 10 : Math.round(mid)} ${unit})`;
  }
  if (L.webResult?.evidence && r.source !== "web") result.official = { says: L.webResult.evidence, source_url: L.webResult.source_url };
  result.earners_nearby = L.pinged ?? 0;

  await mongo.updateQuestion(q._id, { status: "resolved", result, resolvedAt: new Date() });
  emit("answer", { ...result, placeId: q.placeId });
  L.resolve(result);

  // Reward and re-weight only when the answer is solid.
  emit("settled_media", { id: q._id, photos: result.photos || [] });
  if (!r.option || r.lowConfidence || !["people", "photo"].includes(r.source)) return;
  await mongo.updateTrust(q.votes, r.option);
  for (const v of q.votes) {
    const u = await mongo.getUser(v.userId);
    if (!u) continue;
    if (v.option !== r.option) {
      send(u, "sendText", `🦉 Settled: ${q.place} is "${result.answer}". Others saw it differently this time.`);
    } else if (v.disputePhoto) {
      continue; // already paid the photo reward in submitPhoto
    } else if (solanaEnabled()) {
      // A verified photo earns the photo reward; a tap earns the vote reward.
      if (v.photoId) payUser(u, env.rewardPhotoSol, "verified photo");
      else payUser(u, env.rewardVoteSol, "matching answer");
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

// ---------------------------------------------------------------- joins

// Channels call this when someone checks in, so the dashboard can show them arriving.
export async function announceJoin(user, placeId) {
  const p = placeId ? findPlace(placeId) : null;
  const counts = await mongo.peopleByPlace();
  const total = await mongo.questionStats().then((x) => x.people).catch(() => 0);
  emit("join", { userId: user._id, name: user.name, channel: user.channel, placeId: p?.id || null, place: p?.name || "nearby", here: p ? counts[p.id] || 0 : 0, total });
}

// ---------------------------------------------------------------- earner app

// Open requests this person was asked and hasn't answered yet.
export function pendingFor(userId) {
  const out = [];
  for (const L of live.values()) {
    if (L.settled || !L.pingedIds?.has(userId) || L.q.votes.some((v) => v.userId === userId)) continue;
    out.push({
      id: L.q._id, place: L.q.place, placeId: L.q.placeId, question: L.q.question, options: L.q.options,
      sensor: L.q.sensor, askedBy: L.q.askedBy, at: L.q.createdAt, answered: L.q.votes.length, pinged: L.pinged,
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

// Chat channels: which open request does an incoming photo / voice note / text belong to?
export function findRequestFor(userId, kind, text = "") {
  const open = pendingFor(userId);
  const number = kind === "text" && typedCount({ text }) != null;
  const prefer = { photo: ["photo", "people_count", "report", "poll"], voice: ["noise", "poll"], text: number ? ["people_count", "report"] : ["report"] }[kind] || [];
  for (const s of prefer) { const r = open.find((x) => x.sensor === s); if (r) return r.id; }
  return null;
}
export const answerRequest = (...a) => answerFromApp(...a);

// One submit from the app: a tap answer, plus an optional photo and an optional 5-second noise reading.
// Sensor questions (noise / people count / photo / report) go through the same path as the Telegram mini page.
// Failures carry a `code` so clients can react without parsing text:
//   already_answered (this person's answer is recorded), closed (settled or expired), not_for_you.
export async function answerFromApp(userId, questionId, body = {}) {
  const L = live.get(questionId);
  if (!L || L.settled) {
    // A retry after a dropped connection: tell the person their first answer counted.
    const saved = await mongo.getQuestion(questionId).catch(() => null);
    if (saved?.votes?.some((v) => v.userId === userId)) return { ok: false, code: "already_answered", message: "You already answered this one." };
    return { ok: false, code: "closed", message: "This request is already answered. Thanks anyway!" };
  }
  if (!L.pingedIds?.has(userId)) return { ok: false, code: "not_for_you", message: "This request isn't for you." };
  if (L.q.votes.some((v) => v.userId === userId)) return { ok: false, code: "already_answered", message: "You already answered this one." };

  if (L.q.sensor !== "poll") {
    let token = [...L.tasks.entries()].find(([, t]) => t.userId === userId)?.[0];
    if (!token) { token = randomBytes(10).toString("base64url"); L.tasks.set(token, { userId, done: false }); }
    return submitReading(token, body);
  }

  let option = Number(body.option);
  if (![1, 2, 3].includes(option) && !body.image) return { ok: false, message: "Pick an answer first." };
  const extra = {};
  let image = null;
  if (body.image) {
    try {
      const m = await maskedPhoto({ ...L, q: { ...L.q, sensor: "photo" } }, body);
      // A photo on its own answers the poll: Gemini reads which option it shows.
      if (![1, 2, 3].includes(option)) option = Number(m.analysis.option);
      if (![1, 2, 3].includes(option)) return { ok: false, message: `Couldn't read an answer from the photo. Tap the one that fits: ${L.q.options.map((o, n) => `${n + 1} = ${o}`).join(", ")}.` };
      extra.photoId = m.photoId; extra.description = m.analysis.description; image = m.dataUrl;
      emit("photo", { id: L.q._id, placeId: L.q.placeId, place: L.q.place, passed: true, masked: m.masked, reason: m.analysis.description, image });
      await mongo.addCredits(userId, RULES.creditPhoto - RULES.creditVote);
    } catch (e) {
      return { ok: false, message: e.message.startsWith("Not accepted") ? e.message : "Couldn't process the photo. Try again or skip it." };
    }
  }
  let noise = null;
  if (Number.isFinite(Number(body.db))) {
    const db = Math.round(Math.min(120, Math.max(20, Number(body.db))));
    const nOpt = bucket(db, [55, 70]);
    const u = await mongo.getUser(userId);
    await tiger.saveNoise({ questionId, placeId: L.q.placeId, option: nOpt, answerText: ["Quiet", "Chatty", "Loud"][nOpt - 1], userId, trust: u?.trust, value: db });
    noise = db;
    emit("noise", { placeId: L.q.placeId, place: L.q.place, db });
  }
  const msg = await recordVote(userId, questionId, option, null, extra);
  const points = RULES.creditVote + (extra.photoId ? RULES.creditPhoto - RULES.creditVote : 0);
  return { ok: true, image, noise, points, message: `${msg.replace(/\+\d+ points? 🦉/, "").trim()} +${points} point${points === 1 ? "" : "s"} 🦉` };
}

const TOPIC_KEYS = { line_length: "line", noise: "noise", crowd: "crowd", people_count: "people" };

// Everything the app's map needs, one call.
export async function placesForApp() {
  const [latest, counts, rows] = await Promise.all([mongo.latestAnswers(24), mongo.peopleByPlace(), tiger.latestByPlace()]);
  const resolved = Object.fromEntries(latest.map((x) => [x._id, x.q]));
  return PLACES.map((p) => {
    const mine = rows.filter((r) => r.place_id === p.id);
    const live = {};
    for (const r of mine) if (TOPIC_KEYS[r.topic]) live[TOPIC_KEYS[r.topic]] = { answer: r.answer_text, option: r.option, value: r.value, at: r.time };
    const q = resolved[p.id];
    return {
      id: p.id, name: p.name, lat: p.lat, lng: p.lng, kind: p.kind || "place", tagline: p.tagline || "", dynamic: Boolean(p.dynamic),
      people_here: counts[p.id] || 0, live,
      headline: q ? { question: q.question, answer: q.result.answer, option: q.result.option, source: q.result.source,
        confidence: q.result.confidence, votes: q.result.votes, at: q.resolvedAt } : null,
    };
  });
}

export async function placeDetail(placeId) {
  const p = findPlace(placeId);
  if (!p) throw new Error("Unknown place");
  const all = await placesForApp();
  const [photo, history, trend] = await Promise.all([
    mongo.latestPhoto(p.id), mongo.placeHistory(p.id), tiger.trend(p.id, "line_length"),
  ]);
  return {
    ...all.find((x) => x.id === p.id),
    photo: photo ? `/api/photos/${photo._id}` : null,
    photoAt: photo?.createdAt || null,
    history: history.map((h) => ({ question: h.question, answer: h.result.answer, source: h.result.source, votes: h.result.votes, at: h.resolvedAt })),
    trend,
  };
}

// ---------------------------------------------------------------- spending points

// Points -> devnet SOL, sent to the person's own wallet if they linked one.
export async function cashOut(userId, points) {
  if (!solanaEnabled()) return { ok: false, message: "Cash-outs aren't switched on yet." };
  points = Math.floor(Number(points));
  if (!Number.isFinite(points) || points < env.minCashout) return { ok: false, message: `The minimum cash-out is ${env.minCashout} points.` };
  const user = await mongo.getUser(userId);
  if (!user || user.credits < points) return { ok: false, message: `You have ${user?.credits ?? 0} points.` };
  if (!(await mongo.spendCredit(userId, points))) return { ok: false, message: "Not enough points." };
  const sol = Math.round((points / env.pointsPerSol) * 1e6) / 1e6;
  const to = user.payoutWallet || user.wallet.pub;
  try {
    const { signature, url } = await pay(to, sol);
    await tiger.savePayout({ userId, amountSol: sol, reason: `cash-out of ${points} points`, signature, url });
    await mongo.addCredits(userId, 0, { earnedSol: sol });
    emit("payout", { name: user.name, amount: sol, reason: "cash-out", url });
    return { ok: true, sol, url, to, message: `Sent ${sol} SOL to ${to.slice(0, 4)}…${to.slice(-4)}.` };
  } catch (e) {
    await mongo.addCredits(userId, points); // refund
    return { ok: false, message: `Payment failed, your points are back: ${e.message}` };
  }
}

export async function redeemReward(userId, reward) {
  const user = await mongo.getUser(userId);
  const r = user && (await mongo.redeem(user, reward));
  if (!r) return { ok: false, message: `${reward.name} needs ${reward.points} points. You have ${user?.credits ?? 0}.` };
  emit("redeem", { name: user.name, reward: reward.name, points: reward.points });
  return { ok: true, message: `Redeemed ${reward.name} for ${reward.points} points. Your code will be sent here soon.` };
}

// ---------------------------------------------------------------- views

export async function liveStatus() {
  const [latest, counts] = await Promise.all([mongo.latestAnswers(24 * 14), mongo.peopleByPlace()]);
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
