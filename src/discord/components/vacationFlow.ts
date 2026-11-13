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
  type ModalSubmitInteraction,
} from "discord.js";
import { config } from "../../config.js";
import * as ladderRepo from "../../sheets/ladderRepo.js";
import * as matchesRepo from "../../sheets/matchesRepo.js";
import * as vacationRequestsRepo from "../../sheets/vacationRequestsRepo.js";
import * as extendedVacationRepo from "../../sheets/extendedVacationRepo.js";
import * as vacationService from "../../domain/vacationService.js";
import { handleDodgeCountThreshold } from "../../domain/dodgeService.js";
import { enqueueResolution } from "../../domain/resolutionQueue.js";
import { finalizeReportWin } from "../reportWinFlow.js";
import { createMatchChannel } from "../matchChannels.js";
import { refreshTop10Panel } from "../top10Panel.js";
import { refreshActiveChallengesPanel } from "../activeChallengesPanel.js";
import { isLeagueManager } from "../permissions.js";
import { notify, postAutoDeletingConfirmation, deleteMessageByUrl } from "../notify.js";
import { scheduleReplyCleanup, scheduleMessageCleanup } from "../ephemeralCleanup.js";
import type { LadderRow, VacationRequestRow, VacationRequestType } from "../../types.js";

const DENY_REASON_INPUT_ID = "vac_deny_reason";

/* ------------------------------------------------------------------------ */
/* Request Vacation / Request Extended Vacation — nearly identical shape,   */
/* parametrized by this config so the flow logic below is written once.    */
/* ------------------------------------------------------------------------ */

interface RequestFlowDef {
  requestType: VacationRequestType;
  label: string;
  submitPrefix: string;
  submitCancelId: string;
  approvePrefix: string;
  denyPrefix: string;
  denyModalPrefix: string;
  buildWarning: (entry: LadderRow) => string;
}

export const VACATION_REQUEST_SUBMIT_PREFIX = "vacreq_submit";
export const VACATION_REQUEST_SUBMIT_CANCEL_ID = "vacreq_submit_cancel";
export const VACATION_REQUEST_APPROVE_DENY_PREFIXES = ["vacreq_approve:", "vacreq_deny:"];
export const VACATION_REQUEST_DENY_MODAL_PREFIX = "vacreq_deny_modal";

export const EXTENDED_VACATION_REQUEST_SUBMIT_PREFIX = "evacreq_submit";
export const EXTENDED_VACATION_REQUEST_SUBMIT_CANCEL_ID = "evacreq_submit_cancel";
export const EXTENDED_VACATION_REQUEST_APPROVE_DENY_PREFIXES = ["evacreq_approve:", "evacreq_deny:"];
export const EXTENDED_VACATION_REQUEST_DENY_MODAL_PREFIX = "evacreq_deny_modal";

const VACATION_REQUEST_DEF: RequestFlowDef = {
  requestType: "Vacation",
  label: "Vacation",
  submitPrefix: VACATION_REQUEST_SUBMIT_PREFIX,
  submitCancelId: VACATION_REQUEST_SUBMIT_CANCEL_ID,
  approvePrefix: "vacreq_approve",
  denyPrefix: "vacreq_deny",
  denyModalPrefix: VACATION_REQUEST_DENY_MODAL_PREFIX,
  buildWarning: (entry) =>
    `Request **Vacation** (you're rank ${entry.rank})?\n\n` +
    `If you're in an active match, please try to finish it first. If this is approved while you still have a match pending, ` +
    `you'll receive an automatic loss for it and it will count toward your dodge total.\n\n` +
    `Vacation lasts up to **14 days** — if you don't return in time, you'll be automatically moved to Extended Vacation.\n\n` +
    `A League Manager must approve this request.`,
};

