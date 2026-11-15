// Username + password accounts for the Oracle app. Passwords are hashed with scrypt and a random salt.
import { randomBytes, scryptSync, timingSafeEqual, createPublicKey, verify } from "node:crypto";
import * as mongo from "../db/mongo.js";
import { linkToken } from "./auth.js";
import { env } from "../config.js";

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

const nameOk = (x) => String(x || "").trim().slice(0, 40);
const fullName = (first, last) => [first, last].filter(Boolean).join(" ");

export async function register({ firstName, lastName, username, password, confirm }) {
  const first = nameOk(firstName), last = nameOk(lastName);
  if (!first || !last) throw new Error("Add your first and last name.");
  username = clean(username); check(username, password);
  if (confirm !== undefined && confirm !== password) throw new Error("The two passwords don't match.");
  if (await mongo.col("users").findOne({ username })) throw new Error("That username is taken. Try another.");
  const u = await mongo.getOrCreateUser({ channel: "app", channelUserId: username, name: fullName(first, last) });
  try {
    await mongo.col("users").updateOne({ _id: u._id }, { $set: { username, passHash: hash(password), firstName: first, lastName: last, name: fullName(first, last) } });
  } catch { throw new Error("That username is taken. Try another."); }
  return { user: { ...u, name: fullName(first, last) }, token: linkToken(u._id) };
}

// Google and Microsoft: the provider vouches for who you are, so no password is needed.
async function oauthUser(provider, id, { first, last, email }) {
  const key = `${provider}:${id}`;
  let u = await mongo.col("users").findOne({ oauth: key });
  if (!u) {
    u = await mongo.getOrCreateUser({ channel: "app", channelUserId: `${provider}-${id}`, name: fullName(first, last) || email || "Oracle user" });
    await mongo.col("users").updateOne({ _id: u._id }, { $set: { oauth: key, firstName: first || null, lastName: last || null, email: email || null } });
  }
  return { user: u, token: linkToken(u._id), name: u.name };
}
export async function googleSignIn({ credential }) {
  if (!env.googleClientId && !env.googleIosClientId) throw new Error("Google sign-in isn't set up.");
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential || "")}`, { signal: AbortSignal.timeout(8000) });
  const t = await r.json().catch(() => ({}));
  // The web app and the iPhone app use different Google client IDs; accept a token issued to either.
  const audiences = [env.googleClientId, env.googleIosClientId].filter(Boolean);
  if (!r.ok || !audiences.includes(t.aud) || !/accounts\.google\.com$/.test(t.iss || "") || String(t.email_verified) !== "true") throw new Error("Google sign-in didn't work. Try again.");
  return oauthUser("google", t.sub, { first: t.given_name, last: t.family_name, email: t.email });
}
export async function microsoftSignIn({ accessToken }) {
  if (!env.microsoftClientId) throw new Error("Microsoft sign-in isn't set up.");
  const r = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000) });
  const m = await r.json().catch(() => ({}));
  if (!r.ok || !m.id) throw new Error("Microsoft sign-in didn't work. Try again.");
  return oauthUser("microsoft", m.id, { first: m.givenName, last: m.surname, email: m.mail || m.userPrincipalName });
}

// Sign in with Apple (iPhone app). Apple signs an identity token (RS256 JWT); its public keys are at
// appleid.apple.com/auth/keys. Apple only shares the name on the very first sign-in, so the app sends it along.
let appleKeys = { at: 0, keys: [] };
async function appleKey(kid) {
  if (Date.now() - appleKeys.at > 6 * 3600e3 || !appleKeys.keys.some((k) => k.kid === kid)) {
    const r = await fetch("https://appleid.apple.com/auth/keys", { signal: AbortSignal.timeout(8000) });
    if (r.ok) appleKeys = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = appleKeys.keys.find((k) => k.kid === kid);
  return jwk ? createPublicKey({ key: jwk, format: "jwk" }) : null;
}
export async function appleSignIn({ identityToken, firstName, lastName }) {
  const fail = () => new Error("Sign in with Apple didn't work. Try again.");
  const [h, p, s] = String(identityToken || "").split(".");
  if (!h || !p || !s) throw fail();
  let header, claims;
  try { header = JSON.parse(Buffer.from(h, "base64url")); claims = JSON.parse(Buffer.from(p, "base64url")); } catch { throw fail(); }
  const key = header.alg === "RS256" ? await appleKey(header.kid) : null;
  const signed = key && verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  if (!signed || claims.iss !== "https://appleid.apple.com" || claims.aud !== env.apnsBundleId || !claims.sub || claims.exp * 1000 < Date.now()) throw fail();
  return oauthUser("apple", claims.sub, { first: nameOk(firstName) || null, last: nameOk(lastName) || null, email: claims.email || null });
}

// Account deletion (App Store guideline 5.1.1(v)): removes the person. Past answers stay as anonymous data.
export async function deleteAccount(user) {
  await mongo.deleteUser(user._id);
  return { ok: true };
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
// Also used by Edit account: leaving the password empty keeps the current one (if there is one).
export async function setCredentials(user, { username, password, firstName, lastName }) {
  username = clean(username || user.username);
  const keepPassword = !password && Boolean(user.passHash);
  if (!keepPassword) check(username, password);
  else if (!USERNAME.test(username)) throw new Error("Usernames are 3–20 characters: letters, numbers, dots or underscores.");
  const first = nameOk(firstName), last = nameOk(lastName);
  const other = await mongo.col("users").findOne({ username });
  if (other && other._id !== user._id) throw new Error("That username is taken. Try another.");
  const set = { username };
  if (!keepPassword) set.passHash = hash(password);
  if (first && last) Object.assign(set, { firstName: first, lastName: last, name: fullName(first, last) });
  await mongo.col("users").updateOne({ _id: user._id }, { $set: set });
  return { ok: true, username };
}
