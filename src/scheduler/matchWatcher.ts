import { EmbedBuilder, type Client } from "discord.js";
import { config } from "../config.js";
import * as matchesRepo from "../sheets/matchesRepo.js";
import { expireMatch } from "../domain/matchService.js";
import { isLadderPaused } from "../domain/ladderPauseService.js";
import { notify } from "../discord/notify.js";
import { expireMatchChannel } from "../discord/matchChannels.js";
import { refreshActiveChallengesPanel } from "../discord/activeChallengesPanel.js";
import { formatElement } from "../util/formatElement.js";

let running = false;

async function checkMatches(client: Client): Promise<void> {
  if (running) return; // avoid overlapping runs if a previous pass is still working through Sheets API calls
  running = true;
  try {
    if (await isLadderPaused()) return; // active match timers are frozen while the ladder is paused

    const pending = await matchesRepo.getPendingMatches();
    const now = Date.now();

    for (const match of pending) {
      const expiresAtMs = Date.parse(match.expiresAt);
      if (Number.isNaN(expiresAtMs)) continue;

      if (now >= expiresAtMs) {
        await expireMatch(match);
        await expireMatchChannel(client, match);
        const embed = new EmbedBuilder()
          .setTitle("Match expired")
          .setDescription(
            `⌛ The match (\`${match.matchId}\`) between <@${match.challengerUserId}> (${formatElement(match.challengerElement)}) and ` +
              `<@${match.defenderUserId}> (${formatElement(match.defenderElement)}) expired with no result reported. No rank change — both players are free to challenge/be challenged again.`,
          )
          .setColor(0x7f8c8d);
        await notify.challenges(client, { embeds: [embed] });
        await refreshActiveChallengesPanel(client).catch((err) => console.error("Failed to refresh active challenges panel:", err));
        continue;
      }

      const warnAtMs = expiresAtMs - config.timing.matchWarningLeadMs;
      if (!match.warningSentAt && now >= warnAtMs) {
        await matchesRepo.setWarningSentAt(match.sheetRow, new Date().toISOString());
        const embed = new EmbedBuilder()
          .setTitle("Match expiring soon")
          .setDescription(
            `⚠️ Match \`${match.matchId}\` between <@${match.challengerUserId}> (${formatElement(match.challengerElement)}) and ` +
              // Static (:F), not relative (:R) — this post is permanent and never edited or removed once
              // the match resolves, so a live-ticking "expires in 2 hours" would just turn into a
              // forever-climbing "expired 3 weeks ago" for a match that's long since done.
              `<@${match.defenderUserId}> (${formatElement(match.defenderElement)}) expires <t:${Math.floor(expiresAtMs / 1000)}:F>. ` +
              `Play your match and use /report-win, or request a dodge if your opponent hasn't responded.`,
          )
          .setColor(0xf39c12);
        await notify.challenges(client, {
          content: `<@${match.challengerUserId}> <@${match.defenderUserId}>`,
          embeds: [embed],
        });
      }
    }
  } catch (err) {
    console.error("matchWatcher pass failed:", err);
  } finally {
    running = false;
  }
}

export function startMatchWatcher(client: Client): void {
  checkMatches(client);
  setInterval(() => checkMatches(client), config.timing.schedulerIntervalMs);
}
