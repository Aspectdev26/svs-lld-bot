import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction, type GuildMember } from "discord.js";
import { isLeagueManager } from "../../permissions.js";
import { shuffleLadder } from "../../../domain/adminService.js";
import { closeMatchChannel } from "../../matchChannels.js";
import { notify } from "../../notify.js";
import { refreshTop10Panel } from "../../top10Panel.js";
import { refreshActiveChallengesPanel } from "../../activeChallengesPanel.js";

const CONFIRM_ID = "admin_shuffle_confirm";
const CANCEL_ID = "admin_shuffle_cancel";

export async function handleShuffleStart(interaction: ButtonInteraction): Promise<void> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel("Yes, shuffle the ladder").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    content:
      "⚠️ This will **cancel every active match** and **randomize everyone's rank order**. This can't be undone. Are you sure?",
    components: [row],
    ephemeral: true,
  });
}

export async function handleShuffleResolve(interaction: ButtonInteraction): Promise<void> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    return;
  }

  if (interaction.customId === CANCEL_ID) {
    await interaction.update({ content: "Shuffle cancelled — no changes made.", components: [] });
    return;
  }

  await interaction.update({ content: "Shuffling the ladder…", components: [] });

  const { changedCount, cancelledMatches } = await shuffleLadder();
  for (const match of cancelledMatches) {
    await closeMatchChannel(interaction.client, match, "Ladder reset by admin");
  }

  await interaction.followUp({
    content: `Done. ${changedCount} entries moved, ${cancelledMatches.length} active match(es) cancelled.`,
    ephemeral: true,
  });

  const embed = new EmbedBuilder()
    .setTitle("🎲 Ladder Reset")
    .setDescription(
      `<@${interaction.user.id}> shuffled the ladder — every rank has been randomized` +
        (cancelledMatches.length > 0 ? ` and ${cancelledMatches.length} active match(es) were cancelled.` : "."),
    )
    .setColor(0x992d22);
  await notify.rankings(interaction.client, { embeds: [embed] });
  if (cancelledMatches.length > 0) {
    await notify.challenges(interaction.client, {
      content: "Several active matches were cancelled due to a ladder reset.",
    });
  }
  await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  await refreshActiveChallengesPanel(interaction.client).catch((err) =>
    console.error("Failed to refresh active challenges panel:", err),
  );
}
