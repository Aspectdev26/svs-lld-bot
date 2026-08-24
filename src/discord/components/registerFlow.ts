import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { config } from "../../config.js";
import { ELEMENTS, BUILDS } from "../../types.js";
import type { Element, Build } from "../../types.js";
import * as signupRequestsRepo from "../../sheets/signupRequestsRepo.js";
import * as bannedRepo from "../../sheets/bannedRepo.js";
import { createSignupRequest, approveSignup, denySignup } from "../../domain/signupService.js";
import { isLeagueManager } from "../permissions.js";
import { notify, postAutoDeletingConfirmation, deleteMessageByUrl } from "../notify.js";
import { refreshTop10Panel } from "../top10Panel.js";
import type { SignupRequestRow } from "../../types.js";

const ELEMENT_SELECT_ID = "reg_element_select";
const BUILD_SELECT_PREFIX = "reg_build_select";
const NAME_MODAL_PREFIX = "reg_name_modal";
const NAME_INPUT_ID = "character_name";
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

export async function handleRegisterStartButton(interaction: ButtonInteraction): Promise<void> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(ELEMENT_SELECT_ID)
    .setPlaceholder("Choose your element")
    .addOptions(ELEMENTS.map((e) => ({ label: e, value: e })));

  await interaction.reply({
    content: "**Step 1/3 — Element:** which element is this character?",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handleElementSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const element = interaction.values[0] as Element;

  const ban = await bannedRepo.isBanned(interaction.user.id, element);
  if (ban) {
    await interaction.update({
      content: `You're banned from signing up${ban.element === "ALL" ? "" : ` with **${element}**`}${ban.reason ? ` (reason: ${ban.reason})` : ""}.`,
      components: [],
    });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${BUILD_SELECT_PREFIX}:${element}`)
    .setPlaceholder("Choose your build")
    .addOptions(BUILDS.map((b) => ({ label: b, value: b })));

  await interaction.update({
    content: `**Step 2/3 — Build:** element set to **${element}**. Which build?`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

export async function handleBuildSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const element = interaction.customId.slice(`${BUILD_SELECT_PREFIX}:`.length) as Element;
  const build = interaction.values[0] as Build;

  const modal = new ModalBuilder()
    .setCustomId(`${NAME_MODAL_PREFIX}:${element}:${build}`)
    .setTitle("Character name")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(NAME_INPUT_ID)
          .setLabel("What's this character's name?")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32),
      ),
    );
  await interaction.showModal(modal);
}

/** Shared by the auto-post on submission and the admin dashboard's "Pending Sign-ups" recovery view. */
export function buildSignupReviewMessage(request: SignupRequestRow): {
  embed: EmbedBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
} {
  const embed = new EmbedBuilder()
    .setTitle("New signup request")
    .setDescription(
      `**Character:** ${request.characterName}\n**Element:** ${request.element}\n**Build:** ${request.build}\n` +
        `**Requested by:** <@${request.discordUserId}>`,
    )
    .setColor(0x9b59b6);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`reg_approve:${request.requestId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reg_deny:${request.requestId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
  );

  return { embed, row };
}

export async function handleNameModal(interaction: ModalSubmitInteraction): Promise<void> {
  const [, element, build] = interaction.customId.split(":") as [string, Element, Build];
  const characterName = interaction.fields.getTextInputValue(NAME_INPUT_ID).trim();

  if (!characterName) {
    await interaction.reply({ content: "Character name can't be empty — please try again.", ephemeral: true });
    return;
  }

  // Acknowledge immediately — Discord expires the interaction after 3s, and the Sheets calls
  // below (ban check, duplicate checks, the write itself) can exceed that under any latency.
  await interaction.deferReply({ ephemeral: true });

  const discordName =
    interaction.member && "displayName" in interaction.member
      ? (interaction.member.displayName as string)
      : interaction.user.username;

  const result = await createSignupRequest(interaction.user.id, discordName, characterName, element, build);
  if (!result.ok) {
    await interaction.editReply({ content: result.reason });
    return;
  }

  await interaction.editReply({
    content: `Signup request submitted for **${characterName}** (${element}, ${build}) — a League Manager will review it shortly.`,
  });

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
    await interaction.reply({ content: "Only League Managers can resolve signup requests.", ephemeral: true });
    return;
  }

  const request = await signupRequestsRepo.getRequestById(requestId);
  if (!request || request.status !== "Pending") {
    await interaction.reply({ content: "This signup request has already been resolved.", ephemeral: true });
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

  const { entry } = await approveSignup(request, interaction.user.id);

  await deleteMessageByUrl(interaction.client, request.leagueManagerMessageUrl);
  await postAutoDeletingConfirmation(
    interaction.client,
    `✅ Approved by <@${interaction.user.id}>. **${entry.characterName}** is on the ladder!`,
  );

  const embed = new EmbedBuilder()
    .setTitle("🎉 New Challenger Has Entered The Ladder! 🎉")
    .setDescription(
      `**${entry.characterName}** (${entry.element} • ${entry.build}) has joined at **Rank ${entry.rank}**!\n\n*"${randomSaying()}"*`,
    )
    .setColor(0xf1c40f);

  await notify.announcements(interaction.client, {
    content: `<@${entry.discordUserId}>`,
    embeds: [embed],
  });

  try {
    const requester = await interaction.client.users.fetch(entry.discordUserId);
    await requester.send({
      content: `🎉 You've been approved! **${entry.characterName}** (${entry.element}, ${entry.build}) is now on the ladder at rank ${entry.rank}.`,
    });
  } catch {
    // DMs closed — the public #announcements post above already covers it.
  }

  if (entry.rank <= 10) {
    await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  }
}

export async function handleRegisterDenyModal(interaction: ModalSubmitInteraction): Promise<void> {
  const requestId = interaction.customId.slice(`${DENY_MODAL_PREFIX}:`.length);

  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can resolve signup requests.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const request = await signupRequestsRepo.getRequestById(requestId);
  if (!request || request.status !== "Pending") {
    await interaction.editReply({ content: "This signup request has already been resolved." });
    return;
  }

  const reason = interaction.fields.getTextInputValue(DENY_REASON_INPUT_ID);
  await denySignup(request, interaction.user.id, reason);

  await interaction.editReply({ content: "Signup request denied and the requester has been notified." });

  await deleteMessageByUrl(interaction.client, request.leagueManagerMessageUrl);
  await postAutoDeletingConfirmation(interaction.client, `❌ Denied by <@${interaction.user.id}>. Reason: ${reason}`);

  const embed = new EmbedBuilder()
    .setTitle("Your signup request was denied")
    .setDescription(`**Character:** ${request.characterName} (${request.element}, ${request.build})\n**Reason:** ${reason}`)
    .setColor(0xe74c3c);

  try {
    const requester = await interaction.client.users.fetch(request.discordUserId);
    await requester.send({ embeds: [embed] });
  } catch {
    await notify.register(interaction.client, { content: `<@${request.discordUserId}>`, embeds: [embed] });
  }
}
