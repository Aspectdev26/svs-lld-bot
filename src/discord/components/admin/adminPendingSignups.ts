import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type GuildMember,
  type StringSelectMenuInteraction,
} from "discord.js";
import * as signupRequestsRepo from "../../../sheets/signupRequestsRepo.js";
import { isLeagueManager } from "../../permissions.js";
import { buildSignupReviewMessage } from "../registerFlow.js";
import { scheduleReplyCleanup } from "../../ephemeralCleanup.js";
import { formatElement } from "../../../util/formatElement.js";

export const PENDING_SIGNUPS_SELECT_ID = "admin_pending_signup_select";

export async function handlePendingSignupsStart(interaction: ButtonInteraction): Promise<void> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const pending = await signupRequestsRepo.getPendingRequests();
  if (pending.length === 0) {
    await interaction.reply({ content: "No pending sign-up requests.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(PENDING_SIGNUPS_SELECT_ID)
    .setPlaceholder("Choose a pending request to review")
    .addOptions(
      pending.slice(0, 25).map((r) => ({
        label: `${r.characterName} (${formatElement(r.element)}, ${r.build})`,
        description: `Requested by ${r.discordName}`.slice(0, 100),
        value: r.requestId,
      })),
    );

  await interaction.reply({
    content: `**${pending.length} pending request${pending.length === 1 ? "" : "s"}** — select one to review:`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    ephemeral: true,
  });
}

export async function handlePendingSignupSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const requestId = interaction.values[0];
  const request = await signupRequestsRepo.getRequestById(requestId);
  if (!request || request.status !== "Pending") {
    await interaction.update({ content: "That request has already been resolved.", components: [] });
    scheduleReplyCleanup(interaction);
    return;
  }

  const { embed, row } = buildSignupReviewMessage(request);
  await interaction.update({ content: null, embeds: [embed], components: [row] });
}
