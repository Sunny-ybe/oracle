// Apple Push (APNs) for the native iPhone app: requests arrive as notifications even when the app is closed.
// Needs an APNs auth key (.p8) from developer.apple.com → Certificates, IDs & Profiles → Keys (enable APNs).
// Without APNS_KEY / APNS_KEY_ID / APNS_TEAM_ID, iPhone push is simply off.
// Uses Node's built-in http2 + crypto, so there are no extra dependencies.
import http2 from "node:http2";
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "../config.js";

export const apnsEnabled = () => Boolean(env.apnsKey && env.apnsKeyId && env.apnsTeamId && env.apnsBundleId);

// APNS_KEY is either the .p8 file's text (newlines may be written as \n) or a path to the file.
let privateKey = null;
function key() {
  if (privateKey) return privateKey;
  const raw = env.apnsKey.includes("BEGIN PRIVATE KEY") ? env.apnsKey.replace(/\\n/g, "\n") : readFileSync(env.apnsKey, "utf8");
  return (privateKey = createPrivateKey(raw));
}

// Provider token (ES256 JWT). Apple accepts one for up to an hour; refresh every 50 minutes.
let jwt = null, jwtAt = 0;
function token() {
  if (jwt && Date.now() - jwtAt < 50 * 60 * 1000) return jwt;
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${part({ alg: "ES256", kid: env.apnsKeyId })}.${part({ iss: env.apnsTeamId, iat: Math.floor(Date.now() / 1000) })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: key(), dsaEncoding: "ieee-p1363" }).toString("base64url");
  jwt = `${unsigned}.${signature}`; jwtAt = Date.now();
  return jwt;
}

// Debug builds from Xcode use the sandbox; TestFlight and App Store builds use production.
const sessions = {};
function client(sandbox) {
  const host = sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const s = sessions[host];
  if (s && !s.closed && !s.destroyed) return s;
  const fresh = http2.connect(host);
  fresh.on("error", () => { delete sessions[host]; });
  fresh.on("goaway", () => { delete sessions[host]; });
  return (sessions[host] = fresh);
}

// The bundled notification sound in the iPhone app (ios/Oracle/Oracle/oracle-chime.caf).
export const ORACLE_SOUND = "oracle-chime.caf";
// A request is only worth answering for a few minutes; Apple drops it if the phone is offline longer.
const REQUEST_TTL_S = 15 * 60;

/** Sends one notification. Resolves { ok, status, reason, gone, wrongEnvironment }.
 *  gone means the token should be dropped; wrongEnvironment means it belongs to the other APNs server. */
export function sendApns({ token: deviceToken, sandbox }, payload, { collapseId, ttl = REQUEST_TTL_S } = {}) {
  return new Promise((resolve) => {
    const done = (status, reason = "") => resolve({
      ok: status === 200, status, reason,
      wrongEnvironment: reason === "BadDeviceToken",
      gone: status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(reason),
    });
    let req;
    try {
      req = client(sandbox).request({
        ":method": "POST", ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${token()}`, "apns-topic": env.apnsBundleId,
        "apns-push-type": "alert", "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + ttl),
        ...(collapseId ? { "apns-collapse-id": String(collapseId).slice(0, 64) } : {}),
      });
    } catch (e) { return done(0, e.message); }
    let status = 0, body = "";
    req.setEncoding("utf8");
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (c) => { body += c; });
    req.on("end", () => { let reason = ""; try { reason = JSON.parse(body).reason || ""; } catch {} done(status, reason); });
    req.on("error", (e) => done(0, e.message));
    req.setTimeout(10000, () => { req.close(); done(0, "timeout"); });
    req.end(JSON.stringify(payload));
  });
}

/** The payload the iPhone app understands: answer buttons come from the category, the request rides along.
 *  The sound and badge are filled in per device by the app channel. */
export function requestPayload(q, title) {
  const options = Array.isArray(q.options) ? q.options : [];
  return {
    aps: {
      alert: { title, ...(q.note ? { subtitle: q.note.replace("📍 ", "") } : {}), body: q.question },
      sound: ORACLE_SOUND,
      "interruption-level": "active",
      category: options.length ? `poll.${options.join("|")}` : "ORACLE_POLL",
      "thread-id": "oracle-requests",
    },
    request: { id: q._id, place: q.place, placeId: q.placeId, question: q.question, options, sensor: q.sensor || "poll", at: q.createdAt },
  };
}
