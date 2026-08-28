import * as ladderRepo from "../sheets/ladderRepo.js";
import * as matchesRepo from "../sheets/matchesRepo.js";
import * as bannedRepo from "../sheets/bannedRepo.js";
import * as seasonStatsRepo from "../sheets/seasonStatsRepo.js";
import * as pointsStore from "./pointsStore.js";
import { ALL_ELEMENTS, type BanScope } from "../sheets/bannedRepo.js";
import { applyManualRank, compactRanks, shuffleRanks, type RankChange } from "./rankingService.js";
import { cancelMatch } from "./matchService.js";
import { syncToCurrentHolder } from "./rank1Tracker.js";
import { sanitizeSheetTitle } from "../util/sanitizeSheetTitle.js";
import { applyLadderFormatting } from "../sheets/ladderFormatting.js";
import type { LadderRow, MatchRow } from "../types.js";

export type ResetLadderEndSeasonResult =
  | { ok: true; changedCount: number; cancelledMatches: MatchRow[]; newSeasonName: string }
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
 * Admin "Reset Ladder (End Season)": backfills the current season's tab with any ladder entries
 * that saw no activity (so it stands as a complete record once writes move on), then creates a
 * brand-new tab titled `newSeasonName` for the upcoming season and points future season-stat
 * writes at it — the just-ended season's tab is left exactly as-is, no copy step needed. Also
 * cancels active matches, shuffles rank order three times, and clears every entry's `dodgeCount`
 * back to 0 (a fresh season means a clean slate for the warning/removal count; `dodgeWins`, like
 * All-Time Stats, is left untouched). Rejects a name that collides with any existing tab without
 * making any changes.
 */
export async function resetLadderEndSeason(newSeasonNameInput: string): Promise<ResetLadderEndSeasonResult> {
  const seasonName = sanitizeSheetTitle(newSeasonNameInput);
  if (await seasonStatsRepo.tabExists(seasonName)) {
    return { ok: false, reason: `A tab named "${seasonName}" already exists — pick a different name.` };
  }

  const pending = await matchesRepo.getPendingMatches();
  for (const match of pending) {
    await cancelMatch(match);
  }

  const ladder = await ladderRepo.getLadder();
  await seasonStatsRepo.backfillInactiveEntries(ladder);
  await seasonStatsRepo.startNewSeason(seasonName);
  await pointsStore.resetForNewSeason(seasonName, new Date().toISOString());

  for (const row of ladder) {
    if (row.dodgeCount > 0) await ladderRepo.setDodgeCount(row.sheetRow, 0);
  }

  const changes = shuffleRepeatedly(ladder);
  await ladderRepo.setRanks(changes);
  if (changes.length > 0) await ladderRepo.sortLadderByRank();

  const updatedLadder = ladder.map((r) => {
    const change = changes.find((c) => c.sheetRow === r.sheetRow);
    return change ? { ...r, rank: change.newRank } : r;
  });
  await syncToCurrentHolder(updatedLadder);
  await applyLadderFormatting().catch((err) => console.error("Failed to reapply Ladder formatting after reset:", err));

  return { ok: true, changedCount: changes.length, cancelledMatches: pending, newSeasonName: seasonName };
}

export interface ShuffleLadderRanksResult {
  changedCount: number;
}

/** Admin "Shuffle Ranks": randomizes rank order only — no season archiving, no match cancellation. */
export async function shuffleLadderRanks(): Promise<ShuffleLadderRanksResult> {
  const ladder = await ladderRepo.getLadder();
  const changes = shuffleRepeatedly(ladder);
  await ladderRepo.setRanks(changes);
  if (changes.length > 0) await ladderRepo.sortLadderByRank();

  const updatedLadder = ladder.map((r) => {
    const change = changes.find((c) => c.sheetRow === r.sheetRow);
    return change ? { ...r, rank: change.newRank } : r;
  });
  await syncToCurrentHolder(updatedLadder);
  await applyLadderFormatting().catch((err) => console.error("Failed to reapply Ladder formatting after shuffle:", err));

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
  await ladderRepo.setRanks(changes);
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
  await ladderRepo.setRanks(changes);
  if (changes.length > 0) await ladderRepo.sortLadderByRank();

  const updatedLadder = ladder.map((r) => {
    const change = changes.find((c) => c.sheetRow === r.sheetRow);
    return change ? { ...r, rank: change.newRank } : r;
  });
  await syncToCurrentHolder(updatedLadder);

  const finalRank = changes.find((c) => c.sheetRow === targetSheetRow)?.newRank ?? target.rank;
  return { entry: { ...target, rank: finalRank }, changedCount: changes.length };
}
