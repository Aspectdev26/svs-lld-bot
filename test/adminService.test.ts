import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderRow, MatchRow, SeasonStatsRow } from "../src/types.js";

vi.mock("../src/sheets/ladderRepo.js", () => ({
  getPlayerRows: vi.fn(),
  getLadder: vi.fn(),
  clearRow: vi.fn(),
  setRank: vi.fn(),
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
  getAllRows: vi.fn(),
  clearAll: vi.fn(),
  archiveSeason: vi.fn(),
  archiveTabExists: vi.fn(),
}));
vi.mock("../src/domain/rankingService.js", async () => {
  const actual = await vi.importActual<typeof import("../src/domain/rankingService.js")>("../src/domain/rankingService.js");
  return { ...actual, shuffleRanks: vi.fn() };
});

import * as ladderRepo from "../src/sheets/ladderRepo.js";
import * as matchesRepo from "../src/sheets/matchesRepo.js";
import * as bannedRepo from "../src/sheets/bannedRepo.js";
import * as seasonStatsRepo from "../src/sheets/seasonStatsRepo.js";
import * as rankingService from "../src/domain/rankingService.js";
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
    ...overrides,
  };
}

function seasonStatsRow(overrides: Partial<SeasonStatsRow> = {}): SeasonStatsRow {
  return {
    sheetRow: 2,
    discordUserId: "u1",
    discordName: "user#1",
    characterName: "Frosty",
    element: "Cold",
    build: "Vita",
    defends: 2,
    wins: 5,
    losses: 3,
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
  vi.mocked(ladderRepo.findEntry).mockReset().mockResolvedValue(undefined);
  vi.mocked(ladderRepo.clearChallengeInfo).mockReset();
  vi.mocked(ladderRepo.sortLadderByRank).mockReset();
  vi.mocked(matchesRepo.getPendingMatches).mockReset();
  vi.mocked(matchesRepo.getPendingMatchForEntry).mockReset().mockResolvedValue(undefined);
  vi.mocked(matchesRepo.getMatchById).mockReset();
  vi.mocked(matchesRepo.updateMatch).mockReset();
  vi.mocked(bannedRepo.addBan).mockReset();
  vi.mocked(seasonStatsRepo.getAllRows).mockReset().mockResolvedValue([]);
  vi.mocked(seasonStatsRepo.clearAll).mockReset();
  vi.mocked(seasonStatsRepo.archiveSeason).mockReset();
  vi.mocked(seasonStatsRepo.archiveTabExists).mockReset().mockResolvedValue(false);
  vi.mocked(rankingService.shuffleRanks).mockReset().mockReturnValue([]);
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
  it("archives the current season's stats under the given name and resets them", async () => {
    vi.mocked(matchesRepo.getPendingMatches).mockResolvedValue([]);
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([]);
    vi.mocked(seasonStatsRepo.getAllRows).mockResolvedValue([seasonStatsRow()]);

    const result = await resetLadderEndSeason("Season 3");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seasonName).toBe("Season 3");
    expect(seasonStatsRepo.archiveSeason).toHaveBeenCalledWith(
      "Season 3",
      expect.arrayContaining([expect.objectContaining({ discordUserId: "u1", wins: 5, losses: 3, defends: 2 })]),
    );
    expect(seasonStatsRepo.clearAll).toHaveBeenCalled();
  });

  it("sanitizes forbidden sheet-title characters out of the given name", async () => {
    vi.mocked(matchesRepo.getPendingMatches).mockResolvedValue([]);
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([]);

    const result = await resetLadderEndSeason("Test/Season: 1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seasonName).toBe("Test-Season- 1");
    expect(seasonStatsRepo.archiveTabExists).toHaveBeenCalledWith("Test-Season- 1");
  });

  it("rejects a name that collides with an already-archived season, making no changes", async () => {
    vi.mocked(seasonStatsRepo.archiveTabExists).mockResolvedValue(true);

    const result = await resetLadderEndSeason("Test");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/already been archived/);
    expect(matchesRepo.getPendingMatches).not.toHaveBeenCalled();
    expect(seasonStatsRepo.archiveSeason).not.toHaveBeenCalled();
    expect(seasonStatsRepo.clearAll).not.toHaveBeenCalled();
  });

  it("includes ladder entries with no recorded season activity at 0/0/0, so quiet players still show up", async () => {
    vi.mocked(matchesRepo.getPendingMatches).mockResolvedValue([]);
    const quietEntry = entry({ sheetRow: 5, discordUserId: "u-quiet", characterName: "Ghost", element: "Fire" });
    vi.mocked(ladderRepo.getLadder).mockResolvedValue([quietEntry]);
    vi.mocked(seasonStatsRepo.getAllRows).mockResolvedValue([]);

    await resetLadderEndSeason("Season 1");

    expect(seasonStatsRepo.archiveSeason).toHaveBeenCalledWith(
      "Season 1",
      expect.arrayContaining([
        expect.objectContaining({ discordUserId: "u-quiet", characterName: "Ghost", defends: 0, wins: 0, losses: 0 }),
      ]),
    );
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
    expect(seasonStatsRepo.clearAll).not.toHaveBeenCalled();
    expect(seasonStatsRepo.archiveSeason).not.toHaveBeenCalled();
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
