// Telegram: scan once to join, share live location so Oracle knows where you are,
// answer one-tap polls, and spend points on gift cards or SOL. Plain Bot API, no library.
import { env, PLACES, findPlace, RULES, REWARDS } from "../config.js";
import * as mongo from "../db/mongo.js";
import { ask, recordVote, registerChannel, announceJoin, cashOut, redeemReward, answerRequest, findRequestFor } from "../core.js";
import { explorerAddress, isValidAddress, solanaEnabled } from "../pay/solana.js";
import { loudnessDb } from "../ai/audio.js";

const api = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
};
const say = (chat_id, text, extra = {}) => api("sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

let botUsername = null;
const replyTo = new Map(); // "chatId:messageId" -> question id, so replies land on the right request

async function download(fileId) {
  const f = await api("getFile", { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${env.telegramToken}/${f.file_path}`);
  return Buffer.from(await res.arrayBuffer());
}
const replyFor = (m) => (m.reply_to_message ? replyTo.get(`${m.chat.id}:${m.reply_to_message.message_id}`) : null);
// Deep link that opens the bot and checks the person in at a place in one tap.
export const telegramJoinLink = (placeId) => (botUsername ? `https://t.me/${botUsername}?start=${placeId || "join"}` : null);

const placeKeyboard = () => ({ inline_keyboard: PLACES.filter((p) => !p.dynamic).slice(0, 8).map((p) => [{ text: p.name, callback_data: `place:${p.id}` }]) });
const locationKeyboard = {
  keyboard: [[{ text: "📍 Share my location", request_location: true }]],
  resize_keyboard: true, one_time_keyboard: true,
};
const userFrom = (from) =>
  mongo.getOrCreateUser({ channel: "telegram", channelUserId: from.id, name: from.first_name || from.username || "friend" });

const HELP = `🦉 <b>Oracle</b>
/points · your points, trust and earnings
/rewards · swap points for gift cards
/wallet &lt;address&gt; · link your Phantom wallet (devnet)
/cashout &lt;points&gt; · turn points into SOL
/ask &lt;place&gt; &lt;question&gt; · ask people somewhere else
/where · change where you are

You earn ${RULES.creditVote} point per answer, ${RULES.creditPhoto} for a verified photo, and SOL when you match the crowd.`;

export async function startTelegram() {
  botUsername = (await api("getMe", {})).username;
  await api("setMyCommands", {
    commands: [
      { command: "points", description: "Your points, trust and earnings" },
      { command: "rewards", description: "Swap points for gift cards" },
      { command: "wallet", description: "Link your Solana wallet" },
      { command: "cashout", description: "Turn points into SOL" },
      { command: "ask", description: "Ask a place: /ask mu is there pizza?" },
      { command: "where", description: "Change where you are" },
      { command: "help", description: "How Oracle works" },
    ],
  });

  // Everything happens inside Telegram: tap buttons, or reply with a photo / voice note / text.
  const ask1 = (q, extraLine) =>
    `🦉 Oracle asks: ${q.question}${q.note ? `\n${q.note}` : ""}${extraLine ? `\n\n${extraLine}` : ""}`;
  const buttons = (q) => ({ inline_keyboard: [q.options.map((o, i) => ({ text: o, callback_data: `ans:${q._id}:${i + 1}` }))] });
  const HINT = {
    noise: `Tap one, or hold 🎙️ and send a 5-second voice note for an exact reading (+${RULES.creditPhoto} pts).`,
    people_count: `Tap one, or send a 📸 photo of the room for an exact count (+${RULES.creditPhoto} pts). Faces are blurred.`,
    photo: `Tap one, or send a 📸 photo (+${RULES.creditPhoto} pts). Faces and plates are blurred.`,
    report: `Find out, then reply to this message with what you learned. You can attach a photo.`,
  };
  registerChannel("telegram", {
    sendPoll: (user, q) => api("sendMessage", { chat_id: user.channelUserId, text: ask1(q), reply_markup: buttons(q) }),
    sendText: (user, text) => api("sendMessage", { chat_id: user.channelUserId, text }),
    sendTask: async (user, q) => {
      const msg = await api("sendMessage", { chat_id: user.channelUserId, text: ask1(q, HINT[q.sensor]), reply_markup: buttons(q) });
      replyTo.set(`${user.channelUserId}:${msg.message_id}`, q._id);
      return msg;
    },
  });

  // Earlier versions set a menu button that opened a web page; clear it so Telegram stays self-contained.
  await api("setChatMenuButton", { menu_button: { type: "commands" } }).catch(() => {});
  console.log(`Telegram bot polling as @${botUsername}`);
  let offset = 0;
  for (;;) {
    try {
      const updates = await api("getUpdates", {
        offset, timeout: 30, allowed_updates: ["message", "edited_message", "callback_query"],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        handle(u).catch((e) => console.error("Telegram update error:", e.message));
      }
    } catch (e) {
      console.error("Telegram polling error:", e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function onLocation(m, quiet) {
  const user = await userFrom(m.from);
  const { latitude, longitude } = m.location;
  const { placeId, changed, first } = await mongo.setLocation(user._id, latitude, longitude);
  if (changed || first) announceJoin(user, placeId).catch(() => {});
  if (!quiet && first) {
    return say(m.chat.id, `📍 You're all set. When an AI agent asks about anywhere within ${env.answerRadiusMiles} miles of you, you'll get a one-tap question here. Nearest places come first.`, { reply_markup: { remove_keyboard: true } });
  }
  if (changed && !quiet) return say(m.chat.id, `📍 You're near <b>${esc(findPlace(placeId).name)}</b>.`, { reply_markup: { remove_keyboard: true } });
  if (!quiet) return say(m.chat.id, "📍 Location updated.", { reply_markup: { remove_keyboard: true } });
}

async function handle(u) {
  // Live location updates arrive as edited messages; update silently unless the place changed.
  if (u.edited_message?.location) return onLocation(u.edited_message, true);

  if (u.callback_query) {
    const cq = u.callback_query;
    const user = await userFrom(cq.from);
    const [kind, a, b] = cq.data.split(":");
    let text = cq.message.text;
    if (kind === "place") {
      const p = findPlace(a);
      await mongo.checkIn(user._id, p.id);
      announceJoin(user, p.id).catch(() => {});
      text = `🦉 You're checked in at ${p.name}. I'll send you quick one-tap questions about it.`;
    } else if (kind === "ans") {
      const r = await answerRequest(user._id, a, { option: Number(b) });
      text = `${cq.message.text}\n\n${r.message}`;
    } else if (kind === "redeem") {
      const reward = REWARDS.find((r) => r.id === a);
      const r = reward ? await redeemReward(user._id, reward) : { message: "That reward is gone." };
      await api("answerCallbackQuery", { callback_query_id: cq.id, text: r.ok ? "Redeemed!" : "Not enough points", show_alert: !r.ok });
      return say(cq.message.chat.id, `${r.ok ? "🎁" : "🦉"} ${esc(r.message)}`);
    }
    await api("answerCallbackQuery", { callback_query_id: cq.id });
    await api("editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text });
    return;
  }

  const m = u.message;
  if (!m) return;
  if (m.location) return onLocation(m, false);

  // A photo, voice note or reply answers the open request, right here in the chat.
  if (m.photo || m.voice || m.audio || (m.text && !m.text.startsWith("/"))) {
    const user = await userFrom(m.from);
    const kind = m.photo ? "photo" : m.voice || m.audio ? "voice" : "text";
    const qid = replyFor(m) || findRequestFor(user._id, kind);
    if (!qid) return say(m.chat.id, kind === "text" ? HELP : "🦉 Thanks! There's no open request for that right now.");
    let body;
    try {
      if (kind === "photo") {
        await api("sendChatAction", { chat_id: m.chat.id, action: "upload_photo" }).catch(() => {});
        const buf = await download(m.photo.at(-1).file_id);
        body = { image: `data:image/jpeg;base64,${buf.toString("base64")}`, mime: "image/jpeg", ...(m.caption && { text: m.caption }) };
      } else if (kind === "voice") {
        const buf = await download((m.voice || m.audio).file_id);
        body = { db: await loudnessDb(buf) };
      } else body = { text: m.text };
    } catch (e) {
      return say(m.chat.id, `🦉 ${e.message.includes("ffmpeg") ? "Voice readings aren't switched on yet. Tap one of the buttons instead." : "Couldn't read that. Try again or tap a button."}`);
    }
    const r = await answerRequest(user._id, qid, body);
    return say(m.chat.id, `${r.ok ? "✅" : "🦉"} ${esc(r.message)}${r.ok && body.image ? "\n🔒 Faces, badges, screens and plates were blurred before sharing." : ""}`);
  }
  if (!m.text) return;

  const user = await userFrom(m.from);
  const [rawCmd, ...rest] = m.text.trim().split(/\s+/);
  const cmd = rawCmd.split("@")[0].toLowerCase();

  // First time: scanned the QR. /start <placeId> checks them in, then offers live location.
  if (cmd === "/start" && rest[0] && findPlace(rest[0])) {
    const p = findPlace(rest[0]);
    await mongo.checkIn(user._id, p.id);
    announceJoin(user, p.id).catch(() => {});
    await say(m.chat.id,
      `🦉 Welcome to Oracle, <b>${esc(user.name)}</b>! You're checked in at <b>${esc(p.name)}</b>.\n\nWhen an AI agent asks what's happening near you, you'll get a one-tap question. Answers earn points you can swap for gift cards or SOL.`);
    return say(m.chat.id,
      "Want questions wherever you go, without scanning again? Share your location once.\nFor all day: 📎 → Location → <b>Share My Live Location</b>.",
      { reply_markup: locationKeyboard });
  }

  // Scanned the general QR: welcome them, then one tap to share location (or pick a place).
  if (cmd === "/start" && (!rest[0] || rest[0] === "join")) {
    await say(m.chat.id,
      `🦉 Welcome to Oracle, <b>${esc(user.name)}</b>!\n\nWhen an AI agent asks what's happening near you (a line, how busy it is, how sunny, anything), you get a one-tap question right here. Answers earn points for gift cards or SOL.`);
    await say(m.chat.id,
      "📍 Share your location so questions find you wherever you are. For all day: 📎 → Location → <b>Share My Live Location</b>.",
      { reply_markup: locationKeyboard });
    return say(m.chat.id, "Or pick where you are right now:", { reply_markup: placeKeyboard() });
  }

  if (cmd === "/start") {
    return say(m.chat.id,
      `🦉 Welcome to Oracle, <b>${esc(user.name)}</b>!\n\nAI agents can read the whole internet but can't see the street. When one asks about a store, line, park or anything near you, you get a one-tap question here and earn points for gift cards or SOL.\n\n<b>One step left:</b> tap the button below to share your location. For all-day questions: 📎 → Location → Share My Live Location.`,
      { reply_markup: locationKeyboard });
  }

  if (cmd === "/where" || cmd === "/checkin") {
    await say(m.chat.id, "🦉 Where are you right now?", { reply_markup: placeKeyboard() });
    return say(m.chat.id, "Or share your location and I'll work it out.", { reply_markup: locationKeyboard });
  }

  if (cmd === "/help") return say(m.chat.id, HELP);

  if (cmd === "/points" || cmd === "/me") {
    const f = await mongo.getUser(user._id);
    const place = f.placeId ? findPlace(f.placeId)?.name : "not checked in";
    const wallet = f.payoutWallet || f.wallet.pub;
    return say(m.chat.id,
      `🦉 <b>${esc(f.name)}</b>\n⭐ <b>${f.credits} points</b>\nTrust ${f.trust} · right ${f.correct} of ${f.answered}\nEarned ${f.earnedSol.toFixed(3)} SOL\nNear: ${esc(place)}\nWallet: <a href="${explorerAddress(wallet)}">${wallet.slice(0, 4)}…${wallet.slice(-4)}</a>${f.payoutWallet ? "" : " (Oracle wallet; link yours with /wallet)"}`,
      { disable_web_page_preview: true });
  }

  if (cmd === "/rewards") {
    const f = await mongo.getUser(user._id);
    return say(m.chat.id, `🎁 You have <b>${f.credits} points</b>. Pick a reward:`, {
      reply_markup: { inline_keyboard: REWARDS.map((r) => [{ text: `${r.name} · ${r.points} pts`, callback_data: `redeem:${r.id}` }]) },
    });
  }

  if (cmd === "/wallet") {
    if (!rest[0]) return say(m.chat.id, "Send <code>/wallet YOUR_SOLANA_ADDRESS</code>. In Phantom: Settings → Developer settings → Testnet mode (Devnet), then copy your address.");
    if (!isValidAddress(rest[0])) return say(m.chat.id, "That doesn't look like a Solana address. Copy it from Phantom and try again.");
    await mongo.setPayoutWallet(user._id, rest[0]);
    return say(m.chat.id, `✅ Linked. Cash-outs now go to <a href="${explorerAddress(rest[0])}">${rest[0].slice(0, 4)}…${rest[0].slice(-4)}</a>.`, { disable_web_page_preview: true });
  }

  if (cmd === "/cashout") {
    if (!solanaEnabled()) return say(m.chat.id, "Cash-outs aren't switched on yet.");
    const f = await mongo.getUser(user._id);
    const points = rest[0] ? Number(rest[0]) : f.credits;
    await say(m.chat.id, `💸 Sending ${(points / env.pointsPerSol).toFixed(4)} SOL…`);
    const r = await cashOut(user._id, points);
    return say(m.chat.id, r.ok ? `✅ ${esc(r.message)}\n<a href="${r.url}">View on Solana Explorer</a>` : `🦉 ${esc(r.message)}`, { disable_web_page_preview: true });
  }

  if (cmd === "/ask") {
    const p = findPlace(rest[0]);
    const question = rest.slice(1).join(" ");
    if (!p || !question) return say(m.chat.id, "Usage: <code>/ask mu is there still pizza?</code>");
    if (!(await mongo.spendCredit(user._id))) return say(m.chat.id, `You need ${RULES.creditAsk} point. Answer questions to earn more 🦉`);
    await say(m.chat.id, `🦉 Asking people at ${esc(p.name)}…`);
    const r = await ask({ place: p.id, question, askedBy: user.name, waitSeconds: 120 });
    return say(m.chat.id, `🦉 ${esc(r.question)}\n→ <b>${esc(r.answer || r.note || "No answer yet")}</b> (${r.source || r.status}, ${r.votes ?? r.votes_so_far ?? 0} votes)`);
  }

  return say(m.chat.id, HELP);
}
