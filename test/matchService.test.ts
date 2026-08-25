import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderRow, MatchRow } from "../src/types.js";

vi.mock("../src/sheets/ladderRepo.js", () => ({
  findEntry: vi.fn(),
  setRank: vi.fn(),
  clearChallengeInfo: vi.fn(),
  setChallengeInfo: vi.fn(),
  setDodgeWins: vi.fn(),
  sortLadderByRank: vi.fn(),
}));
vi.mock("../src/sheets/matchesRepo.js", () => ({
  getMatchById: vi.fn(),
  updateMatch: vi.fn(),
  addMatch: vi.fn(),
}));
vi.mock("../src/domain/rank1Tracker.js", () => ({
  recordMatchResult: vi.fn(),
}));

import * as ladderRepo from "../src/sheets/ladderRepo.js";
import * as matchesRepo from "../src/sheets/matchesRepo.js";
import * as rank1Tracker from "../src/domain/rank1Tracker.js";
import { reportWin } from "../src/domain/matchService.js";

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
  vi.mocked(ladderRepo.sortLadderByRank).mockReset();
  vi.mocked(matchesRepo.getMatchById).mockReset();
  vi.mocked(matchesRepo.updateMatch).mockReset();
  vi.mocked(rank1Tracker.recordMatchResult).mockReset().mockResolvedValue({ changed: false });
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
});
