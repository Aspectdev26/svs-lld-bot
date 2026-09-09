import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  OverwriteType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type TextChannel,
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

async function getOrCreateChallengeCategory(guild: Guild) {
  const existing = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name === config.matchChannels.categoryName,
  );
  if (existing) return existing;
  return guild.channels.create({
    name: config.matchChannels.categoryName,
    type: ChannelType.GuildCategory,
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
): Promise<TextChannel> {
  const category = await getOrCreateChallengeCategory(guild);
  const leagueManagerRole = guild.roles.cache.find((r) => r.name === config.leagueManagerRoleName);

  const channel = await guild.channels.create({
    name: `challenge-${slug(challenger.characterName)}-vs-${slug(defender.characterName)}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Match ${match.matchId}: ${challenger.characterName} (${formatElement(challenger.element)}) vs ${defender.characterName} (${formatElement(defender.element)})`,
    // Explicit `type` on every overwrite: without it, discord.js tries to resolve each id against
    // its User/Role caches to guess the type, and throws if the user isn't cached (likely here,
    // since the bot doesn't proactively cache all guild members).
    permissionOverwrites: [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: challenger.discordUserId,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
      },
      {
        id: defender.discordUserId,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
      },
      {
        id: client.user!.id,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory],
      },
      ...(leagueManagerRole
        ? [
            {
              id: leagueManagerRole.id,
              type: OverwriteType.Role,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            },
          ]
        : []),
    ],
  });

  await matchesRepo.setChannelId(match.sheetRow, channel.id);

  const expiresUnix = Math.floor(Date.parse(match.expiresAt) / 1000);
  const embed = new EmbedBuilder()
    .setTitle("Match channel")
    .setDescription(
      `⚔️ <@${challenger.discordUserId}> (**${formatElement(challenger.element)}**) vs <@${defender.discordUserId}> (**${formatElement(defender.element)}**)\n\n` +
        `Use this channel to arrange and play your match. Match expires <t:${expiresUnix}:F> (<t:${expiresUnix}:R>).\n\n` +
        `**Report Win** — either player can self-report the result once the match is played.\n` +
        `**Request Dodge** — if your opponent hasn't responded in 24+ hours, request a dodge (you'll need a screenshot).\n` +
        `**Request Extension** — ask a League Manager for 2 extra days if you both need more time. One request per match, so make it count.\n` +
        `**Cancel Match** — voids the match with no rank change. Both players must click it to confirm.\n\n` +
        `This channel is deleted automatically once a result is reported, a dodge is approved, or the match is cancelled.`,
    )
    .setColor(0xe67e22);

  const sent = await channel.send({
    content: `<@${challenger.discordUserId}> <@${defender.discordUserId}>`,
    embeds: [embed],
    components: [matchActionRow(match.matchId)],
  });
  // Pinned so expireMatchChannel() can find and edit this exact message later — matches only ever
  // get one channel post like this, so being findable via fetchPins is enough (same trick as the
  // Active Challenges panel).
  await sent.pin().catch((err) => console.error(`Failed to pin match channel message for ${match.matchId}:`, err));

  return channel;
}

export async function closeMatchChannel(client: Client, match: MatchRow, reason: string): Promise<void> {
  if (!match.channelId) return;
  try {
    const channel = await client.channels.fetch(match.channelId);
    if (channel?.isTextBased() && "delete" in channel) {
      await (channel as TextChannel).delete(reason);
    }
  } catch (err) {
    console.error(`Failed to delete match channel ${match.channelId} for match ${match.matchId}:`, err);
  }
}

/**
 * Unlike every other resolution, an expired match's channel is deliberately left in place (so
 * there's somewhere to review what happened) instead of being deleted — see closeMatchChannel.
 * Left untouched, though, its original post keeps showing a live "Match expires <t:R>" countdown
 * that just ticks into "expired 3 days ago" and keeps climbing forever, plus action buttons that
 * still look clickable. Edit that post in place to a static, no-longer-ticking notice and drop
 * the buttons, so the channel reads as closed rather than still running.
 */
export async function expireMatchChannel(client: Client, match: MatchRow): Promise<void> {
  if (!match.channelId) return;
  try {
    const channel = await client.channels.fetch(match.channelId);
    if (!channel?.isTextBased()) return;
    const textChannel = channel as TextChannel;

    const { items: pinned } = await textChannel.messages.fetchPins();
    const original = pinned.find(
      ({ message: m }) => m.author.id === client.user?.id && m.embeds.some((e) => e.title === "Match channel"),
    )?.message;

    const expiresUnix = Math.floor(Date.parse(match.expiresAt) / 1000);
    const description =
      `⚔️ <@${match.challengerUserId}> (**${formatElement(match.challengerElement)}**) vs <@${match.defenderUserId}> (**${formatElement(match.defenderElement)}**)\n\n` +
      `⌛ This match expired <t:${expiresUnix}:F> with no result reported. No rank change — both players are free to challenge/be challenged again.\n\n` +
      `This channel is left in place for reference; a League Manager can delete it once it's no longer needed.`;
    const embed = new EmbedBuilder().setTitle("Match channel (expired)").setDescription(description).setColor(0x7f8c8d);

    if (original) {
      await original.edit({ embeds: [embed], components: [] });
    } else {
      // Original post couldn't be located (unpinned by hand, etc.) — post a fresh static notice
      // rather than leave the channel with no expiry record at all.
      await textChannel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error(`Failed to update expired match channel ${match.channelId} for match ${match.matchId}:`, err);
  }
}
