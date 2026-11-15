// Discord: check-in panel, slash commands, and one-tap polls by DM.
import {
  Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  SlashCommandBuilder, EmbedBuilder, Partials, ModalBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { geocode } from "../web/geo.js";
import { loudnessDb } from "../ai/audio.js";
import { linkToken } from "../web/auth.js";
import { env, PLACES, findPlace, RULES, REWARDS } from "../config.js";
import * as mongo from "../db/mongo.js";
import { ask, registerChannel, announceJoin, answerRequest, findRequestFor, cashOut, redeemReward } from "../core.js";
import { balanceSol, explorerAddress, solanaEnabled, isValidAddress } from "../pay/solana.js";

const OWL = 0xf5b83d;

const commands = [
  new SlashCommandBuilder().setName("checkin").setDescription("Tell Oracle where you are")
    .addStringOption((o) => o.setName("place").setDescription("Where are you?").setRequired(true)
      .addChoices(...PLACES.filter((p) => !p.dynamic).slice(0, 25).map((p) => ({ name: p.name, value: p.id })))),
  new SlashCommandBuilder().setName("location").setDescription("Set your area so you get questions for places near you")
    .addStringOption((o) => o.setName("area").setDescription("A street, campus spot or ZIP, e.g. 'Mill Ave Tempe' or '85281'").setRequired(true)),
  new SlashCommandBuilder().setName("ask").setDescription(`Ask people at a place (costs ${RULES.creditAsk} credit)`)
    .addStringOption((o) => o.setName("place").setDescription("Any place, e.g. 'MU' or 'Trader Joe's on Mill Ave'").setRequired(true))
    .addStringOption((o) => o.setName("question").setDescription("e.g. Is there still pizza?").setRequired(true)),
  new SlashCommandBuilder().setName("me").setDescription("Your points, trust and wallet"),
  new SlashCommandBuilder().setName("rewards").setDescription("Swap your points for gift cards"),
  new SlashCommandBuilder().setName("wallet").setDescription("Link your own Solana (devnet) wallet for cash-outs")
    .addStringOption((o) => o.setName("address").setDescription("Your Phantom address on devnet").setRequired(true)),
  new SlashCommandBuilder().setName("cashout").setDescription(`Turn points into SOL (${env.pointsPerSol} points = 1 SOL)`)
    .addIntegerOption((o) => o.setName("points").setDescription("How many points; leave empty for all").setMinValue(1)),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Top reporters"),
].map((c) => c.toJSON());

const userFrom = (u) => mongo.getOrCreateUser({ channel: "discord", channelUserId: u.id, name: u.globalName || u.username });

function pollRow(q) {
  return new ActionRowBuilder().addComponents(
    q.options.map((label, i) =>
      new ButtonBuilder().setCustomId(`ans:${q._id}:${i + 1}`).setLabel(label).setStyle(ButtonStyle.Primary)
    )
  );
}

function placeRow() {
  return new ActionRowBuilder().addComponents(
    PLACES.filter((p) => !p.dynamic).slice(0, 5).map((p) => new ButtonBuilder().setCustomId(`place:${p.id}`).setLabel(p.name).setStyle(ButtonStyle.Secondary))
  );
}

export async function startDiscord() {
  // DirectMessages lets earners answer by replying in DM with a photo, voice message or text.
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages], partials: [Partials.Channel] });

  client.on(Events.MessageCreate, async (m) => {
    if (m.author.bot || m.guild) return;
    try {
      const user = await userFrom(m.author);
      const file = m.attachments.first();
      const isImage = file?.contentType?.startsWith("image/");
      const isAudio = file?.contentType?.startsWith("audio/");
      const kind = isImage ? "photo" : isAudio ? "voice" : m.content ? "text" : null;
      if (!kind) return;
      const qid = findRequestFor(user._id, kind);
      if (!qid) return m.reply(kind === "text" ? "🦉 Use `/checkin` to say where you are; questions about it will show up here." : "🦉 Thanks! There's no open request for that right now.");
      let body;
      if (isImage) {
        const buf = Buffer.from(await (await fetch(file.url)).arrayBuffer());
        body = { image: `data:${file.contentType};base64,${buf.toString("base64")}`, mime: file.contentType, ...(m.content && { text: m.content }) };
      } else if (isAudio) {
        body = { db: await loudnessDb(Buffer.from(await (await fetch(file.url)).arrayBuffer())) };
      } else body = { text: m.content };
      const r = await answerRequest(user._id, qid, body);
      await m.reply(`${r.ok ? "✅" : "🦉"} ${r.message}${r.ok && isImage ? "\n🔒 Faces, badges, screens and plates were blurred before sharing." : ""}`);
    } catch (e) {
      await m.reply(e.message.includes("ffmpeg") ? "🦉 Voice readings aren't switched on yet. Tap a button instead." : "🦉 Couldn't read that. Try again or tap a button.").catch(() => {});
    }
  });

  client.once(Events.ClientReady, async () => {
    console.log(`Discord online as ${client.user.tag}`);
    if (env.discordGuildId) await client.application.commands.set(commands, env.discordGuildId);
    await postPanel(client);
  });

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isButton()) return await onButton(i);
      if (i.isChatInputCommand()) return await onCommand(i);
      if (i.isModalSubmit() && i.customId === "areaModal") return await setArea(i, i.fields.getTextInputValue("area"));
    } catch (err) {
      console.error("Discord interaction error:", err);
      const msg = { content: "Something went wrong. Try again.", flags: MessageFlags.Ephemeral };
      if (i.deferred || i.replied) await i.followUp(msg).catch(() => {});
      else await i.reply(msg).catch(() => {});
    }
  });

  registerChannel("discord", {
    async sendPoll(user, q) {
      const content = `🦉 **Oracle asks:** ${q.question}${q.note ? `\n${q.note}` : ""}`;
      try {
        const u = await client.users.fetch(user.channelUserId);
        await u.send({ content, components: [pollRow(q)] });
      } catch {
        const ch = await client.channels.fetch(env.discordChannelId);
        await ch.send({ content: `<@${user.channelUserId}> ${content}`, components: [pollRow(q)] });
      }
    },
    async sendTask(user, q) {
      const hint = {
        noise: `Tap one, or send a 10-second 🎙️ voice message for an exact reading (+${RULES.creditPhoto} pts).`,
        wifi: `Tap one, or run the 1 MB speed test for an exact reading (+${RULES.creditPhoto} pts).`,
        people_count: `Tap one, or reply with a 📸 photo of the room for an exact count (+${RULES.creditPhoto} pts). Faces are blurred.`,
        photo: `Tap one, or reply with a 📸 photo (+${RULES.creditPhoto} pts). Faces and plates are blurred.`,
        report: "Find out, then reply here with what you learned. You can attach a photo.",
      }[q.sensor] || "";
      const content = `🦉 **Oracle asks:** ${q.question}${q.note ? `\n${q.note}` : ""}\n${hint}`;
      // A bot can't measure the connection, so the speed test runs on a web page signed in as this person.
      // The link is personal, so it only goes out by DM, never to the shared channel.
      const speed = q.sensor === "wifi" && env.publicUrl.startsWith("https://")
        ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("🛜 Run speed test").setURL(`${env.publicUrl}/app?q=${q._id}&t=${linkToken(user._id)}`))]
        : [];
      try {
        const u = await client.users.fetch(user.channelUserId);
        await u.send({ content, components: [pollRow(q), ...speed] });
      } catch {
        const ch = await client.channels.fetch(env.discordChannelId);
        await ch.send({ content: `<@${user.channelUserId}> ${content}`, components: [pollRow(q)] });
      }
    },
    async sendText(user, text) {
      try {
        const u = await client.users.fetch(user.channelUserId);
        await u.send(text);
      } catch {
        const ch = await client.channels.fetch(env.discordChannelId);
        await ch.send(`<@${user.channelUserId}> ${text}`);
      }
    },
  });

  await client.login(env.discordToken);
}

