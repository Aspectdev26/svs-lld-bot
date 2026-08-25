import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, type RepliableInteraction } from "discord.js";
import { config } from "../config.js";
import * as matchService from "../domain/matchService.js";
import { checkChallenge, getEligibleTargets } from "../domain/challengeRules.js";
import { isLadderPaused } from "../domain/ladderPauseService.js";
import { createMatchChannel } from "./matchChannels.js";
import { notify } from "./notify.js";
import { refreshActiveChallengesPanel } from "./activeChallengesPanel.js";
import { scheduleReplyCleanup, scheduleMessageCleanup } from "./ephemeralCleanup.js";
import { formatElement } from "../util/formatElement.js";
import type { LadderRow } from "../types.js";

export const TARGET_SELECT_PREFIX = "chal_target_select";

export type TargetSelectResult =
  | { ok: true; row: ActionRowBuilder<StringSelectMenuBuilder> }
  | { ok: false; reason: string };

/** Builds the "who do you want to challenge" select menu for one of the player's elements. */
export function buildTargetSelectRow(ladder: LadderRow[], challengerEntry: LadderRow): TargetSelectResult {
  const eligible = getEligibleTargets(ladder, challengerEntry, config.rules);
  if (eligible.length === 0) {
    return {
      ok: false,
      reason: `There's no one you can currently challenge with your **${formatElement(challengerEntry.element)}** entry (rank ${challengerEntry.rank}).`,
    };
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${TARGET_SELECT_PREFIX}:${challengerEntry.element}`)
    .setPlaceholder("Choose your target")
    .addOptions(
      eligible.map((e) => ({
        label: `Rank ${e.row.rank} — ${e.row.characterName} (${formatElement(e.row.element)})`,
        value: String(e.row.sheetRow),
      })),
    );

  return { ok: true, row: new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select) };
}

/**
 * Shared by the /challenge slash command and the #challenges button flow. Validates the
 * challenge, creates the match + its private channel, and responds to `interaction` with the
 * outcome — via `.editReply()` after deferring if it hasn't been responded to yet, or
 * `.followUp()` if the call site already used `.update()`/`.reply()` (e.g. to clear a select menu
 * first). Deferring up front matters here: `createMatchChannel` creates a whole Discord channel
 * with bespoke permission overwrites, easily slow enough on its own to blow past Discord's 3s
 * interaction deadline once you add the Sheets calls before it.
 */
export async function attemptChallenge(
  interaction: RepliableInteraction,
  ladder: LadderRow[],
  challengerEntry: LadderRow,
  defenderEntry: LadderRow,
): Promise<void> {
  const alreadyAcked = interaction.replied || interaction.deferred;
  if (!alreadyAcked) {
    await interaction.deferReply({ ephemeral: true });
  }
  const respond = (alreadyAcked ? interaction.followUp : interaction.editReply).bind(interaction);

  if (await isLadderPaused()) {
    const sent = await respond({
      content: "The ladder is currently paused by League Managers — new challenges can't be issued right now.",
      ephemeral: true,
    });
    scheduleReplyCleanup(interaction);
    if (alreadyAcked) scheduleMessageCleanup(sent);
    return;
  }

  const [challengerPending, defenderPending] = await Promise.all([
    matchService.entryHasPendingMatch(challengerEntry.discordUserId, challengerEntry.element),
    matchService.entryHasPendingMatch(defenderEntry.discordUserId, defenderEntry.element),
  ]);

  const rejection = checkChallenge({
    ladder,
    challenger: challengerEntry,
    defender: defenderEntry,
    challengerEntryHasPendingMatch: challengerPending,
    defenderEntryHasPendingMatch: defenderPending,
    rules: config.rules,
  });

  if (rejection) {
    const sent = await respond({ content: `You can't challenge that player because ${rejection}`, ephemeral: true });
    scheduleReplyCleanup(interaction);
    if (alreadyAcked) scheduleMessageCleanup(sent);
    return;
  }

  const match = await matchService.createMatch(challengerEntry, defenderEntry);
  const expiresUnix = Math.floor(Date.parse(match.expiresAt) / 1000);

  let channelMention = "";
  if (interaction.guild) {
    try {
      const channel = await createMatchChannel(interaction.client, interaction.guild, match, challengerEntry, defenderEntry);
      channelMention = ` Head to ${channel} to play it out.`;
    } catch (err) {
      console.error(`Failed to create match channel for ${match.matchId}:`, err);
    }
  }

  const sent = await respond({
    content: `Challenge issued against **${defenderEntry.characterName}** (${formatElement(defenderEntry.element)})! Match ID \`${match.matchId}\`.${channelMention}`,
    ephemeral: true,
  });
  scheduleReplyCleanup(interaction);
  if (alreadyAcked) scheduleMessageCleanup(sent);

  const embed = new EmbedBuilder()
    .setTitle("New challenge")
    .setDescription(
      `⚔️ <@${challengerEntry.discordUserId}> (**${formatElement(challengerEntry.element)}**, rank ${challengerEntry.rank}) has challenged <@${defenderEntry.discordUserId}> (**${formatElement(defenderEntry.element)}**, rank ${defenderEntry.rank})!\n\n` +
        `Match ID: \`${match.matchId}\`\nExpires: <t:${expiresUnix}:F> (<t:${expiresUnix}:R>)${channelMention}`,
    )
    .setColor(0xe67e22);
  await notify.challenges(interaction.client, {
    content: `<@${challengerEntry.discordUserId}> <@${defenderEntry.discordUserId}>`,
    embeds: [embed],
  });
  await refreshActiveChallengesPanel(interaction.client).catch((err) =>
    console.error("Failed to refresh active challenges panel:", err),
  );
}
