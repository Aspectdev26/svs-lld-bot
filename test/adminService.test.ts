import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderRow, MatchRow } from "../src/types.js";

vi.mock("../src/sheets/ladderRepo.js", () => ({
  getPlayerRows: vi.fn(),
  getLadder: vi.fn(),
  clearRow: vi.fn(),
  setRank: vi.fn(),
  setDodgeCount: vi.fn(),
  findEntry: vi.fn(),
  clearChallengeInfo: vi.fn(),
  sortLadderByRank: vi.fn(),
}));
vi.mock("../src/sheets/matchesRepo.js", () => ({
  getPendingMatches: vi.fn(),
  getPendingMatchForEntry: vi.fn(),
  getMatchById: vi.fn(),
  updateMatch: vi.fn(),
}));
vi.mock("../src/sheets/rank1Repo.js", () => ({
  getCurrentHolderRow: vi.fn(),
  crownHolder: vi.fn(),
}));
vi.mock("../src/sheets/bannedRepo.js", async () => {
  const actual = await vi.importActual<typeof import("../src/sheets/bannedRepo.js")>("../src/sheets/bannedRepo.js");
  return { ...actual, addBan: vi.fn(), clearBan: vi.fn(), getAllBans: vi.fn() };
});
vi.mock("../src/sheets/seasonStatsRepo.js", () => ({
  tabExists: vi.fn(),
  backfillInactiveEntries: vi.fn(),
  startNewSeason: vi.fn(),
}));
vi.mock("../src/domain/rankingService.js", async () => {
  const actual = await vi.importActual<typeof import("../src/domain/rankingService.js")>("../src/domain/rankingService.js");
  return { ...actual, shuffleRanks: vi.fn() };
});
vi.mock("../src/sheets/ladderFormatting.js", () => ({
  applyLadderFormatting: vi.fn().mockResolvedValue(undefined),
}));
// pointsStore writes to the real local data/points.json with no locking — mock it out so
// resetLadderEndSeason tests below can't overwrite/wipe that live file.
vi.mock("../src/domain/pointsStore.js", () => ({
  resetForNewSeason: vi.fn(),
}));

import * as ladderRepo from "../src/sheets/ladderRepo.js";
import * as matchesRepo from "../src/sheets/matchesRepo.js";
import * as bannedRepo from "../src/sheets/bannedRepo.js";
import * as seasonStatsRepo from "../src/sheets/seasonStatsRepo.js";
import * as rankingService from "../src/domain/rankingService.js";
import * as pointsStore from "../src/domain/pointsStore.js";
import { ALL_ELEMENTS } from "../src/sheets/bannedRepo.js";
import { removePlayer, banPlayer, forceCancelMatch, resetLadderEndSeason, shuffleLadderRanks } from "../src/domain/adminService.js";

