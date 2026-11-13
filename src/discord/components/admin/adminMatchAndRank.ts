import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import * as ladderRepo from "../../../sheets/ladderRepo.js";
import * as matchesRepo from "../../../sheets/matchesRepo.js";
import { forceCancelMatch, setManualRank } from "../../../domain/adminService.js";
import { isLeagueManager } from "../../permissions.js";
import { closeMatchChannel } from "../../matchChannels.js";
import { notify } from "../../notify.js";
import { refreshTop10Panel } from "../../top10Panel.js";
import { refreshActiveChallengesPanel } from "../../activeChallengesPanel.js";
import { scheduleReplyCleanup, scheduleMessageCleanup } from "../../ephemeralCleanup.js";

const CANCEL_SELECT_ID = "admin_cancel_select";
const CANCEL_CONFIRM_PREFIX = "admin_cancel_confirm";
const CANCEL_CANCEL_ID = "admin_cancel_cancel";

const SETRANK_USER_SELECT_ID = "admin_setrank_user";
const SETRANK_MODAL_PREFIX = "admin_setrank_modal";
const SETRANK_INPUT_ID = "new_rank";

async function requireLeagueManager(
  interaction: ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return false;
  }
  return true;
}

// ---------- Force-cancel match ----------

export async function handleCancelMatchStart(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const [pending, ladder] = await Promise.all([matchesRepo.getPendingMatches(), ladderRepo.getLadder()]);
  if (pending.length === 0) {
    await interaction.reply({ content: "There are no active matches to cancel.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const nameFor = (userId: string) => ladder.find((r) => r.discordUserId === userId)?.discordName ?? "Unknown";

  const select = new StringSelectMenuBuilder()
    .setCustomId(CANCEL_SELECT_ID)
    .setPlaceholder("Choose a match to cancel")
    .addOptions(
      pending.slice(0, 25).map((m) => ({
        label: `${nameFor(m.challengerUserId)} vs ${nameFor(m.defenderUserId)}`.slice(0, 100),
        value: m.matchId,
      })),
    );
  await interaction.reply({
    content: "**Select a match to force-cancel:**",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleCancelMatchSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const matchId = interaction.values[0];
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${CANCEL_CONFIRM_PREFIX}:${matchId}`).setLabel("Confirm cancel").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CANCEL_CANCEL_ID).setLabel("Never mind").setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({
    content: `Cancel match \`${matchId}\`? No rank change will be applied. This can't be undone.`,
    components: [row],
  });
}

export async function handleCancelMatchResolve(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  if (interaction.customId === CANCEL_CANCEL_ID) {
    await interaction.update({ content: "Never mind — no changes made.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const matchId = interaction.customId.slice(`${CANCEL_CONFIRM_PREFIX}:`.length);
  await interaction.update({ content: "Cancelling…", components: [] });

  const match = await forceCancelMatch(matchId);
  if (!match) {
    const followUp = await interaction.followUp({ content: "That match is no longer active.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    scheduleMessageCleanup(followUp);
    return;
  }
  await closeMatchChannel(interaction.client, match, "Force-cancelled by admin");

  const followUp = await interaction.followUp({ content: "Match cancelled.", ephemeral: true });
  scheduleReplyCleanup(interaction);
  scheduleMessageCleanup(followUp);

  const embed = new EmbedBuilder()
    .setDescription(
      `🛑 <@${interaction.user.id}> force-cancelled the match between <@${match.challengerUserId}> and <@${match.defenderUserId}> (\`${match.matchId}\`). No rank change.`,
    )
    .setColor(0x992d22);
  await notify.challenges(interaction.client, { embeds: [embed] });
  await refreshActiveChallengesPanel(interaction.client).catch((err) =>
    console.error("Failed to refresh active challenges panel:", err),
  );
}

// ---------- Set rank ----------

function setRankModal(userId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${SETRANK_MODAL_PREFIX}:${userId}`)
    .setTitle("Set rank")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(SETRANK_INPUT_ID)
          .setLabel("New rank (number)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(6),
      ),
    );
}

export async function handleSetRankStart(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const select = new UserSelectMenuBuilder().setCustomId(SETRANK_USER_SELECT_ID).setPlaceholder("Choose a player");
  await interaction.reply({
    content: "**Which player's rank do you want to set?**",
    components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleSetRankUserSelect(interaction: UserSelectMenuInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const userId = interaction.values[0];
  const entry = await ladderRepo.findEntry(userId);
  if (!entry) {
    await interaction.update({ content: "That player isn't on the ladder.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.showModal(setRankModal(userId));
}

export async function handleSetRankModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const userId = interaction.customId.slice(`${SETRANK_MODAL_PREFIX}:`.length);
  const raw = interaction.fields.getTextInputValue(SETRANK_INPUT_ID);
  const desiredRank = Number.parseInt(raw, 10);
  if (Number.isNaN(desiredRank) || desiredRank < 1) {
    await interaction.reply({ content: "That's not a valid rank number.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  // Ack before the lookup + setManualRank's (potentially many sequential) Sheets writes — easily
  // slow enough under load to blow past Discord's 3s interaction deadline.
  await interaction.deferReply({ ephemeral: true });

  const entry = await ladderRepo.findEntry(userId);
  if (!entry) {
    await interaction.editReply({ content: "That entry isn't on the ladder anymore." });
    scheduleReplyCleanup(interaction);
    return;
  }

  const result = await setManualRank(entry.sheetRow, desiredRank);
  if (!result) {
    await interaction.editReply({ content: "Something went wrong applying that rank." });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.editReply({
    content: `Set <@${userId}> to rank ${result.entry.rank}. ${result.changedCount} entries shifted.`,
  });
  scheduleReplyCleanup(interaction);

  const embed = new EmbedBuilder()
    .setDescription(`🛠️ <@${interaction.user.id}> manually set <@${userId}> to rank **${result.entry.rank}**.`)
    .setColor(0x992d22);
  await notify.challenges(interaction.client, { embeds: [embed] });
  await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
}
