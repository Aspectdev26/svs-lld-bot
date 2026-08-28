import * as rank1Repo from "../sheets/rank1Repo.js";
import * as seasonStatsRepo from "../sheets/seasonStatsRepo.js";
import type { LadderRow } from "../types.js";

export type Rank1Update =
  | { changed: false }
  | { changed: true; kind: "defended"; holderName: string; defends: number }
  | { changed: true; kind: "newChampion"; holderName: string };

/**
 * Call after a match resolves (reported win or approved dodge, including dodges) to keep the
 * win/loss/defend stats in sync — both the current-season tally and the permanent all-time tally.
 * `preMatchDefenderRank` must be the defender's rank *before* any swap was applied — title-defense
 * tracking only kicks in for matches involving the rank-1 holder as defender (a challenger can
 * never already be rank 1, since you can only challenge players ranked above you); win/loss
 * tracking applies to every match regardless of rank.
 */
export async function recordMatchResult(
  preMatchDefenderRank: number,
  defenderEntry: LadderRow,
  challengerEntry: LadderRow,
  winnerIsChallenger: boolean,
): Promise<Rank1Update> {
  const winnerEntry = winnerIsChallenger ? challengerEntry : defenderEntry;
  const loserEntry = winnerIsChallenger ? defenderEntry : challengerEntry;

  // Winner and loser are always different rows, so it's safe for recordWin/recordLoss below to
  // share one read of each sheet instead of each independently re-fetching the whole thing.
  const [rank1Rows, seasonCache] = await Promise.all([rank1Repo.getAllRows(), seasonStatsRepo.loadCache()]);
  await Promise.all([
    rank1Repo.recordWin(winnerEntry, rank1Rows),
    rank1Repo.recordLoss(loserEntry, rank1Rows),
    seasonStatsRepo.recordWin(winnerEntry, seasonCache),
    seasonStatsRepo.recordLoss(loserEntry, seasonCache),
  ]);

  if (preMatchDefenderRank !== 1) return { changed: false };

  if (winnerIsChallenger) {
    await rank1Repo.crownHolder(challengerEntry);
    return { changed: true, kind: "newChampion", holderName: challengerEntry.characterName };
  }

  const [defends] = await Promise.all([rank1Repo.recordDefend(defenderEntry), seasonStatsRepo.recordDefend(defenderEntry)]);
  return { changed: true, kind: "defended", holderName: defenderEntry.characterName, defends };
}

/**
 * Records a permanent, never-reset dodge against `defenderEntry` on the All Time Stats tab — call
 * once per approved dodge, alongside the Ladder's own resettable `dodgeCount`. Returns the new
 * all-time total.
 */
export async function recordDodgeAgainst(defenderEntry: LadderRow): Promise<number> {
  return rank1Repo.recordDodgeAgainst(defenderEntry);
}

/**
 * Reconciles the All Time Stats tracker to whoever now actually sits at rank 1 on `ladder` — for
 * rank shakeups that didn't go through a reported match (admin overrides, a player leaving the
 * ladder outright). Leaves the holder's defend total alone if they didn't change; crowns (or
 * re-crowns) whoever now holds rank 1 otherwise.
 */
export async function syncToCurrentHolder(ladder: LadderRow[]): Promise<void> {
  const newHolder = ladder.find((r) => r.rank === 1);
  if (!newHolder) return;
  const current = await rank1Repo.getCurrentHolderRow();
  if (current && current.discordUserId === newHolder.discordUserId && current.element === newHolder.element) {
    return; // same holder as before — leave their defend total alone
  }
  await rank1Repo.crownHolder(newHolder);
}
