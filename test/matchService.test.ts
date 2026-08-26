import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderRow, MatchRow } from "../src/types.js";

vi.mock("../src/sheets/ladderRepo.js", () => ({
  findEntry: vi.fn(),
  setRank: vi.fn(),
  clearChallengeInfo: vi.fn(),
  setChallengeInfo: vi.fn(),
  setDodgeWins: vi.fn(),
  setDodgeCount: vi.fn(),
  sortLadderByRank: vi.fn(),
}));
vi.mock("../src/sheets/matchesRepo.js", () => ({
  getMatchById: vi.fn(),
  updateMatch: vi.fn(),
  addMatch: vi.fn(),
  getAllMatches: vi.fn(),
}));
vi.mock("../src/domain/rank1Tracker.js", () => ({
  recordMatchResult: vi.fn(),
  recordDodgeAgainst: vi.fn(),
}));
// pointsService writes to the real local data/points.json with no locking — mock it out so
// concurrent test calls (reportWin/applyDodgeWin fire several of these per call via Promise.all)
// can't race and corrupt that file.
vi.mock("../src/domain/pointsService.js", () => ({
  recordChallengeIssued: vi.fn(),
  recordMatchCompleted: vi.fn(),
  recordDodgeAgainst: vi.fn(),
  recordMatchExpired: vi.fn(),
  recordExtensionRequested: vi.fn(),
}));

import * as ladderRepo from "../src/sheets/ladderRepo.js";
import * as matchesRepo from "../src/sheets/matchesRepo.js";
import * as rank1Tracker from "../src/domain/rank1Tracker.js";
import { reportWin, applyDodgeWin, getChallengeCooldownExpiry } from "../src/domain/matchService.js";

function ladderRow(overrides: Partial<LadderRow> = {}): LadderRow {
  return {
    sheetRow: 2,
    rank: 3,
    element: "Cold",
    build: "Vita",
    characterName: "Frosty",
    discordName: "user#1",
    discordUserId: "u1",
    status: "Available",
    joinedAt: "",
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
  vi.mocked(ladderRepo.findEntry).mockReset();
  vi.mocked(ladderRepo.setRank).mockReset();
  vi.mocked(ladderRepo.clearChallengeInfo).mockReset();
  vi.mocked(ladderRepo.setDodgeWins).mockReset();
  vi.mocked(ladderRepo.setDodgeCount).mockReset();
  vi.mocked(ladderRepo.sortLadderByRank).mockReset();
  vi.mocked(matchesRepo.getMatchById).mockReset();
  vi.mocked(matchesRepo.updateMatch).mockReset();
  vi.mocked(rank1Tracker.recordMatchResult).mockReset().mockResolvedValue({ changed: false });
  vi.mocked(rank1Tracker.recordDodgeAgainst).mockReset();
});

describe("reportWin", () => {
  it("rejects when the match isn't pending", async () => {
    vi.mocked(matchesRepo.getMatchById).mockResolvedValue(matchRow({ status: "Reported" }));
    const result = await reportWin("u1", "m1", "u1");
    expect(result.ok).toBe(false);
  });

  it("rejects when the reporter isn't a participant", async () => {
    vi.mocked(matchesRepo.getMatchById).mockResolvedValue(matchRow());
    const result = await reportWin("stranger", "m1", "u1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a participant/);
  });

  it("rejects when the selected winner isn't a participant", async () => {
    vi.mocked(matchesRepo.getMatchById).mockResolvedValue(matchRow());
    const result = await reportWin("u1", "m1", "stranger");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a participant/);
  });

  it("swaps ranks and records the challenger as winner when the challenger is picked", async () => {
    const match = matchRow(); // challenger=u1 rank3, defender=u2 rank1
    vi.mocked(matchesRepo.getMatchById).mockResolvedValue(match);
    const challengerEntry = ladderRow({ sheetRow: 2, discordUserId: "u1", rank: 3 });
    const defenderEntry = ladderRow({ sheetRow: 3, discordUserId: "u2", rank: 1 });
    vi.mocked(ladderRepo.findEntry).mockImplementation(async (userId) =>
      userId === "u1" ? challengerEntry : defenderEntry,
    );

    // Defender (u2) reports that the challenger (u1) won — i.e. conceding on the defender's behalf.
    const result = await reportWin("u2", "m1", "u1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.winnerMovedUp).toBe(true);
      expect(result.match.winnerUserId).toBe("u1");
    }
    expect(ladderRepo.setRank).toHaveBeenCalledWith(2, 1); // challenger takes rank 1
    expect(ladderRepo.setRank).toHaveBeenCalledWith(3, 3); // defender takes rank 3
    expect(matchesRepo.updateMatch).toHaveBeenCalledWith(expect.objectContaining({ winnerUserId: "u1", status: "Reported" }));
  });

  it("does not swap ranks when the defender is picked as winner, even if the challenger reports it", async () => {
    const match = matchRow();
    vi.mocked(matchesRepo.getMatchById).mockResolvedValue(match);
    const challengerEntry = ladderRow({ sheetRow: 2, discordUserId: "u1", rank: 3 });
    const defenderEntry = ladderRow({ sheetRow: 3, discordUserId: "u2", rank: 1 });
    vi.mocked(ladderRepo.findEntry).mockImplementation(async (userId) =>
      userId === "u1" ? challengerEntry : defenderEntry,
    );

    // Challenger (u1) self-reports a loss — picks the defender (u2) as winner.
    const result = await reportWin("u1", "m1", "u2");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.winnerMovedUp).toBe(false);
      expect(result.match.winnerUserId).toBe("u2");
    }
    expect(ladderRepo.setRank).not.toHaveBeenCalled();
  });

  it("decrements dodgeCount for both participants when it's above 0", async () => {
    const match = matchRow();
    vi.mocked(matchesRepo.getMatchById).mockResolvedValue(match);
    const challengerEntry = ladderRow({ sheetRow: 2, discordUserId: "u1", rank: 3, dodgeCount: 1 });
    const defenderEntry = ladderRow({ sheetRow: 3, discordUserId: "u2", rank: 1, dodgeCount: 2 });
    vi.mocked(ladderRepo.findEntry).mockImplementation(async (userId) =>
      userId === "u1" ? challengerEntry : defenderEntry,
    );

    await reportWin("u1", "m1", "u1");

    expect(ladderRepo.setDodgeCount).toHaveBeenCalledWith(2, 0);
    expect(ladderRepo.setDodgeCount).toHaveBeenCalledWith(3, 1);
  });

  it("leaves dodgeCount alone (no write) for a participant already at 0", async () => {
    const match = matchRow();
    vi.mocked(matchesRepo.getMatchById).mockResolvedValue(match);
    const challengerEntry = ladderRow({ sheetRow: 2, discordUserId: "u1", rank: 3, dodgeCount: 0 });
    const defenderEntry = ladderRow({ sheetRow: 3, discordUserId: "u2", rank: 1, dodgeCount: 0 });
    vi.mocked(ladderRepo.findEntry).mockImplementation(async (userId) =>
      userId === "u1" ? challengerEntry : defenderEntry,
    );

    await reportWin("u1", "m1", "u1");

    expect(ladderRepo.setDodgeCount).not.toHaveBeenCalled();
  });
});

