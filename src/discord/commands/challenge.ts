import { SlashCommandBuilder } from "discord.js";
import { config } from "../../config.js";
import * as ladderRepo from "../../sheets/ladderRepo.js";
import { getEligibleTargets } from "../../domain/challengeRules.js";
import { attemptChallenge } from "../challengeFlow.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";
import type { Command } from "../commandTypes.js";

export const challengeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("challenge")
    .setDescription("Challenge a player above you on the ladder")
    .addStringOption((opt) =>
      opt
        .setName("target")
        .setDescription("Who do you want to challenge?")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const challengerEntry = await ladderRepo.findEntry(interaction.user.id);
    if (!challengerEntry) {
      await interaction.respond([]);
      return;
    }
    const ladder = await ladderRepo.getLadder();
    const eligible = getEligibleTargets(ladder, challengerEntry, config.rules);
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = eligible
      .filter((e) => e.row.discordName.toLowerCase().includes(typed))
      .map((e) => ({
        name: `Rank ${e.row.rank} — ${e.row.discordName}`.slice(0, 100),
        value: String(e.row.sheetRow),
      }));
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const targetSheetRow = Number.parseInt(interaction.options.getString("target", true), 10);

    // Ack immediately — everything below is Sheets reads/writes and (for a valid challenge)
    // Discord channel creation, easily slow enough under load to exceed the 3s interaction deadline.
    await interaction.deferReply({ ephemeral: true });

    const ladder = await ladderRepo.getLadder();
    const challengerEntry = ladder.find((r) => r.discordUserId === interaction.user.id);
    if (!challengerEntry) {
      await interaction.editReply({ content: "You're not on the ladder — sign up in #register first." });
      scheduleReplyCleanup(interaction);
      return;
    }

    const defenderEntry = ladder.find((r) => r.sheetRow === targetSheetRow);
    if (!defenderEntry) {
      await interaction.editReply({ content: "That target isn't valid anymore — please pick again from the list." });
      scheduleReplyCleanup(interaction);
      return;
    }

    await attemptChallenge(interaction, ladder, challengerEntry, defenderEntry);
  },
};
