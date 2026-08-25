import type { StringSelectMenuInteraction } from "discord.js";
import { WINNER_SELECT_PREFIX, finalizeReportWin } from "../reportWinFlow.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";

/** Shared by both the /report-win slash command and the in-channel Report Win button flows. */
export async function handleWinnerSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const matchId = interaction.customId.slice(`${WINNER_SELECT_PREFIX}:`.length);
  const winnerUserId = interaction.values[0];

  // Ack by clearing the dropdown before the multi-write reportWin call, which (plus rank1
  // tracking) can take long enough under load to blow past Discord's 3s interaction deadline.
  await interaction.update({ content: "Reporting result…", components: [] });

  const result = await finalizeReportWin(interaction.client, interaction.user.id, matchId, winnerUserId);
  if (!result.ok) {
    await interaction.editReply({ content: `Couldn't report that win: ${result.reason}` });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.editReply({ content: `Win reported! <@${winnerUserId}> won the match.` });
  scheduleReplyCleanup(interaction);
}
