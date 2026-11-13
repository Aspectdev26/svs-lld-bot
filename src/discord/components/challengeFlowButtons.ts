import type { ButtonInteraction, StringSelectMenuInteraction } from "discord.js";
import * as ladderRepo from "../../sheets/ladderRepo.js";
import { attemptChallenge, buildTargetSelectRow } from "../challengeFlow.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";

export async function handleChallengeStartButton(interaction: ButtonInteraction): Promise<void> {
  const ladder = await ladderRepo.getLadder();
  const challengerEntry = ladder.find((r) => r.discordUserId === interaction.user.id);
  if (!challengerEntry) {
    await interaction.reply({
      content: "You're not registered on the ladder yet — sign up in #register first, then come back and challenge someone.",
      ephemeral: true,
    });
    scheduleReplyCleanup(interaction);
    return;
  }

  const result = buildTargetSelectRow(ladder, challengerEntry);
  if (!result.ok) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }
  await interaction.reply({
    content: `**Choose your target** (you're rank ${challengerEntry.rank}):`,
    components: [result.row],
    ephemeral: true,
  });
}

export async function handleChallengeTargetSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const targetSheetRow = Number.parseInt(interaction.values[0], 10);

  const ladder = await ladderRepo.getLadder();
  const challengerEntry = ladder.find((r) => r.discordUserId === interaction.user.id);
  if (!challengerEntry) {
    await interaction.update({ content: "You're not on the ladder anymore.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const defenderEntry = ladder.find((r) => r.sheetRow === targetSheetRow);
  if (!defenderEntry) {
    await interaction.update({ content: "That target isn't valid anymore — click Challenge again to retry.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.update({ content: "Issuing your challenge…", components: [] });
  await attemptChallenge(interaction, ladder, challengerEntry, defenderEntry);
}
