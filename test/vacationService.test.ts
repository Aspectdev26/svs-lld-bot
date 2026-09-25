import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtendedVacationRow, LadderRow, MatchRow } from "../src/types.js";

vi.mock("../src/sheets/ladderRepo.js", () => ({
  getLadder: vi.fn(),
  addLadderEntry: vi.fn(),
  findEntry: vi.fn(),
}));
vi.mock("../src/sheets/extendedVacationRepo.js", () => ({
  removeEntry: vi.fn(),
}));
vi.mock("../src/sheets/vacationRequestsRepo.js", () => ({}));
vi.mock("../src/domain/adminService.js", () => ({
  removePlayer: vi.fn(),
  setManualRank: vi.fn(),
}));
vi.mock("../src/domain/matchService.js", () => ({
  genId: vi.fn(),
  entryHasPendingMatch: vi.fn(),
  createMatch: vi.fn(),
}));

import * as ladderRepo from "../src/sheets/ladderRepo.js";
import * as matchService from "../src/domain/matchService.js";
import { setManualRank } from "../src/domain/adminService.js";
import { returnFromExtendedVacation } from "../src/domain/vacationService.js";

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

const evacRow: ExtendedVacationRow = {
  sheetRow: 2,
  discordUserId: "elsa",
  discordName: "elsa#1",
  characterName: "Elsa",
  element: "Cold",
  build: "Vita",
  rankAtEntry: 3,
  enteredAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-08-31T00:00:00.000Z",
  source: "Requested",
  approvedByUserId: "lm",
  warningSentAt: "",
};

beforeEach(() => {
  vi.mocked(ladderRepo.getLadder).mockReset();
  vi.mocked(ladderRepo.addLadderEntry).mockReset();
  vi.mocked(ladderRepo.findEntry).mockReset();
  vi.mocked(setManualRank).mockReset();
  vi.mocked(matchService.entryHasPendingMatch).mockReset().mockResolvedValue(false);
  vi.mocked(matchService.createMatch).mockReset().mockResolvedValue({ matchId: "m1" } as MatchRow);
});

describe("returnFromExtendedVacation", () => {
  it("re-finds the returner after setManualRank re-sorts the sheet, and challenges the old rank holder", async () => {
    const a = entry({ discordUserId: "a", characterName: "A", rank: 1, sheetRow: 2 });
    const b = entry({ discordUserId: "b", characterName: "B", rank: 2, sheetRow: 3 });
    const c = entry({ discordUserId: "c", characterName: "C", rank: 3, sheetRow: 4 });
    const d = entry({ discordUserId: "d", characterName: "D", rank: 4, sheetRow: 5 });

    // Appended at the bottom (sheet row 6), then setManualRank inserts at rank 4 and re-sorts,
    // so Elsa lands on sheet row 5 and D (now rank 5) sorts into sheet row 6.
    const elsaAppended = entry({ discordUserId: "elsa", characterName: "Elsa", rank: 5, sheetRow: 6 });
    vi.mocked(ladderRepo.findEntry).mockResolvedValue(elsaAppended);
    vi.mocked(ladderRepo.getLadder)
      .mockResolvedValueOnce([a, b, c, d])
      .mockResolvedValueOnce([
        a,
        b,
        c,
        entry({ discordUserId: "elsa", characterName: "Elsa", rank: 4, sheetRow: 5 }),
        entry({ discordUserId: "d", characterName: "D", rank: 5, sheetRow: 6 }),
      ]);

    const result = await returnFromExtendedVacation(evacRow);

    expect(setManualRank).toHaveBeenCalledWith(6, 4);
    expect(result.entry.discordUserId).toBe("elsa");
    expect(result.entry.rank).toBe(4);
    expect(result.opponentEntry?.discordUserId).toBe("c");
    expect(matchService.createMatch).toHaveBeenCalledWith(
      expect.objectContaining({ discordUserId: "elsa", rank: 4 }),
      expect.objectContaining({ discordUserId: "c", rank: 3 }),
    );
  });
});
