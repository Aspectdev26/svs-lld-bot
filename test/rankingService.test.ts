import { describe, expect, it } from "vitest";
import { applyManualRank, compactRanks, nextRankForNewEntry, shuffleRanks, swapRanks } from "../src/domain/rankingService.js";
import type { LadderRow } from "../src/types.js";

function row(rank: number): LadderRow {
  return {
    sheetRow: rank + 1,
    rank,
    element: "Fire",
    build: "Vita",
    characterName: `Char${rank}`,
    discordName: `User${rank}`,
    discordUserId: `u${rank}`,
    status: "Available",
    joinedAt: "2026-01-01T00:00:00.000Z",
    challengeDate: "",
    opponentRank: "",
    notes: "",
    dodgeWins: 0,
    dodgeCount: 0,
  };
}

describe("nextRankForNewEntry", () => {
  it("returns 1 for an empty ladder", () => {
    expect(nextRankForNewEntry([])).toBe(1);
  });

  it("returns max rank + 1 for a non-empty ladder", () => {
    const ladder = [row(1), row(2), row(5)];
    expect(nextRankForNewEntry(ladder)).toBe(6);
  });
});

describe("swapRanks", () => {
  it("swaps the challenger and defender rank numbers", () => {
    const challenger = row(5);
    const defender = row(2);
    expect(swapRanks(challenger, defender)).toEqual({ challengerRank: 2, defenderRank: 5 });
  });
});

describe("compactRanks", () => {
  it("closes a gap left by a removed entry, keeping relative order", () => {
    // rank 2 was removed, leaving 1, 3, 4
    const ladder = [row(1), row(3), row(4)];
    const changes = compactRanks(ladder);
    expect(changes).toEqual(
      expect.arrayContaining([
        { sheetRow: ladder[1].sheetRow, newRank: 2 },
        { sheetRow: ladder[2].sheetRow, newRank: 3 },
      ]),
    );
    // rank-1 entry didn't move, so it shouldn't appear in the change set
    expect(changes.find((c) => c.sheetRow === ladder[0].sheetRow)).toBeUndefined();
  });

  it("returns no changes when ranks are already contiguous", () => {
    const ladder = [row(1), row(2), row(3)];
    expect(compactRanks(ladder)).toEqual([]);
  });
});

describe("shuffleRanks", () => {
  it("produces a permutation covering 1..N with no duplicates or gaps", () => {
    const ladder = [row(1), row(2), row(3), row(4), row(5)];
    const changes = shuffleRanks(ladder, () => 0.42); // deterministic rng for the test
    const bySheetRow = new Map(ladder.map((r) => [r.sheetRow, r.rank]));
    for (const c of changes) bySheetRow.set(c.sheetRow, c.newRank);
    const finalRanks = [...bySheetRow.values()].sort((a, b) => a - b);
    expect(finalRanks).toEqual([1, 2, 3, 4, 5]);
  });

  it("is a no-op on a single-entry ladder", () => {
    expect(shuffleRanks([row(1)])).toEqual([]);
  });
});

describe("applyManualRank", () => {
  it("moves an entry up, shifting everyone in between down by one", () => {
    const ladder = [row(1), row(2), row(3), row(4), row(5)];
    const target = ladder[3]; // currently rank 4
    const changes = applyManualRank(ladder, target.sheetRow, 2);

    const bySheetRow = new Map(ladder.map((r) => [r.sheetRow, r.rank]));
    for (const c of changes) bySheetRow.set(c.sheetRow, c.newRank);

    expect(bySheetRow.get(target.sheetRow)).toBe(2);
    expect(bySheetRow.get(ladder[1].sheetRow)).toBe(3); // old rank 2 -> 3
    expect(bySheetRow.get(ladder[2].sheetRow)).toBe(4); // old rank 3 -> 4
    expect(bySheetRow.get(ladder[0].sheetRow)).toBe(1); // rank 1 unaffected
    expect(bySheetRow.get(ladder[4].sheetRow)).toBe(5); // rank 5 unaffected
  });

  it("clamps a desired rank beyond the ladder size to the bottom", () => {
    const ladder = [row(1), row(2), row(3)];
    const changes = applyManualRank(ladder, ladder[0].sheetRow, 99);
    const bySheetRow = new Map(ladder.map((r) => [r.sheetRow, r.rank]));
    for (const c of changes) bySheetRow.set(c.sheetRow, c.newRank);
    expect(bySheetRow.get(ladder[0].sheetRow)).toBe(3);
  });

  it("returns no changes for an unknown sheetRow", () => {
    const ladder = [row(1), row(2)];
    expect(applyManualRank(ladder, 999, 1)).toEqual([]);
  });
});
