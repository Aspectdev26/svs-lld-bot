import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import * as ladderRepo from "../../sheets/ladderRepo.js";
import * as matchesRepo from "../../sheets/matchesRepo.js";
import { leaveLadderEntry } from "../../domain/leaveLadderService.js";
import { finalizeReportWin } from "../reportWinFlow.js";
import { notify } from "../notify.js";
import { refreshTop10Panel } from "../top10Panel.js";
import { refreshActiveChallengesPanel } from "../activeChallengesPanel.js";
import { scheduleReplyCleanup, scheduleMessageCleanup } from "../ephemeralCleanup.js";
import { formatElement } from "../../util/formatElement.js";
import type { Element, LadderRow, MatchRow } from "../../types.js";

export const LEAVE_ELEMENT_SELECT_ID = "leave_element_select";
export const LEAVE_CONFIRM_PREFIX = "leave_confirm";
export const LEAVE_CANCEL_ID = "leave_cancel";

function buildLeaveConfirmMessage(entry: LadderRow, pendingMatch: MatchRow | undefined): { content: string; row: ActionRowBuilder<ButtonBuilder> } {
  const warning = pendingMatch
    ? " You have an active match right now — leaving will count as **a loss** for you and hand your opponent the win by forfeit."
    : "";
  const content =
    `Leave the ladder with **${entry.characterName}** (${formatElement(entry.element)}, rank ${entry.rank})?${warning}\n\n` +
    "This can't be undone — you'll need to sign up again (and be re-approved) to rejoin.";

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${LEAVE_CONFIRM_PREFIX}:${entry.element}`).setLabel("Leave Ladder").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(LEAVE_CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  return { content, row };
}

export async function handleLeaveLadderStartButton(interaction: ButtonInteraction): Promise<void> {
  const rows = await ladderRepo.getPlayerRows(interaction.user.id);
  if (rows.length === 0) {
    await interaction.reply({ content: "You're not registered on the ladder.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  if (rows.length === 1) {
    const pendingMatch = await matchesRepo.getPendingMatchForEntry(rows[0].discordUserId, rows[0].element);
    const { content, row } = buildLeaveConfirmMessage(rows[0], pendingMatch);
    await interaction.reply({ content, components: [row], ephemeral: true });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(LEAVE_ELEMENT_SELECT_ID)
    .setPlaceholder("Choose which entry to leave the ladder with")
    .addOptions(rows.map((r) => ({ label: `${r.characterName} — ${formatElement(r.element)} (rank ${r.rank})`, value: r.element })));

  await interaction.reply({
    content: "**Which of your entries do you want to leave the ladder with?**",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleLeaveLadderElementSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const element = interaction.values[0] as Element;
  const entry = await ladderRepo.findEntry(interaction.user.id, element);
  if (!entry) {
    await interaction.update({ content: "That entry isn't on the ladder anymore.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const pendingMatch = await matchesRepo.getPendingMatchForEntry(entry.discordUserId, entry.element);
  const { content, row } = buildLeaveConfirmMessage(entry, pendingMatch);
  await interaction.update({ content, components: [row] });
}

export async function handleLeaveLadderResolve(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === LEAVE_CANCEL_ID) {
    await interaction.update({ content: "Cancelled — you're still on the ladder.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const element = interaction.customId.slice(`${LEAVE_CONFIRM_PREFIX}:`.length) as Element;
  const entry = await ladderRepo.findEntry(interaction.user.id, element);
  if (!entry) {
    await interaction.update({ content: "That entry isn't on the ladder anymore.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.update({ content: "Leaving the ladder…", components: [] });

  const pendingMatch = await matchesRepo.getPendingMatchForEntry(entry.discordUserId, entry.element);
  if (pendingMatch) {
    const opponentUserId =
      pendingMatch.challengerUserId === entry.discordUserId ? pendingMatch.defenderUserId : pendingMatch.challengerUserId;
    const forfeitResult = await finalizeReportWin(interaction.client, entry.discordUserId, pendingMatch.matchId, opponentUserId);
    if (!forfeitResult.ok) {
      const followUp = await interaction.followUp({
        content: `Couldn't process your active match (${forfeitResult.reason}) — please try again.`,
        ephemeral: true,
      });
      scheduleReplyCleanup(interaction);
      scheduleMessageCleanup(followUp);
      return;
    }
  }

  const result = await leaveLadderEntry(entry.discordUserId, entry.element);
  if (!result.ok) {
    const followUp = await interaction.followUp({ content: result.reason, ephemeral: true });
    scheduleReplyCleanup(interaction);
    scheduleMessageCleanup(followUp);
    return;
  }

  const followUp = await interaction.followUp({
    content: `You've left the ladder with **${result.removedEntry.characterName}** (${formatElement(result.removedEntry.element)}).`,
    ephemeral: true,
  });
  scheduleReplyCleanup(interaction);
  scheduleMessageCleanup(followUp);

  const embed = new EmbedBuilder()
    .setDescription(
      `👋 <@${result.removedEntry.discordUserId}>'s **${result.removedEntry.characterName}** (${formatElement(result.removedEntry.element)}) has left the ladder.` +
        (pendingMatch ? " Their active match was forfeited." : ""),
    )
    .setColor(0x95a5a6);
  await notify.announcements(interaction.client, { embeds: [embed] });

  await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  if (pendingMatch) {
    await refreshActiveChallengesPanel(interaction.client).catch((err) =>
      console.error("Failed to refresh active challenges panel:", err),
    );
  }
}
