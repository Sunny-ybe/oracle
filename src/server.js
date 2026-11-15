import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, PLACES, PRESETS } from "./config.js";
import { connectMongo } from "./db/mongo.js";
import * as mongo from "./db/mongo.js";
import * as tiger from "./db/tiger.js";
import {
  ask, getAnswer, recordVote, events, openQuestions, liveStatus, insights, disputeInfo, submitPhoto, announceJoin,
  placeDetail, photoById, redeemReward, cashOut, pendingFor, answerFromApp, placesForApp,
} from "./core.js";
import { appUser, linkToken } from "./web/auth.js";
import { startAppChannel, vapidPublicKey } from "./channels/app.js";
import sharp from "sharp";
import { isValidAddress, explorerAddress } from "./pay/solana.js";
import { REWARDS, findPlace } from "./config.js";
import { startDiscord } from "./channels/discord.js";
import { startTelegram, telegramJoinLink } from "./channels/telegram.js";
import { treasuryInfo } from "./pay/solana.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(root, "public")));

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const requireKey = (req, res, next) => {
  if (env.apiKey && req.get("x-oracle-key") !== env.apiKey) return res.status(401).json({ error: "Bad API key" });
  next();
};

// ---- agent API (used by the MCP server)
app.post("/api/ask", requireKey, wrap((req) => ask(req.body)));
app.get("/api/questions/:id", requireKey, wrap((req) => getAnswer(req.params.id, Number(req.query.wait) || 0)));
app.get("/api/status", wrap(() => liveStatus()));
app.get("/api/insights", wrap((req) => insights(req.query.place, req.query.topic)));

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
app.get("/icon.png", async (req, res) => {
  const size = Math.min(1024, Math.max(32, Number(req.query.s) || 192));
  res.set("Content-Type", "image/png").set("Cache-Control", "public, max-age=604800")
    .send(await sharp(Buffer.from(OWL_SVG(size))).png().toBuffer());
});

// ---- app sign-up and notifications
app.post("/api/app/register", wrap(async (req) => {
  const name = String(req.body.name || "").trim().slice(0, 40);
  if (!name) throw new Error("Tell us your first name.");
  const u = await mongo.getOrCreateUser({ channel: "app", channelUserId: Math.random().toString(36).slice(2, 12), name });
  if (findPlace(req.body.place)) {
    await mongo.checkIn(u._id, findPlace(req.body.place).id);
    announceJoin(u, findPlace(req.body.place).id).catch(() => {});
  }
  return { token: linkToken(u._id) };
}));
app.get("/api/app/push-key", (_req, res) => res.json({ key: vapidPublicKey() }));
app.post("/api/app/push", appUser, wrap(async (req) => {
  if (!req.body?.endpoint) throw new Error("No subscription");
  await mongo.addPush(req.user._id, req.body);
  return { ok: true };
}));

// ---- the Oracle earner app (Explore, Requests, Rewards, Profile). Asking happens in Claude, not here.
app.get(["/app", "/app/*"], (_req, res) => res.sendFile(path.join(root, "public", "app.html")));
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
    place: f.placeId ? findPlace(f.placeId)?.name : null, rewards: REWARDS, pointsPerSol: env.pointsPerSol, minCashout: env.minCashout,
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
    const r = await mongo.setLocation(u._id, req.body.lat, req.body.lng);
    if (r.placeId) announceJoin(u, r.placeId).catch(() => {});
    return { ok: true, place: r.placeId ? findPlace(r.placeId).name : null };
  }
  if (!findPlace(req.body.place)) throw new Error("Unknown place");
  await mongo.checkIn(u._id, req.body.place);
  announceJoin(u, req.body.place).catch(() => {});
  return { ok: true, place: findPlace(req.body.place).name };
}));

// ---- photo verification page
app.get("/verify/:token", (_req, res) => res.sendFile(path.join(root, "public", "verify.html")));
app.get("/api/verify/:token", (req, res) => {
  const info = disputeInfo(req.params.token);
  info ? res.json(info) : res.status(404).json({ error: "This link has expired or the question is already settled." });
});
app.post("/api/verify/:token", wrap((req) => submitPhoto(req.params.token, req.body)));

// ---- testing without phones: fake people check in and vote
app.get("/api/dev/open", (_req, res) => res.json(openQuestions()));
app.post("/api/dev/checkin", wrap(async (req) => {
  const u = await mongo.getOrCreateUser({ channel: "dev", channelUserId: req.body.name, name: req.body.name });
  await mongo.checkIn(u._id, req.body.place);
  announceJoin(u, req.body.place).catch(() => {});
  return { ok: true, user: u._id };
}));
app.post("/api/dev/vote", wrap(async (req) => ({
  message: await recordVote(`dev:${req.body.name}`, req.body.questionId, req.body.option),
})));

// ---- keep running through network hiccups instead of crashing mid-demo
process.on("unhandledRejection", (e) => console.error("Unhandled:", e?.message || e));
process.on("uncaughtException", (e) => console.error("Uncaught:", e?.message || e));

// ---- start
await connectMongo();
await startAppChannel().catch((e) => console.error("App notifications off:", e.message));
await tiger.checkTiger();
app.listen(env.port, () => console.log(`🦉 Oracle running at http://localhost:${env.port}`));

if (env.discordToken) startDiscord().catch((e) => console.error("Discord failed to start:", e.message));
else console.log("No DISCORD_TOKEN: Discord off");
if (env.telegramToken) startTelegram().catch((e) => console.error("Telegram failed to start:", e.message));
else console.log("No TELEGRAM_TOKEN: Telegram off");
