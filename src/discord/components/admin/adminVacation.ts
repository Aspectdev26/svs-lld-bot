import { EmbedBuilder, type ButtonInteraction, type GuildMember, type StringSelectMenuInteraction } from "discord.js";
import * as ladderRepo from "../../../sheets/ladderRepo.js";
import * as matchService from "../../../domain/matchService.js";
import { isLeagueManager } from "../../permissions.js";
import { notify } from "../../notify.js";
import { buildLadderCharacterSelectRow } from "./characterSelect.js";

export const VACATION_SELECT_ID = "admin_vacation_select";

async function requireLeagueManager(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<boolean> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    return false;
  }
  return true;
}

export async function handleVacationStart(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const ladder = await ladderRepo.getLadder();
  if (ladder.length === 0) {
    await interaction.reply({ content: "The ladder is empty.", ephemeral: true });
    return;
  }

  const row = buildLadderCharacterSelectRow(ladder, VACATION_SELECT_ID, "Choose a character");
  await interaction.reply({
    content: "**Toggle Vacation for which character?** (selecting toggles their current status)",
    components: [row],
    ephemeral: true,
  });
}

export async function handleVacationSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const sheetRow = Number.parseInt(interaction.values[0], 10);
  const ladder = await ladderRepo.getLadder();
  const entry = ladder.find((r) => r.sheetRow === sheetRow);
  if (!entry) {
    await interaction.update({ content: "That entry isn't on the ladder anymore.", components: [] });
    return;
  }

  const goingOnVacation = entry.status !== "Vacation";

  if (goingOnVacation) {
    const hasPending = await matchService.entryHasPendingMatch(entry.discordUserId, entry.element);
    if (hasPending) {
      await interaction.update({
        content: `**${entry.characterName}** (${entry.element}) has an active match — resolve or cancel it before setting Vacation.`,
        components: [],
      });
      return;
    }
  }

  await interaction.update({ content: "Updating…", components: [] });

  await ladderRepo.setStatusForEntry(entry.sheetRow, goingOnVacation ? "Vacation" : "Available");

  await interaction.followUp({
    content: `**${entry.characterName}** (${entry.element}) is now ${goingOnVacation ? "on **Vacation**" : "**Available**"}.`,
    ephemeral: true,
  });

  const embed = new EmbedBuilder()
    .setDescription(
      goingOnVacation
        ? `🌴 **${entry.characterName}** (${entry.element}) — <@${entry.discordUserId}> — was set to **Vacation** by <@${interaction.user.id}> and can't be challenged until they're back.`
        : `✅ **${entry.characterName}** (${entry.element}) — <@${entry.discordUserId}> — was marked **Available** again by <@${interaction.user.id}>.`,
    )
    .setColor(goingOnVacation ? 0x95a5a6 : 0x2ecc71);
  await notify.rankings(interaction.client, { embeds: [embed] });
}
