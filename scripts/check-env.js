// Validates Oracle's .env without printing secrets.
//   npm run check          -> format checks only (offline)
//   npm run check -- --live -> also contacts each configured service independently
// Exit code 1 when a required variable is missing or a live check fails.
import "dotenv/config";

const live = process.argv.includes("--live");
const E = process.env;
const results = [];
const set = (k) => typeof E[k] === "string" && E[k].trim() !== "";
const add = (group, status, text) => results.push({ group, status, text });
const ok = (g, t) => add(g, "ok", t);
const warn = (g, t) => add(g, "warn", t);
const fail = (g, t) => add(g, "fail", t);
const off = (g, t) => add(g, "off", t);
const timeout = (ms = 10000) => AbortSignal.timeout(ms);
// Only ever show the host of a URL, never credentials or tokens.
const host = (u) => { try { return new URL(u).host; } catch { return "(unparseable)"; } };
const scrub = (msg) => String(msg || "").replace(/(key|token|secret|password)=([^&\s]+)/gi, "$1=***").replace(/\/\/[^@/\s]+@/g, "//***@").slice(0, 160);

async function check(group, fn) {
  try { await fn(); } catch (e) { fail(group, scrub(e.message)); }
}

// ---------------------------------------------------------------- core server
await check("Server", async () => {
  const pub = E.PUBLIC_URL || "";
  if (!pub) warn("Server", "PUBLIC_URL is empty: photo links and push notifications use http://localhost.");
  else if (!/^https:\/\//.test(pub)) warn("Server", `PUBLIC_URL is ${host(pub)} over http. The iPhone app and location sharing need HTTPS when deployed.`);
  else ok("Server", `PUBLIC_URL host ${host(pub)} (https)`);
  if (!set("ORACLE_API_KEY")) warn("Server", "ORACLE_API_KEY is empty: /api/ask, /mcp and /api/dev/* are open, and (without TELEGRAM_TOKEN) app sessions use a public dev secret.");
  else if (E.ORACLE_API_KEY.length < 24) warn("Server", "ORACLE_API_KEY is shorter than 24 characters. Use a long random value (openssl rand -hex 32).");
  else ok("Server", "ORACLE_API_KEY set (also signs app session tokens; changing it signs everyone out)");
  if (set("GEO_BIAS") && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(E.GEO_BIAS.trim())) fail("Server", "GEO_BIAS must be lat,lng or empty.");
});

// ---------------------------------------------------------------- MongoDB (required)
await check("MongoDB", async () => {
  if (!set("MONGODB_URI")) return fail("MongoDB", "MONGODB_URI is required.");
  if (!/^mongodb(\+srv)?:\/\//.test(E.MONGODB_URI)) return fail("MongoDB", "MONGODB_URI must start with mongodb:// or mongodb+srv://");
  if (/USER:PASSWORD|CLUSTER\.mongodb/.test(E.MONGODB_URI)) return fail("MongoDB", "MONGODB_URI still contains the .env.example placeholder.");
  if (!set("MONGODB_DB")) warn("MongoDB", "MONGODB_DB empty: defaults to \"oracle\".");
  if (!live) return ok("MongoDB", `URI format ok (host ${host(E.MONGODB_URI.replace(/^mongodb\+srv/, "https").replace(/^mongodb/, "https"))})`);
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(E.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    await client.db(E.MONGODB_DB || "oracle").command({ ping: 1 });
    ok("MongoDB", `connected, ping ok (db ${E.MONGODB_DB || "oracle"})`);
  } finally { await client.close().catch(() => {}); }
});

// ---------------------------------------------------------------- Tiger Data (required)
await check("Tiger Data", async () => {
  if (!set("TIGER_DATABASE_URL")) return fail("Tiger Data", "TIGER_DATABASE_URL is required.");
  if (!/^postgres(ql)?:\/\//.test(E.TIGER_DATABASE_URL)) return fail("Tiger Data", "TIGER_DATABASE_URL must start with postgres://");
  if (/PASSWORD@HOST/.test(E.TIGER_DATABASE_URL)) return fail("Tiger Data", "TIGER_DATABASE_URL still contains the .env.example placeholder.");
  if (!live) return ok("Tiger Data", `URL format ok (host ${host(E.TIGER_DATABASE_URL)})`);
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: E.TIGER_DATABASE_URL, connectionTimeoutMillis: 8000 });
  await client.connect();
  try {
    const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('answers','payouts')")).rows.map((r) => r.table_name);
    const missing = ["answers", "payouts"].filter((t) => !tables.includes(t));
    if (missing.length) return fail("Tiger Data", `connected, but table(s) ${missing.join(", ")} are missing. Run schema.sql.`);
    const ts = (await client.query("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'")).rowCount;
    if (!ts) return fail("Tiger Data", "connected, but the timescaledb extension (time_bucket) is not installed. Trends and place details need it.");
    ok("Tiger Data", "connected, answers + payouts tables and timescaledb present");
  } finally { await client.end().catch(() => {}); }
});

// ---------------------------------------------------------------- Gemini
await check("Gemini", async () => {
  if (!set("GEMINI_API_KEY")) return off("Gemini", "GEMINI_API_KEY empty: search interpretation returns the original query; questions use built-in presets; photo checks are off.");
  const model = E.GEMINI_MODEL || "gemini-3.8-flash";
  if (!live) return ok("Gemini", `key set, model ${model}`);
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": E.GEMINI_API_KEY }, signal: timeout(20000),
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: 'Return JSON {"query":"place search terms"} for: "quiet coffee near Union Square San Francisco"' }] }], generationConfig: { responseMimeType: "application/json" } }),
  });
  if (!r.ok) return fail("Gemini", `model ${model} returned HTTP ${r.status}. Check the key and that this model is available to it.`);
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
  let query = null; try { query = JSON.parse(text.replace(/```(json)?/g, "")).query; } catch {}
  query ? ok("Gemini", `model ${model} interpreted a search ("${String(query).slice(0, 60)}")`) : warn("Gemini", `model ${model} answered but not with the expected JSON.`);
  for (const fb of (E.GEMINI_FALLBACK_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const f = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(fb)}`, { headers: { "x-goog-api-key": E.GEMINI_API_KEY }, signal: timeout() });
    f.ok ? ok("Gemini", `fallback model ${fb} available`) : warn("Gemini", `fallback model ${fb} returned HTTP ${f.status}`);
  }
});

