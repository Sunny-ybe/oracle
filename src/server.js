import { searchPlaces } from "./web/place-search.js";
import { gameRounds as nearbyGameRounds } from "./web/game.js";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, PLACES, PRESETS } from "./config.js";
import { connectMongo } from "./db/mongo.js";
import * as mongo from "./db/mongo.js";
import * as tiger from "./db/tiger.js";
import {
  ask, getAnswer, recordVote, events, openQuestions, liveStatus, insights, disputeInfo, submitPhoto, announceJoin,
  placeDetail, photoById, redeemReward, cashOut, pendingFor, answerFromApp, placesForApp, ensurePlace,
} from "./core.js";
import { appUser, linkToken } from "./web/auth.js";
import { startAppChannel, vapidPublicKey } from "./channels/app.js";
import { apnsEnabled } from "./channels/apns.js";
import sharp from "sharp";
import { isValidAddress, explorerAddress } from "./pay/solana.js";
import { REWARDS, findPlace } from "./config.js";
import { startDiscord } from "./channels/discord.js";
import { startTelegram, telegramJoinLink } from "./channels/telegram.js";
import { treasuryInfo } from "./pay/solana.js";
import { ensureSpeedFile, saveScan, floorReport } from "./scan.js";
import { register, login, setCredentials, googleSignIn, microsoftSignIn, appleSignIn, deleteAccount } from "./web/accounts.js";
import { importPlaces } from "./web/places-import.js";

import { nearby, discover, venueMedia } from "./web/native.js";
import { mountMcp } from "../mcp/http.js";
import { warmFacts, tinyfishEnabled } from "./web/tinyfish.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
app.use(express.json({ limit: "12mb" }));

// Wi-Fi speed test: a 1 MB file stored on this server, never cached, so every download is real.
ensureSpeedFile(path.join(root, "public"));
app.get("/speedtest.bin", (_req, res) => {
  res.set({ "Cache-Control": "no-store, no-transform", "Content-Type": "application/octet-stream" });
  res.sendFile(path.join(root, "public", "speedtest.bin"));
});
app.get("/api/ping", (_req, res) => res.set("Cache-Control", "no-store").json({ t: Date.now() }));
app.use(express.static(path.join(root, "public")));

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Agent key. Accepted as x-oracle-key (original), x-api-key, or "Authorization: Bearer <key>" so MCP clients
// that only allow standard header names (for example Claude's request-header list) can send it.
const presentedKey = (req) => req.get("x-oracle-key") || req.get("x-api-key") || (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
const sameKey = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const requireKey = (req, res, next) => {
  if (env.apiKey && !sameKey(presentedKey(req), env.apiKey)) return res.status(401).json({ error: "Bad API key" });
  next();
};

// ---- agent API (used by the MCP server)
app.post("/api/ask", requireKey, wrap((req) => ask(req.body)));
app.get("/api/questions/:id", requireKey, wrap((req) => getAnswer(req.params.id, Number(req.query.wait) || 0)));
app.get("/api/status", wrap(() => liveStatus()));
app.get("/api/recent", wrap(async () => (await mongo.recentAnswered()).map((q) => ({
  question: q.question, place: q.place, placeId: q.placeId, answer: q.result.answer, option: q.result.option, source: q.result.source, at: q.resolvedAt }))));
app.post("/api/places/ensure", wrap((req) => ensurePlace(req.body)));
app.get("/api/insights", wrap((req) => insights(req.query.place, req.query.topic)));

app.get("/api/app/search-places", wrap(async req => ({ results: await searchPlaces(req.query.q), attribution: "© OpenStreetMap contributors" })));
app.get("/api/app/places/nearby", wrap(req => nearby(req.query)));
app.post("/api/app/discover", appUser, wrap(req => discover(req.body)));
// Public so the place photo shows before signing in. Google lookups only run when GOOGLE_PLACES_API_KEY is set.
app.post("/api/app/venue-media", wrap(req => venueMedia(req.body)));
app.post("/api/app/ask", appUser, wrap(req => ask({ ...req.body, askedBy: req.user._id, waitSeconds: 0 })));
app.get("/api/app/questions/:id", appUser, wrap(req => getAnswer(req.params.id, 0)));
mountMcp(app, requireKey);

// Public capabilities and MCP address only: never secrets. The iPhone app uses it to test a server address.
app.get("/api/app/config", (_req, res) => res.set("Cache-Control", "no-store").json({
  name: "Oracle", api: 1,
  integrations: {
    gemini: Boolean(env.geminiKey), venuePhotos: Boolean(process.env.GOOGLE_PLACES_API_KEY), telegram: Boolean(env.telegramToken),
    discord: Boolean(env.discordToken), solanaDevnet: Boolean(env.solanaTreasury), tinyfish: Boolean(env.tinyfishKey),
    apns: apnsEnabled(),
  },
  mcp: { url: `${env.publicUrl}/mcp`, path: "/mcp", transport: "streamable-http", auth: env.apiKey ? "api-key" : "none", oauth: false },
}));

// ---- dashboard
app.get("/api/places", (_req, res) => res.json({ places: PLACES.map(({ web, ...p }) => p), presets: Object.keys(PRESETS) }));
app.get("/api/trend", wrap((req) => tiger.trend(req.query.place, req.query.topic || "line_length")));
app.get("/api/topics", wrap((req) => tiger.topicsForPlace(req.query.place)));
app.get("/api/leaderboard", wrap(() => mongo.leaderboard()));
app.get("/api/redemptions", requireKey, wrap(() => mongo.redemptions()));
app.get("/api/payouts", wrap(() => tiger.recentPayouts()));
app.get("/api/stats", wrap(async () => ({
  ...(await mongo.questionStats()), payouts: await tiger.payoutTotal(), treasury: await treasuryInfo().catch(() => null),
})));
app.get("/api/stream", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const push = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  events.on("event", push);
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => { events.off("event", push); clearInterval(ping); });
});

