import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { setTrollEnabled } from "../../domain/trollService.js";
import { TROLL_TARGET_USER_ID } from "../troll.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";
import type { Command } from "../commandTypes.js";

export const trollToggleCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("troll-toggle")
    .setDescription("Turn the admin panel troll feature on or off")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((opt) => opt.setName("enabled").setDescription("On or off").setRequired(true)),

  async execute(interaction) {
    if (interaction.user.id === TROLL_TARGET_USER_ID) {
      await interaction.reply({ content: "Nice try.", ephemeral: true });
      scheduleReplyCleanup(interaction);
      return;
    }

    const enabled = interaction.options.getBoolean("enabled", true);
    await setTrollEnabled(enabled);
    await interaction.reply({ content: `Troll feature is now **${enabled ? "ON" : "OFF"}**.`, ephemeral: true });
    scheduleReplyCleanup(interaction);
  },
};
