import * as ladderRepo from "../sheets/ladderRepo.js";
import { compactRanks } from "./rankingService.js";
import { syncToCurrentHolder } from "./rank1Tracker.js";
import type { Element, LadderRow } from "../types.js";

export type LeaveLadderResult =
  | { ok: true; removedEntry: LadderRow }
  | { ok: false; reason: string };

/**
 * Self-service ladder departure: removes one of the caller's element-entries and closes the rank
 * gap it leaves behind. Any pending match tied to this entry must already be forfeited by the
 * caller (see matchService/reportWinFlow) before this runs — this only handles the
 * ladder-membership side, same as adminService.removePlayer but for a single entry with no match
 * cancellation of its own.
 */
export async function leaveLadderEntry(discordUserId: string, element: Element): Promise<LeaveLadderResult> {
  const entry = await ladderRepo.findEntry(discordUserId, element);
  if (!entry) {
    return { ok: false, reason: "You don't have that entry on the ladder anymore." };
  }

  await ladderRepo.clearRow(entry.sheetRow);

  const remainingLadder = (await ladderRepo.getLadder()).filter((r) => r.sheetRow !== entry.sheetRow);
  const changes = compactRanks(remainingLadder);
  await ladderRepo.setRanks(changes);
  await ladderRepo.sortLadderByRank();

  if (entry.rank === 1) {
    const updatedLadder = remainingLadder.map((r) => {
      const change = changes.find((c) => c.sheetRow === r.sheetRow);
      return change ? { ...r, rank: change.newRank } : r;
    });
    await syncToCurrentHolder(updatedLadder);
  }

  return { ok: true, removedEntry: entry };
}
