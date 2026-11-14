import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, PLACES, PRESETS } from "./config.js";
import { connectMongo } from "./db/mongo.js";
import * as mongo from "./db/mongo.js";
import * as tiger from "./db/tiger.js";
import {
  ask, getAnswer, recordVote, events, openQuestions, liveStatus, insights, disputeInfo, submitPhoto,
} from "./core.js";
import { startDiscord } from "./channels/discord.js";
import { startTelegram } from "./channels/telegram.js";
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
app.get("/api/questions/:id", requireKey, wrap((req) => getAnswer(req.params.id)));
app.get("/api/status", wrap(() => liveStatus()));
app.get("/api/insights", wrap((req) => insights(req.query.place, req.query.topic)));

// ---- dashboard
app.get("/api/places", (_req, res) => res.json({ places: PLACES.map(({ web, ...p }) => p), presets: Object.keys(PRESETS) }));
app.get("/api/trend", wrap((req) => tiger.trend(req.query.place, req.query.topic || "line_length")));
app.get("/api/topics", wrap((req) => tiger.topicsForPlace(req.query.place)));
app.get("/api/leaderboard", wrap(() => mongo.leaderboard()));
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
  return { ok: true, user: u._id };
}));
app.post("/api/dev/vote", wrap(async (req) => ({
  message: await recordVote(`dev:${req.body.name}`, req.body.questionId, req.body.option),
})));

// ---- start
await connectMongo();
await tiger.checkTiger();
app.listen(env.port, () => console.log(`🦉 Oracle running at http://localhost:${env.port}`));

if (env.discordToken) startDiscord().catch((e) => console.error("Discord failed to start:", e.message));
else console.log("No DISCORD_TOKEN: Discord off");
if (env.telegramToken) startTelegram().catch((e) => console.error("Telegram failed to start:", e.message));
else console.log("No TELEGRAM_TOKEN: Telegram off");
