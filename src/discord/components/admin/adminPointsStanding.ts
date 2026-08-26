import { EmbedBuilder, type ButtonInteraction, type GuildMember } from "discord.js";
import * as pointsStore from "../../../domain/pointsStore.js";
import { isLeagueManager } from "../../permissions.js";
import { scheduleReplyCleanup } from "../../ephemeralCleanup.js";

/** League-Manager-only: this season's private activity-points standings. Never shown to players. */
export async function handlePointsStandingButton(interaction: ButtonInteraction): Promise<void> {
  if (!isLeagueManager(interaction.member as GuildMember | null)) {
    await interaction.reply({ content: "Only League Managers can do that.", ephemeral: true });
    scheduleReplyCleanup(interaction);
    return;
  }

  const standings = await pointsStore.getStandings();
  const description =
    standings.length === 0
      ? "No activity recorded yet this season."
      : standings
          .map((s, i) => `${i + 1}. **${s.discordName}** — ${s.points}`)
          .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Points Standing (this season)")
    .setDescription(description)
    .setColor(0x992d22);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}