function entry(overrides: Partial<LadderRow> = {}): LadderRow {
  return {
    sheetRow: 2,
    rank: 1,
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

function matchRow(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    sheetRow: 2,
    matchId: "m1",
    challengerUserId: "u1",
    challengerElement: "Cold",
    challengerRank: 3,
    defenderUserId: "u2",
    defenderElement: "Cold",
    defenderRank: 1,
    status: "Pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-04T00:00:00.000Z",
    warningSentAt: "",
    winnerUserId: "",
    resolvedAt: "",
    channelId: "",
    extensionPending: false,
    cancelRequestedByUserId: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(ladderRepo.getPlayerRows).mockReset();
  vi.mocked(ladderRepo.getLadder).mockReset().mockResolvedValue([]);
  vi.mocked(ladderRepo.clearRow).mockReset();
  vi.mocked(ladderRepo.setRank).mockReset();
  vi.mocked(ladderRepo.setDodgeCount).mockReset();
  vi.mocked(ladderRepo.findEntry).mockReset().mockResolvedValue(undefined);
  vi.mocked(ladderRepo.clearChallengeInfo).mockReset();
  vi.mocked(ladderRepo.sortLadderByRank).mockReset();
  vi.mocked(matchesRepo.getPendingMatches).mockReset();
  vi.mocked(matchesRepo.getPendingMatchForEntry).mockReset().mockResolvedValue(undefined);
  vi.mocked(matchesRepo.getMatchById).mockReset();
  vi.mocked(matchesRepo.updateMatch).mockReset();
  vi.mocked(bannedRepo.addBan).mockReset();
  vi.mocked(seasonStatsRepo.backfillInactiveEntries).mockReset();
  vi.mocked(seasonStatsRepo.startNewSeason).mockReset();
  vi.mocked(seasonStatsRepo.tabExists).mockReset().mockResolvedValue(false);
  vi.mocked(rankingService.shuffleRanks).mockReset().mockReturnValue([]);
  vi.mocked(pointsStore.resetForNewSeason).mockReset();
});

describe("removePlayer", () => {
  it("removes only the matching element when scope is a specific element", async () => {
    const coldEntry = entry({ sheetRow: 2, element: "Cold", rank: 1 });
    const fireEntry = entry({ sheetRow: 3, element: "Fire", rank: 2 });
    vi.mocked(ladderRepo.getPlayerRows).mockResolvedValue([coldEntry, fireEntry]);
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([coldEntry, fireEntry]);

    const result = await removePlayer("u1", "Cold");

    expect(result.removedEntries).toEqual([coldEntry]);
    expect(ladderRepo.clearRow).toHaveBeenCalledWith(2);
    expect(ladderRepo.clearRow).not.toHaveBeenCalledWith(3);
  });

  it("removes every entry when scope is ALL", async () => {
    const coldEntry = entry({ sheetRow: 2, element: "Cold" });
    const fireEntry = entry({ sheetRow: 3, element: "Fire" });
    vi.mocked(ladderRepo.getPlayerRows).mockResolvedValue([coldEntry, fireEntry]);
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([coldEntry, fireEntry]);

    const result = await removePlayer("u1", ALL_ELEMENTS);

    expect(result.removedEntries).toHaveLength(2);
    expect(ladderRepo.clearRow).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending match tied to a removed entry", async () => {
    const coldEntry = entry({ sheetRow: 2, element: "Cold" });
    vi.mocked(ladderRepo.getPlayerRows).mockResolvedValue([coldEntry]);
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([coldEntry]);
    const pendingMatch = matchRow();
    vi.mocked(matchesRepo.getPendingMatchForEntry).mockResolvedValue(pendingMatch);

    const result = await removePlayer("u1", "Cold");

    expect(result.cancelledMatches).toEqual([pendingMatch]);
    expect(matchesRepo.updateMatch).toHaveBeenCalledWith(expect.objectContaining({ status: "Cancelled" }));
  });

  it("does nothing when the player has no matching entries", async () => {
    vi.mocked(ladderRepo.getPlayerRows).mockResolvedValue([entry({ element: "Fire" })]);

    const result = await removePlayer("u1", "Cold");

    expect(result.removedEntries).toEqual([]);
    expect(ladderRepo.clearRow).not.toHaveBeenCalled();
  });
});

describe("banPlayer", () => {
  it("records a ban row and then removes the matching entries", async () => {
    const coldEntry = entry({ sheetRow: 2, element: "Cold" });
    vi.mocked(ladderRepo.getPlayerRows).mockResolvedValue([coldEntry]);
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([coldEntry]);

    const result = await banPlayer("u1", "user#1", "Cold", "toxic behavior", "admin1");

    expect(bannedRepo.addBan).toHaveBeenCalledWith(
      expect.objectContaining({ discordUserId: "u1", element: "Cold", reason: "toxic behavior", bannedByUserId: "admin1" }),
    );
    expect(result.removedEntries).toEqual([coldEntry]);
  });
});

describe("forceCancelMatch", () => {
  it("cancels a pending match", async () => {
    const match = matchRow();
    vi.mocked(matchesRepo.getMatchById).mockResolvedValue(match);

    const result = await forceCancelMatch("m1");

    expect(result?.status).toBe("Cancelled");
    expect(matchesRepo.updateMatch).toHaveBeenCalledWith(expect.objectContaining({ status: "Cancelled" }));
  });

  it("returns undefined for a match that isn't pending", async () => {
    vi.mocked(matchesRepo.getMatchById).mockResolvedValue(matchRow({ status: "Reported" }));
    expect(await forceCancelMatch("m1")).toBeUndefined();
  });

  it("returns undefined for an unknown match id", async () => {
    vi.mocked(matchesRepo.getMatchById).mockResolvedValue(undefined);
    expect(await forceCancelMatch("nope")).toBeUndefined();
  });
});

describe("resetLadderEndSeason", () => {
  it("backfills inactive ladder entries then starts a new season tab under the given name", async () => {
    vi.mocked(matchesRepo.getPendingMatches).mockResolvedValue([]);
    const ladder = [entry({ sheetRow: 2 })];
    vi.mocked(ladderRepo.getLadder).mockResolvedValue(ladder);

    const result = await resetLadderEndSeason("Season 3");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newSeasonName).toBe("Season 3");
    expect(seasonStatsRepo.backfillInactiveEntries).toHaveBeenCalledWith(ladder);
    expect(seasonStatsRepo.startNewSeason).toHaveBeenCalledWith("Season 3");
  });

  it("sanitizes forbidden sheet-title characters out of the given name", async () => {
    vi.mocked(matchesRepo.getPendingMatches).mockResolvedValue([]);
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([]);

    const result = await resetLadderEndSeason("Test/Season: 1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newSeasonName).toBe("Test-Season- 1");
    expect(seasonStatsRepo.tabExists).toHaveBeenCalledWith("Test-Season- 1");
    expect(seasonStatsRepo.startNewSeason).toHaveBeenCalledWith("Test-Season- 1");
  });

  it("rejects a name that collides with an existing tab, making no changes", async () => {
    vi.mocked(seasonStatsRepo.tabExists).mockResolvedValue(true);

    const result = await resetLadderEndSeason("Test");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/already exists/);
    expect(matchesRepo.getPendingMatches).not.toHaveBeenCalled();
    expect(seasonStatsRepo.backfillInactiveEntries).not.toHaveBeenCalled();
    expect(seasonStatsRepo.startNewSeason).not.toHaveBeenCalled();
  });

  it("cancels every pending match", async () => {
    const pendingMatch = matchRow();
    vi.mocked(matchesRepo.getPendingMatches).mockResolvedValue([pendingMatch]);
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([]);

    const result = await resetLadderEndSeason("Season 1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cancelledMatches).toEqual([pendingMatch]);
    expect(matchesRepo.updateMatch).toHaveBeenCalledWith(expect.objectContaining({ status: "Cancelled" }));
  });

  it("clears every entry's dodgeCount back to 0, leaving entries already at 0 untouched", async () => {
    vi.mocked(matchesRepo.getPendingMatches).mockResolvedValue([]);
    const ladder = [
      entry({ sheetRow: 2, discordUserId: "u1", dodgeCount: 2 }),
      entry({ sheetRow: 3, discordUserId: "u2", dodgeCount: 0 }),
    ];
    vi.mocked(ladderRepo.getLadder).mockResolvedValue(ladder);

    const result = await resetLadderEndSeason("Season 1");

    expect(result.ok).toBe(true);
    expect(ladderRepo.setDodgeCount).toHaveBeenCalledWith(2, 0);
    expect(ladderRepo.setDodgeCount).not.toHaveBeenCalledWith(3, 0);
    expect(ladderRepo.setDodgeCount).toHaveBeenCalledTimes(1);
  });

  it("shuffles the ranks three times and applies only the net rank change", async () => {
    vi.mocked(matchesRepo.getPendingMatches).mockResolvedValue([]);
    const ladder = [
      entry({ sheetRow: 2, rank: 1, discordUserId: "u1" }),
      entry({ sheetRow: 3, rank: 2, discordUserId: "u2" }),
      entry({ sheetRow: 4, rank: 3, discordUserId: "u3" }),
    ];
    vi.mocked(ladderRepo.getLadder).mockResolvedValue(ladder);
    vi.mocked(rankingService.shuffleRanks)
      .mockReturnValueOnce([
        { sheetRow: 2, newRank: 3 },
        { sheetRow: 4, newRank: 1 },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    const result = await resetLadderEndSeason("Season 1");

    expect(rankingService.shuffleRanks).toHaveBeenCalledTimes(3);
    expect(ladderRepo.setRank).toHaveBeenCalledWith(2, 3);
    expect(ladderRepo.setRank).toHaveBeenCalledWith(4, 1);
    expect(ladderRepo.setRank).not.toHaveBeenCalledWith(3, expect.anything());
    expect(ladderRepo.sortLadderByRank).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changedCount).toBe(2);
  });
});

describe("shuffleLadderRanks", () => {
  it("shuffles ranks and applies only the net rank change, without touching matches or season stats", async () => {
    const ladder = [
      entry({ sheetRow: 2, rank: 1, discordUserId: "u1" }),
      entry({ sheetRow: 3, rank: 2, discordUserId: "u2" }),
      entry({ sheetRow: 4, rank: 3, discordUserId: "u3" }),
    ];
    vi.mocked(ladderRepo.getLadder).mockResolvedValue(ladder);
    vi.mocked(rankingService.shuffleRanks)
      .mockReturnValueOnce([
        { sheetRow: 2, newRank: 3 },
        { sheetRow: 4, newRank: 1 },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([]);

    const result = await shuffleLadderRanks();

    expect(rankingService.shuffleRanks).toHaveBeenCalledTimes(3);
    expect(ladderRepo.setRank).toHaveBeenCalledWith(2, 3);
    expect(ladderRepo.setRank).toHaveBeenCalledWith(4, 1);
    expect(ladderRepo.setRank).not.toHaveBeenCalledWith(3, expect.anything());
    expect(ladderRepo.sortLadderByRank).toHaveBeenCalled();
    expect(result.changedCount).toBe(2);
    expect(matchesRepo.getPendingMatches).not.toHaveBeenCalled();
    expect(seasonStatsRepo.backfillInactiveEntries).not.toHaveBeenCalled();
    expect(seasonStatsRepo.startNewSeason).not.toHaveBeenCalled();
  });

  it("skips writes when nothing changes", async () => {
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([entry({ sheetRow: 2, rank: 1 })]);
    vi.mocked(rankingService.shuffleRanks).mockReturnValue([]);

    const result = await shuffleLadderRanks();

    expect(result.changedCount).toBe(0);
    expect(ladderRepo.setRank).not.toHaveBeenCalled();
    expect(ladderRepo.sortLadderByRank).not.toHaveBeenCalled();
  });
});