async function onButton(i) {
  const [kind, a, b] = i.customId.split(":");
  if (kind === "area") {
    return i.showModal(new ModalBuilder().setCustomId("areaModal").setTitle("Where are you usually?").addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("area").setLabel("Street, campus spot or ZIP")
        .setPlaceholder("e.g. Mill Ave Tempe, Memorial Union, 85281").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100))
    ));
  }
  const user = await userFrom(i.user);

  if (kind === "place") {
    const p = findPlace(a);
    await mongo.checkIn(user._id, p.id);
    announceJoin(user, p.id).catch(() => {});
    return i.reply({
      content: `🦉 You're checked in at **${p.name}**. I'll DM you quick one-tap questions about it.\nYou have **${user.credits} credits** and a devnet wallet. Try \`/me\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (kind === "redeem") {
    const reward = REWARDS.find((r) => r.id === a);
    const r = reward ? await redeemReward(user._id, reward) : { message: "That reward is gone." };
    return i.reply({ content: `🦉 ${r.message}`, flags: MessageFlags.Ephemeral });
  }

  if (kind === "ans") {
    const r = await answerRequest(user._id, a, { option: Number(b) });
    return i.update({ content: `${i.message.content}\n${r.message}`, components: [] });
  }
}

async function onCommand(i) {
  const user = await userFrom(i.user);

  if (i.commandName === "location") return setArea(i, i.options.getString("area"));

  if (i.commandName === "checkin") {
    const p = findPlace(i.options.getString("place"));
    await mongo.checkIn(user._id, p.id);
    announceJoin(user, p.id).catch(() => {});
    return i.reply({ content: `🦉 Checked in at **${p.name}**.`, flags: MessageFlags.Ephemeral });
  }

  if (i.commandName === "ask") {
    if (!(await mongo.spendCredit(user._id))) {
      return i.reply({ content: "You're out of credits. Answer a few questions to earn more 🦉", flags: MessageFlags.Ephemeral });
    }
    await i.deferReply();
    const r = await ask({ place: i.options.getString("place"), question: i.options.getString("question"), askedBy: user.name, waitSeconds: 120 });
    const embed = new EmbedBuilder().setColor(OWL).setTitle(`🦉 ${r.question}`)
      .setDescription(r.answer ? `**${r.answer}**` : r.note || "No answer yet.")
      .addFields(
        { name: "Source", value: r.source || r.status, inline: true },
        { name: "Votes", value: String(r.votes ?? r.votes_so_far ?? 0), inline: true },
        ...(r.evidence ? [{ name: "Evidence", value: r.evidence.slice(0, 200) }] : [])
      );
    return i.editReply({ embeds: [embed] });
  }

  if (i.commandName === "me") {
    const fresh = await mongo.getUser(user._id);
    const wallet = fresh.payoutWallet || fresh.wallet.pub;
    let bal = "";
    if (solanaEnabled()) bal = ` · ${(await balanceSol(wallet).catch(() => 0)).toFixed(4)} SOL`;
    const place = fresh.placeId ? findPlace(fresh.placeId)?.name : fresh.location ? "your area" : "not set";
    return i.reply({
      content: `🦉 **${fresh.name}**\n⭐ **${fresh.credits} points** (worth ${(fresh.credits / env.pointsPerSol).toFixed(3)} SOL)\nTrust ${fresh.trust} · right ${fresh.correct} of ${fresh.answered} · earned ${(fresh.earnedSol || 0).toFixed(3)} SOL\nQuestions for: ${place}\nWallet: [${wallet.slice(0, 4)}…${wallet.slice(-4)}](${explorerAddress(wallet)})${bal}${fresh.payoutWallet ? "" : " (Oracle wallet; link yours with `/wallet`)"}\nSpend points with \`/rewards\` or \`/cashout\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (i.commandName === "rewards") {
    const fresh = await mongo.getUser(user._id);
    const row = new ActionRowBuilder().addComponents(
      REWARDS.map((r) => new ButtonBuilder().setCustomId(`redeem:${r.id}`).setLabel(`${r.name} · ${r.points} pts`)
        .setStyle(fresh.credits >= r.points ? ButtonStyle.Primary : ButtonStyle.Secondary))
    );
    return i.reply({ content: `🎁 You have **${fresh.credits} points**. Pick a reward, or use \`/cashout\` for SOL.`, components: [row], flags: MessageFlags.Ephemeral });
  }

  if (i.commandName === "wallet") {
    const addr = i.options.getString("address").trim();
    if (!isValidAddress(addr)) return i.reply({ content: "That doesn't look like a Solana address. Copy it from Phantom and try again.", flags: MessageFlags.Ephemeral });
    await mongo.setPayoutWallet(user._id, addr);
    return i.reply({ content: `✅ Linked. Cash-outs now go to [${addr.slice(0, 4)}…${addr.slice(-4)}](${explorerAddress(addr)}).`, flags: MessageFlags.Ephemeral });
  }

  if (i.commandName === "cashout") {
    const fresh = await mongo.getUser(user._id);
    const points = i.options.getInteger("points") ?? fresh.credits;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const r = await cashOut(user._id, points);
    return i.editReply(r.ok ? `✅ ${r.message} [View on Solana Explorer](${r.url})` : `🦉 ${r.message}`);
  }

  if (i.commandName === "leaderboard") {
    const top = await mongo.leaderboard();
    const lines = top.map((u, n) => `${["🥇", "🥈", "🥉"][n] || `${n + 1}.`} **${u.name}** · ${u.correct} correct · trust ${u.trust} · ${u.earnedSol.toFixed(3)} SOL`);
    return i.reply({ content: `🦉 **Top reporters**\n${lines.join("\n") || "No one yet."}` });
  }
}

