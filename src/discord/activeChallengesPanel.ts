import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { config } from "../config.js";
import * as matchesRepo from "../sheets/matchesRepo.js";
import * as ladderRepo from "../sheets/ladderRepo.js";
import { formatElement } from "../util/formatElement.js";
import type { Element } from "../types.js";

const PANEL_TITLE = "⚔️ Active Challenges";

/**
 * Finds (or creates + pins) the standing "Active Challenges" post in the Issue a Challenge
 * channel and refreshes it with every currently pending match. Safe to call after anything that
 * creates, resolves, expires, cancels, or extends a match, and once at startup — idempotent
 * either way.
 */
export async function refreshActiveChallengesPanel(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.channels.challenges);
  if (!channel || !channel.isTextBased()) {
    console.error(`CHALLENGES_CHANNEL_ID (${config.channels.challenges}) is not a text channel`);
    return;
  }
  const textChannel = channel as TextChannel;

  const [pending, ladder] = await Promise.all([matchesRepo.getPendingMatches(), ladderRepo.getLadder()]);
  const nameFor = (userId: string, element: Element) =>
    ladder.find((r) => r.discordUserId === userId && r.element === element)?.characterName ?? "Unknown";

  const sorted = [...pending].sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));

  const description =
    sorted.length === 0
      ? "No active challenges right now."
      : sorted
          .map((m) => {
            const expiresUnix = Math.floor(Date.parse(m.expiresAt) / 1000);
            return (
              `**${nameFor(m.challengerUserId, m.challengerElement)}** (${formatElement(m.challengerElement)}) vs ` +
              `**${nameFor(m.defenderUserId, m.defenderElement)}** (${formatElement(m.defenderElement)}) — ` +
              `expires <t:${expiresUnix}:R> — \`${m.matchId}\``
            );
          })
          .join("\n");

  const embed = new EmbedBuilder().setTitle(PANEL_TITLE).setDescription(description).setColor(0xe67e22).setTimestamp(new Date());

  const { items: pinned } = await textChannel.messages.fetchPins();
  const existing = pinned.find(
    ({ message: m }) => m.author.id === client.user?.id && m.embeds.some((e) => e.title === PANEL_TITLE),
  )?.message;

  if (existing) {
    await existing.edit({ embeds: [embed] });
    return;
  }

  const sent = await textChannel.send({ embeds: [embed] });
  await sent.pin().catch((err) => console.error("Failed to pin active challenges panel:", err));
}
