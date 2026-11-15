// MongoDB Atlas: people, places, and the full history of every question.
import { MongoClient } from "mongodb";
import { env, PLACES, RULES } from "../config.js";
import { newWallet } from "../pay/solana.js";

let db;
export const col = (name) => db.collection(name);

export async function connectMongo() {
  const client = new MongoClient(env.mongoUri);
  await client.connect();
  db = client.db(env.mongoDb);

  await col("users").createIndex({ placeId: 1, trust: -1 });
  await col("questions").createIndex({ status: 1, createdAt: -1 });
  await col("places").createIndex({ location: "2dsphere" });
  await col("users").createIndex({ location: "2dsphere" });
  await col("redemptions").createIndex({ createdAt: -1 });
  // One redemption per tap: the app sends the same idempotency key if a request is repeated.
  await col("redemptions").createIndex({ userId: 1, idemKey: 1 }, { unique: true, partialFilterExpression: { idemKey: { $type: "string" } } });
  await col("redemptions").createIndex({ status: 1, updatedAt: 1 });
  await col("users").createIndex({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: "string" } } });

  // Keep the places collection in sync with config.js, then bring back places discovered earlier.
  const configured = new Set(PLACES.map((p) => p.id));
  for (const doc of await col("places").find({ dynamic: true }).toArray()) {
    if (configured.has(doc._id)) continue;
    const [lng, lat] = doc.location.coordinates;
    PLACES.push({ id: doc._id, name: doc.name, aliases: doc.aliases || [doc.name.toLowerCase()], lat, lng,
      radiusM: doc.radiusM || 200, kind: doc.kind || "place", tagline: doc.address || "", dynamic: true });
  }
  for (const p of PLACES.filter((x) => configured.has(x.id))) {
    await col("places").updateOne(
      { _id: p.id },
      { $set: { name: p.name, radiusM: p.radiusM, location: { type: "Point", coordinates: [p.lng, p.lat] } } },
      { upsert: true }
    );
  }
  console.log("MongoDB connected");
}

// ---------- people ----------

export async function getOrCreateUser({ channel, channelUserId, name }) {
  const _id = `${channel}:${channelUserId}`;
  const existing = await col("users").findOne({ _id });
  if (existing) return existing;
  const user = {
    _id, channel, channelUserId: String(channelUserId), name,
    placeId: null, trust: 1.0, credits: RULES.startCredits,
    answered: 0, correct: 0, earnedSol: 0,
    wallet: newWallet(), // devnet only
    lastPingedAt: null, joinedAt: new Date(),
  };
  await col("users").insertOne(user);
  return user;
}

export const getUser = (id) => col("users").findOne({ _id: id });

export const checkIn = (id, placeId) =>
  col("users").updateOne({ _id: id }, { $set: { placeId, checkedInAt: new Date() } });

// Live location: store it and work out the nearest place with a geo query.
// `accuracy` (metres, from the phone) gives a little slack so a fuzzy fix inside a building still counts.
export async function setLocation(id, lat, lng, accuracy = 0) {
  const point = { type: "Point", coordinates: [lng, lat] };
  const slack = Math.min(Number(accuracy) || 0, 75);
  // Look at every place close by, not just the nearest centre: you can be inside a big
  // building whose centre is farther away than a small café next door.
  const candidates = await col("places")
    .find({ location: { $nearSphere: { $geometry: point, $maxDistance: 600 } } })
    .limit(25).toArray();
  let placeId = null, best = Infinity;
  for (const p of candidates) {
    const [plng, plat] = p.location.coordinates;
    const d = distanceM(lat, lng, plat, plng);
    const over = d - (p.radiusM || 250) - slack;   // <= 0 means you're inside it
    if (over <= 0 && d < best) { best = d; placeId = p._id; }
  }
  const before = await getUser(id);
  // Your live location wins: if it puts you away from every place, you're no longer "at" the old one.
  const set = { location: point, locationAt: new Date(), placeId };
  if (placeId !== before?.placeId) set.checkedInAt = null;
  await col("users").updateOne({ _id: id }, { $set: set });
  return { placeId, changed: Boolean(placeId) && placeId !== before?.placeId, first: !before?.locationAt };
}