const PANEL = `🦉 **Oracle: earn by answering what AI can't see.**
When an AI agent asks about a store, a line, a park or anything within ${env.answerRadiusMiles} miles of you, you get a one-tap question by DM. Good answers earn points, trust and SOL.
**Tap 📍 Set my area once**, or pick a campus spot.
See your points with \`/me\`, spend them with \`/rewards\` (gift cards) or \`/cashout\` (SOL).`;
const areaRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("area").setLabel("📍 Set my area").setStyle(ButtonStyle.Success)
);

async function postPanel(client) {
  if (!env.discordChannelId) return;
  const ch = await client.channels.fetch(env.discordChannelId);
  const recent = await ch.messages.fetch({ limit: 20 }).catch(() => null);
  const old = recent?.find((m) => m.author.id === client.user.id && m.components.length);
  const panel = { content: PANEL, components: [areaRow(), placeRow()] };
  if (old) { if (old.content !== PANEL) await old.edit(panel).catch(() => {}); return; }
  await ch.send(panel);
}

// Discord can't share GPS, so people type an area once; only the coordinates are kept.
async function setArea(i, text) {
  const user = await userFrom(i.user);
  const known = findPlace(text);
  const spot = known ? { lat: known.lat, lng: known.lng, name: known.name } : await geocode(text).catch(() => null);
  if (!spot) return i.reply({ content: "🦉 Couldn't find that on the map. Try a street with the city, or a ZIP code.", flags: MessageFlags.Ephemeral });
  const r = await mongo.setLocation(user._id, spot.lat, spot.lng);
  announceJoin(user, r.placeId).catch(() => {});
  return i.reply({
    content: `📍 Area set near **${spot.name}**. You'll get one-tap questions by DM for places within ${env.answerRadiusMiles} miles. Change it anytime with \`/location\`.`,
    flags: MessageFlags.Ephemeral,
  });
}
