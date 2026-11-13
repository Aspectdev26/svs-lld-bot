import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction } from "discord.js";
import * as ladderRepo from "../../sheets/ladderRepo.js";
import * as matchesRepo from "../../sheets/matchesRepo.js";
import { leaveLadder } from "../../domain/leaveLadderService.js";
import { finalizeReportWin } from "../reportWinFlow.js";
import { notify } from "../notify.js";
import { refreshTop10Panel } from "../top10Panel.js";
import { refreshActiveChallengesPanel } from "../activeChallengesPanel.js";
import { scheduleReplyCleanup, scheduleMessageCleanup } from "../ephemeralCleanup.js";

export const LEAVE_CONFIRM_ID = "leave_confirm";
export const LEAVE_CANCEL_ID = "leave_cancel";

export async function handleLeaveLadderStartButton(interaction: ButtonInteraction): Promise<void> {
  const entry = await ladderRepo.findEntry(interaction.user.id);
  if (!entry) {
    await interaction.reply({ content: "You're not registered on the ladder.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const pendingMatch = await matchesRepo.getPendingMatchForPlayer(entry.discordUserId);
  const warning = pendingMatch
    ? " You have an active match right now — leaving will count as **a loss** for you and hand your opponent the win by forfeit."
    : "";
  const content =
    `Leave the ladder (you're rank ${entry.rank})?${warning}\n\n` +
    "This can't be undone — you'll need to sign up again (and be re-approved) to rejoin.";

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(LEAVE_CONFIRM_ID).setLabel("Leave Ladder").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(LEAVE_CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ content, components: [row], ephemeral: true });
}

export async function handleLeaveLadderResolve(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === LEAVE_CANCEL_ID) {
    await interaction.update({ content: "Cancelled — you're still on the ladder.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const entry = await ladderRepo.findEntry(interaction.user.id);
  if (!entry) {
    await interaction.update({ content: "You're not on the ladder anymore.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.update({ content: "Leaving the ladder…", components: [] });

  const pendingMatch = await matchesRepo.getPendingMatchForPlayer(entry.discordUserId);
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

  const result = await leaveLadder(entry.discordUserId);
  if (!result.ok) {
    const followUp = await interaction.followUp({ content: result.reason, ephemeral: true });
    scheduleReplyCleanup(interaction);
    scheduleMessageCleanup(followUp);
    return;
  }

  const followUp = await interaction.followUp({ content: "You've left the ladder.", ephemeral: true });
  scheduleReplyCleanup(interaction);
  scheduleMessageCleanup(followUp);

  const embed = new EmbedBuilder()
    .setDescription(
      `👋 <@${result.removedEntry.discordUserId}> has left the ladder.` + (pendingMatch ? " Their active match was forfeited." : ""),
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
