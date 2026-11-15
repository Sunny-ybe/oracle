// The Oracle app as a channel: earners who chose the app get native phone notifications.
// Web app: Web Push. iPhone app: Apple Push (APNs), which also works while the app is closed.
// Tapping one opens the app straight on that request; on iPhone the answer buttons send it directly.
import webpush from "web-push";
import { env } from "../config.js";
import * as mongo from "../db/mongo.js";
import { registerChannel, pendingFor } from "../core.js";
import { apnsEnabled, sendApns, requestPayload, ORACLE_SOUND } from "./apns.js";

let publicKey = null;
export const vapidPublicKey = () => publicKey;

const HINT = {
  noise: "Tap an answer or measure the noise (10 sec)",
  wifi: "Tap an answer or run the 1 MB speed test",
  people_count: "Tap, type the number, or snap the room",
  photo: "Tap an answer or snap a photo",
  report: "Find out and reply",
};

async function push(user, payload, apnsPayload) {
  const fresh = await mongo.getUser(user._id);
  for (const sub of fresh?.push || []) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 600, urgency: "high" });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await mongo.removePush(user._id, sub.endpoint);
      else console.error("Push failed:", e.statusCode || e.message);
    }
  }
  if (!apnsEnabled()) return;
  // The app icon badge shows how many requests are waiting for this person.
  let badge;
  try { badge = pendingFor(user._id).length; } catch {}
  for (const device of fresh?.apns || []) {
    const aps = { ...apnsPayload.aps, sound: device.sound === "default" ? "default" : apnsPayload.aps.sound || ORACLE_SOUND };
    if (apnsPayload.request && Number.isInteger(badge)) aps.badge = badge;
    const body = { ...apnsPayload, aps };
    let r = await sendApns(device, body, { collapseId: payload.tag });
    // A token from the other APNs server (an Xcode build vs TestFlight) is retried there once and remembered.
    if (r.wrongEnvironment) {
      const other = { ...device, sandbox: !device.sandbox };
      const retry = await sendApns(other, body, { collapseId: payload.tag });
      if (retry.ok) { await mongo.setApnsSandbox(user._id, device.token, other.sandbox); continue; }
      r = retry;
    }
    if (r.gone) await mongo.removeApns(user._id, device.token);
    else if (!r.ok) console.error("APNs failed:", r.status, r.reason);
  }
}

export async function startAppChannel() {
  let keys = await mongo.getSetting("vapid");
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    await mongo.setSetting("vapid", keys);
  }
  webpush.setVapidDetails("mailto:team@oracle.example", keys.publicKey, keys.privateKey);
  publicKey = keys.publicKey;

  const title = (q) => `🦉 ${q.place}${q.note ? ` · ${q.note.replace("📍 ", "")}` : ""}`;
  registerChannel("app", {
    sendPoll: (user, q, url) => push(user, { title: title(q), body: q.question, url, tag: q._id },
      requestPayload(q, `Quick Poll · ${q.place}`)),
    sendTask: (user, q, url) => push(user, { title: title(q), body: `${q.question}\n${HINT[q.sensor] || ""}`, url, tag: q._id },
      requestPayload(q, `Quick Request · ${q.place}`)),
    sendText: (user, text) => push(user, { title: "Oracle", body: text, url: `${env.publicUrl}/app` },
      { aps: { alert: { title: "Oracle", body: text }, sound: "default", "thread-id": "oracle-requests" } }),
  });
  console.log(`App notifications ready${apnsEnabled() ? " (web push + iPhone APNs)" : " (web push; iPhone APNs off: set APNS_* in .env)"}`);
}
