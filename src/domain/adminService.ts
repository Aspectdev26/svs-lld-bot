import * as ladderRepo from "../sheets/ladderRepo.js";
import * as matchesRepo from "../sheets/matchesRepo.js";
import * as rank1Repo from "../sheets/rank1Repo.js";
import * as bannedRepo from "../sheets/bannedRepo.js";
import { ALL_ELEMENTS, type BanScope } from "../sheets/bannedRepo.js";
import { applyManualRank, compactRanks, shuffleRanks } from "./rankingService.js";
import { cancelMatch } from "./matchService.js";
import type { LadderRow, MatchRow } from "../types.js";

/** After any admin rank shakeup, keep Rank1Defends pointed at whoever now actually holds rank 1. */
async function syncRank1TrackerToCurrentHolder(ladder: LadderRow[]): Promise<void> {
  const newHolder = ladder.find((r) => r.rank === 1);
  if (!newHolder) return;
  const current = await rank1Repo.getRank1Row();
  if (current && current.discordUserId === newHolder.discordUserId && current.element === newHolder.element) {
    return; // same holder as before — leave their defend streak alone
  }
  await rank1Repo.setRank1Holder(newHolder, 0);
}

export interface ShuffleResult {
  changedCount: number;
  cancelledMatches: MatchRow[];
}

/** Admin "Reset Ladder (Shuffle)": cancels every active match, then randomizes rank order. */
export async function shuffleLadder(): Promise<ShuffleResult> {
  const pending = await matchesRepo.getPendingMatches();
  for (const match of pending) {
    await cancelMatch(match);
  }

  const ladder = await ladderRepo.getLadder();
  const changes = shuffleRanks(ladder);
  for (const change of changes) {
    await ladderRepo.setRank(change.sheetRow, change.newRank);
  }
  if (changes.length > 0) await ladderRepo.sortLadderByRank();

  const updatedLadder = ladder.map((r) => {
    const change = changes.find((c) => c.sheetRow === r.sheetRow);
    return change ? { ...r, rank: change.newRank } : r;
  });
  await syncRank1TrackerToCurrentHolder(updatedLadder);

  return { changedCount: changes.length, cancelledMatches: pending };
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
    await syncRank1TrackerToCurrentHolder(updatedLadder);
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
  await syncRank1TrackerToCurrentHolder(updatedLadder);

  const finalRank = changes.find((c) => c.sheetRow === targetSheetRow)?.newRank ?? target.rank;
  return { entry: { ...target, rank: finalRank }, changedCount: changes.length };
}
