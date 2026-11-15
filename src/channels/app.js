// The Oracle app as a channel: earners who chose the app get native phone notifications
// (Web Push). Tapping one opens the app straight on that request.
import webpush from "web-push";
import { env } from "../config.js";
import * as mongo from "../db/mongo.js";
import { registerChannel } from "../core.js";

let publicKey = null;
export const vapidPublicKey = () => publicKey;

const HINT = {
  noise: "Tap an answer or measure the noise (5 sec)",
  people_count: "Tap an answer or snap the room",
  photo: "Tap an answer or snap a photo",
  report: "Find out and reply",
};

async function push(user, payload) {
  const fresh = await mongo.getUser(user._id);
  for (const sub of fresh?.push || []) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 600, urgency: "high" });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await mongo.removePush(user._id, sub.endpoint);
      else console.error("Push failed:", e.statusCode || e.message);
    }
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

  registerChannel("app", {
    sendPoll: (user, q, url) => push(user, { title: `🦉 ${q.place}${q.note ? ` · ${q.note.replace("📍 ", "")}` : ""}`, body: q.question, url, tag: q._id }),
    sendTask: (user, q, url) => push(user, { title: `🦉 ${q.place}${q.note ? ` · ${q.note.replace("📍 ", "")}` : ""}`, body: `${q.question}\n${HINT[q.sensor] || ""}`, url, tag: q._id }),
    sendText: (user, text) => push(user, { title: "Oracle", body: text, url: `${env.publicUrl}/app` }),
  });
  console.log("App notifications ready");
}