// Is any known place within `m` metres of this point?
export async function hasPlaceWithin(lat, lng, m) {
  return Boolean(await col("places").findOne({ location: { $nearSphere: { $geometry: { type: "Point", coordinates: [lng, lat] }, $maxDistance: m } } }));
}

function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Who should get a request about this place:
//   1. people checked in there (they scanned its QR), then
//   2. people whose shared location is within ANSWER_RADIUS_MILES, nearest first.
// Each gets distM so the request can say "0.3 mi from you".
export async function pickResponders(place) {
  const now = Date.now();
  const cutoff = new Date(now - RULES.pingCooldownSec * 1000);
  const fresh = new Date(now - env.activeHours * 3600 * 1000);
  const cool = { $or: [{ lastPingedAt: null }, { lastPingedAt: { $lt: cutoff } }] };

  const checkedIn = await col("users")
    .find({ placeId: place.id, checkedInAt: { $gt: fresh }, ...cool })
    .sort({ trust: -1 }).limit(RULES.maxPings).toArray();
  const nearby = await col("users")
    .find({
      location: { $nearSphere: { $geometry: { type: "Point", coordinates: [place.lng, place.lat] }, $maxDistance: env.answerRadiusMiles * 1609.34 } },
      locationAt: { $gt: fresh }, ...cool,
    })
    .limit(RULES.maxPings).toArray();

  const seen = new Set();
  const people = [];
  for (const u of [...checkedIn, ...nearby]) {
    if (seen.has(u._id)) continue;
    seen.add(u._id);
    const c = u.location?.coordinates;
    u.distM = c && u.locationAt > fresh ? Math.round(distanceM(place.lat, place.lng, c[1], c[0])) : 0;
    people.push(u);
  }
  const picked = people.slice(0, RULES.maxPings);
  if (picked.length) {
    await col("users").updateMany({ _id: { $in: picked.map((p) => p._id) } }, { $set: { lastPingedAt: new Date() } });
  }
  return picked;
}

// A place Claude asked about that isn't in config: remember it (and show it on the maps).
export async function addPlace(p) {
  await col("places").updateOne(
    { _id: p.id },
    { $set: { name: p.name, aliases: p.aliases, radiusM: p.radiusM, kind: p.kind, address: p.tagline, dynamic: true,
      location: { type: "Point", coordinates: [p.lng, p.lat] }, createdAt: new Date() } },
    { upsert: true }
  );
}

export const addCredits = (id, n, extra = {}) =>
  col("users").updateOne({ _id: id }, { $inc: { credits: n, ...extra } });

export async function spendCredit(id, n = RULES.creditAsk) {
  const r = await col("users").updateOne({ _id: id, credits: { $gte: n } }, { $inc: { credits: -n } });
  return r.modifiedCount === 1;
}

export async function updateTrust(votes, winningOption) {
  for (const v of votes) {
    const user = await getUser(v.userId);
    if (!user) continue;
    const right = v.option === winningOption;
    const trust = right
      ? Math.min(RULES.trustMax, user.trust + RULES.trustUp)
      : Math.max(RULES.trustMin, user.trust - RULES.trustDown);
    await col("users").updateOne(
      { _id: user._id },
      { $set: { trust: Math.round(trust * 100) / 100 }, $inc: { correct: right ? 1 : 0 } }
    );
  }
}

// ---------- settings + app notifications ----------

export const getSetting = async (key) => (await col("settings").findOne({ _id: key }))?.value ?? null;
export const setSetting = (key, value) => col("settings").updateOne({ _id: key }, { $set: { value } }, { upsert: true });
export async function addPush(id, sub) {
  await col("users").updateOne({ _id: id }, { $pull: { push: { endpoint: sub.endpoint } } });
  await col("users").updateOne({ _id: id }, { $push: { push: sub } });
}
export const removePush = (id, endpoint) => col("users").updateOne({ _id: id }, { $pull: { push: { endpoint } } });

