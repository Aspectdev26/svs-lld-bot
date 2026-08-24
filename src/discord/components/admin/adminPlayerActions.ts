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
  type Client,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import { ELEMENTS, type Element } from "../../../types.js";
import * as ladderRepo from "../../../sheets/ladderRepo.js";
import * as bannedRepo from "../../../sheets/bannedRepo.js";
import { ALL_ELEMENTS, type BanScope } from "../../../sheets/bannedRepo.js";
import { removePlayer, banPlayer, unban } from "../../../domain/adminService.js";
import { isLeagueManager } from "../../permissions.js";
import { closeMatchChannel } from "../../matchChannels.js";
import { notify } from "../../notify.js";
import { refreshTop10Panel } from "../../top10Panel.js";
import { refreshActiveChallengesPanel } from "../../activeChallengesPanel.js";
import { scheduleReplyCleanup, scheduleMessageCleanup } from "../../ephemeralCleanup.js";
import { buildLadderCharacterSelectRow } from "./characterSelect.js";
import { formatElement } from "../../../util/formatElement.js";

const REMOVE_CHARACTER_SELECT_ID = "admin_remove_character";
const REMOVE_CONFIRM_PREFIX = "admin_remove_confirm";
const REMOVE_CANCEL_ID = "admin_remove_cancel";

const BAN_USER_SELECT_ID = "admin_ban_user";
const BAN_ELEMENT_SELECT_PREFIX = "admin_ban_element";
export const BAN_REASON_MODAL_PREFIX = "admin_ban_reason";
const BAN_REASON_INPUT_ID = "ban_reason";

const UNBAN_SELECT_ID = "admin_unban_select";

async function requireLeagueManager(interaction: ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction | ModalSubmitInteraction): Promise<boolean> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return false;
  }
  return true;
}

async function getDisplayName(client: Client, guildId: string | null, userId: string): Promise<string> {
  try {
    const guild = guildId ? await client.guilds.fetch(guildId) : null;
    const member = await guild?.members.fetch(userId);
    if (member) return member.displayName;
  } catch {
    // fall through to username
  }
  const user = await client.users.fetch(userId).catch(() => null);
  return user?.username ?? userId;
}

function elementScopeOptions() {
  return [...ELEMENTS.map((e) => ({ label: formatElement(e), value: e })), { label: "All elements", value: ALL_ELEMENTS }];
}

/** Formats a BanScope (a specific Element or the "ALL" sentinel) for display. */
function formatScope(scope: BanScope): string {
  return scope === ALL_ELEMENTS ? "all elements" : formatElement(scope);
}

// ---------- Remove ----------

