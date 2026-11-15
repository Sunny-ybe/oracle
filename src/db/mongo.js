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
export async function setLocation(id, lat, lng) {
  const point = { type: "Point", coordinates: [lng, lat] };
  const near = await col("places").findOne({
    location: { $nearSphere: { $geometry: point, $maxDistance: 600 } },
  });
  let placeId = null;
  if (near) {
    const [plng, plat] = near.location.coordinates;
    if (distanceM(lat, lng, plat, plng) <= (near.radiusM || 250)) placeId = near._id;
  }
  const before = await getUser(id);
  await col("users").updateOne({ _id: id }, { $set: { location: point, locationAt: new Date(), placeId: placeId ?? before?.placeId ?? null } });
  return { placeId, changed: Boolean(placeId) && placeId !== before?.placeId, first: !before?.locationAt };
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

// ---------- rewards ----------

export const setPayoutWallet = (id, address) => col("users").updateOne({ _id: id }, { $set: { payoutWallet: address } });

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

export async function latestAnswers() {
  // Most recent resolved answer per place in the last hour.
  const since = new Date(Date.now() - 60 * 60 * 1000);
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