// ---- join QR for the room
app.get("/api/join", wrap(async (req) => {
  const place = findPlace(req.query.place)?.id || null;   // no place = join for everywhere
  const counts = await mongo.peopleByPlace();
  const https = env.publicUrl.startsWith("https://");
  return {
    place, name: place ? findPlace(place).name : null, here: place ? counts[place] || 0 : Object.values(counts).reduce((a, b) => a + b, 0),
    joinPage: https ? `${env.publicUrl}/join${place ? `?place=${place}` : ""}` : null,   // pick a channel once
    telegram: telegramJoinLink(place), discord: env.discordInvite || null,
    app: https ? `${env.publicUrl}/app?join=${place || "anywhere"}` : null,
  };
}));

// ---- sign-up: pick where requests reach you (Telegram, Discord, iMessage soon, or the app)
app.get("/join", (_req, res) => res.sendFile(path.join(root, "public", "join.html")));

// ---- app icon, drawn from the owl
const OWL_SVG = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1e6b46"/><path d="M14 18l7 6h22l7-6-2 21c0 11-7 17-16 17s-16-6-16-17z" fill="#e7f3eb"/><circle cx="25" cy="33" r="7.5" fill="#fff"/><circle cx="39" cy="33" r="7.5" fill="#fff"/><circle cx="25" cy="33" r="3.4" fill="#13241b"/><circle cx="39" cy="33" r="3.4" fill="#13241b"/><path d="M29.5 41h5l-2.5 5z" fill="#f2b33d"/></svg>`;
// The app icon is Ora, the robot from the iPhone app (public/img/mark.png); the owl SVG is the fallback.
app.get("/icon.png", async (req, res) => {
  const size = Math.min(1024, Math.max(32, Number(req.query.s) || 192));
  let img;
  try { img = sharp(path.join(root, "public", "img", "mark.png")).resize(size, size); }
  catch { img = sharp(Buffer.from(OWL_SVG(size))); }
  res.set("Content-Type", "image/png").set("Cache-Control", "public, max-age=86400")
    .send(await img.png().toBuffer().catch(() => sharp(Buffer.from(OWL_SVG(size))).png().toBuffer()));
});

// ---- app sign-up and notifications
app.post("/api/app/register", wrap(async (req) => {
  const { user, token } = await register(req.body);
  if (findPlace(req.body.place)) {
    await mongo.checkIn(user._id, findPlace(req.body.place).id);
    announceJoin(user, findPlace(req.body.place).id).catch(() => {});
  } else announceJoin(user, null).catch(() => {});
  return { token };
}));
app.post("/api/app/login", wrap((req) => login(req.body, req.ip)));
app.get("/api/app/auth-config", (_req, res) => res.json({
  google: env.googleClientId || null, googleIos: env.googleIosClientId || null, microsoft: env.microsoftClientId || null, apple: true,
}));
const oauthJoin = (fn) => wrap(async (req) => {
  const r = await fn(req.body);
  if (findPlace(req.body.place)) { await mongo.checkIn(r.user._id, findPlace(req.body.place).id); announceJoin(r.user, findPlace(req.body.place).id).catch(() => {}); }
  else announceJoin(r.user, null).catch(() => {});
  return { token: r.token, name: r.name };
});
app.post("/api/app/oauth/google", oauthJoin(googleSignIn));
app.post("/api/app/oauth/microsoft", oauthJoin(microsoftSignIn));
app.post("/api/app/oauth/apple", oauthJoin(appleSignIn));
app.post("/api/app/account/delete", appUser, wrap(async (req) => deleteAccount(await mongo.getUser(req.user._id))));
app.post("/api/app/account", appUser, wrap(async (req) => setCredentials(await mongo.getUser(req.user._id), req.body)));
app.get("/api/app/push-key", (_req, res) => res.json({ key: vapidPublicKey() }));
app.post("/api/app/push", appUser, wrap(async (req) => {
  if (!req.body?.endpoint) throw new Error("No subscription");
  await mongo.addPush(req.user._id, req.body);
  return { ok: true };
}));
// Crowd Guess: real questions people answered, for the "can you read the room?" game.
app.get("/api/game/rounds", wrap(req => nearbyGameRounds(req.query)));
// iPhone app: Apple Push device token (hex), so requests reach the phone while the app is closed.
app.post("/api/app/apns", appUser, wrap(async (req) => {
  const token = String(req.body?.token || "").toLowerCase();
  if (!/^[0-9a-f]{64,200}$/.test(token)) throw new Error("That isn't an Apple push token.");
  await mongo.addApns(req.user._id, token, req.body.sandbox === true);
  return { ok: true, apns: apnsEnabled() };
}));
// iPhone app: name for the Edit account screen (the username and password are edited through /api/app/account).
app.get("/api/app/account", appUser, wrap(async (req) => {
  const u = await mongo.getUser(req.user._id);
  return { username: u.username || null, firstName: u.firstName || null, lastName: u.lastName || null,
    email: u.email || null, hasPassword: Boolean(u.passHash), provider: u.oauth ? String(u.oauth).split(":")[0] : null };
}));

