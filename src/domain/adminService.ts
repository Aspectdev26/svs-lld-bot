import * as ladderRepo from "../sheets/ladderRepo.js";
import * as matchesRepo from "../sheets/matchesRepo.js";
import * as bannedRepo from "../sheets/bannedRepo.js";
import * as seasonStatsRepo from "../sheets/seasonStatsRepo.js";
import { ALL_ELEMENTS, type BanScope } from "../sheets/bannedRepo.js";
import { applyManualRank, compactRanks, shuffleRanks, type RankChange } from "./rankingService.js";
import { cancelMatch } from "./matchService.js";
import { syncToCurrentHolder } from "./rank1Tracker.js";
import { sanitizeSheetTitle } from "../util/sanitizeSheetTitle.js";
import type { LadderRow, MatchRow } from "../types.js";

export type ResetLadderEndSeasonResult =
  | { ok: true; changedCount: number; cancelledMatches: MatchRow[]; seasonName: string }
  | { ok: false; reason: string };

const SHUFFLE_PASSES = 3;

/** Applies `shuffleRanks` three times in a row, each pass reshuffling the previous pass's order, and returns the net rank changes vs. the original ladder. */
function shuffleRepeatedly(ladder: LadderRow[]): RankChange[] {
  let current = ladder;
  for (let i = 0; i < SHUFFLE_PASSES; i++) {
    const changes = shuffleRanks(current);
    if (changes.length === 0) continue;
    current = current.map((r) => {
      const change = changes.find((c) => c.sheetRow === r.sheetRow);
      return change ? { ...r, rank: change.newRank } : r;
    });
  }

  const originalRanks = new Map(ladder.map((r) => [r.sheetRow, r.rank]));
  return current
    .filter((r) => originalRanks.get(r.sheetRow) !== r.rank)
    .map((r) => ({ sheetRow: r.sheetRow, newRank: r.rank }));
}

/**
 * Snapshots the current season's SeasonStats (plus every ladder entry with no recorded activity,
 * so historically-active-but-quiet characters still show up at 0/0/0) into a tab titled
 * `seasonName`, then wipes SeasonStats for the next season.
 */
async function archiveAndResetSeason(ladder: LadderRow[], seasonName: string): Promise<void> {
  const seasonStats = await seasonStatsRepo.getAllRows();

  const statKeys = new Set(seasonStats.map((r) => `${r.discordUserId}:${r.element}`));
  const inactiveEntries = ladder.filter((entry) => !statKeys.has(`${entry.discordUserId}:${entry.element}`));

  const archiveRows = [
    ...seasonStats.map(({ sheetRow, ...row }) => row),
    ...inactiveEntries.map((entry) => ({
      discordUserId: entry.discordUserId,
      discordName: entry.discordName,
      characterName: entry.characterName,
      element: entry.element,
      build: entry.build,
      defends: 0,
      wins: 0,
      losses: 0,
    })),
  ];

  await seasonStatsRepo.archiveSeason(seasonName, archiveRows);
  await seasonStatsRepo.clearAll();
}

/**
 * Admin "Reset Ladder (End Season)": archives + resets season stats under an admin-chosen name,
 * cancels active matches, then shuffles rank order three times. Rejects a name that collides with
 * an already-archived season tab without making any changes.
 */
export async function resetLadderEndSeason(seasonNameInput: string): Promise<ResetLadderEndSeasonResult> {
  const seasonName = sanitizeSheetTitle(seasonNameInput);
  if (await seasonStatsRepo.archiveTabExists(seasonName)) {
    return { ok: false, reason: `A season named "${seasonName}" has already been archived — pick a different name.` };
  }

  const pending = await matchesRepo.getPendingMatches();
  for (const match of pending) {
    await cancelMatch(match);
  }

  const ladder = await ladderRepo.getLadder();
  await archiveAndResetSeason(ladder, seasonName);

  const changes = shuffleRepeatedly(ladder);
  for (const change of changes) {
    await ladderRepo.setRank(change.sheetRow, change.newRank);
  }
  if (changes.length > 0) await ladderRepo.sortLadderByRank();

  const updatedLadder = ladder.map((r) => {
    const change = changes.find((c) => c.sheetRow === r.sheetRow);
    return change ? { ...r, rank: change.newRank } : r;
  });
  await syncToCurrentHolder(updatedLadder);

  return { ok: true, changedCount: changes.length, cancelledMatches: pending, seasonName };
}

export interface ShuffleLadderRanksResult {
  changedCount: number;
}

