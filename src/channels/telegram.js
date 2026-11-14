// Telegram: same flow as Discord with inline keyboards. No library, just the Bot API.
import { env, PLACES, findPlace, RULES } from "../config.js";
import * as mongo from "../db/mongo.js";
import { ask, recordVote, registerChannel } from "../core.js";
import { explorerAddress } from "../pay/solana.js";

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

const placeKeyboard = () => ({
  inline_keyboard: PLACES.map((p) => [{ text: p.name, callback_data: `place:${p.id}` }]),
});

const userFrom = (from) =>
  mongo.getOrCreateUser({ channel: "telegram", channelUserId: from.id, name: from.first_name || from.username || "friend" });

export async function startTelegram() {
  await api("setMyCommands", {
    commands: [
      { command: "start", description: "Check in at a place" },
      { command: "ask", description: "Ask a place: /ask mu is there pizza?" },
      { command: "me", description: "Your credits, trust and wallet" },
    ],
  });

  registerChannel("telegram", {
    sendPoll: (user, q) =>
      api("sendMessage", {
        chat_id: user.channelUserId,
        text: `🦉 Oracle asks: ${q.question}`,
        reply_markup: { inline_keyboard: [q.options.map((o, i) => ({ text: o, callback_data: `ans:${q._id}:${i + 1}` }))] },
      }),
    sendText: (user, text) => api("sendMessage", { chat_id: user.channelUserId, text }),
  });

  console.log("Telegram bot polling");
  let offset = 0;
  for (;;) {
    try {
      const updates = await api("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
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

async function handle(u) {
  if (u.callback_query) {
    const cq = u.callback_query;
    const user = await userFrom(cq.from);
    const [kind, a, b] = cq.data.split(":");
    let text = "";
    if (kind === "place") {
      const p = findPlace(a);
      await mongo.checkIn(user._id, p.id);
      text = `🦉 You're checked in at ${p.name}. I'll send you quick one-tap questions about it.`;
    } else if (kind === "ans") {
      text = `${cq.message.text}\n${await recordVote(user._id, a, Number(b))}`;
    }
    await api("answerCallbackQuery", { callback_query_id: cq.id });
    await api("editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text });
    return;
  }

  const m = u.message;
  if (!m?.text) return;
  const user = await userFrom(m.from);
  const [cmd, ...rest] = m.text.trim().split(/\s+/);

  if (cmd === "/start" || cmd === "/checkin") {
    return api("sendMessage", {
      chat_id: m.chat.id,
      text: "🦉 Oracle gives AI agents eyes on campus. Where are you right now?",
      reply_markup: placeKeyboard(),
    });
  }

  if (cmd === "/me") {
    const f = await mongo.getUser(user._id);
    const place = f.placeId ? findPlace(f.placeId).name : "not checked in";
    return api("sendMessage", {
      chat_id: m.chat.id,
      text: `🦉 ${f.name}\nPlace: ${place}\nCredits: ${f.credits} · Trust: ${f.trust} · Correct: ${f.correct}/${f.answered}\nWallet: ${explorerAddress(f.wallet.pub)}`,
    });
  }

  if (cmd === "/ask") {
    const p = findPlace(rest[0]);
    const question = rest.slice(1).join(" ");
    if (!p || !question) return api("sendMessage", { chat_id: m.chat.id, text: "Usage: /ask mu is there still pizza?" });
    if (!(await mongo.spendCredit(user._id))) {
      return api("sendMessage", { chat_id: m.chat.id, text: `You need ${RULES.creditAsk} credit. Answer questions to earn more 🦉` });
    }
    await api("sendMessage", { chat_id: m.chat.id, text: `🦉 Asking people at ${p.name}…` });
    const r = await ask({ place: p.id, question, askedBy: user.name, waitSeconds: 120 });
    return api("sendMessage", {
      chat_id: m.chat.id,
      text: `🦉 ${r.question}\n→ ${r.answer || r.note || "No answer yet"} (${r.source || r.status}, ${r.votes ?? r.votes_so_far ?? 0} votes)`,
    });
  }
}