// ---------------------------------------------------------------- Google Places (venue photos)
await check("Venue photos", async () => {
  if (!set("GOOGLE_PLACES_API_KEY")) return off("Venue photos", "GOOGLE_PLACES_API_KEY empty: the app shows an illustration instead of venue photos.");
  if (!live) return ok("Venue photos", "key set (needs Places API (New) enabled)");
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST", signal: timeout(),
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": E.GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": "places.id,places.photos" },
    body: JSON.stringify({ textQuery: "Ferry Building San Francisco", pageSize: 1 }),
  });
  if (!r.ok) return fail("Venue photos", `Places API (New) text search returned HTTP ${r.status}. Enable "Places API (New)" for this key.`);
  const photo = (await r.json()).places?.[0]?.photos?.[0];
  if (!photo) return warn("Venue photos", "text search works but returned no photo for the test venue.");
  const m = await fetch(`https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=400&skipHttpRedirect=true`, { headers: { "X-Goog-Api-Key": E.GOOGLE_PLACES_API_KEY }, signal: timeout() });
  m.ok ? ok("Venue photos", `text search + photo media ok (${(photo.authorAttributions || []).length} attribution(s))`) : fail("Venue photos", `photo media returned HTTP ${m.status}`);
});

// ---------------------------------------------------------------- Telegram
await check("Telegram", async () => {
  if (!set("TELEGRAM_TOKEN")) return off("Telegram", "TELEGRAM_TOKEN empty: Telegram bot off.");
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(E.TELEGRAM_TOKEN)) return fail("Telegram", "TELEGRAM_TOKEN doesn't look like a BotFather token (123456:ABC...).");
  if (!live) return ok("Telegram", "token format ok");
  const r = await fetch(`https://api.telegram.org/bot${E.TELEGRAM_TOKEN}/getMe`, { signal: timeout() });
  const d = await r.json().catch(() => ({}));
  d.ok ? ok("Telegram", `bot @${d.result.username} authenticated`) : fail("Telegram", `getMe failed (HTTP ${r.status}). Check the token.`);
  const w = await (await fetch(`https://api.telegram.org/bot${E.TELEGRAM_TOKEN}/getWebhookInfo`, { signal: timeout() })).json().catch(() => ({}));
  if (w.result?.url) warn("Telegram", "a webhook is set on this bot; Oracle uses long polling, so remove the webhook (deleteWebhook).");
});

