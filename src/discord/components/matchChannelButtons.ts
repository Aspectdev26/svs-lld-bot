import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
} from "discord.js";
import { config } from "../../config.js";
import * as matchesRepo from "../../sheets/matchesRepo.js";
import * as matchService from "../../domain/matchService.js";
import { isDodgeEligible } from "../../domain/dodgeService.js";
import { submitDodgeRequest } from "../dodgeFlow.js";
import { buildWinnerPrompt } from "../reportWinFlow.js";
import { notify } from "../notify.js";
import { closeMatchChannel } from "../matchChannels.js";
import { refreshActiveChallengesPanel } from "../activeChallengesPanel.js";
import { formatElement } from "../../util/formatElement.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";

async function handleReportWin(interaction: ButtonInteraction, matchId: string): Promise<void> {
  const prompt = await buildWinnerPrompt(matchId, interaction.user.id);
  if (!prompt.ok) {
    await interaction.reply({ content: prompt.reason, ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.reply({ content: "**Who won this match?**", components: [prompt.row] });
}

async function handleDodgeStart(interaction: ButtonInteraction, matchId: string): Promise<void> {
  const match = await matchesRepo.getMatchById(matchId);
  if (!match || match.status !== "Pending") {
    await interaction.reply({ content: "That match isn't currently active.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }
  if (![match.challengerUserId, match.defenderUserId].includes(interaction.user.id)) {
    await interaction.reply({ content: "You're not a participant in that match.", ephemeral: true });
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

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`matchch_dodge_submit:${matchId}`).setLabel("Submit Dodge Request").setStyle(ButtonStyle.Danger),
  );
  await interaction.reply({
    content:
      "Discord doesn't let buttons accept file uploads directly. **Upload your screenshot as a message in this channel now**, then click **Submit Dodge Request** below.",
    components: [row],
    ephemeral: true,
  });
}

async function handleDodgeSubmit(interaction: ButtonInteraction, matchId: string): Promise<void> {
  const match = await matchesRepo.getMatchById(matchId);
  if (!match) {
    await interaction.reply({ content: "That match isn't currently active.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const recent = await interaction.channel?.messages.fetch({ limit: 25 });
  const withAttachment = recent
    ?.filter((m) => m.author.id === interaction.user.id && m.attachments.size > 0)
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
    .first();
  const screenshot = withAttachment?.attachments.first();

  if (!screenshot) {
    await interaction.reply({
      content: "I couldn't find a screenshot you uploaded in this channel — attach the image as a message here, then click Submit again.",
      ephemeral: true,
    });
    scheduleReplyCleanup(interaction);
    return;
  }

  await submitDodgeRequest(interaction, match, screenshot);
}

async function handleExtensionRequest(interaction: ButtonInteraction, matchId: string): Promise<void> {
  const match = await matchesRepo.getMatchById(matchId);
  if (!match || match.status !== "Pending") {
    await interaction.reply({ content: "That match isn't currently active.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }
  if (![match.challengerUserId, match.defenderUserId].includes(interaction.user.id)) {
    await interaction.reply({ content: "You're not a participant in that match.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }
  if (match.extensionPending) {
    await interaction.reply({ content: "An extension request for this match is already pending review.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  await matchesRepo.setExtensionPending(match.sheetRow, true);
  await interaction.editReply({ content: "Extension request submitted to League Managers for review." });
  scheduleReplyCleanup(interaction);

  const leagueManagerRole = interaction.guild?.roles.cache.find((r) => r.name === config.leagueManagerRoleName);
  const embed = new EmbedBuilder()
    .setTitle("Match extension request")
    .setDescription(
      `⏳ <@${interaction.user.id}> requested a 2-day extension for match \`${match.matchId}\`\n` +
        `(<@${match.challengerUserId}> vs <@${match.defenderUserId}>, ${formatElement(match.challengerElement)} vs ${formatElement(match.defenderElement)}).\n` +
        `Current expiry: <t:${Math.floor(Date.parse(match.expiresAt) / 1000)}:F>`,
    )
    .setColor(0xf39c12);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`extend_approve:${matchId}`).setLabel("Approve (+2 days)").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`extend_deny:${matchId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
  );
  await notify.leagueManagers(interaction.client, {
    content: leagueManagerRole ? `${leagueManagerRole}` : undefined,
    embeds: [embed],
    components: [row],
    allowedMentions: leagueManagerRole ? { roles: [leagueManagerRole.id] } : undefined,
  });
}

/**
 * Cancelling a match with no rank change requires both participants to click Cancel Match:
 * the first click just records the requester; the opponent clicking the same button confirms
 * and actually cancels the match. Either participant can click again and see the other is
 * still pending, but there's no way to "un-request" — cancelling is cheap enough (voids the
 * match, no rank change) that we don't need a withdraw path.
 */
async function handleCancelMatch(interaction: ButtonInteraction, matchId: string): Promise<void> {
  const match = await matchesRepo.getMatchById(matchId);
  if (!match || match.status !== "Pending") {
    await interaction.reply({ content: "That match isn't currently active.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }
  if (![match.challengerUserId, match.defenderUserId].includes(interaction.user.id)) {
    await interaction.reply({ content: "You're not a participant in that match.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const otherUserId = interaction.user.id === match.challengerUserId ? match.defenderUserId : match.challengerUserId;

  if (!match.cancelRequestedByUserId) {
    await interaction.deferReply();
    await matchesRepo.setCancelRequestedBy(match.sheetRow, interaction.user.id);
    await interaction.editReply({
      content: `🚫 <@${interaction.user.id}> wants to cancel this match. <@${otherUserId}>, click **Cancel Match** to confirm — both players must agree.`,
    });
    return;
  }

  if (match.cancelRequestedByUserId === interaction.user.id) {
    await interaction.reply({
      content: `You've already requested to cancel this match — waiting on <@${otherUserId}> to confirm.`,
      ephemeral: true,
    });
    scheduleReplyCleanup(interaction);
    return;
  }

  // The other participant just confirmed — both sides agree, so cancel for real.
  await interaction.deferReply();
  await matchService.cancelMatch(match);

  const embed = new EmbedBuilder()
    .setTitle("Match cancelled")
    .setDescription(
      `🚫 Match \`${match.matchId}\` between <@${match.challengerUserId}> (${formatElement(match.challengerElement)}) and <@${match.defenderUserId}> (${formatElement(match.defenderElement)}) was cancelled by mutual agreement. No rank change.`,
    )
    .setColor(0x95a5a6);
  await notify.challenges(interaction.client, { embeds: [embed] });

  await interaction.editReply({ content: "✅ Both players agreed — match cancelled. This channel will now close." });
  await closeMatchChannel(interaction.client, match, "Cancelled by mutual agreement");
  await refreshActiveChallengesPanel(interaction.client).catch((err) =>
    console.error("Failed to refresh active challenges panel:", err),
  );
}

export async function handleMatchChannelButton(interaction: ButtonInteraction): Promise<void> {
  const [action, matchId] = interaction.customId.split(":");

  switch (action) {
    case "matchch_report":
      await handleReportWin(interaction, matchId);
      return;
    case "matchch_dodge":
      await handleDodgeStart(interaction, matchId);
      return;
    case "matchch_dodge_submit":
      await handleDodgeSubmit(interaction, matchId);
      return;
    case "matchch_extend":
      await handleExtensionRequest(interaction, matchId);
      return;
    case "matchch_cancel":
      await handleCancelMatch(interaction, matchId);
      return;
  }
}
