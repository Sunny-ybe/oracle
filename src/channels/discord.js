// Discord: check-in panel, slash commands, and one-tap polls by DM.
import {
  Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  SlashCommandBuilder, EmbedBuilder,
} from "discord.js";
import { env, PLACES, findPlace, RULES } from "../config.js";
import * as mongo from "../db/mongo.js";
import { ask, recordVote, registerChannel } from "../core.js";
import { balanceSol, explorerAddress, solanaEnabled } from "../pay/solana.js";

const OWL = 0xf5b83d;

const commands = [
  new SlashCommandBuilder().setName("checkin").setDescription("Tell Oracle where you are")
    .addStringOption((o) => o.setName("place").setDescription("Where are you?").setRequired(true)
      .addChoices(...PLACES.map((p) => ({ name: p.name, value: p.id })))),
  new SlashCommandBuilder().setName("ask").setDescription(`Ask people at a place (costs ${RULES.creditAsk} credit)`)
    .addStringOption((o) => o.setName("place").setDescription("Which place").setRequired(true)
      .addChoices(...PLACES.map((p) => ({ name: p.name, value: p.id }))))
    .addStringOption((o) => o.setName("question").setDescription("e.g. Is there still pizza?").setRequired(true)),
  new SlashCommandBuilder().setName("me").setDescription("Your credits, trust and wallet"),
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
    PLACES.slice(0, 5).map((p) => new ButtonBuilder().setCustomId(`place:${p.id}`).setLabel(p.name).setStyle(ButtonStyle.Secondary))
  );
}

export async function startDiscord() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async () => {
    console.log(`Discord online as ${client.user.tag}`);
    if (env.discordGuildId) await client.application.commands.set(commands, env.discordGuildId);
    await postPanel(client);
  });

  client.on(Events.InteractionCreate, async (i) => {
    try {
      if (i.isButton()) return await onButton(i);
      if (i.isChatInputCommand()) return await onCommand(i);
    } catch (err) {
      console.error("Discord interaction error:", err);
      const msg = { content: "Something went wrong. Try again.", flags: MessageFlags.Ephemeral };
      if (i.deferred || i.replied) await i.followUp(msg).catch(() => {});
      else await i.reply(msg).catch(() => {});
    }
  });

  registerChannel("discord", {
    async sendPoll(user, q) {
      const content = `🦉 **Oracle asks:** ${q.question}`;
      try {
        const u = await client.users.fetch(user.channelUserId);
        await u.send({ content, components: [pollRow(q)] });
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
  const user = await userFrom(i.user);

  if (kind === "place") {
    const p = findPlace(a);
    await mongo.checkIn(user._id, p.id);
    return i.reply({
      content: `🦉 You're checked in at **${p.name}**. I'll DM you quick one-tap questions about it.\nYou have **${user.credits} credits** and a devnet wallet. Try \`/me\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (kind === "ans") {
    const msg = await recordVote(user._id, a, Number(b));
    return i.update({ content: `${i.message.content}\n${msg}`, components: [] });
  }
}

async function onCommand(i) {
  const user = await userFrom(i.user);

  if (i.commandName === "checkin") {
    const p = findPlace(i.options.getString("place"));
    await mongo.checkIn(user._id, p.id);
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
    let bal = "";
    if (solanaEnabled()) bal = ` · ${(await balanceSol(fresh.wallet.pub).catch(() => 0)).toFixed(4)} SOL`;
    const place = fresh.placeId ? findPlace(fresh.placeId).name : "not checked in";
    return i.reply({
      content: `🦉 **${fresh.name}**\nPlace: ${place}\nCredits: ${fresh.credits} · Trust: ${fresh.trust} · Correct answers: ${fresh.correct}/${fresh.answered}\nWallet: [${fresh.wallet.pub.slice(0, 6)}…](${explorerAddress(fresh.wallet.pub)})${bal}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (i.commandName === "leaderboard") {
    const top = await mongo.leaderboard();
    const lines = top.map((u, n) => `${["🥇", "🥈", "🥉"][n] || `${n + 1}.`} **${u.name}** · ${u.correct} correct · trust ${u.trust} · ${u.earnedSol.toFixed(3)} SOL`);
    return i.reply({ content: `🦉 **Top reporters**\n${lines.join("\n") || "No one yet."}` });
  }
}

async function postPanel(client) {
  if (!env.discordChannelId) return;
  const ch = await client.channels.fetch(env.discordChannelId);
  const recent = await ch.messages.fetch({ limit: 20 }).catch(() => null);
  if (recent?.some((m) => m.author.id === client.user.id && m.components.length)) return; // already posted
  await ch.send({
    content:
      "🦉 **Oracle gives AI agents eyes on campus.**\nTap where you are. When someone asks about your spot, you get a one-tap question. Good answers earn credits, trust and SOL.",
    components: [placeRow()],
  });
}
