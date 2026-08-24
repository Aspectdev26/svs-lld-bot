import { SlashCommandBuilder } from "discord.js";
import { config } from "../../config.js";
import * as ladderRepo from "../../sheets/ladderRepo.js";
import { getEligibleTargets } from "../../domain/challengeRules.js";
import { attemptChallenge } from "../challengeFlow.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";
import { formatElement } from "../../util/formatElement.js";
import type { Command } from "../commandTypes.js";
import type { Element } from "../../types.js";

export const challengeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("challenge")
    .setDescription("Challenge a player above you on the ladder")
    .addStringOption((opt) =>
      opt
        .setName("my-element")
        .setDescription("Which of your elements is issuing the challenge?")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("target")
        .setDescription("Who do you want to challenge?")
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === "my-element") {
      const rows = await ladderRepo.getPlayerRows(interaction.user.id);
      const choices = rows.map((r) => ({ name: `${formatElement(r.element)} (rank ${r.rank})`, value: r.element }));
      await interaction.respond(choices.slice(0, 25));
      return;
    }

    if (focused.name === "target") {
      const myElement = interaction.options.getString("my-element") as Element | null;
      if (!myElement) {
        await interaction.respond([]);
        return;
      }
      const challengerEntry = await ladderRepo.findEntry(interaction.user.id, myElement);
      if (!challengerEntry) {
        await interaction.respond([]);
        return;
      }
      const ladder = await ladderRepo.getLadder();
      const eligible = getEligibleTargets(ladder, challengerEntry, config.rules);
      const typed = focused.value.toLowerCase();
      const choices = eligible
        .filter((e) => e.row.characterName.toLowerCase().includes(typed))
        .map((e) => ({
          name: `Rank ${e.row.rank} — ${e.row.characterName} (${formatElement(e.row.element)})`,
          value: String(e.row.sheetRow),
        }));
      await interaction.respond(choices.slice(0, 25));
    }
  },

  async execute(interaction) {
    const myElement = interaction.options.getString("my-element", true) as Element;
    const targetSheetRow = Number.parseInt(interaction.options.getString("target", true), 10);

    // Ack immediately — everything below is Sheets reads/writes and (for a valid challenge)
    // Discord channel creation, easily slow enough under load to exceed the 3s interaction deadline.
    await interaction.deferReply({ ephemeral: true });

    const challengerEntry = await ladderRepo.findEntry(interaction.user.id, myElement);
    if (!challengerEntry) {
      await interaction.editReply({
        content: `You don't have a **${formatElement(myElement)}** entry on the ladder — sign up in #register first.`,
      });
      scheduleReplyCleanup(interaction);
      return;
    }

    const ladder = await ladderRepo.getLadder();
    const defenderEntry = ladder.find((r) => r.sheetRow === targetSheetRow);
    if (!defenderEntry) {
      await interaction.editReply({ content: "That target isn't valid anymore — please pick again from the list." });
      scheduleReplyCleanup(interaction);
      return;
    }

    await attemptChallenge(interaction, ladder, challengerEntry, defenderEntry);
  },
};