describe("applyDodgeWin", () => {
  it("increments the defender's dodgeCount and returns the new value", async () => {
    const match = matchRow();
    const challengerEntry = ladderRow({ sheetRow: 2, discordUserId: "u1", rank: 3 });
    const defenderEntry = ladderRow({ sheetRow: 3, discordUserId: "u2", rank: 1, dodgeCount: 1 });
    vi.mocked(ladderRepo.findEntry).mockImplementation(async (userId) =>
      userId === "u1" ? challengerEntry : defenderEntry,
    );

    const result = await applyDodgeWin(match);

    expect(result.defenderDodgeCount).toBe(2);
    expect(ladderRepo.setDodgeCount).toHaveBeenCalledWith(3, 2);
    expect(rank1Tracker.recordDodgeAgainst).toHaveBeenCalledWith(defenderEntry);
  });

  it("returns null defenderDodgeCount when the defender's ladder entry can't be found", async () => {
    const match = matchRow();
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(undefined);

    const result = await applyDodgeWin(match);

    expect(result.defenderDodgeCount).toBeNull();
    expect(ladderRepo.setDodgeCount).not.toHaveBeenCalled();
  });
});

describe("getChallengeCooldownExpiry", () => {
  it("returns null when this challenger entry never lost to this defender entry", async () => {
    vi.mocked(matchesRepo.getAllMatches).mockResolvedValue([]);
    const expiry = await getChallengeCooldownExpiry("u1", "Cold", "u2", "Cold");
    expect(expiry).toBeNull();
  });

  it("returns null once the loss is well outside any reasonable cooldown window", async () => {
    vi.mocked(matchesRepo.getAllMatches).mockResolvedValue([
      matchRow({
        status: "Reported",
        challengerUserId: "u1",
        challengerElement: "Cold",
        defenderUserId: "u2",
        defenderElement: "Cold",
        winnerUserId: "u2",
        resolvedAt: new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ]);
    const expiry = await getChallengeCooldownExpiry("u1", "Cold", "u2", "Cold");
    expect(expiry).toBeNull();
  });

  it("returns a future expiry for a very recent loss to that exact defender entry", async () => {
    vi.mocked(matchesRepo.getAllMatches).mockResolvedValue([
      matchRow({
        status: "Reported",
        challengerUserId: "u1",
        challengerElement: "Cold",
        defenderUserId: "u2",
        defenderElement: "Cold",
        winnerUserId: "u2",
        resolvedAt: new Date().toISOString(),
      }),
    ]);
    const expiry = await getChallengeCooldownExpiry("u1", "Cold", "u2", "Cold");
    expect(expiry).not.toBeNull();
    expect(expiry!.getTime()).toBeGreaterThan(Date.now());
  });

  it("ignores a win (the challenger wasn't the one who lost)", async () => {
    vi.mocked(matchesRepo.getAllMatches).mockResolvedValue([
      matchRow({
        status: "Reported",
        challengerUserId: "u1",
        challengerElement: "Cold",
        defenderUserId: "u2",
        defenderElement: "Cold",
        winnerUserId: "u1",
        resolvedAt: new Date().toISOString(),
      }),
    ]);
    const expiry = await getChallengeCooldownExpiry("u1", "Cold", "u2", "Cold");
    expect(expiry).toBeNull();
  });

  it("ignores a loss to a different element-entry of the same defender", async () => {
    vi.mocked(matchesRepo.getAllMatches).mockResolvedValue([
      matchRow({
        status: "Reported",
        challengerUserId: "u1",
        challengerElement: "Cold",
        defenderUserId: "u2",
        defenderElement: "Fire",
        winnerUserId: "u2",
        resolvedAt: new Date().toISOString(),
      }),
    ]);
    const expiry = await getChallengeCooldownExpiry("u1", "Cold", "u2", "Cold");
    expect(expiry).toBeNull();
  });
});
