import type { ButtonInteraction, EmbedBuilder } from "discord.js";
import { buildLeagueManagerGuideEmbeds } from "../../leagueManagerGuide.js";

/** Discord rejects a message whose embeds total more than 6000 characters — leave a little headroom. */
const MAX_EMBED_CHARS_PER_MESSAGE = 5800;

function embedLength(embed: EmbedBuilder): number {
  const d = embed.data;
  return (
    (d.title?.length ?? 0) +
    (d.description?.length ?? 0) +
    (d.footer?.text.length ?? 0) +
    (d.author?.name.length ?? 0) +
    (d.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0)
  );
}

/** Packs embeds into as few messages as possible without any one message exceeding Discord's size limit. */
function chunkEmbeds(embeds: EmbedBuilder[]): EmbedBuilder[][] {
  const chunks: EmbedBuilder[][] = [];
  let current: EmbedBuilder[] = [];
  let currentLength = 0;
  for (const embed of embeds) {
    const length = embedLength(embed);
    if (current.length > 0 && (currentLength + length > MAX_EMBED_CHARS_PER_MESSAGE || current.length === 10)) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(embed);
    currentLength += length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Shows the consolidated NvD Admin guide, visible only to whoever clicked it. Deliberately
 * exempt from the standard 5s auto-cleanup — it's multi-embed reference material meant to be
 * read, not a pass/fail confirmation, so it's dismissed manually (Discord's own "Dismiss Message").
 * Split across follow-ups when the full guide is too long for one message.
 */
export async function handleGuideButton(interaction: ButtonInteraction): Promise<void> {
  const [first, ...rest] = chunkEmbeds(buildLeagueManagerGuideEmbeds());
  await interaction.reply({ embeds: first, ephemeral: true });
  for (const chunk of rest) {
    await interaction.followUp({ embeds: chunk, ephemeral: true });
  }
}
