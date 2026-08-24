import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import * as ladderRepo from "../../sheets/ladderRepo.js";
import { attemptChallenge, buildTargetSelectRow, TARGET_SELECT_PREFIX } from "../challengeFlow.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";
import { formatElement } from "../../util/formatElement.js";
import type { Element } from "../../types.js";

const ELEMENT_SELECT_ID = "chal_element_select";

export async function handleChallengeStartButton(interaction: ButtonInteraction): Promise<void> {
  const rows = await ladderRepo.getPlayerRows(interaction.user.id);
  if (rows.length === 0) {
    await interaction.reply({
      content: "You're not registered on the ladder yet — sign up in #register first, then come back and challenge someone.",
      ephemeral: true,
    });
    scheduleReplyCleanup(interaction);
    return;
  }

  if (rows.length === 1) {
    const ladder = await ladderRepo.getLadder();
    const result = buildTargetSelectRow(ladder, rows[0]);
    if (!result.ok) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      scheduleReplyCleanup(interaction);
      return;
    }
    await interaction.reply({
      content: `**Choose your target** (challenging with your **${formatElement(rows[0].element)}** entry, rank ${rows[0].rank}):`,
      components: [result.row],
      ephemeral: true,
    });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(ELEMENT_SELECT_ID)
    .setPlaceholder("Choose which element is challenging")
    .addOptions(rows.map((r) => ({ label: `${formatElement(r.element)} (rank ${r.rank})`, value: r.element })));

  await interaction.reply({
    content: "**Which of your elements is issuing the challenge?**",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleChallengeElementSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const element = interaction.values[0] as Element;
  const challengerEntry = await ladderRepo.findEntry(interaction.user.id, element);
  if (!challengerEntry) {
    await interaction.update({ content: "That entry isn't on the ladder anymore.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const ladder = await ladderRepo.getLadder();
  const result = buildTargetSelectRow(ladder, challengerEntry);
  if (!result.ok) {
    await interaction.update({ content: result.reason, components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.update({
    content: `**Choose your target** (challenging with your **${formatElement(challengerEntry.element)}** entry, rank ${challengerEntry.rank}):`,
    components: [result.row],
  });
}

export async function handleChallengeTargetSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const element = interaction.customId.slice(`${TARGET_SELECT_PREFIX}:`.length) as Element;
  const targetSheetRow = Number.parseInt(interaction.values[0], 10);

  const challengerEntry = await ladderRepo.findEntry(interaction.user.id, element);
  if (!challengerEntry) {
    await interaction.update({ content: "That entry isn't on the ladder anymore.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const ladder = await ladderRepo.getLadder();
  const defenderEntry = ladder.find((r) => r.sheetRow === targetSheetRow);
  if (!defenderEntry) {
    await interaction.update({ content: "That target isn't valid anymore — click Challenge again to retry.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.update({ content: "Issuing your challenge…", components: [] });
  await attemptChallenge(interaction, ladder, challengerEntry, defenderEntry);
}
