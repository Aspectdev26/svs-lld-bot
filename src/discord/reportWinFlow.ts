import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, type Client } from "discord.js";
import * as matchesRepo from "../sheets/matchesRepo.js";
import * as ladderRepo from "../sheets/ladderRepo.js";
import * as matchService from "../domain/matchService.js";
import type { ReportWinResult } from "../domain/matchService.js";
import { notify } from "./notify.js";
import { closeMatchChannel } from "./matchChannels.js";
import { refreshTop10Panel } from "./top10Panel.js";
import { refreshActiveChallengesPanel } from "./activeChallengesPanel.js";
import type { MatchRow } from "../types.js";

export const WINNER_SELECT_PREFIX = "reportwin_winner_select";
/** Same dropdown, but from the NvD Admin dashboard: routed to an admin-checked handler. */
export const ADMIN_WINNER_SELECT_PREFIX = "admin_reportwin_winner";

export type BuildWinnerPromptResult =
  | { ok: true; match: MatchRow; row: ActionRowBuilder<StringSelectMenuBuilder> }
  | { ok: false; reason: string };

/**
 * Fetches the match + both participants' names and builds the "who won?" dropdown,
 * shared by the /report-win slash command and the in-channel Report Win button. `requesterUserId`
 * must be one of the two participants; either side can be picked as the winner (self-report,
 * concede, or correct a mistake). With `asAdmin`, the participant check is skipped (the caller has
 * already checked the NvD Admin role) and the dropdown routes to the admin handler.
 */
export async function buildWinnerPrompt(
  matchId: string,
  requesterUserId: string,
  opts: { asAdmin?: boolean } = {},
): Promise<BuildWinnerPromptResult> {
  const match = await matchesRepo.getMatchById(matchId);
  if (!match || match.status !== "Pending") {
    return { ok: false, reason: "That match isn't currently active." };
  }
  if (!opts.asAdmin && ![match.challengerUserId, match.defenderUserId].includes(requesterUserId)) {
    return { ok: false, reason: "You're not a participant in that match." };
  }

  const [challengerEntry, defenderEntry] = await Promise.all([
    ladderRepo.findEntry(match.challengerUserId),
    ladderRepo.findEntry(match.defenderUserId),
  ]);
  const challengerName = challengerEntry?.discordName ?? "Challenger";
  const defenderName = defenderEntry?.discordName ?? "Defender";

  // No option is pre-selected (`default: true`) on purpose: some Discord clients won't fire the
  // interaction when you "pick" an option that's already shown as selected, which made reporting
  // silently fail whenever the winner happened to be whichever side would've been defaulted.
  // Requiring an explicit pick every time sidesteps that.
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${opts.asAdmin ? ADMIN_WINNER_SELECT_PREFIX : WINNER_SELECT_PREFIX}:${matchId}`)
    .setPlaceholder("Who won?")
    .addOptions(
      { label: `${challengerName} (challenger)`.slice(0, 100), value: match.challengerUserId },
      { label: `${defenderName} (defender)`.slice(0, 100), value: match.defenderUserId },
    );

  return { ok: true, match, row: new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select) };
}

/** Runs matchService.reportWin plus the shared #challenges announcement / channel-close / top10 refresh. */
export async function finalizeReportWin(
  client: Client,
  reporterUserId: string,
  matchId: string,
  winnerUserId: string,
  opts: { asAdmin?: boolean } = {},
): Promise<ReportWinResult> {
  const result = await matchService.reportWin(reporterUserId, matchId, winnerUserId, opts);
  if (!result.ok) return result;

  const { match, winnerMovedUp, rank1Update } = result;
  let description =
    `🏆 <@${match.winnerUserId}> won the match (\`${match.matchId}\`) between <@${match.challengerUserId}> and <@${match.defenderUserId}>.` +
    (winnerMovedUp ? "\nThe challenger has taken the defender's rank." : "\nNo rank change — the defender held their spot.");
  if (opts.asAdmin) description += `\n🛠️ Reported by NvD Admin <@${reporterUserId}>.`;

  if (rank1Update.changed) {
    description +=
      rank1Update.kind === "newChampion"
        ? `\n👑 **${rank1Update.holderName}** is the new Rank 1!`
        : `\n🛡️ **${rank1Update.holderName}** defends Rank 1! (Defend #${rank1Update.defends})`;
  }

  const embed = new EmbedBuilder().setTitle("Match result reported").setDescription(description).setColor(0xf1c40f);
  await notify.challenges(client, { embeds: [embed] });

  await closeMatchChannel(client, match, "Match result reported");
  if (winnerMovedUp) {
    await refreshTop10Panel(client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
  }
  await refreshActiveChallengesPanel(client).catch((err) => console.error("Failed to refresh active challenges panel:", err));

  return result;
}
