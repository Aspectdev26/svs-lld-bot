import { SlashCommandBuilder } from "discord.js";
import { buildMatchChoices } from "../matchChoices.js";
import { buildWinnerPrompt } from "../reportWinFlow.js";
import type { Command } from "../commandTypes.js";

export const reportWinCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("report-win")
    .setDescription("Report the result of one of your active matches")
    .addStringOption((opt) =>
      opt.setName("match").setDescription("Which match do you want to report?").setRequired(true).setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const choices = await buildMatchChoices(interaction.user.id, focused);
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const matchId = interaction.options.getString("match", true);

    await interaction.deferReply({ ephemeral: true });

    const prompt = await buildWinnerPrompt(matchId, interaction.user.id);
    if (!prompt.ok) {
      await interaction.editReply({ content: prompt.reason });
      return;
    }

    await interaction.editReply({ content: "**Who won this match?**", components: [prompt.row] });
  },
};