// ---- the Oracle earner app (Explore, Requests, Rewards, Profile). Asking happens in Claude, not here.
app.get(["/app", "/app/*"], (_req, res) => res.sendFile(path.join(root, "public", "app.html")));
app.get("/privacy", (_req, res) => res.sendFile(path.join(root, "public", "privacy.html"))); // App Store privacy policy URL
app.get("/api/app/places", wrap(() => placesForApp()));
app.get("/api/app/place/:id", wrap((req) => placeDetail(req.params.id)));

// Privacy-masked photos only; originals are never stored.
app.get("/api/photos/:id", async (req, res) => {
  const p = await photoById(req.params.id).catch(() => null);
  if (!p) return res.status(404).end();
  res.set({ "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" }).send(Buffer.from(p.data, "base64"));
});

const me = async (u) => {
  const f = await mongo.getUser(u._id);
  const { wallet, ...rest } = f;
  return {
    ...rest, wallet: f.payoutWallet || wallet.pub, walletUrl: explorerAddress(f.payoutWallet || wallet.pub), linkedWallet: Boolean(f.payoutWallet),
    place: f.placeId ? findPlace(f.placeId)?.name : null, rewards: REWARDS, passHash: undefined, hasPassword: Boolean(f.passHash), pointsPerSol: env.pointsPerSol, minCashout: env.minCashout,
    requests: pendingFor(f._id),
  };
};
app.get("/api/app/me", appUser, wrap((req) => me(req.user)));
app.post("/api/app/answer/:id", appUser, wrap((req) => answerFromApp(req.user._id, req.params.id, req.body)));
app.post("/api/app/redeem", appUser, wrap((req) => {
  const reward = REWARDS.find((r) => r.id === req.body.rewardId);
  if (!reward) throw new Error("Unknown reward");
  return redeemReward(req.user._id, reward);
}));
app.post("/api/app/cashout", appUser, wrap((req) => cashOut(req.user._id, req.body.points)));
app.post("/api/app/wallet", appUser, wrap(async (req) => {
  if (!isValidAddress(req.body.address)) throw new Error("That isn't a Solana address.");
  await mongo.setPayoutWallet(req.user._id, req.body.address);
  return { ok: true };
}));
app.post("/api/app/checkin", appUser, wrap(async (req) => {
  const u = req.user;
  if (Number.isFinite(req.body.lat) && Number.isFinite(req.body.lng)) {
    const { lat, lng, accuracy } = req.body;
    const r = await mongo.setLocation(u._id, lat, lng, accuracy);
    if (r.changed) announceJoin(u, r.placeId).catch(() => {});
    importAround(lat, lng).catch(() => {});
    return { ok: true, place: r.placeId ? findPlace(r.placeId)?.name ?? null : null };
  }
  if (!findPlace(req.body.place)) throw new Error("Unknown place");
  await mongo.checkIn(u._id, req.body.place);
  announceJoin(u, req.body.place).catch(() => {});
  return { ok: true, place: findPlace(req.body.place).name };
}));

// ---- spot scans: Wi-Fi speed, 10-second loudness, floor -> which floor is best
app.post("/api/app/scan", appUser, wrap(async (req) => saveScan(await mongo.getUser(req.user._id), req.body)));
app.get("/api/floors", wrap((req) => floorReport(req.query.place)));

