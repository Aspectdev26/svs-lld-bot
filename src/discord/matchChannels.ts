import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import { config } from "../config.js";
import * as matchesRepo from "../sheets/matchesRepo.js";
import { formatElement } from "../util/formatElement.js";
import type { LadderRow, MatchRow } from "../types.js";

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** The #challenges channel doubles as the parent every match thread is created under. */
async function getChallengesParentChannel(client: Client): Promise<TextChannel | null> {
  const channel = await client.channels.fetch(config.channels.challenges);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error(`CHALLENGES_CHANNEL_ID (${config.channels.challenges}) is not a text channel`);
    return null;
  }
  return channel;
}

/**
 * Idempotently grants the League Manager role ManageThreads (+ view/send-in-threads) on
 * #challenges, so any League Manager can see and join every match thread without being
 * individually added to each one — the thread equivalent of the old per-channel
 * `permissionOverwrites` grant. Call once at startup.
 */
export async function ensureLeagueManagerThreadAccess(client: Client): Promise<void> {
  const parent = await getChallengesParentChannel(client);
  if (!parent) return;
  const leagueManagerRole = parent.guild.roles.cache.find((r) => r.name === config.leagueManagerRoleName);
  if (!leagueManagerRole) return;

  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.ManageThreads];
  const existing = parent.permissionOverwrites.cache.get(leagueManagerRole.id);
  if (existing && needed.every((bit) => existing.allow.has(bit))) return;

  await parent.permissionOverwrites.edit(leagueManagerRole, {
    ViewChannel: true,
    SendMessagesInThreads: true,
    ManageThreads: true,
  });
}

export function matchActionRow(matchId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`matchch_report:${matchId}`).setLabel("Report Win").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`matchch_dodge:${matchId}`).setLabel("Request Dodge").setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`matchch_extend:${matchId}`)
      .setLabel("Request Extension")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`matchch_cancel:${matchId}`).setLabel("Cancel Match").setStyle(ButtonStyle.Danger),
  );
}

export async function createMatchChannel(
  client: Client,
  guild: Guild,
  match: MatchRow,
  challenger: LadderRow,
  defender: LadderRow,
): Promise<ThreadChannel> {
  const parent = await getChallengesParentChannel(client);
  if (!parent) {
    throw new Error(`Cannot create match thread: CHALLENGES_CHANNEL_ID (${config.channels.challenges}) is not a text channel`);
  }

  // Private + not invitable: only the two participants (added below) and anyone with
  // ManageThreads on the parent (League Managers, via ensureLeagueManagerThreadAccess) can see or
  // join it — participants can't add outside spectators themselves.
  const thread = await parent.threads.create({
    name: `challenge-${slug(challenger.characterName)}-vs-${slug(defender.characterName)}`,
    type: ChannelType.PrivateThread,
    invitable: false,
    // 7 days: comfortably outlasts the 24h dodge window plus a 2-day extension, so an active
    // match's thread never auto-archives out from under it.
    autoArchiveDuration: 10080,
    reason: `Match ${match.matchId}`,
  });

  await Promise.all([thread.members.add(challenger.discordUserId), thread.members.add(defender.discordUserId)]);

  await matchesRepo.setChannelId(match.sheetRow, thread.id);

  const expiresUnix = Math.floor(Date.parse(match.expiresAt) / 1000);
  const embed = new EmbedBuilder()
    .setTitle("Match thread")
    .setDescription(
      `⚔️ <@${challenger.discordUserId}> (**${formatElement(challenger.element)}**) vs <@${defender.discordUserId}> (**${formatElement(defender.element)}**)\n\n` +
        `Use this thread to arrange and play your match. Match expires <t:${expiresUnix}:F> (<t:${expiresUnix}:R>).\n\n` +
        `**Report Win** — either player can self-report the result once the match is played.\n` +
        `**Request Dodge** — if your opponent hasn't responded in 24+ hours, request a dodge (you'll need a screenshot).\n` +
        `**Request Extension** — ask a League Manager for 2 extra days if you both need more time. One request per match, so make it count.\n` +
        `**Cancel Match** — voids the match with no rank change. Both players must click it to confirm.\n\n` +
        `This thread is deleted automatically once a result is reported, a dodge is approved, or the match is cancelled.`,
    )
    .setColor(0xe67e22);

  const sent = await thread.send({
    content: `<@${challenger.discordUserId}> <@${defender.discordUserId}>`,
    embeds: [embed],
    components: [matchActionRow(match.matchId)],
  });
  // Pinned so expireMatchChannel() can find and edit this exact message later — matches only ever
  // get one thread post like this, so being findable via fetchPins is enough (same trick as the
  // Active Challenges panel).
  await sent.pin().catch((err) => console.error(`Failed to pin match thread message for ${match.matchId}:`, err));

  return thread;
}

export async function closeMatchChannel(client: Client, match: MatchRow, reason: string): Promise<void> {
  if (!match.channelId) return;
  try {
    const channel = await client.channels.fetch(match.channelId);
    if (channel?.isTextBased() && "delete" in channel) {
      await channel.delete(reason);
    }
  } catch (err) {
    console.error(`Failed to delete match thread ${match.channelId} for match ${match.matchId}:`, err);
  }
}

/**
 * Unlike every other resolution, an expired match's thread is deliberately left in place (so
 * there's somewhere to review what happened) instead of being deleted — see closeMatchChannel.
 * Left untouched, though, its original post keeps showing a live "Match expires <t:R>" countdown
 * that just ticks into "expired 3 days ago" and keeps climbing forever, plus action buttons that
 * still look clickable. Edit that post in place to a static, no-longer-ticking notice, drop the
 * buttons, and archive the thread so it drops out of the active list on its own.
 */
export async function expireMatchChannel(client: Client, match: MatchRow): Promise<void> {
  if (!match.channelId) return;
  try {
    const fetched = await client.channels.fetch(match.channelId);
    if (!fetched?.isTextBased()) return;
    const channel = fetched as TextChannel | ThreadChannel;

    const { items: pinned } = await channel.messages.fetchPins();
    const original = pinned.find(
      ({ message: m }) => m.author.id === client.user?.id && m.embeds.some((e) => e.title === "Match thread"),
    )?.message;

    const expiresUnix = Math.floor(Date.parse(match.expiresAt) / 1000);
    const description =
      `⚔️ <@${match.challengerUserId}> (**${formatElement(match.challengerElement)}**) vs <@${match.defenderUserId}> (**${formatElement(match.defenderElement)}**)\n\n` +
      `⌛ This match expired <t:${expiresUnix}:F> with no result reported. No rank change — both players are free to challenge/be challenged again.\n\n` +
      `This thread is archived for reference; a League Manager can delete it once it's no longer needed.`;
    const embed = new EmbedBuilder().setTitle("Match thread (expired)").setDescription(description).setColor(0x7f8c8d);

    if (original) {
      await original.edit({ embeds: [embed], components: [] });
    } else {
      // Original post couldn't be located (unpinned by hand, etc.) — post a fresh static notice
      // rather than leave the thread with no expiry record at all.
      await channel.send({ embeds: [embed] });
    }

    if (channel.isThread()) {
      await channel
        .setArchived(true, "Match expired")
        .catch((err) => console.error(`Failed to archive expired match thread ${match.channelId} for match ${match.matchId}:`, err));
    }
  } catch (err) {
    console.error(`Failed to update expired match thread ${match.channelId} for match ${match.matchId}:`, err);
  }
}
