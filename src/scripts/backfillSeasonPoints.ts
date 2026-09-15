/**
 * One-time script: replays every match created since the current season started into the local
 * points store, so the season doesn't start with a blank slate just because the points system
 * shipped mid-season. Not wired into bot startup — run manually once via:
 *   npx tsx src/scripts/backfillSeasonPoints.ts
 *
 * Extension penalties are NOT backfilled: the bot never recorded who requested a past extension
 * (only a transient "pending" flag cleared on resolution), so there's no reliable way to attribute
 * it to the right person. Going forward, ExtensionRequestedBy is recorded and used live.
 */
import "dotenv/config";
import * as matchesRepo from "../sheets/matchesRepo.js";
import * as ladderRepo from "../sheets/ladderRepo.js";
import * as settingsRepo from "../sheets/settingsRepo.js";
import * as pointsStore from "../domain/pointsStore.js";
import * as pointsService from "../domain/pointsService.js";
import * as seasonStatsRepo from "../sheets/seasonStatsRepo.js";
import { SEASON_STATS_SHEET } from "../sheets/seasonStatsRepo.js";
import type { LadderRow } from "../types.js";

/** 9:00 PM America/New_York, 2026-08-25 — when the current season started, per the League Manager. */
const SEASON_START_ISO = "2026-08-26T01:00:00.000Z";

async function main(): Promise<void> {
  const settings = await settingsRepo.getSettings();
  const seasonName = settings.currentSeasonName || SEASON_STATS_SHEET;

  await pointsStore.resetForNewSeason(seasonName, SEASON_START_ISO);

  const ladder = await ladderRepo.getLadder();
  const entryFor = (userId: string, element: string): LadderRow | undefined =>
    ladder.find((r) => r.discordUserId === userId && r.element === element);

  const all = await matchesRepo.getAllMatches();
  const seasonMatches = all
    .filter((m) => Date.parse(m.createdAt) >= Date.parse(SEASON_START_ISO))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  console.log(`Replaying ${seasonMatches.length} match(es) created since ${SEASON_START_ISO}...`);

  for (const match of seasonMatches) {
    const challengerEntry = entryFor(match.challengerUserId, match.challengerElement);
    const defenderEntry = entryFor(match.defenderUserId, match.defenderElement);

    // Awarded at creation time regardless of eventual outcome, matching how it's awarded live.
    if (challengerEntry) {
      await pointsService.recordChallengeIssued(challengerEntry.discordUserId, challengerEntry.discordName, match.createdAt);
    }

    if (match.status === "Reported" && challengerEntry && defenderEntry) {
      await pointsService.recordMatchCompleted(challengerEntry.discordUserId, challengerEntry.discordName, match.createdAt, match.resolvedAt);
      await pointsService.recordMatchCompleted(defenderEntry.discordUserId, defenderEntry.discordName, match.createdAt, match.resolvedAt);
    } else if (match.status === "DodgeApproved" && defenderEntry) {
      await pointsService.recordDodgeAgainst(defenderEntry.discordUserId, defenderEntry.discordName);
    } else if (match.status === "Expired" && challengerEntry) {
      await pointsService.recordMatchExpired(challengerEntry.discordUserId, challengerEntry.discordName);
    }
    // Cancelled / Pending: no points either way.
  }

  // Defends aren't derivable from a replay - the Matches sheet doesn't record what rank the
  // defender held at match time, and the live ladder's current ranks don't reflect that either.
  // The SeasonStats tab's own `Defends` column was already tallied correctly in real time (via
  // rank1Tracker), so it's the authoritative source for this one - award it directly per character.
  const seasonStats = await seasonStatsRepo.getAllRows();
  for (const stat of seasonStats) {
    for (let i = 0; i < stat.defends; i++) {
      await pointsService.recordDefend(stat.discordUserId, stat.discordName);
    }
  }

  const standings = await pointsStore.getStandings();
  console.log("\nFinal standings:");
  for (const [i, s] of standings.entries()) {
    console.log(`${i + 1}. ${s.discordName} — ${s.points}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
