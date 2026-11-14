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

  // Keep the places collection in sync with config.js.
  for (const p of PLACES) {
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

// Highest-trust people at the place who haven't been pinged in the last minute.
export async function pickResponders(placeId) {
  const cutoff = new Date(Date.now() - RULES.pingCooldownSec * 1000);
  const people = await col("users")
    .find({ placeId, $or: [{ lastPingedAt: null }, { lastPingedAt: { $lt: cutoff } }] })
    .sort({ trust: -1 })
    .limit(RULES.maxPings)
    .toArray();
  if (people.length) {
    await col("users").updateMany({ _id: { $in: people.map((p) => p._id) } }, { $set: { lastPingedAt: new Date() } });
  }
  return people;
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
  const people = await col("users").countDocuments();
  return { answered: row?.answered || 0, avgSeconds: Math.round(row?.avgSeconds || 0), people };
}
