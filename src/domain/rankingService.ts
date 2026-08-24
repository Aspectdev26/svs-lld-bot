import type { LadderRow } from "../types.js";

export interface RankChange {
  sheetRow: number;
  newRank: number;
}

/** Next rank for a brand-new ladder entry: bottom of the ladder. */
export function nextRankForNewEntry(ladder: LadderRow[]): number {
  if (ladder.length === 0) return 1;
  return Math.max(...ladder.map((r) => r.rank)) + 1;
}

/** Challenger win: the two entries simply trade rank numbers. */
export function swapRanks(challenger: LadderRow, defender: LadderRow): { challengerRank: number; defenderRank: number } {
  return { challengerRank: defender.rank, defenderRank: challenger.rank };
}

/** Relabels an already-ordered list of rows 1..N, returning only the rows whose rank actually changes. */
function reassignSequentially(orderedRows: LadderRow[]): RankChange[] {
  const changes: RankChange[] = [];
  orderedRows.forEach((row, idx) => {
    const newRank = idx + 1;
    if (row.rank !== newRank) changes.push({ sheetRow: row.sheetRow, newRank });
  });
  return changes;
}

/** Closes any gaps left by a removed entry, renumbering everyone else 1..N in their existing order. */
export function compactRanks(ladder: LadderRow[]): RankChange[] {
  const sorted = [...ladder].sort((a, b) => a.rank - b.rank);
  return reassignSequentially(sorted);
}

/** Admin "Reset Ladder (Shuffle)": randomizes rank order among all current entries. */
export function shuffleRanks(ladder: LadderRow[], rng: () => number = Math.random): RankChange[] {
  const shuffled = [...ladder];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return reassignSequentially(shuffled);
}

/**
 * Admin "Set Rank" override: moves one entry to `desiredRank`, shifting everyone between its old
 * and new position by one (like inserting into a sorted list), and renumbers 1..N cleanly.
 */
export function applyManualRank(ladder: LadderRow[], targetSheetRow: number, desiredRank: number): RankChange[] {
  const target = ladder.find((r) => r.sheetRow === targetSheetRow);
  if (!target) return [];

  const others = ladder.filter((r) => r.sheetRow !== targetSheetRow).sort((a, b) => a.rank - b.rank);
  const clamped = Math.min(Math.max(1, Math.round(desiredRank)), others.length + 1);
  const newOrder = [...others.slice(0, clamped - 1), target, ...others.slice(clamped - 1)];
  return reassignSequentially(newOrder);
}
