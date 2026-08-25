import { SlashCommandBuilder } from "discord.js";
import * as matchesRepo from "../../sheets/matchesRepo.js";
import { isDodgeEligible } from "../../domain/dodgeService.js";
import { buildMatchChoices } from "../matchChoices.js";
import { submitDodgeRequest } from "../dodgeFlow.js";
import type { Command } from "../commandTypes.js";

export const dodgeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("dodge-request")
    .setDescription("Request a dodge because your opponent hasn't responded in 24+ hours")
    .addStringOption((opt) =>
      opt.setName("match").setDescription("Which match are you requesting a dodge for?").setRequired(true).setAutocomplete(true),
    )
    .addAttachmentOption((opt) =>
      opt
        .setName("screenshot")
        .setDescription("Screenshot showing the lack of response that warrants the dodge")
        .setRequired(true),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const choices = await buildMatchChoices(interaction.user.id, focused, isDodgeEligible);
    await interaction.respond(choices.slice(0, 25));
  },

  async execute(interaction) {
    const matchId = interaction.options.getString("match", true);
    const screenshot = interaction.options.getAttachment("screenshot", true);

    const match = await matchesRepo.getMatchById(matchId);
    if (!match) {
      await interaction.reply({ content: "That match isn't currently active.", ephemeral: true });
      return;
    }

    await submitDodgeRequest(interaction, match, screenshot);
  },
};
