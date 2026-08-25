import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderRow, MatchRow } from "../src/types.js";

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
  getRank1Row: vi.fn(),
  setRank1Holder: vi.fn(),
}));
vi.mock("../src/sheets/bannedRepo.js", async () => {
  const actual = await vi.importActual<typeof import("../src/sheets/bannedRepo.js")>("../src/sheets/bannedRepo.js");
  return { ...actual, addBan: vi.fn(), clearBan: vi.fn(), getAllBans: vi.fn() };
});

import * as ladderRepo from "../src/sheets/ladderRepo.js";
import * as matchesRepo from "../src/sheets/matchesRepo.js";
import * as bannedRepo from "../src/sheets/bannedRepo.js";
import { ALL_ELEMENTS } from "../src/sheets/bannedRepo.js";
import { removePlayer, banPlayer, forceCancelMatch } from "../src/domain/adminService.js";

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
