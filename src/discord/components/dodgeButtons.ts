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
import { resolveDodge } from "../../domain/dodgeService.js";
import { isLeagueManager } from "../permissions.js";
import { notify, postAutoDeletingConfirmation, deleteMessageByUrl } from "../notify.js";
import { closeMatchChannel } from "../matchChannels.js";
import { refreshTop10Panel } from "../top10Panel.js";
import { refreshActiveChallengesPanel } from "../activeChallengesPanel.js";

export const DENY_MODAL_PREFIX = "dodge_deny_modal";
export const DENY_REASON_INPUT_ID = "deny_reason";

export async function handleDodgeButton(interaction: ButtonInteraction): Promise<void> {
  const [action, dodgeId] = interaction.customId.split(":");

  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can resolve dodge requests.", ephemeral: true });
    return;
  }

  const dodge = await dodgesRepo.getDodgeById(dodgeId);
  if (!dodge || dodge.status !== "Pending") {
    await interaction.reply({ content: "This dodge request has already been resolved.", ephemeral: true });
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
    return;
  }

  // Ack silently before applyDodgeWin/resolveDodge — several sequential Sheets writes, easily
  // slow enough under load to blow past Discord's 3s interaction deadline given the two reads
  // already above. We're about to delete this message entirely, so no point updating it first.
  await interaction.deferUpdate();

  const rank1Update = await matchService.applyDodgeWin(match);
  await resolveDodge(dodge, interaction.user.id, true);

  await deleteMessageByUrl(interaction.client, dodge.leagueManagerMessageUrl);
  await postAutoDeletingConfirmation(
    interaction.client,
    `✅ Dodge approved by <@${interaction.user.id}>. <@${match.challengerUserId}> has taken the rank.`,
  );

  let description = `🏳️ <@${match.defenderUserId}> did not respond in time — <@${match.challengerUserId}> (${match.challengerElement}) has been awarded the win and taken their rank (match \`${match.matchId}\`).`;
  if (rank1Update.changed && rank1Update.kind === "newChampion") {
    description += `\n👑 **${rank1Update.holderName}** is the new Rank 1!`;
  }

  const embed = new EmbedBuilder().setTitle("Dodge approved").setDescription(description).setColor(0x9b59b6);
  await notify.challenges(interaction.client, {
    content: `<@${match.challengerUserId}> <@${match.defenderUserId}>`,
    embeds: [embed],
  });

  await closeMatchChannel(interaction.client, match, "Dodge approved");
  await refreshTop10Panel(interaction.client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  await refreshActiveChallengesPanel(interaction.client).catch((err) =>
    console.error("Failed to refresh active challenges panel:", err),
  );
}
