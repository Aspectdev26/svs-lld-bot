import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type GuildMember,
} from "discord.js";
import * as dodgesRepo from "../../sheets/dodgesRepo.js";
import * as matchesRepo from "../../sheets/matchesRepo.js";
import * as matchService from "../../domain/matchService.js";
import { removePlayer } from "../../domain/adminService.js";
import { resolveDodge, DODGE_WARNING_THRESHOLD, DODGE_REMOVAL_THRESHOLD } from "../../domain/dodgeService.js";
import { isLeagueManager } from "../permissions.js";
import { notify, postAutoDeletingConfirmation, deleteMessageByUrl } from "../notify.js";
import { closeMatchChannel } from "../matchChannels.js";
import { refreshTop10Panel } from "../top10Panel.js";
import { refreshActiveChallengesPanel } from "../activeChallengesPanel.js";
import { formatElement } from "../../util/formatElement.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";
import type { MatchRow } from "../../types.js";

export const DENY_MODAL_PREFIX = "dodge_deny_modal";
export const DENY_REASON_INPUT_ID = "deny_reason";

/**
 * Reacts to the defender's post-dodge-approval dodgeCount: a private warning DM (+ League Manager
 * notice) at DODGE_WARNING_THRESHOLD, or an automatic ladder removal at DODGE_REMOVAL_THRESHOLD.
 * A no-op below the warning threshold, or if the defender's ladder entry couldn't be found.
 */
async function handleDodgeCountThreshold(client: Client, match: MatchRow, defenderDodgeCount: number | null): Promise<void> {
  if (defenderDodgeCount === null || defenderDodgeCount < DODGE_WARNING_THRESHOLD) return;

  const elementLabel = formatElement(match.defenderElement);

  if (defenderDodgeCount >= DODGE_REMOVAL_THRESHOLD) {
    const { removedEntries, cancelledMatches } = await removePlayer(match.defenderUserId, match.defenderElement);
    if (removedEntries.length === 0) return;
    // Defensive: the just-approved dodge match is already resolved by this point, so this
    // should normally find nothing, but any other pending match on this entry gets cleaned up.
    for (const cancelled of cancelledMatches) {
      await closeMatchChannel(client, cancelled, "Player removed by automatic dodge-count removal");
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle("Removed from the ladder")
      .setDescription(
        `Your **${elementLabel}** entry reached ${defenderDodgeCount} dodges against it and has been automatically removed from the ladder.`,
      )
      .setColor(0x992d22);
    try {
      const defender = await client.users.fetch(match.defenderUserId);
      await defender.send({ embeds: [dmEmbed] });
    } catch {
      // DMs closed — the League Manager/results-channel notices below stand as the record.
    }

    const lmEmbed = new EmbedBuilder()
      .setDescription(
        `🚫 <@${match.defenderUserId}>'s **${elementLabel}** entry reached ${defenderDodgeCount} dodges against it and was automatically removed from the ladder.`,
      )
      .setColor(0x992d22);
    await notify.leagueManagers(client, { embeds: [lmEmbed] });
    await notify.challenges(client, { embeds: [lmEmbed] });
    return;
  }

  // defenderDodgeCount === DODGE_WARNING_THRESHOLD
  const dmEmbed = new EmbedBuilder()
    .setTitle("Dodge warning")
    .setDescription(
      `Your **${elementLabel}** entry now has **${defenderDodgeCount}** dodges against it. One more and it will be ` +
        `automatically removed from the ladder. Completing a challenge (win or lose) removes one dodge from the count.`,
    )
    .setColor(0xe67e22);
  try {
    const defender = await client.users.fetch(match.defenderUserId);
    await defender.send({ embeds: [dmEmbed] });
  } catch {
    // DMs closed — the League Manager notice below still records it.
  }

  const lmEmbed = new EmbedBuilder()
    .setDescription(
      `⚠️ <@${match.defenderUserId}>'s **${elementLabel}** entry now has ${defenderDodgeCount} dodges against it — ` +
        `one more triggers automatic removal from the ladder.`,
    )
    .setColor(0xe67e22);
  await notify.leagueManagers(client, { embeds: [lmEmbed] });
}

export async function handleDodgeButton(interaction: ButtonInteraction): Promise<void> {
  const [action, dodgeId] = interaction.customId.split(":");

  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can resolve dodge requests.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const dodge = await dodgesRepo.getDodgeById(dodgeId);
  if (!dodge || dodge.status !== "Pending") {
    await interaction.reply({ content: "This dodge request has already been resolved.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  if (action === "dodge_deny") {
    const modal = new ModalBuilder()
      .setCustomId(`${DENY_MODAL_PREFIX}:${dodgeId}`)
      .setTitle("Deny dodge request")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(DENY_REASON_INPUT_ID)
            .setLabel("Reason for denying this dodge request")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // Approve
  const match = await matchesRepo.getMatchById(dodge.matchId);
  if (!match || match.status !== "Pending") {
    await interaction.reply({ content: "The underlying match is no longer pending — can't approve.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  // Ack silently before applyDodgeWin/resolveDodge — several sequential Sheets writes, easily
  // slow enough under load to blow past Discord's 3s interaction deadline given the two reads
  // already above. We're about to delete this message entirely, so no point updating it first.
  await interaction.deferUpdate();

  const { rank1Update, defenderDodgeCount } = await matchService.applyDodgeWin(match);
  await resolveDodge(dodge, interaction.user.id, true);

  await deleteMessageByUrl(interaction.client, dodge.leagueManagerMessageUrl);
  await postAutoDeletingConfirmation(
    interaction.client,
    `✅ Dodge approved by <@${interaction.user.id}>. <@${match.challengerUserId}> has taken the rank.`,
  );

  let description = `🏳️ <@${match.defenderUserId}> did not respond in time — <@${match.challengerUserId}> (${formatElement(match.challengerElement)}) has been awarded the win and taken their rank (match \`${match.matchId}\`).`;
  if (rank1Update.changed && rank1Update.kind === "newChampion") {
    description += `\n👑 **${rank1Update.holderName}** is the new Rank 1!`;
  }

  const embed = new EmbedBuilder().setTitle("Dodge approved").setDescription(description).setColor(0x9b59b6);
  await notify.challenges(interaction.client, {
    content: `<@${match.challengerUserId}> <@${match.defenderUserId}>`,
    embeds: [embed],
  });

  await closeMatchChannel(interaction.client, match, "Dodge approved");
  await handleDodgeCountThreshold(interaction.client, match, defenderDodgeCount);

  await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  await refreshActiveChallengesPanel(interaction.client).catch((err) =>
    console.error("Failed to refresh active challenges panel:", err),
  );
}