// Delete an account: the person's record goes; names on past answers become "Deleted user".
export async function deleteUser(id) {
  await col("questions").updateMany({ "votes.userId": id }, { $set: { "votes.$[v].name": "Deleted user" } }, { arrayFilters: [{ "v.userId": id }] });
  await col("users").deleteOne({ _id: id });
}

// Crowd Guess (the in-app game): recent settled questions with a definite answer.
export const gameRounds = (limit = 15) =>
  col("questions")
    .find({ status: "resolved", "result.option": { $in: [1, 2, 3] }, "options.2": { $exists: true } },
      { projection: { place: 1, placeId: 1, question: 1, options: 1, result: 1, resolvedAt: 1 } })
    .sort({ resolvedAt: -1 }).limit(limit).toArray();

// iPhone app device tokens for Apple Push. `sandbox` is true for builds signed for development (Xcode);
// TestFlight and App Store builds use production. `sound` is "oracle" (bundled chime) or "default".
export async function addApns(id, token, sandbox, sound = "oracle") {
  await col("users").updateMany({ "apns.token": token }, { $pull: { apns: { token } } }); // one account per device
  await col("users").updateOne({ _id: id }, { $push: { apns: { token, sandbox: Boolean(sandbox), sound, at: new Date() } } });
}
export const removeApns = (id, token) => col("users").updateOne({ _id: id }, { $pull: { apns: { token } } });
export const setApnsSandbox = (id, token, sandbox) =>
  col("users").updateOne({ _id: id, "apns.token": token }, { $set: { "apns.$.sandbox": Boolean(sandbox) } });

// ---------- rewards ----------

export const setPayoutWallet = (id, address) => col("users").updateOne({ _id: id }, { $set: { payoutWallet: address } });

// ---------- verified wallets (signed challenge) and on-chain redemptions ----------
export const setWalletChallenge = (id, challenge) => col("users").updateOne({ _id: id }, { $set: { walletChallenge: challenge } });
export const setVerifiedWallet = (id, address) =>
  col("users").updateOne({ _id: id }, { $set: { payoutWallet: address, walletVerified: address }, $unset: { walletChallenge: "" } });

/** Inserts a redemption; a repeated idempotency key returns { duplicate } with the earlier one instead. */
export async function createRedemption(doc) {
  try { await col("redemptions").insertOne({ ...doc, updatedAt: new Date() }); return { created: doc }; }
  catch (e) {
    if (e.code !== 11000) throw e;
    return { duplicate: await col("redemptions").findOne({ userId: doc.userId, idemKey: doc.idemKey }) };
  }
}
export const getRedemption = (id) => col("redemptions").findOne({ _id: id });
export const redemptionByKey = (userId, idemKey) => col("redemptions").findOne({ userId, idemKey });
export const myRedemptions = (userId) => col("redemptions").find({ userId }).sort({ createdAt: -1 }).limit(10).toArray();
export const redemptionsIn = (statuses, olderThan) =>
  col("redemptions").find({ status: { $in: statuses }, ...(olderThan ? { updatedAt: { $lt: olderThan } } : {}) }).limit(50).toArray();
/** Moves a redemption to a new state only if it is still in one of `from` (so two taps can't both act). */
export const moveRedemption = (id, from, set, extra = {}) =>
  col("redemptions").findOneAndUpdate({ _id: id, status: { $in: from } }, { $set: { ...set, updatedAt: new Date() }, ...extra }, { returnDocument: "after" });
export const updateRedemption = (id, set, extra = {}) =>
  col("redemptions").updateOne({ _id: id }, { $set: { ...set, updatedAt: new Date() }, ...extra });

/** Takes the points once per redemption ID: a repeat (retry, crash, double tap) can never deduct twice. */
export async function deductForRedemption(userId, rid, points) {
  const r = await col("users").updateOne({ _id: userId, credits: { $gte: points }, redeemIds: { $ne: rid } }, { $inc: { credits: -points }, $push: { redeemIds: rid } });
  return r.modifiedCount === 1;
}
/** Gives the points back once per redemption ID, and only if they were taken. */
export async function refundForRedemption(userId, rid, points) {
  const r = await col("users").updateOne({ _id: userId, redeemIds: rid, refundedIds: { $ne: rid } }, { $inc: { credits: points }, $push: { refundedIds: rid } });
  return r.modifiedCount === 1;
}
export const wasDeducted = async (userId, rid) => Boolean(await col("users").findOne({ _id: userId, redeemIds: rid }, { projection: { _id: 1 } }));
export const fulfillRedemption = (id) => moveRedemption(id, ["awaiting_fulfillment"], { status: "fulfilled", fulfilledAt: new Date() });

