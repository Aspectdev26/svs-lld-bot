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

export type BuildWinnerPromptResult =
  | { ok: true; match: MatchRow; row: ActionRowBuilder<StringSelectMenuBuilder> }
  | { ok: false; reason: string };

/**
 * Fetches the match + both participants' character names and builds the "who won?" dropdown,
 * shared by the /report-win slash command and the in-channel Report Win button. `requesterUserId`
 * must be one of the two participants; either side can be picked as the winner (self-report,
 * concede, or correct a mistake).
 */
export async function buildWinnerPrompt(matchId: string, requesterUserId: string): Promise<BuildWinnerPromptResult> {
  const match = await matchesRepo.getMatchById(matchId);
  if (!match || match.status !== "Pending") {
    return { ok: false, reason: "That match isn't currently active." };
  }
  if (![match.challengerUserId, match.defenderUserId].includes(requesterUserId)) {
    return { ok: false, reason: "You're not a participant in that match." };
  }

  const [challengerEntry, defenderEntry] = await Promise.all([
    ladderRepo.findEntry(match.challengerUserId, match.challengerElement),
    ladderRepo.findEntry(match.defenderUserId, match.defenderElement),
  ]);
  const challengerName = challengerEntry?.characterName ?? "Challenger";
  const defenderName = defenderEntry?.characterName ?? "Defender";

  // No option is pre-selected (`default: true`) on purpose: some Discord clients won't fire the
  // interaction when you "pick" an option that's already shown as selected, which made reporting
  // silently fail whenever the winner happened to be whichever side would've been defaulted.
  // Requiring an explicit pick every time sidesteps that.
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${WINNER_SELECT_PREFIX}:${matchId}`)
    .setPlaceholder("Who won?")
    .addOptions(
      {
        label: `${challengerName} (${match.challengerElement})`,
        value: match.challengerUserId,
      },
      {
        label: `${defenderName} (${match.defenderElement})`,
        value: match.defenderUserId,
      },
    );

  return { ok: true, match, row: new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select) };
}

/** Runs matchService.reportWin plus the shared #challenges announcement / channel-close / top10 refresh. */
export async function finalizeReportWin(
  client: Client,
  reporterUserId: string,
  matchId: string,
  winnerUserId: string,
): Promise<ReportWinResult> {
  const result = await matchService.reportWin(reporterUserId, matchId, winnerUserId);
  if (!result.ok) return result;

  const { match, winnerMovedUp, rank1Update } = result;
  let description =
    `🏆 <@${match.winnerUserId}> won the match (\`${match.matchId}\`) between <@${match.challengerUserId}> (${match.challengerElement}) and <@${match.defenderUserId}> (${match.defenderElement}).` +
    (winnerMovedUp ? "\nThe challenger has taken the defender's rank." : "\nNo rank change — the defender held their spot.");

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
