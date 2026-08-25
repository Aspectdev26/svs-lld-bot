import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Attachment,
  type RepliableInteraction,
} from "discord.js";
import { config } from "../config.js";
import * as dodgesRepo from "../sheets/dodgesRepo.js";
import { isDodgeEligible, createDodgeRequest } from "../domain/dodgeService.js";
import { notify } from "./notify.js";
import { scheduleReplyCleanup } from "./ephemeralCleanup.js";
import { formatElement } from "../util/formatElement.js";
import type { MatchRow } from "../types.js";

/**
 * Shared by the /dodge-request slash command and the in-channel "Request Dodge" button flow.
 * Validates eligibility, records the dodge request, and posts the evidence + approve/deny
 * buttons to #league-managers. Always responds to `interaction` itself (success or error).
 */
export async function submitDodgeRequest(
  interaction: RepliableInteraction,
  match: MatchRow,
  screenshot: Attachment,
): Promise<void> {
  const participants = [match.challengerUserId, match.defenderUserId];
  if (!participants.includes(interaction.user.id)) {
    await interaction.reply({ content: "You're not a participant in that match.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }
  if (match.status !== "Pending") {
    await interaction.reply({ content: "That match isn't currently active.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }
  if (!isDodgeEligible(match)) {
    await interaction.reply({
      content: "You can only request a dodge once 24 hours have passed with no result on this match.",
      ephemeral: true,
    });
    scheduleReplyCleanup(interaction);
    return;
  }

  // Ack before the Sheets round trips below (duplicate check, write, re-read) — sequentially
  // enough to risk exceeding Discord's 3s interaction deadline under load.
  await interaction.deferReply({ ephemeral: true });

  const existingDodge = await dodgesRepo.getPendingDodgeForMatch(match.matchId);
  if (existingDodge) {
    await interaction.editReply({ content: "A dodge request for this match is already pending review." });
    scheduleReplyCleanup(interaction);
    return;
  }

  const opponentUserId = match.challengerUserId === interaction.user.id ? match.defenderUserId : match.challengerUserId;

  const dodge = await createDodgeRequest(match, interaction.user.id, "");
  const stored = await dodgesRepo.getDodgeById(dodge.dodgeId);
  if (!stored) {
    await interaction.editReply({ content: "Something went wrong recording the dodge request — try again." });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.editReply({ content: "Dodge request submitted to League Managers for review." });
  scheduleReplyCleanup(interaction);

  const leagueManagerRole = interaction.guild?.roles.cache.find((r) => r.name === config.leagueManagerRoleName);

  const embed = new EmbedBuilder()
    .setTitle("Dodge request")
    .setDescription(
      `**Requested by:** <@${interaction.user.id}>\n**Opponent:** <@${opponentUserId}>\n` +
        `**Match:** \`${match.matchId}\` — ${formatElement(match.challengerElement)} vs ${formatElement(match.defenderElement)}\n` +
        `**Match created:** <t:${Math.floor(Date.parse(match.createdAt) / 1000)}:R>`,
    )
    .setImage(`attachment://${screenshot.name}`)
    .setColor(0xe74c3c);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`dodge_approve:${dodge.dodgeId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`dodge_deny:${dodge.dodgeId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
  );

  const sent = await notify.leagueManagers(interaction.client, {
    content: leagueManagerRole ? `${leagueManagerRole}` : undefined,
    embeds: [embed],
    files: [{ attachment: screenshot.url, name: screenshot.name }],
    components: [row],
    allowedMentions: leagueManagerRole ? { roles: [leagueManagerRole.id] } : undefined,
  });

  stored.leagueManagerMessageUrl = sent.url;
  await dodgesRepo.updateDodge(stored);
}
