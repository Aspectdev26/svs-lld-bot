import type { ButtonInteraction } from "discord.js";
import { buildLeagueManagerGuideEmbeds } from "../../leagueManagerGuide.js";

/**
 * Shows the consolidated League Manager guide, visible only to whoever clicked it. Deliberately
 * exempt from the standard 5s auto-cleanup — it's multi-embed reference material meant to be
 * read, not a pass/fail confirmation, so it's dismissed manually (Discord's own "Dismiss Message").
 */
export async function handleGuideButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({ embeds: buildLeagueManagerGuideEmbeds(), ephemeral: true });
}
