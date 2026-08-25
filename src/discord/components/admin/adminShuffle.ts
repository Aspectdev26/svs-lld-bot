import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
} from "discord.js";
import { isLeagueManager } from "../../permissions.js";
import { resetLadderEndSeason } from "../../../domain/adminService.js";
import { closeMatchChannel } from "../../matchChannels.js";
import { notify } from "../../notify.js";
import { refreshTop10Panel } from "../../top10Panel.js";
import { refreshActiveChallengesPanel } from "../../activeChallengesPanel.js";
import { scheduleReplyCleanup } from "../../ephemeralCleanup.js";

const CONFIRM_ID = "admin_shuffle_confirm";
const CANCEL_ID = "admin_shuffle_cancel";
export const SEASON_NAME_MODAL_ID = "admin_shuffle_name_modal";
const SEASON_NAME_INPUT_ID = "season_name";

async function requireLeagueManager(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<boolean> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return false;
  }
  return true;
}

export async function handleShuffleStart(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CONFIRM_ID).setLabel("Yes, end the season").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    content:
      "⚠️ This will **cancel every active match**, **randomize everyone's rank order**, and start a **new season** " +
      "under a name you choose — its defends/wins/losses will track live in its own tab from here on. The season " +
      "that just ended keeps whatever tab it's already been using, untouched. All-time stats are unaffected. " +
      "This can't be undone. Are you sure?",
    components: [row],
    ephemeral: true,
  });
}

/** Confirm/cancel on the warning prompt. Confirming opens a modal to name the new season (that name becomes its live stats tab title). */
export async function handleShuffleResolve(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  if (interaction.customId === CANCEL_ID) {
    await interaction.update({ content: "Season end cancelled — no changes made.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(SEASON_NAME_MODAL_ID)
    .setTitle("Start New Season")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(SEASON_NAME_INPUT_ID)
          .setLabel('New season name (e.g. "Season 2")')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleShuffleNameModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  // Ack before the (potentially many sequential) Sheets writes — easily slow enough under load to
  // blow past Discord's 3s interaction deadline.
  await interaction.deferReply({ ephemeral: true });

  const seasonNameInput = interaction.fields.getTextInputValue(SEASON_NAME_INPUT_ID);
  const result = await resetLadderEndSeason(seasonNameInput);

  if (!result.ok) {
    await interaction.editReply({ content: result.reason });
    scheduleReplyCleanup(interaction);
    return;
  }

  const { changedCount, cancelledMatches, newSeasonName } = result;
  for (const match of cancelledMatches) {
    await closeMatchChannel(interaction.client, match, "Ladder reset by admin");
  }

  await interaction.editReply({
    content: `Done. **${newSeasonName}** has started and its stats will track live in the "${newSeasonName}" tab. ${changedCount} entries moved, ${cancelledMatches.length} active match(es) cancelled.`,
  });
  scheduleReplyCleanup(interaction);

  const embed = new EmbedBuilder()
    .setTitle("🏆 New Season Started")
    .setDescription(
      `<@${interaction.user.id}> started **${newSeasonName}** — every rank has been randomized` +
        (cancelledMatches.length > 0 ? `, and ${cancelledMatches.length} active match(es) were cancelled.` : ".") +
        ` Season stats now track live in the **${newSeasonName}** tab.`,
    )
    .setColor(0x992d22);
  await notify.challenges(interaction.client, { embeds: [embed] });
  await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  await refreshActiveChallengesPanel(interaction.client).catch((err) =>
    console.error("Failed to refresh active challenges panel:", err),
  );
}
