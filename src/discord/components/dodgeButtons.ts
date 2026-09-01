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
} from "discord.js";
import * as dodgesRepo from "../../sheets/dodgesRepo.js";
import * as matchesRepo from "../../sheets/matchesRepo.js";
import * as matchService from "../../domain/matchService.js";
import { resolveDodge, handleDodgeCountThreshold } from "../../domain/dodgeService.js";
import { enqueueResolution } from "../../domain/resolutionQueue.js";
import { isLeagueManager } from "../permissions.js";
import { notify, postAutoDeletingConfirmation, deleteMessageByUrl } from "../notify.js";
import { closeMatchChannel } from "../matchChannels.js";
import { refreshTop10Panel } from "../top10Panel.js";
import { refreshActiveChallengesPanel } from "../activeChallengesPanel.js";
import { formatElement } from "../../util/formatElement.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";

export const DENY_MODAL_PREFIX = "dodge_deny_modal";
export const DENY_REASON_INPUT_ID = "deny_reason";

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
  const matchFastCheck = await matchesRepo.getMatchById(dodge.matchId);
  if (!matchFastCheck || matchFastCheck.status !== "Pending") {
    await interaction.reply({ content: "The underlying match is no longer pending — can't approve.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  // Ack silently before applyDodgeWin/resolveDodge — several sequential Sheets writes, easily
  // slow enough under load to blow past Discord's 3s interaction deadline given the two reads
  // already above. We're about to delete this message entirely, so no point updating it first.
  await interaction.deferUpdate();

  // Re-check + apply + write all run inside the shared resolution queue so a second League
  // Manager's click (Approve or Deny) on this same dodge can never race past this one's write.
  // See resolutionQueue.ts.
  const resolution = await enqueueResolution(async () => {
    const freshDodge = await dodgesRepo.getDodgeById(dodgeId);
    if (!freshDodge || freshDodge.status !== "Pending") return { ok: false as const };

    const freshMatch = await matchesRepo.getMatchById(freshDodge.matchId);
    if (!freshMatch || freshMatch.status !== "Pending") return { ok: true as const, kind: "matchNotPending" as const };

    const { rank1Update, defenderDodgeCount } = await matchService.applyDodgeWin(freshMatch);
    await resolveDodge(freshDodge, interaction.user.id, true);

    return { ok: true as const, kind: "approved" as const, match: freshMatch, rank1Update, defenderDodgeCount };
  });

  if (!resolution.ok) {
    await postAutoDeletingConfirmation(interaction.client, "This dodge request was already resolved by another League Manager.");
    return;
  }

  if (resolution.kind === "matchNotPending") {
    await postAutoDeletingConfirmation(interaction.client, "The underlying match is no longer pending — can't approve.");
    return;
  }

  const { match, rank1Update, defenderDodgeCount } = resolution;

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
  await handleDodgeCountThreshold(interaction.client, match.defenderUserId, match.defenderElement, defenderDodgeCount);

  await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  await refreshActiveChallengesPanel(interaction.client).catch((err) =>
    console.error("Failed to refresh active challenges panel:", err),
  );
}