export async function redeem(user, reward) {
  if (!(await spendCredit(user._id, reward.points))) return null;
  const r = {
    userId: user._id, name: user.name, channel: user.channel, rewardId: reward.id, reward: reward.name,
    points: reward.points, status: "pending", createdAt: new Date(),
  };
  await col("redemptions").insertOne(r);
  return r;
}

// ---------- photos (already privacy-masked; originals are never stored) ----------

export async function savePhoto({ questionId, placeId, buffer }) {
  const _id = Math.random().toString(36).slice(2, 12);
  await col("photos").insertOne({ _id, questionId, placeId, data: buffer.toString("base64"), createdAt: new Date() });
  return _id;
}
export const getPhoto = (id) => col("photos").findOne({ _id: id });
export const latestPhoto = (placeId) =>
  col("photos").find({ placeId }, { projection: { data: 0 } }).sort({ createdAt: -1 }).limit(1).next();
export const placeHistory = (placeId) =>
  col("questions").find({ placeId, status: "resolved", "result.answer": { $ne: null } }, { projection: { votes: 0 } })
    .sort({ resolvedAt: -1 }).limit(8).toArray();
export const recentResolved = (placeId) =>
  col("questions").find({ placeId, status: "resolved", resolvedAt: { $gt: new Date(Date.now() - 6 * 3600 * 1000) } })
    .sort({ resolvedAt: -1 }).limit(40).toArray();

// The most recent answered questions anywhere, for the dashboard's "Earlier" list.
export const recentAnswered = (n = 12) =>
  col("questions").find({ status: "resolved", "result.answer": { $ne: null } }, { projection: { question: 1, place: 1, placeId: 1, result: 1, resolvedAt: 1 } })
    .sort({ resolvedAt: -1 }).limit(n).toArray();

export const redemptions = () => col("redemptions").find({}).sort({ createdAt: -1 }).limit(50).toArray();

export const leaderboard = () =>
  col("users")
    .find({}, { projection: { wallet: 0 } })
    .sort({ correct: -1, trust: -1 })
    .limit(10)
    .toArray();

export async function peopleByPlace() {
  const rows = await col("users").aggregate([{ $match: { placeId: { $ne: null } } }, { $group: { _id: "$placeId", n: { $sum: 1 } } }]).toArray();
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

// ---------- questions ----------

export const saveQuestion = (q) => col("questions").insertOne(q);
export const updateQuestion = (id, set) => col("questions").updateOne({ _id: id }, { $set: set });
export const pushVote = (id, vote) => col("questions").updateOne({ _id: id }, { $push: { votes: vote } });
export const getQuestion = (id) => col("questions").findOne({ _id: id });

export async function latestAnswers(hours = 1) {
  // Most recent resolved answer per place in the last `hours` hours.
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return col("questions")
    .aggregate([
      { $match: { status: "resolved", resolvedAt: { $gte: since }, "result.answer": { $ne: null } } },
      { $sort: { resolvedAt: -1 } },
      { $group: { _id: "$placeId", q: { $first: "$$ROOT" } } },
    ])
    .toArray();
}

export async function questionStats() {
  const [row] = await col("questions")
    .aggregate([
      { $match: { status: "resolved" } },
      { $group: { _id: null, answered: { $sum: 1 }, avgSeconds: { $avg: "$result.answered_in_s" } } },
    ])
    .toArray();
  const people = await col("users").countDocuments({ channel: { $ne: "dev" } }); // real earners only, not test users
  return { answered: row?.answered || 0, avgSeconds: Math.round(row?.avgSeconds || 0), people };
}