/** Admin "Shuffle Ranks": randomizes rank order only — no season archiving, no match cancellation. */
export async function shuffleLadderRanks(): Promise<ShuffleLadderRanksResult> {
  const ladder = await ladderRepo.getLadder();
  const changes = shuffleRepeatedly(ladder);
  for (const change of changes) {
    await ladderRepo.setRank(change.sheetRow, change.newRank);
  }
  if (changes.length > 0) await ladderRepo.sortLadderByRank();

  const updatedLadder = ladder.map((r) => {
    const change = changes.find((c) => c.sheetRow === r.sheetRow);
    return change ? { ...r, rank: change.newRank } : r;
  });
  await syncToCurrentHolder(updatedLadder);

  return { changedCount: changes.length };
}

export interface RemoveResult {
  removedEntries: LadderRow[];
  cancelledMatches: MatchRow[];
}

/** Removes one or all of a player's ladder entries, cancels any of their pending matches, and compacts ranks. */
export async function removePlayer(discordUserId: string, scope: BanScope): Promise<RemoveResult> {
  const playerRows = await ladderRepo.getPlayerRows(discordUserId);
  const toRemove = scope === ALL_ELEMENTS ? playerRows : playerRows.filter((r) => r.element === scope);
  if (toRemove.length === 0) return { removedEntries: [], cancelledMatches: [] };

  const cancelledMatches: MatchRow[] = [];
  for (const entry of toRemove) {
    const pending = await matchesRepo.getPendingMatchForEntry(entry.discordUserId, entry.element);
    if (pending) {
      await cancelMatch(pending);
      cancelledMatches.push(pending);
    }
    await ladderRepo.clearRow(entry.sheetRow);
  }

  const remainingLadder = (await ladderRepo.getLadder()).filter(
    (r) => !toRemove.some((removed) => removed.sheetRow === r.sheetRow),
  );
  const changes = compactRanks(remainingLadder);
  for (const change of changes) {
    await ladderRepo.setRank(change.sheetRow, change.newRank);
  }
  // Always sort, even with no rank changes — clearRow above can leave a blank gap mid-sheet,
  // and sorting moves blanks to the end.
  await ladderRepo.sortLadderByRank();

  const wasRank1 = toRemove.some((r) => r.rank === 1);
  if (wasRank1) {
    const updatedLadder = remainingLadder.map((r) => {
      const change = changes.find((c) => c.sheetRow === r.sheetRow);
      return change ? { ...r, rank: change.newRank } : r;
    });
    await syncToCurrentHolder(updatedLadder);
  }

  return { removedEntries: toRemove, cancelledMatches };
}

export interface BanResult extends RemoveResult {}

export async function banPlayer(
  discordUserId: string,
  discordName: string,
  scope: BanScope,
  reason: string,
  bannedByUserId: string,
): Promise<BanResult> {
  await bannedRepo.addBan({
    discordUserId,
    discordName,
    element: scope,
    reason,
    bannedAt: new Date().toISOString(),
    bannedByUserId,
  });
  return removePlayer(discordUserId, scope);
}

export async function unban(banSheetRow: number): Promise<void> {
  await bannedRepo.clearBan(banSheetRow);
}

/** Admin override: voids an active match with no rank change (for disputes/mistakes). */
export async function forceCancelMatch(matchId: string): Promise<MatchRow | undefined> {
  const match = await matchesRepo.getMatchById(matchId);
  if (!match || match.status !== "Pending") return undefined;
  await cancelMatch(match);
  return match;
}

export interface SetRankResult {
  entry: LadderRow;
  changedCount: number;
}

/** Admin override: moves one entry to an exact rank, shifting others out of the way. */
export async function setManualRank(targetSheetRow: number, desiredRank: number): Promise<SetRankResult | undefined> {
  const ladder = await ladderRepo.getLadder();
  const target = ladder.find((r) => r.sheetRow === targetSheetRow);
  if (!target) return undefined;

  const changes = applyManualRank(ladder, targetSheetRow, desiredRank);
  for (const change of changes) {
    await ladderRepo.setRank(change.sheetRow, change.newRank);
  }
  if (changes.length > 0) await ladderRepo.sortLadderByRank();

  const updatedLadder = ladder.map((r) => {
    const change = changes.find((c) => c.sheetRow === r.sheetRow);
    return change ? { ...r, rank: change.newRank } : r;
  });
  await syncToCurrentHolder(updatedLadder);

  const finalRank = changes.find((c) => c.sheetRow === targetSheetRow)?.newRank ?? target.rank;
  return { entry: { ...target, rank: finalRank }, changedCount: changes.length };
}
