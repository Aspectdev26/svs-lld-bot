import { EmbedBuilder, type ModalSubmitInteraction, type GuildMember } from "discord.js";
import * as dodgesRepo from "../../sheets/dodgesRepo.js";
import { resolveDodge } from "../../domain/dodgeService.js";
import { isLeagueManager } from "../permissions.js";
import { notify, postAutoDeletingConfirmation, deleteMessageByUrl } from "../notify.js";
import { DENY_MODAL_PREFIX, DENY_REASON_INPUT_ID } from "./dodgeButtons.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";

export async function handleDodgeDenyModal(interaction: ModalSubmitInteraction): Promise<void> {
  const dodgeId = interaction.customId.slice(`${DENY_MODAL_PREFIX}:`.length);

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

  const reason = interaction.fields.getTextInputValue(DENY_REASON_INPUT_ID);
  await resolveDodge(dodge, interaction.user.id, false, reason);

  await interaction.reply({ content: "Dodge request denied and the requester has been notified.", ephemeral: true });
  scheduleReplyCleanup(interaction);

  await deleteMessageByUrl(interaction.client, dodge.leagueManagerMessageUrl);
  await postAutoDeletingConfirmation(interaction.client, `❌ Dodge denied by <@${interaction.user.id}>. Reason: ${reason}`);

  const embed = new EmbedBuilder()
    .setTitle("Your dodge request was denied")
    .setDescription(`**Reason:** ${reason}`)
    .setColor(0xe74c3c);

  try {
    const requester = await interaction.client.users.fetch(dodge.requestedByUserId);
    await requester.send({ embeds: [embed] });
  } catch {
    await notify.challenges(interaction.client, { content: `<@${dodge.requestedByUserId}>`, embeds: [embed] });
  }
}
