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
import { config } from "../../config.js";
import * as signupRequestsRepo from "../../sheets/signupRequestsRepo.js";
import { createSignupRequest, approveSignup, denySignup } from "../../domain/signupService.js";
import { isLeagueManager } from "../permissions.js";
import { notify, postAutoDeletingConfirmation, deleteMessageByUrl } from "../notify.js";
import { refreshTop10Panel } from "../top10Panel.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";
import type { SignupRequestRow } from "../../types.js";

export const DENY_MODAL_PREFIX = "reg_deny_modal";
const DENY_REASON_INPUT_ID = "reg_deny_reason";

const JOIN_SAYINGS = [
  "Time to start climbing!",
  "Let the ascent begin!",
  "Fresh blood on the ladder!",
  "The climb starts now!",
  "Another challenger rises!",
  "Onward and upward!",
];

function randomSaying(): string {
  return JOIN_SAYINGS[Math.floor(Math.random() * JOIN_SAYINGS.length)];
}

/** Shared by the auto-post on submission and the admin dashboard's "Pending Sign-ups" recovery view. */
export function buildSignupReviewMessage(request: SignupRequestRow): {
  embed: EmbedBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
} {
  const embed = new EmbedBuilder()
    .setTitle("New signup request")
    .setDescription(`**Player:** <@${request.discordUserId}> (${request.discordName})`)
    .setColor(0x9b59b6);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`reg_approve:${request.requestId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reg_deny:${request.requestId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
  );

  return { embed, row };
}

/** One click — the signup request is just the player's Discord name, no choices to make. */
export async function handleRegisterStartButton(interaction: ButtonInteraction): Promise<void> {
  // Acknowledge immediately — Discord expires the interaction after 3s, and the Sheets calls
  // below (ban check, duplicate checks, the write itself) can exceed that under any latency.
  await interaction.deferReply({ ephemeral: true });

  const discordName =
    interaction.member && "displayName" in interaction.member
      ? (interaction.member.displayName as string)
      : interaction.user.username;

  const result = await createSignupRequest(interaction.user.id, discordName);
  if (!result.ok) {
    await interaction.editReply({ content: result.reason });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.editReply({
    content: "Signup request submitted — an NvD Admin will review it shortly.",
  });
  scheduleReplyCleanup(interaction);

  const { request } = result;
  const leagueManagerRole = interaction.guild?.roles.cache.find((r) => r.name === config.leagueManagerRoleName);
  const { embed, row } = buildSignupReviewMessage(request);

  const sent = await notify.leagueManagers(interaction.client, {
    content: leagueManagerRole ? `${leagueManagerRole}` : undefined,
    embeds: [embed],
    components: [row],
    allowedMentions: leagueManagerRole ? { roles: [leagueManagerRole.id] } : undefined,
  });

  request.leagueManagerMessageUrl = sent.url;
  await signupRequestsRepo.updateRequest(request);
}

export async function handleRegisterApproveDenyButton(interaction: ButtonInteraction): Promise<void> {
  const [action, requestId] = interaction.customId.split(":");

  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only NvD Admins can resolve signup requests.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const request = await signupRequestsRepo.getRequestById(requestId);
  if (!request || request.status !== "Pending") {
    await interaction.reply({ content: "This signup request has already been resolved.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  if (action === "reg_deny") {
    const modal = new ModalBuilder()
      .setCustomId(`${DENY_MODAL_PREFIX}:${requestId}`)
      .setTitle("Deny signup request")
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

  // Ack silently before the (multi-write) approveSignup call, which can take long enough under
  // load to blow past Discord's 3s interaction deadline — we're about to delete this message
  // entirely, so there's no point updating its buttons first.
  await interaction.deferUpdate();

  const result = await approveSignup(requestId, interaction.user.id);
  if (!result.ok) {
    await deleteMessageByUrl(interaction.client, request.leagueManagerMessageUrl);
    await postAutoDeletingConfirmation(
      interaction.client,
      "This signup request was already resolved by another NvD Admin.",
    );
    return;
  }
  const { entry } = result;

  await deleteMessageByUrl(interaction.client, request.leagueManagerMessageUrl);
  await postAutoDeletingConfirmation(
    interaction.client,
    `✅ Approved by <@${interaction.user.id}>. <@${entry.discordUserId}> is on the ladder!`,
  );

  const embed = new EmbedBuilder()
    .setTitle("🎉 New Challenger Has Entered The Ladder! 🎉")
    .setDescription(
      `<@${entry.discordUserId}> has joined at **Rank ${entry.rank}**!\n\n*"${randomSaying()}"*`,
    )
    .setColor(0xf1c40f);

  await notify.challenges(interaction.client, {
    content: `<@${entry.discordUserId}>`,
    embeds: [embed],
  });

  try {
    const requester = await interaction.client.users.fetch(entry.discordUserId);
    await requester.send({
      content: `🎉 You've been approved! You're now on the ladder at rank ${entry.rank}.`,
    });
  } catch {
    // DMs closed — the public results-channel post above already covers it.
  }

  if (entry.rank <= 10) {
    await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  }
}

export async function handleRegisterDenyModal(interaction: ModalSubmitInteraction): Promise<void> {
  const requestId = interaction.customId.slice(`${DENY_MODAL_PREFIX}:`.length);

  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only NvD Admins can resolve signup requests.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const request = await signupRequestsRepo.getRequestById(requestId);
  if (!request || request.status !== "Pending") {
    await interaction.editReply({ content: "This signup request has already been resolved." });
    scheduleReplyCleanup(interaction);
    return;
  }

  const reason = interaction.fields.getTextInputValue(DENY_REASON_INPUT_ID);
  const result = await denySignup(requestId, interaction.user.id, reason);
  if (!result.ok) {
    await interaction.editReply({ content: "This signup request has already been resolved." });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.editReply({ content: "Signup request denied and the requester has been notified." });
  scheduleReplyCleanup(interaction);

  await deleteMessageByUrl(interaction.client, request.leagueManagerMessageUrl);
  await postAutoDeletingConfirmation(interaction.client, `❌ Denied by <@${interaction.user.id}>. Reason: ${reason}`);

  const embed = new EmbedBuilder()
    .setTitle("Your signup request was denied")
    .setDescription(`**Reason:** ${reason}`)
    .setColor(0xe74c3c);

  try {
    const requester = await interaction.client.users.fetch(request.discordUserId);
    await requester.send({ embeds: [embed] });
  } catch {
    await notify.register(interaction.client, { content: `<@${request.discordUserId}>`, embeds: [embed] });
  }
}