const EXTENDED_VACATION_REQUEST_DEF: RequestFlowDef = {
  requestType: "ExtendedVacation",
  label: "Extended Vacation",
  submitPrefix: EXTENDED_VACATION_REQUEST_SUBMIT_PREFIX,
  submitCancelId: EXTENDED_VACATION_REQUEST_SUBMIT_CANCEL_ID,
  approvePrefix: "evacreq_approve",
  denyPrefix: "evacreq_deny",
  denyModalPrefix: EXTENDED_VACATION_REQUEST_DENY_MODAL_PREFIX,
  buildWarning: (entry) =>
    `Request **Extended Vacation** (you're rank ${entry.rank})?\n\n` +
    `If you're in an active match, please try to finish it first. If this is approved while you still have a match pending, ` +
    `you'll receive an automatic loss for it and it will count toward your dodge total.\n\n` +
    `Extended Vacation lasts up to **30 days** — if you don't return in time, you'll be **completely removed from the ladder** ` +
    `and your season points will be reset to zero. You'd need to sign up again to rejoin.\n\n` +
    `A League Manager must approve this request.`,
};

function buildSubmitConfirm(entry: LadderRow, def: RequestFlowDef): { content: string; row: ActionRowBuilder<ButtonBuilder> } {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(def.submitPrefix).setLabel(`Request ${def.label}`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(def.submitCancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  return { content: def.buildWarning(entry), row };
}

function buildRequestReviewMessage(request: VacationRequestRow, def: RequestFlowDef): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const embed = new EmbedBuilder()
    .setTitle(`New ${def.label} request`)
    .setDescription(
      `**Player:** <@${request.discordUserId}> (${request.discordName})`,
    )
    .setColor(0x9b59b6);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${def.approvePrefix}:${request.requestId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${def.denyPrefix}:${request.requestId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
  );
  return { embed, row };
}

async function handleRequestStartButton(interaction: ButtonInteraction, def: RequestFlowDef): Promise<void> {
  const entry = await ladderRepo.findEntry(interaction.user.id);
  if (!entry) {
    await interaction.reply({ content: "You're not registered on the ladder.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const { content, row } = buildSubmitConfirm(entry, def);
  await interaction.reply({ content, components: [row], ephemeral: true });
}

async function handleRequestSubmitResolve(interaction: ButtonInteraction, def: RequestFlowDef): Promise<void> {
  if (interaction.customId === def.submitCancelId) {
    await interaction.update({ content: "Cancelled.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const entry = await ladderRepo.findEntry(interaction.user.id);
  if (!entry) {
    await interaction.update({ content: "You're not on the ladder anymore.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.update({ content: "Submitting…", components: [] });

  const result =
    def.requestType === "Vacation" ? await vacationService.createVacationRequest(entry) : await vacationService.createExtendedVacationRequest(entry);
  if (!result.ok) {
    const followUp = await interaction.followUp({ content: result.reason, ephemeral: true });
    scheduleReplyCleanup(interaction);
    scheduleMessageCleanup(followUp);
    return;
  }

  const followUp = await interaction.followUp({
    content: `${def.label} request submitted — a League Manager will review it shortly.`,
    ephemeral: true,
  });
  scheduleReplyCleanup(interaction);
  scheduleMessageCleanup(followUp);

  const { request } = result;
  const leagueManagerRole = interaction.guild?.roles.cache.find((r) => r.name === config.leagueManagerRoleName);
  const { embed, row } = buildRequestReviewMessage(request, def);

  const sent = await notify.leagueManagers(interaction.client, {
    content: leagueManagerRole ? `${leagueManagerRole}` : undefined,
    embeds: [embed],
    components: [row],
    allowedMentions: leagueManagerRole ? { roles: [leagueManagerRole.id] } : undefined,
  });

  request.leagueManagerMessageUrl = sent.url;
  await vacationRequestsRepo.updateRequest(request);
}

type ForfeitOutcome =
  | { ok: true; entryStillExists: true; entry: LadderRow }
  | { ok: true; entryStillExists: false }
  | { ok: false; reason: string };

/**
 * If `entry` has a pending match, forfeits it (the opponent is awarded the win via the same path
 * as a self-service ladder departure) and charges `entry` a dodge — which may itself trigger the
 * dodge-count warning/removal ladder. Reports back whether `entry` still exists afterward, since a
 * 3rd dodge auto-removes it before the caller gets a chance to apply Vacation/Extended Vacation.
 */
async function forfeitPendingMatchIfAny(client: Client, entry: LadderRow): Promise<ForfeitOutcome> {
  const pendingMatch = await matchesRepo.getPendingMatchForPlayer(entry.discordUserId);
  if (!pendingMatch) return { ok: true, entryStillExists: true, entry };

  const opponentUserId =
    pendingMatch.challengerUserId === entry.discordUserId ? pendingMatch.defenderUserId : pendingMatch.challengerUserId;
  const forfeitResult = await finalizeReportWin(client, entry.discordUserId, pendingMatch.matchId, opponentUserId);
  if (!forfeitResult.ok) return { ok: false, reason: forfeitResult.reason };

  const freshEntry = await ladderRepo.findEntry(entry.discordUserId);
  if (!freshEntry) return { ok: true, entryStillExists: false };

  const newDodgeCount = freshEntry.dodgeCount + 1;
  await ladderRepo.setDodgeCount(freshEntry.sheetRow, newDodgeCount);
  await handleDodgeCountThreshold(client, freshEntry.discordUserId, newDodgeCount);

  const afterThresholdEntry = await ladderRepo.findEntry(entry.discordUserId);
  if (!afterThresholdEntry) return { ok: true, entryStillExists: false };

  return { ok: true, entryStillExists: true, entry: afterThresholdEntry };
}

async function handleRequestApproveDenyButton(interaction: ButtonInteraction, def: RequestFlowDef): Promise<void> {
  const [action, requestId] = interaction.customId.split(":");

  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can resolve vacation requests.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const request = await vacationRequestsRepo.getRequestById(requestId);
  if (!request || request.status !== "Pending") {
    await interaction.reply({ content: "This request has already been resolved.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  if (action === def.denyPrefix) {
    const modal = new ModalBuilder()
      .setCustomId(`${def.denyModalPrefix}:${requestId}`)
      .setTitle(`Deny ${def.label} request`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(DENY_REASON_INPUT_ID)
            .setLabel("Reason for denying this request")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // Ack silently before the multi-write approval path below (possible match forfeit + dodge
  // threshold + ladder mutation), which can easily exceed Discord's 3s deadline.
  await interaction.deferUpdate();

  // The whole approve path — re-check, possible forfeit, and the final Approved write — runs
  // inside the shared resolution queue so a second League Manager's click (Approve or Deny) on
  // this same request can never race past this one's write. See resolutionQueue.ts.
  const resolution = await enqueueResolution(async () => {
    const freshRequest = await vacationRequestsRepo.getRequestById(requestId);
    if (!freshRequest || freshRequest.status !== "Pending") return { ok: false as const };

    const entry = await ladderRepo.findEntry(freshRequest.discordUserId);
    if (!entry) {
      await vacationService.denyVacationRequest(freshRequest, interaction.user.id, "Entry no longer on the ladder.");
      return { ok: true as const, kind: "entryMissing" as const, request: freshRequest };
    }

    const outcome = await forfeitPendingMatchIfAny(interaction.client, entry);
    if (!outcome.ok) {
      return { ok: true as const, kind: "forfeitFailed" as const, entry, reason: outcome.reason };
    }

    if (!outcome.entryStillExists) {
      freshRequest.status = "Approved";
      freshRequest.resolvedByUserId = interaction.user.id;
      freshRequest.resolvedAt = new Date().toISOString();
      await vacationRequestsRepo.updateRequest(freshRequest);
      return { ok: true as const, kind: "autoRemoved" as const, entry, request: freshRequest };
    }

    const freshEntry = outcome.entry;
    if (def.requestType === "Vacation") {
      await vacationService.approveVacationRequest(freshRequest, interaction.user.id, freshEntry);
    } else {
      await vacationService.approveExtendedVacationRequest(freshRequest, interaction.user.id, freshEntry);
    }
    return { ok: true as const, kind: "approved" as const, entry: freshEntry, request: freshRequest };
  });

  if (!resolution.ok) {
    await deleteMessageByUrl(interaction.client, request.leagueManagerMessageUrl);
    await postAutoDeletingConfirmation(interaction.client, "This request was already resolved by another League Manager.");
    return;
  }

  if (resolution.kind === "entryMissing") {
    await deleteMessageByUrl(interaction.client, request.leagueManagerMessageUrl);
    await postAutoDeletingConfirmation(
      interaction.client,
      `⚠️ Couldn't approve — <@${request.discordUserId}> is no longer on the ladder.`,
    );
    return;
  }

  if (resolution.kind === "forfeitFailed") {
    await interaction.followUp({
      content: `Couldn't process ${resolution.entry.discordName}'s active match (${resolution.reason}) — try approving again.`,
      ephemeral: true,
    });
    return;
  }

  await deleteMessageByUrl(interaction.client, request.leagueManagerMessageUrl);

  if (resolution.kind === "autoRemoved") {
    await postAutoDeletingConfirmation(
      interaction.client,
      `✅ Approved by <@${interaction.user.id}> — but <@${resolution.entry.discordUserId}> had already reached the dodge-removal threshold and was automatically removed from the ladder instead.`,
    );
    return;
  }

  const freshEntry = resolution.entry;

  if (def.requestType === "Vacation") {
    await postAutoDeletingConfirmation(interaction.client, `✅ Vacation approved by <@${interaction.user.id}> for <@${freshEntry.discordUserId}>.`);

    const embed = new EmbedBuilder()
      .setDescription(
        `🌴 <@${freshEntry.discordUserId}> is now on **Vacation** (up to 14 days) and can't be challenged until they're back.`,
      )
      .setColor(0x95a5a6);
    await notify.challenges(interaction.client, { embeds: [embed] });

    try {
      const requester = await interaction.client.users.fetch(freshEntry.discordUserId);
      await requester.send({
        content: `✅ Your Vacation request was approved. Use **Return from Vacation** in #register any time within 14 days.`,
      });
    } catch {
      // DMs closed — the public results-channel post above still covers it.
    }
  } else {
    await postAutoDeletingConfirmation(
      interaction.client,
      `✅ Extended Vacation approved by <@${interaction.user.id}> for <@${freshEntry.discordUserId}> (was rank ${freshEntry.rank}).`,
    );

    const embed = new EmbedBuilder()
      .setDescription(
        `🌴 <@${freshEntry.discordUserId}> has entered **Extended Vacation** (up to 30 days) and has been removed from the ladder.`,
      )
      .setColor(0x95a5a6);
    await notify.announcements(interaction.client, { embeds: [embed] });

    try {
      const requester = await interaction.client.users.fetch(freshEntry.discordUserId);
      await requester.send({
        content: `✅ Your Extended Vacation request was approved. Use **Return from Extended Vacation** in #register any time within 30 days, or you'll be fully removed and your season points reset.`,
      });
    } catch {
      // DMs closed
    }

    await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  }
}

async function handleRequestDenyModal(interaction: ModalSubmitInteraction, def: RequestFlowDef): Promise<void> {
  const requestId = interaction.customId.slice(`${def.denyModalPrefix}:`.length);

  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can resolve vacation requests.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const request = await vacationRequestsRepo.getRequestById(requestId);
  if (!request || request.status !== "Pending") {
    await interaction.editReply({ content: "This request has already been resolved." });
    scheduleReplyCleanup(interaction);
    return;
  }

  const reason = interaction.fields.getTextInputValue(DENY_REASON_INPUT_ID);
  const resolution = await enqueueResolution(async () => {
    const fresh = await vacationRequestsRepo.getRequestById(requestId);
    if (!fresh || fresh.status !== "Pending") return { ok: false as const };
    await vacationService.denyVacationRequest(fresh, interaction.user.id, reason);
    return { ok: true as const };
  });

  if (!resolution.ok) {
    await interaction.editReply({ content: "This request has already been resolved." });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.editReply({ content: "Request denied and the requester has been notified." });
  scheduleReplyCleanup(interaction);

  await deleteMessageByUrl(interaction.client, request.leagueManagerMessageUrl);
  await postAutoDeletingConfirmation(interaction.client, `❌ Denied by <@${interaction.user.id}>. Reason: ${reason}`);

  const embed = new EmbedBuilder()
    .setTitle(`Your ${def.label} request was denied`)
    .setDescription(`**Reason:** ${reason}`)
    .setColor(0xe74c3c);

  try {
    const requester = await interaction.client.users.fetch(request.discordUserId);
    await requester.send({ embeds: [embed] });
  } catch {
    await notify.register(interaction.client, { content: `<@${request.discordUserId}>`, embeds: [embed] });
  }
}

export const handleVacationRequestStartButton = (i: ButtonInteraction): Promise<void> => handleRequestStartButton(i, VACATION_REQUEST_DEF);
export const handleVacationRequestSubmitResolve = (i: ButtonInteraction): Promise<void> => handleRequestSubmitResolve(i, VACATION_REQUEST_DEF);
export const handleVacationRequestApproveDenyButton = (i: ButtonInteraction): Promise<void> =>
  handleRequestApproveDenyButton(i, VACATION_REQUEST_DEF);
export const handleVacationRequestDenyModal = (i: ModalSubmitInteraction): Promise<void> => handleRequestDenyModal(i, VACATION_REQUEST_DEF);

export const handleExtendedVacationRequestStartButton = (i: ButtonInteraction): Promise<void> =>
  handleRequestStartButton(i, EXTENDED_VACATION_REQUEST_DEF);
export const handleExtendedVacationRequestSubmitResolve = (i: ButtonInteraction): Promise<void> =>
  handleRequestSubmitResolve(i, EXTENDED_VACATION_REQUEST_DEF);
export const handleExtendedVacationRequestApproveDenyButton = (i: ButtonInteraction): Promise<void> =>
  handleRequestApproveDenyButton(i, EXTENDED_VACATION_REQUEST_DEF);
export const handleExtendedVacationRequestDenyModal = (i: ModalSubmitInteraction): Promise<void> =>
  handleRequestDenyModal(i, EXTENDED_VACATION_REQUEST_DEF);

/* ------------------------------------------------------------------------ */
/* Return from Vacation — self-service, no approval.                        */
/* ------------------------------------------------------------------------ */

export const VACATION_RETURN_CONFIRM_ID = "vacret_confirm";
export const VACATION_RETURN_CANCEL_ID = "vacret_cancel";

export async function handleVacationReturnStartButton(interaction: ButtonInteraction): Promise<void> {
  const entry = await ladderRepo.findEntry(interaction.user.id);
  if (!entry || entry.status !== "Vacation") {
    await interaction.reply({ content: "You're not currently on Vacation.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(VACATION_RETURN_CONFIRM_ID).setLabel("Return from Vacation").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(VACATION_RETURN_CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    content: "Return from Vacation and become **Available** again?",
    components: [row],
    ephemeral: true,
  });
}

export async function handleVacationReturnResolve(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === VACATION_RETURN_CANCEL_ID) {
    await interaction.update({ content: "Cancelled — you're still on Vacation.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const entry = await ladderRepo.findEntry(interaction.user.id);
  if (!entry || entry.status !== "Vacation") {
    await interaction.update({ content: "You're not on Vacation anymore.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.update({ content: "Welcome back…", components: [] });
  await vacationService.returnFromVacation(entry);

  const followUp = await interaction.followUp({
    content: "You're **Available** again — you can challenge or be challenged.",
    ephemeral: true,
  });
  scheduleReplyCleanup(interaction);
  scheduleMessageCleanup(followUp);

  const embed = new EmbedBuilder()
    .setDescription(`✅ <@${entry.discordUserId}> is back from Vacation and **Available** again.`)
    .setColor(0x2ecc71);
  await notify.challenges(interaction.client, { embeds: [embed] });
}

/* ------------------------------------------------------------------------ */
/* Return from Extended Vacation — self-service, no approval; reinserts at  */
/* rankAtEntry + 1 and auto-challenges whoever now holds rankAtEntry.       */
/* ------------------------------------------------------------------------ */

export const EXTENDED_VACATION_RETURN_CONFIRM_ID = "evacret_confirm";
export const EXTENDED_VACATION_RETURN_CANCEL_ID = "evacret_cancel";

export async function handleExtendedVacationReturnStartButton(interaction: ButtonInteraction): Promise<void> {
  const evacRow = await extendedVacationRepo.getEntry(interaction.user.id);
  if (!evacRow) {
    await interaction.reply({ content: "You're not currently on Extended Vacation.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const content =
    `Return from Extended Vacation?\n\n` +
    `You'll rejoin the ladder at **rank ${evacRow.rankAtEntry + 1}** and be automatically put into a challenge against whoever currently ` +
    `holds rank ${evacRow.rankAtEntry} (unless they're already in a match, in which case you'll just settle in at your new rank).`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(EXTENDED_VACATION_RETURN_CONFIRM_ID)
      .setLabel("Return from Extended Vacation")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(EXTENDED_VACATION_RETURN_CANCEL_ID).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({ content, components: [row], ephemeral: true });
}

export async function handleExtendedVacationReturnResolve(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId === EXTENDED_VACATION_RETURN_CANCEL_ID) {
    await interaction.update({ content: "Cancelled — still on Extended Vacation.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const evacRow = await extendedVacationRepo.getEntry(interaction.user.id);
  if (!evacRow) {
    await interaction.update({ content: "You're not on Extended Vacation anymore.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.update({ content: "Welcome back…", components: [] });

  const result = await vacationService.returnFromExtendedVacation(evacRow);

  let channelMention = "";
  if (result.match && result.opponentEntry && interaction.guild) {
    try {
      const channel = await createMatchChannel(interaction.client, interaction.guild, result.match, result.entry, result.opponentEntry);
      channelMention = ` Head to ${channel} to play it out.`;
    } catch (err) {
      console.error(`Failed to create match channel for ${result.match.matchId}:`, err);
    }
  }

  let content = `You're back on the ladder at **rank ${result.entry.rank}**.`;
  content +=
    result.match && result.opponentEntry
      ? ` You've been automatically challenged against **${result.opponentEntry.discordName}** (rank ${result.opponentEntry.rank}) — match \`${result.match.matchId}\`.${channelMention}`
      : " You're free to challenge up or be challenged.";

  const followUp = await interaction.followUp({ content, ephemeral: true });
  scheduleReplyCleanup(interaction);
  scheduleMessageCleanup(followUp);

  const embed = new EmbedBuilder()
    .setDescription(
      `🌴 <@${result.entry.discordUserId}> is back from Extended Vacation at rank ${result.entry.rank}.` +
        (result.match && result.opponentEntry
          ? ` Auto-challenged against <@${result.opponentEntry.discordUserId}> (rank ${result.opponentEntry.rank}).`
          : ""),
    )
    .setColor(0x2ecc71);
  await notify.announcements(interaction.client, { embeds: [embed] });

  if (result.match && result.opponentEntry) {
    const matchEmbed = new EmbedBuilder()
      .setTitle("New challenge")
      .setDescription(
        `⚔️ <@${result.entry.discordUserId}> (rank ${result.entry.rank}) has challenged ` +
          `<@${result.opponentEntry.discordUserId}> (rank ${result.opponentEntry.rank})!\n\n` +
          `Match ID: \`${result.match.matchId}\`${channelMention}`,
      )
      .setColor(0xe67e22);
    await notify.challenges(interaction.client, {
      content: `<@${result.entry.discordUserId}> <@${result.opponentEntry.discordUserId}>`,
      embeds: [matchEmbed],
    });
    await refreshActiveChallengesPanel(interaction.client).catch((err) =>
      console.error("Failed to refresh active challenges panel:", err),
    );
  }

  await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
}