// ---- photo verification page
app.get("/verify/:token", (_req, res) => res.sendFile(path.join(root, "public", "verify.html")));
app.get("/api/verify/:token", (req, res) => {
  const info = disputeInfo(req.params.token);
  info ? res.json(info) : res.status(404).json({ error: "This link has expired or the question is already settled." });
});
app.post("/api/verify/:token", wrap((req) => submitPhoto(req.params.token, req.body)));

// ---- load every named place around campus from OpenStreetMap
app.post("/api/dev/import-places", requireKey, wrap(async (req) => {
  const r = await importPlaces({ radiusM: Number(req.body?.radiusM) || undefined });
  events.emit("event", { type: "places", at: new Date().toISOString(), added: r.added, total: r.total });
  return { added: r.added, total: r.total };
}));

// ---- testing without phones: fake people check in and vote
app.get("/api/dev/open", requireKey, (_req, res) => res.json(openQuestions()));
app.post("/api/dev/checkin", requireKey, wrap(async (req) => {
  const u = await mongo.getOrCreateUser({ channel: "dev", channelUserId: req.body.name, name: req.body.name });
  await mongo.checkIn(u._id, req.body.place);
  announceJoin(u, req.body.place).catch(() => {});
  return { ok: true, user: u._id };
}));
app.post("/api/dev/vote", requireKey, wrap(async (req) => ({
  message: await recordVote(`dev:${req.body.name}`, req.body.questionId, req.body.option),
})));

// ---- keep running through network hiccups instead of crashing mid-demo
process.on("unhandledRejection", (e) => console.error("Unhandled:", e?.message || e));
process.on("uncaughtException", (e) => console.error("Uncaught:", e?.message || e));

// ---- start
for (const [name, value] of [["MONGODB_URI", env.mongoUri], ["TIGER_DATABASE_URL", env.tigerUrl]]) {
  if (!value) { console.error(`${name} is required. Copy .env.example to .env and set it (run npm run check for details).`); process.exit(1); }
}
if (!env.sessionSecret && !env.apiKey && !env.telegramToken) {
  console.warn("WARNING: none of SESSION_SECRET, ORACLE_API_KEY or TELEGRAM_TOKEN is set, so app sessions are signed with a public development secret. Set SESSION_SECRET before exposing this server.");
}
if (!env.apiKey) console.warn("WARNING: ORACLE_API_KEY is empty, so /api/ask, /mcp and /api/dev/* accept anyone.");
await connectMongo().catch((e) => { console.error("MongoDB connection failed:", e.message); process.exit(1); });
await startAppChannel().catch((e) => console.error("App notifications off:", e.message));
await tiger.checkTiger().catch((e) => { console.error("Tiger Data connection failed:", e.message); process.exit(1); });
app.listen(env.port, () => console.log(`🦉 Oracle running at http://localhost:${env.port}`));

// First run: bring in every named place around campus, so questions can be about anywhere nearby.
// Only when GEO_BIAS names a home area; Oracle otherwise discovers places wherever people search.
if (env.geoBias && PLACES.length < 25 && process.env.AUTO_IMPORT_PLACES !== "0") {
  importPlaces()
    .then((r) => { console.log(`Loaded ${r.added} places from OpenStreetMap (${r.total} total)`); events.emit("event", { type: "places", at: new Date().toISOString(), added: r.added, total: r.total }); })
    .catch((e) => console.error("Couldn't load places from OpenStreetMap:", e.message));
}

// Someone shared a location with no known places around it (e.g. outside the GEO_BIAS area):
// load places around them from OpenStreetMap. One import per ~2 km cell, so Overpass isn't hammered.
const importedCells = new Set();
async function importAround(lat, lng) {
  const cell = `${Math.round(lat * 50)},${Math.round(lng * 50)}`;
  if (importedCells.has(cell) || (await mongo.hasPlaceWithin(lat, lng, 800))) return;
  importedCells.add(cell);
  const r = await importPlaces({ lat, lng, radiusM: 2000 }).catch((e) => { importedCells.delete(cell); throw e; });
  console.log(`Loaded ${r.added} places around ${lat.toFixed(3)}, ${lng.toFixed(3)} (${r.total} total)`);
  if (r.added) events.emit("event", { type: "places", at: new Date().toISOString(), added: r.added, total: r.total });
}

// Official pages (hours, schedules, menus): read them in the background so answers from them are instant.
if (tinyfishEnabled()) warmFacts().catch((e) => console.error("TinyFish warm-up failed:", e.message));
else console.log("No TINYFISH_API_KEY: official-page answers off");

if (env.discordToken) startDiscord().catch((e) => console.error("Discord failed to start:", e.message));
else console.log("No DISCORD_TOKEN: Discord off");
if (env.telegramToken) startTelegram().catch((e) => console.error("Telegram failed to start:", e.message));
else console.log("No TELEGRAM_TOKEN: Telegram off");
