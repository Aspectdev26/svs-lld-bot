import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderRow } from "../src/types.js";

vi.mock("../src/sheets/rank1Repo.js", () => ({
  crownHolder: vi.fn(),
  recordDefend: vi.fn(),
  getCurrentHolderRow: vi.fn(),
  getAllRows: vi.fn(),
  recordWin: vi.fn(),
  recordLoss: vi.fn(),
  recordDodgeAgainst: vi.fn(),
}));
vi.mock("../src/sheets/seasonStatsRepo.js", () => ({
  loadCache: vi.fn(),
  recordDefend: vi.fn(),
  recordWin: vi.fn(),
  recordLoss: vi.fn(),
}));

import * as rank1Repo from "../src/sheets/rank1Repo.js";
import * as seasonStatsRepo from "../src/sheets/seasonStatsRepo.js";
import { recordMatchResult, syncToCurrentHolder, recordDodgeAgainst } from "../src/domain/rank1Tracker.js";
import type { Rank1Row } from "../src/types.js";

function entry(overrides: Partial<LadderRow> = {}): LadderRow {
  return {
    sheetRow: 2,
    rank: 1,
    element: "Fire",
    build: "Vita",
    characterName: "Alice",
    discordName: "alice#discord",
    discordUserId: "u-alice",
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

function rank1Row(overrides: Partial<Rank1Row> = {}): Rank1Row {
  return {
    sheetRow: 2,
    discordUserId: "u-alice",
    discordName: "alice#discord",
    characterName: "Alice",
    element: "Fire",
    build: "Vita",
    defends: 3,
    holderSince: "2026-01-01T00:00:00.000Z",
    currentHolder: true,
    wins: 0,
    losses: 0,
    dodgesAgainst: 0,
    ...overrides,
  };
}

const seasonCache = { sheetName: "SeasonStats", rows: [] };

beforeEach(() => {
  vi.mocked(rank1Repo.crownHolder).mockReset();
  vi.mocked(rank1Repo.recordDefend).mockReset();
  vi.mocked(rank1Repo.getCurrentHolderRow).mockReset();
  vi.mocked(rank1Repo.getAllRows).mockReset().mockResolvedValue([]);
  vi.mocked(rank1Repo.recordWin).mockReset();
  vi.mocked(rank1Repo.recordLoss).mockReset();
  vi.mocked(rank1Repo.recordDodgeAgainst).mockReset();
  vi.mocked(seasonStatsRepo.loadCache).mockReset().mockResolvedValue(seasonCache);
  vi.mocked(seasonStatsRepo.recordDefend).mockReset();
  vi.mocked(seasonStatsRepo.recordWin).mockReset();
  vi.mocked(seasonStatsRepo.recordLoss).mockReset();
});

describe("recordMatchResult", () => {
  it("does nothing to the rank-1 tracker but still records win/loss when the defender wasn't rank 1", async () => {
    const defender = entry({ rank: 5, discordUserId: "u-bob", characterName: "Bob" });
    const challenger = entry({ rank: 8, discordUserId: "u-carl", characterName: "Carl" });

    const result = await recordMatchResult(5, defender, challenger, true);

    expect(result).toEqual({ changed: false });
    expect(rank1Repo.crownHolder).not.toHaveBeenCalled();
    expect(rank1Repo.recordDefend).not.toHaveBeenCalled();
    expect(rank1Repo.recordWin).toHaveBeenCalledWith(challenger, []);
    expect(rank1Repo.recordLoss).toHaveBeenCalledWith(defender, []);
    expect(seasonStatsRepo.recordWin).toHaveBeenCalledWith(challenger, seasonCache);
    expect(seasonStatsRepo.recordLoss).toHaveBeenCalledWith(defender, seasonCache);
  });

  it("crowns the challenger as new champion and records win/loss when they beat rank 1", async () => {
    const defender = entry({ discordUserId: "u-alice", characterName: "Alice" });
    const challenger = entry({ rank: 2, discordUserId: "u-carl", characterName: "Carl" });

    const result = await recordMatchResult(1, defender, challenger, true);

    expect(result).toEqual({ changed: true, kind: "newChampion", holderName: "Carl" });
    expect(rank1Repo.crownHolder).toHaveBeenCalledWith(challenger);
    expect(rank1Repo.recordWin).toHaveBeenCalledWith(challenger, []);
    expect(rank1Repo.recordLoss).toHaveBeenCalledWith(defender, []);
    expect(seasonStatsRepo.recordWin).toHaveBeenCalledWith(challenger, seasonCache);
    expect(seasonStatsRepo.recordLoss).toHaveBeenCalledWith(defender, seasonCache);
  });

  it("increments the defend total (and win/loss) when the current rank-1 holder wins", async () => {
    const defender = entry({ discordUserId: "u-alice", characterName: "Alice" });
    const challenger = entry({ rank: 2, discordUserId: "u-carl", characterName: "Carl" });
    vi.mocked(rank1Repo.recordDefend).mockResolvedValue(4);

    const result = await recordMatchResult(1, defender, challenger, false);

    expect(result).toEqual({ changed: true, kind: "defended", holderName: "Alice", defends: 4 });
    expect(rank1Repo.recordDefend).toHaveBeenCalledWith(defender);
    expect(seasonStatsRepo.recordDefend).toHaveBeenCalledWith(defender);
    expect(rank1Repo.crownHolder).not.toHaveBeenCalled();
    expect(rank1Repo.recordWin).toHaveBeenCalledWith(defender, []);
    expect(rank1Repo.recordLoss).toHaveBeenCalledWith(challenger, []);
    expect(seasonStatsRepo.recordWin).toHaveBeenCalledWith(defender, seasonCache);
    expect(seasonStatsRepo.recordLoss).toHaveBeenCalledWith(challenger, seasonCache);
  });

  it("still records a first defend when the tracker was empty or out of sync", async () => {
    const defender = entry({ discordUserId: "u-alice", characterName: "Alice" });
    const challenger = entry({ rank: 2, discordUserId: "u-carl", characterName: "Carl" });
    vi.mocked(rank1Repo.recordDefend).mockResolvedValue(1);

    const result = await recordMatchResult(1, defender, challenger, false);

    expect(result).toEqual({ changed: true, kind: "defended", holderName: "Alice", defends: 1 });
    expect(rank1Repo.recordDefend).toHaveBeenCalledWith(defender);
  });
});

describe("recordDodgeAgainst", () => {
  it("delegates to rank1Repo.recordDodgeAgainst and returns its result", async () => {
    const defender = entry({ discordUserId: "u-alice", characterName: "Alice" });
    vi.mocked(rank1Repo.recordDodgeAgainst).mockResolvedValue(5);

    const result = await recordDodgeAgainst(defender);

    expect(result).toBe(5);
    expect(rank1Repo.recordDodgeAgainst).toHaveBeenCalledWith(defender);
  });
});

describe("syncToCurrentHolder", () => {
  it("does nothing when no one is at rank 1", async () => {
    await syncToCurrentHolder([entry({ rank: 2 })]);

    expect(rank1Repo.getCurrentHolderRow).not.toHaveBeenCalled();
    expect(rank1Repo.crownHolder).not.toHaveBeenCalled();
  });

  it("leaves the tracker alone when the rank-1 holder didn't change", async () => {
    vi.mocked(rank1Repo.getCurrentHolderRow).mockResolvedValue(rank1Row({ discordUserId: "u-alice", element: "Fire" }));

    await syncToCurrentHolder([entry({ discordUserId: "u-alice", element: "Fire", rank: 1 })]);

    expect(rank1Repo.crownHolder).not.toHaveBeenCalled();
  });

  it("crowns whoever now holds rank 1 when the holder changed", async () => {
    vi.mocked(rank1Repo.getCurrentHolderRow).mockResolvedValue(rank1Row({ discordUserId: "u-alice", element: "Fire" }));
    const newHolder = entry({ discordUserId: "u-carl", characterName: "Carl", rank: 1 });

    await syncToCurrentHolder([newHolder]);

    expect(rank1Repo.crownHolder).toHaveBeenCalledWith(newHolder);
  });
});