// ---------------------------------------------------------------- Discord
await check("Discord", async () => {
  if (!set("DISCORD_TOKEN")) {
    off("Discord", "DISCORD_TOKEN empty: Discord bot off.");
    if (set("DISCORD_INVITE_URL")) warn("Discord", "DISCORD_INVITE_URL is only a join link for people. It does not authenticate the bot; DISCORD_TOKEN does.");
    return;
  }
  if (!set("DISCORD_GUILD_ID")) warn("Discord", "DISCORD_GUILD_ID empty: slash commands are not registered.");
  if (!set("DISCORD_CHANNEL_ID")) warn("Discord", "DISCORD_CHANNEL_ID empty: no #oracle check-in panel or channel fallback.");
  for (const k of ["DISCORD_GUILD_ID", "DISCORD_CHANNEL_ID"]) if (set(k) && !/^\d{15,22}$/.test(E[k])) fail("Discord", `${k} must be a numeric snowflake ID.`);
  if (set("DISCORD_INVITE_URL") && !/^https:\/\/(discord\.gg|discord\.com\/invite)\//.test(E.DISCORD_INVITE_URL)) warn("Discord", "DISCORD_INVITE_URL doesn't look like a discord.gg invite.");
  if (!live) return ok("Discord", "token set");
  const H = { Authorization: `Bot ${E.DISCORD_TOKEN}` };
  const me = await fetch("https://discord.com/api/v10/users/@me", { headers: H, signal: timeout() });
  if (!me.ok) return fail("Discord", `bot token rejected (HTTP ${me.status}).`);
  ok("Discord", `bot ${(await me.json()).username} authenticated`);
  if (set("DISCORD_GUILD_ID")) {
    const g = await fetch(`https://discord.com/api/v10/guilds/${E.DISCORD_GUILD_ID}`, { headers: H, signal: timeout() });
    g.ok ? ok("Discord", "bot is in the configured server") : fail("Discord", `server ${E.DISCORD_GUILD_ID}: HTTP ${g.status}. Invite the bot with bot + applications.commands scopes.`);
  }
  if (set("DISCORD_CHANNEL_ID")) {
    const c = await fetch(`https://discord.com/api/v10/channels/${E.DISCORD_CHANNEL_ID}`, { headers: H, signal: timeout() });
    c.ok ? ok("Discord", "bot can see the configured channel") : fail("Discord", `channel ${E.DISCORD_CHANNEL_ID}: HTTP ${c.status}. Give the bot View Channel + Send Messages.`);
  }
});

// ---------------------------------------------------------------- Solana devnet
await check("Solana", async () => {
  const rpc = E.SOLANA_RPC || "https://api.devnet.solana.com";
  if (!set("SOLANA_TREASURY_SECRET")) return off("Solana", "SOLANA_TREASURY_SECRET empty: SOL payouts and cash-outs off (points still work).");
  let secret;
  try { secret = Uint8Array.from(JSON.parse(E.SOLANA_TREASURY_SECRET)); } catch { return fail("Solana", "SOLANA_TREASURY_SECRET must be the JSON array printed by npm run wallet."); }
  if (secret.length !== 64) return fail("Solana", "SOLANA_TREASURY_SECRET must contain 64 numbers.");
  const { Keypair, Connection, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
  const pub = Keypair.fromSecretKey(secret).publicKey;
  if (!live) return ok("Solana", `treasury ${pub.toBase58().slice(0, 4)}…${pub.toBase58().slice(-4)}, RPC ${host(rpc)}`);
  const conn = new Connection(rpc, "confirmed");
  const genesis = await conn.getGenesisHash();
  const devnet = genesis === "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
  if (!devnet) fail("Solana", `RPC ${host(rpc)} is not devnet. Oracle's payouts are devnet-only.`);
  const bal = (await conn.getBalance(pub)) / LAMPORTS_PER_SOL;
  (bal >= 0.01 ? ok : warn)("Solana", `devnet treasury balance ${bal} SOL${bal < 0.01 ? " (fund it at faucet.solana.com)" : ""}`);
});

// ---------------------------------------------------------------- MCP
await check("MCP", async () => {
  const url = E.ORACLE_URL || "http://localhost:3000";
  if (!/^https?:\/\//.test(url)) return fail("MCP", "ORACLE_URL must be the http(s) address of this server's REST API.");
  if (!live) return ok("MCP", `ORACLE_URL host ${host(url)}`);
  const ping = await fetch(`${url.replace(/\/$/, "")}/api/ping`, { signal: timeout(5000) }).catch(() => null);
  if (!ping?.ok) return warn("MCP", `ORACLE_URL ${host(url)} not reachable (start the server first to test MCP).`);
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (set("ORACLE_API_KEY")) headers["x-oracle-key"] = E.ORACLE_API_KEY;
  const r = await fetch(`${url.replace(/\/$/, "")}/mcp`, { method: "POST", headers, signal: timeout(), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  const text = await r.text();
  const names = [...text.matchAll(/"name":"([a-z_]+)"/g)].map((m) => m[1]);
  r.ok && names.length ? ok("MCP", `/mcp lists ${names.length} tools: ${names.join(", ")}`) : fail("MCP", `/mcp returned HTTP ${r.status}`);
});

// ---------------------------------------------------------------- optional extras
if (!set("TINYFISH_API_KEY")) off("Web fallback", "TINYFISH_API_KEY empty: unanswered questions settle as \"no answer\" instead of reading the web.");
else ok("Web fallback", "TinyFish key set");
if (!set("GOOGLE_CLIENT_ID") && !set("MICROSOFT_CLIENT_ID")) off("Web sign-in", "GOOGLE_CLIENT_ID / MICROSOFT_CLIENT_ID empty: web app offers username + password only.");

// ---------------------------------------------------------------- report
const icon = { ok: "✔", warn: "!", fail: "✘", off: "–" };
let group = "";
for (const r of results) {
  if (r.group !== group) { group = r.group; console.log(`\n${group}`); }
  console.log(`  ${icon[r.status]} ${r.text}`);
}
const failed = results.filter((r) => r.status === "fail").length;
console.log(`\n${failed ? `${failed} problem(s) found.` : "No blocking problems."}${live ? "" : " Run with -- --live to contact each service."}`);
process.exit(failed ? 1 : 0);
