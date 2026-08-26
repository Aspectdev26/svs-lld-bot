import { EmbedBuilder, type ButtonInteraction, type GuildMember, type TextChannel } from "discord.js";
import { config } from "../../config.js";
import * as matchesRepo from "../../sheets/matchesRepo.js";
import * as ladderRepo from "../../sheets/ladderRepo.js";
import * as pointsService from "../../domain/pointsService.js";
import { isLeagueManager } from "../permissions.js";
import { notify, postAutoDeletingConfirmation } from "../notify.js";
import { refreshActiveChallengesPanel } from "../activeChallengesPanel.js";
import { scheduleReplyCleanup } from "../ephemeralCleanup.js";

export async function handleExtensionButton(interaction: ButtonInteraction): Promise<void> {
  const [action, matchId] = interaction.customId.split(":");

  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can resolve extension requests.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const match = await matchesRepo.getMatchById(matchId);
  if (!match || match.status !== "Pending" || !match.extensionPending) {
    await interaction.reply({ content: "This extension request is no longer pending.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const matchChannel = match.channelId ? await interaction.client.channels.fetch(match.channelId).catch(() => null) : null;

  // Ack silently before the writes below — sequential Sheets calls can, under load, exceed
  // Discord's 3s interaction deadline given the two reads (+ channel fetch) already made above.
  // We're about to delete this message entirely, so no point updating its buttons first.
  await interaction.deferUpdate();

  if (action === "extend_approve") {
    const newExpiresAt = new Date(Date.parse(match.expiresAt) + config.timing.extensionGrantMs).toISOString();
    await matchesRepo.setExpiresAt(match.sheetRow, newExpiresAt);
    await matchesRepo.setExtensionPending(match.sheetRow, false);
    await matchesRepo.setWarningSentAt(match.sheetRow, ""); // let the scheduler re-warn ahead of the new expiry

    if (match.extensionRequestedByUserId) {
      const requesterElement =
        match.extensionRequestedByUserId === match.challengerUserId ? match.challengerElement : match.defenderElement;
      const requesterEntry = await ladderRepo.findEntry(match.extensionRequestedByUserId, requesterElement);
      if (requesterEntry) {
        await pointsService.recordExtensionRequested(requesterEntry.discordUserId, requesterEntry.discordName);
      }
    }

    await interaction.message.delete().catch(() => undefined);
    await postAutoDeletingConfirmation(interaction.client, `✅ Extension approved by <@${interaction.user.id}>.`);

    const newExpiresUnix = Math.floor(Date.parse(newExpiresAt) / 1000);
    if (matchChannel?.isTextBased()) {
      await (matchChannel as TextChannel).send({
        content: `<@${match.challengerUserId}> <@${match.defenderUserId}>`,
        embeds: [
          new EmbedBuilder()
            .setDescription(`⏳ Extension approved by <@${interaction.user.id}> — new expiry: <t:${newExpiresUnix}:F> (<t:${newExpiresUnix}:R>).`)
            .setColor(0x2ecc71),
        ],
      });
    }
    await notify.challenges(interaction.client, {
      embeds: [
        new EmbedBuilder()
          .setDescription(`⏳ Match \`${match.matchId}\` was granted a 2-day extension by <@${interaction.user.id}>. New expiry: <t:${newExpiresUnix}:R>.`)
          .setColor(0x2ecc71),
      ],
    });
    await refreshActiveChallengesPanel(interaction.client).catch((err) =>
      console.error("Failed to refresh active challenges panel:", err),
    );
    return;
  }

  // Deny
  await matchesRepo.setExtensionPending(match.sheetRow, false);

  await interaction.message.delete().catch(() => undefined);
  await postAutoDeletingConfirmation(interaction.client, `❌ Extension denied by <@${interaction.user.id}>.`);

  if (matchChannel?.isTextBased()) {
    await (matchChannel as TextChannel).send({
      content: `<@${match.challengerUserId}> <@${match.defenderUserId}>`,
      embeds: [
        new EmbedBuilder()
          .setDescription(`❌ Extension request denied by <@${interaction.user.id}>. The original expiry still stands.`)
          .setColor(0xe74c3c),
      ],
    });
  }
}