export async function handleRemoveStart(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const ladder = await ladderRepo.getLadder();
  if (ladder.length === 0) {
    await interaction.reply({ content: "The ladder is empty.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const row = buildLadderCharacterSelectRow(ladder, REMOVE_CHARACTER_SELECT_ID, "Choose a character to remove");
  await interaction.reply({
    content: "**Which character do you want to remove from the ladder?**",
    components: [row],
    ephemeral: true,
  });
}

export async function handleRemoveCharacterSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const sheetRow = Number.parseInt(interaction.values[0], 10);
  const ladder = await ladderRepo.getLadder();
  const target = ladder.find((r) => r.sheetRow === sheetRow);
  if (!target) {
    await interaction.update({ content: "That entry isn't on the ladder anymore.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${REMOVE_CONFIRM_PREFIX}:${target.discordUserId}:${target.element}`)
      .setLabel("Confirm removal")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(REMOVE_CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await interaction.update({
    content: `Remove **${target.characterName}** (${formatElement(target.element)}) — <@${target.discordUserId}>? Any active match involving it will be cancelled.`,
    components: [row],
  });
}

export async function handleRemoveResolve(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  if (interaction.customId === REMOVE_CANCEL_ID) {
    await interaction.update({ content: "Removal cancelled — no changes made.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const [, userId, scope] = interaction.customId.split(":") as [string, string, BanScope];
  await interaction.update({ content: "Removing…", components: [] });

  const { removedEntries, cancelledMatches } = await removePlayer(userId, scope);
  for (const match of cancelledMatches) {
    await closeMatchChannel(interaction.client, match, "Player removed by admin");
  }
  if (cancelledMatches.length > 0) {
    await refreshActiveChallengesPanel(interaction.client).catch((err) =>
      console.error("Failed to refresh active challenges panel:", err),
    );
  }

  if (removedEntries.length === 0) {
    const followUp = await interaction.followUp({ content: "Nothing to remove — that entry may already be gone.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    scheduleMessageCleanup(followUp);
    return;
  }

  const followUp = await interaction.followUp({
    content: `Removed ${removedEntries.map((e) => `**${e.characterName}** (${formatElement(e.element)})`).join(", ")}.`,
    ephemeral: true,
  });
  scheduleReplyCleanup(interaction);
  scheduleMessageCleanup(followUp);

  const embed = new EmbedBuilder()
    .setDescription(
      `🗑️ <@${interaction.user.id}> removed <@${userId}>'s ${removedEntries.map((e) => `**${e.characterName}** (${formatElement(e.element)})`).join(", ")} from the ladder.`,
    )
    .setColor(0x992d22);
  await notify.challenges(interaction.client, { embeds: [embed] });
  await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
}

// ---------- Ban ----------

export async function handleBanStart(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const select = new UserSelectMenuBuilder().setCustomId(BAN_USER_SELECT_ID).setPlaceholder("Choose a player to ban");
  await interaction.reply({
    content: "**Which player do you want to ban?** (they don't need to be on the ladder yet)",
    components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleBanUserSelect(interaction: UserSelectMenuInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const userId = interaction.values[0];
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${BAN_ELEMENT_SELECT_PREFIX}:${userId}`)
    .setPlaceholder("Ban scope")
    .addOptions(elementScopeOptions());
  await interaction.update({
    content: `Ban <@${userId}> from which element(s)?`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

export async function handleBanElementSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;
  const userId = interaction.customId.slice(`${BAN_ELEMENT_SELECT_PREFIX}:`.length);
  const scope = interaction.values[0] as BanScope;

  const modal = new ModalBuilder()
    .setCustomId(`${BAN_REASON_MODAL_PREFIX}:${userId}:${scope}`)
    .setTitle("Ban reason")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(BAN_REASON_INPUT_ID)
          .setLabel("Why is this player being banned?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );
  await interaction.showModal(modal);
}

export async function handleBanReasonModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  // Ack before the display-name lookup and banPlayer's (potentially many sequential) Sheets
  // writes — easily slow enough under load to blow past Discord's 3s interaction deadline.
  await interaction.deferReply({ ephemeral: true });

  const [, userId, scope] = interaction.customId.split(":") as [string, string, BanScope];
  const reason = interaction.fields.getTextInputValue(BAN_REASON_INPUT_ID);
  const discordName = await getDisplayName(interaction.client, interaction.guildId, userId);

  const { removedEntries, cancelledMatches } = await banPlayer(userId, discordName, scope, reason, interaction.user.id);
  for (const match of cancelledMatches) {
    await closeMatchChannel(interaction.client, match, "Player banned by admin");
  }
  if (cancelledMatches.length > 0) {
    await refreshActiveChallengesPanel(interaction.client).catch((err) =>
      console.error("Failed to refresh active challenges panel:", err),
    );
  }

  await interaction.editReply({
    content: `Banned <@${userId}> (${formatScope(scope)}).${removedEntries.length > 0 ? ` Removed ${removedEntries.length} ladder entr${removedEntries.length === 1 ? "y" : "ies"}.` : ""}`,
  });
  scheduleReplyCleanup(interaction);

  const embed = new EmbedBuilder()
    .setDescription(
      `🚫 <@${interaction.user.id}> banned <@${userId}> from **${scope === ALL_ELEMENTS ? "the ladder" : formatElement(scope)}**.\n**Reason:** ${reason}`,
    )
    .setColor(0x992d22);
  await notify.leagueManagers(interaction.client, { embeds: [embed] });
  if (removedEntries.length > 0) {
    await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  }
}

// ---------- Unban ----------

export async function handleUnbanStart(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const bans = await bannedRepo.getAllBans();
  if (bans.length === 0) {
    await interaction.reply({ content: "There are no active bans.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(UNBAN_SELECT_ID)
    .setPlaceholder("Choose a ban to lift")
    .addOptions(
      bans.slice(0, 25).map((b) => ({
        label: `${b.discordName} — ${b.element === ALL_ELEMENTS ? "All elements" : formatElement(b.element as Element)}`,
        description: b.reason.slice(0, 100) || undefined,
        value: String(b.sheetRow),
      })),
    );
  await interaction.reply({
    content: "**Select a ban to lift:**",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleUnbanSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const sheetRow = Number.parseInt(interaction.values[0], 10);
  await interaction.update({ content: "Ban lifted.", components: [] });
  scheduleReplyCleanup(interaction);
  await unban(sheetRow);

  const embed = new EmbedBuilder().setDescription(`✅ <@${interaction.user.id}> lifted a ban.`).setColor(0x2ecc71);
  await notify.leagueManagers(interaction.client, { embeds: [embed] });
}
