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
        `**Request Extension** — ask a League Manager for 2 extra days if you both need more time.\n` +
        `**Cancel Match** — voids the match with no rank change. Both players must click it to confirm.\n\n` +
        `This channel is deleted automatically once a result is reported, a dodge is approved, or the match is cancelled.`,
    )
    .setColor(0xe67e22);

  await channel.send({
    content: `<@${challenger.discordUserId}> <@${defender.discordUserId}>`,
    embeds: [embed],
    components: [matchActionRow(match.matchId)],
  });

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
