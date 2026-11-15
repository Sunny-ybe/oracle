// Username + password accounts for the Oracle app. Passwords are hashed with scrypt and a random salt.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import * as mongo from "../db/mongo.js";
import { linkToken } from "./auth.js";

const USERNAME = /^[a-z0-9_.]{3,20}$/;
const hash = (password, salt = randomBytes(16).toString("hex")) => `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
const matches = (password, stored) => {
  const [salt, h] = String(stored || "").split(":");
  if (!salt || !h) return false;
  const a = Buffer.from(scryptSync(password, salt, 32).toString("hex")), b = Buffer.from(h);
  return a.length === b.length && timingSafeEqual(a, b);
};
const clean = (u) => String(u || "").trim().toLowerCase().replace(/^@/, "");
function check(username, password) {
  if (!USERNAME.test(username)) throw new Error("Usernames are 3–20 characters: letters, numbers, dots or underscores.");
  if (String(password || "").length < 6) throw new Error("Use a password of at least 6 characters.");
}

// Slow down password guessing: 8 tries per username or address every 10 minutes.
const tries = new Map();
function limit(key) {
  const now = Date.now(), t = (tries.get(key) || []).filter((x) => now - x < 10 * 60e3);
  if (t.length >= 8) throw new Error("Too many attempts. Wait a few minutes and try again.");
  t.push(now); tries.set(key, t);
}

export async function register({ username, password }) {
  username = clean(username); check(username, password);
  if (await mongo.col("users").findOne({ username })) throw new Error("That username is taken. Try another.");
  const u = await mongo.getOrCreateUser({ channel: "app", channelUserId: username, name: username });
  try {
    await mongo.col("users").updateOne({ _id: u._id }, { $set: { username, passHash: hash(password) } });
  } catch { throw new Error("That username is taken. Try another."); }
  return { user: u, token: linkToken(u._id) };
}

export async function login({ username, password }, ip) {
  username = clean(username);
  limit(`u:${username}`); limit(`ip:${ip}`);
  const u = await mongo.col("users").findOne({ username });
  if (!u || !matches(String(password || ""), u.passHash)) throw new Error("Wrong username or password.");
  tries.delete(`u:${username}`);
  return { token: linkToken(u._id), name: u.name };
}

// People who joined before passwords existed can secure their account from Profile.
export async function setCredentials(user, { username, password }) {
  username = clean(username); check(username, password);
  const other = await mongo.col("users").findOne({ username });
  if (other && other._id !== user._id) throw new Error("That username is taken. Try another.");
  await mongo.col("users").updateOne({ _id: user._id }, { $set: { username, passHash: hash(password) } });
  return { ok: true, username };
}
