import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderRow, Rank1Row } from "../src/types.js";

vi.mock("../src/sheets/rank1Repo.js", () => ({
  getRank1Row: vi.fn(),
  setRank1Holder: vi.fn(),
  incrementDefends: vi.fn(),
}));

import * as rank1Repo from "../src/sheets/rank1Repo.js";
import { recordMatchResult } from "../src/domain/rank1Tracker.js";

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
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(rank1Repo.getRank1Row).mockReset();
  vi.mocked(rank1Repo.setRank1Holder).mockReset();
  vi.mocked(rank1Repo.incrementDefends).mockReset();
});

describe("recordMatchResult", () => {
  it("does nothing when the defender wasn't rank 1", async () => {
    const defender = entry({ rank: 5, discordUserId: "u-bob", characterName: "Bob" });
    const challenger = entry({ rank: 8, discordUserId: "u-carl", characterName: "Carl" });

    const result = await recordMatchResult(5, defender, challenger, true);

    expect(result).toEqual({ changed: false });
    expect(rank1Repo.setRank1Holder).not.toHaveBeenCalled();
    expect(rank1Repo.incrementDefends).not.toHaveBeenCalled();
  });

  it("crowns the challenger as new champion when they beat rank 1", async () => {
    const defender = entry({ discordUserId: "u-alice", characterName: "Alice" });
    const challenger = entry({ rank: 2, discordUserId: "u-carl", characterName: "Carl" });

    const result = await recordMatchResult(1, defender, challenger, true);

    expect(result).toEqual({ changed: true, kind: "newChampion", holderName: "Carl" });
    expect(rank1Repo.setRank1Holder).toHaveBeenCalledWith(challenger, 0);
  });

  it("increments the defend count when the current rank-1 holder wins", async () => {
    const defender = entry({ discordUserId: "u-alice", characterName: "Alice" });
    const challenger = entry({ rank: 2, discordUserId: "u-carl", characterName: "Carl" });
    const current: Rank1Row = {
      sheetRow: 2,
      discordUserId: "u-alice",
      discordName: "alice#discord",
      characterName: "Alice",
      element: "Fire",
      build: "Vita",
      defends: 3,
      holderSince: "2026-01-01T00:00:00.000Z",
    };
    vi.mocked(rank1Repo.getRank1Row).mockResolvedValue(current);

    const result = await recordMatchResult(1, defender, challenger, false);

    expect(result).toEqual({ changed: true, kind: "defended", holderName: "Alice", defends: 4 });
    expect(rank1Repo.incrementDefends).toHaveBeenCalledWith(current);
    expect(rank1Repo.setRank1Holder).not.toHaveBeenCalled();
  });

  it("re-initializes the tracker at 1 defend if it was empty or out of sync", async () => {
    const defender = entry({ discordUserId: "u-alice", characterName: "Alice" });
    const challenger = entry({ rank: 2, discordUserId: "u-carl", characterName: "Carl" });
    vi.mocked(rank1Repo.getRank1Row).mockResolvedValue(undefined);

    const result = await recordMatchResult(1, defender, challenger, false);

    expect(result).toEqual({ changed: true, kind: "defended", holderName: "Alice", defends: 1 });
    expect(rank1Repo.setRank1Holder).toHaveBeenCalledWith(defender, 1);
  });
});
