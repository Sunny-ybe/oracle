// Who is using the earner app?
// Inside Telegram: verify the signed initData Telegram gives every Mini App.
// In a normal browser: a personal link token the bot sends with /app.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config.js";
import * as mongo from "../db/mongo.js";

const secret = () => env.apiKey || env.telegramToken || "oracle-dev";

export function linkToken(userId) {
  const sig = createHmac("sha256", secret()).update(userId).digest("base64url").slice(0, 24);
  return `${Buffer.from(userId).toString("base64url")}.${sig}`;
}

function fromLinkToken(t) {
  const [u, sig] = String(t || "").split(".");
  if (!u || !sig) return null;
  const userId = Buffer.from(u, "base64url").toString();
  const good = createHmac("sha256", secret()).update(userId).digest("base64url").slice(0, 24);
  return sig.length === good.length && timingSafeEqual(Buffer.from(sig), Buffer.from(good)) ? userId : null;
}

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function fromInitData(initData) {
  if (!initData || !env.telegramToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const key = createHmac("sha256", "WebAppData").update(env.telegramToken).digest();
  const good = createHmac("sha256", key).update(check).digest("hex");
  if (good.length !== hash.length || !timingSafeEqual(Buffer.from(good), Buffer.from(hash))) return null;
  const authDate = Number(params.get("auth_date"));
  if (authDate && Date.now() / 1000 - authDate > 86400) return null; // older than a day
  try { return JSON.parse(params.get("user")); } catch { return null; }
}

export async function appUser(req, res, next) {
  try {
    const tg = fromInitData(req.get("x-tg-init"));
    if (tg) {
      req.user = await mongo.getOrCreateUser({ channel: "telegram", channelUserId: tg.id, name: tg.first_name || tg.username || "friend" });
      return next();
    }
    const id = fromLinkToken(req.get("x-oracle-token"));
    const user = id && (await mongo.getUser(id));
    if (user) { req.user = user; return next(); }
    res.status(401).json({ error: "Sign up in the Oracle app to continue." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
