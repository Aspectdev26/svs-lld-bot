import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import * as ladderRepo from "../../sheets/ladderRepo.js";
import type { Command } from "../commandTypes.js";

const PAGE_SIZE = 20;

export const ladderCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ladder")
    .setDescription("View the current ladder rankings")
    .addIntegerOption((opt) => opt.setName("page").setDescription("Page number (1 = top of ladder)").setMinValue(1)),

  async execute(interaction) {
    const page = interaction.options.getInteger("page") ?? 1;
    const ladder = await ladderRepo.getLadder();

    if (ladder.length === 0) {
      await interaction.reply({ content: "The ladder is empty — be the first to sign up in #register!", ephemeral: true });
      return;
    }

    const start = (page - 1) * PAGE_SIZE;
    const slice = ladder.slice(start, start + PAGE_SIZE);
    if (slice.length === 0) {
      await interaction.reply({ content: `No entries on page ${page}.`, ephemeral: true });
      return;
    }

    const statusTag = { Available: "", Vacation: " 🌴", Challenge: " ⚔️" } as const;
    const lines = slice.map(
      (r) => `**${r.rank}.** ${r.characterName} — ${r.element} (${r.build})${statusTag[r.status]}`,
    );

    const totalPages = Math.ceil(ladder.length / PAGE_SIZE);
    const embed = new EmbedBuilder()
      .setTitle("League Ladder")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Page ${page} of ${totalPages}` })
      .setColor(0x3498db);

    await interaction.reply({ embeds: [embed] });
  },
};
