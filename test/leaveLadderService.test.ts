import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderRow } from "../src/types.js";

vi.mock("../src/sheets/ladderRepo.js", () => ({
  findEntry: vi.fn(),
  getLadder: vi.fn(),
  clearRow: vi.fn(),
  setRank: vi.fn(),
  sortLadderByRank: vi.fn(),
}));
vi.mock("../src/domain/rank1Tracker.js", () => ({
  syncToCurrentHolder: vi.fn(),
}));

import * as ladderRepo from "../src/sheets/ladderRepo.js";
import * as rank1Tracker from "../src/domain/rank1Tracker.js";
import { leaveLadderEntry } from "../src/domain/leaveLadderService.js";

function entry(overrides: Partial<LadderRow> = {}): LadderRow {
  return {
    sheetRow: 2,
    rank: 3,
    element: "Cold",
    build: "Vita",
    characterName: "Frosty",
    discordName: "user#1",
    discordUserId: "u1",
    status: "Available",
    joinedAt: "2026-01-01T00:00:00.000Z",
    challengeDate: "",
    opponentRank: "",
    notes: "",
    dodgeWins: 0,
    dodgeCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(ladderRepo.findEntry).mockReset();
  vi.mocked(ladderRepo.getLadder).mockReset().mockResolvedValue([]);
  vi.mocked(ladderRepo.clearRow).mockReset();
  vi.mocked(ladderRepo.setRank).mockReset();
  vi.mocked(ladderRepo.sortLadderByRank).mockReset();
  vi.mocked(rank1Tracker.syncToCurrentHolder).mockReset();
});

describe("leaveLadderEntry", () => {
  it("returns an error when the caller has no such entry", async () => {
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(undefined);

    const result = await leaveLadderEntry("u1", "Cold");

    expect(result).toEqual({ ok: false, reason: "You don't have that entry on the ladder anymore." });
    expect(ladderRepo.clearRow).not.toHaveBeenCalled();
  });

  it("clears the entry and compacts the ranks below it", async () => {
    const top = entry({ sheetRow: 2, rank: 1, discordUserId: "u2", characterName: "Ember" });
    const leaving = entry({ sheetRow: 3, rank: 2 });
    const below = entry({ sheetRow: 4, rank: 3, discordUserId: "u3", characterName: "Blaze" });
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(leaving);
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([top, leaving, below]);

    const result = await leaveLadderEntry("u1", "Cold");

    expect(result).toEqual({ ok: true, removedEntry: leaving });
    expect(ladderRepo.clearRow).toHaveBeenCalledWith(3);
    expect(ladderRepo.setRank).toHaveBeenCalledWith(4, 2);
    expect(ladderRepo.sortLadderByRank).toHaveBeenCalled();
    expect(rank1Tracker.syncToCurrentHolder).not.toHaveBeenCalled();
  });

  it("syncs the rank-1 tracker when the leaver held rank 1", async () => {
    const leaving = entry({ sheetRow: 2, rank: 1 });
    const newTop = entry({ sheetRow: 3, rank: 2, discordUserId: "u2", characterName: "Ember" });
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(leaving);
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([leaving, newTop]);

    const result = await leaveLadderEntry("u1", "Cold");

    expect(result).toEqual({ ok: true, removedEntry: leaving });
    expect(rank1Tracker.syncToCurrentHolder).toHaveBeenCalledWith([expect.objectContaining({ sheetRow: 3, rank: 1 })]);
  });
});
