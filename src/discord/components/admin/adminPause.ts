import { EmbedBuilder, type ButtonInteraction, type GuildMember } from "discord.js";
import { isLeagueManager } from "../../permissions.js";
import { isLadderPaused, pauseLadder, resumeLadder } from "../../../domain/ladderPauseService.js";
import { notify } from "../../notify.js";
import { refreshActiveChallengesPanel } from "../../activeChallengesPanel.js";
import { scheduleReplyCleanup } from "../../ephemeralCleanup.js";

async function requireLeagueManager(interaction: ButtonInteraction): Promise<boolean> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return false;
  }
  return true;
}

/** Toggles the ladder paused/resumed. Pausing blocks new challenges and freezes active match timers. */
export async function handlePauseToggle(interaction: ButtonInteraction): Promise<void> {
  if (!(await requireLeagueManager(interaction))) return;

  const paused = await isLadderPaused();

  if (!paused) {
    const result = await pauseLadder();
    if (!result.ok) {
      await interaction.reply({ content: result.reason, ephemeral: true });
      scheduleReplyCleanup(interaction);
      return;
    }
    await interaction.reply({
      content: "⏸️ Ladder paused — new challenges are blocked and active match timers are frozen until you resume.",
      ephemeral: true,
    });
    scheduleReplyCleanup(interaction);

    const embed = new EmbedBuilder()
      .setDescription(
        `⏸️ <@${interaction.user.id}> **paused** the ladder — no new challenges can be issued and active match timers are frozen until it's resumed.`,
      )
      .setColor(0x95a5a6);
    await notify.challenges(interaction.client, { embeds: [embed] });
    return;
  }

  const result = await resumeLadder();
  if (!result.ok) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  await interaction.reply({
    content: `▶️ Ladder resumed — ${result.shiftedMatchCount} active match timer(s) shifted forward by the paused duration.`,
    ephemeral: true,
  });
  scheduleReplyCleanup(interaction);

  const embed = new EmbedBuilder()
    .setDescription(`▶️ <@${interaction.user.id}> **resumed** the ladder — challenges can be issued again.`)
    .setColor(0x2ecc71);
  await notify.challenges(interaction.client, { embeds: [embed] });
  await refreshActiveChallengesPanel(interaction.client).catch((err) =>
    console.error("Failed to refresh active challenges panel:", err),
  );
}
