import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchRow } from "../src/types.js";

vi.mock("../src/sheets/settingsRepo.js", () => ({
  getSettings: vi.fn(),
  setPaused: vi.fn(),
}));
vi.mock("../src/sheets/matchesRepo.js", () => ({
  getPendingMatches: vi.fn(),
  setExpiresAt: vi.fn(),
}));

import * as settingsRepo from "../src/sheets/settingsRepo.js";
import * as matchesRepo from "../src/sheets/matchesRepo.js";
import { isLadderPaused, pauseLadder, resumeLadder } from "../src/domain/ladderPauseService.js";

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
  vi.mocked(settingsRepo.getSettings).mockReset();
  vi.mocked(settingsRepo.setPaused).mockReset();
  vi.mocked(matchesRepo.getPendingMatches).mockReset().mockResolvedValue([]);
  vi.mocked(matchesRepo.setExpiresAt).mockReset();
});

describe("isLadderPaused", () => {
  it("reflects the settings row", async () => {
    vi.mocked(settingsRepo.getSettings).mockResolvedValue({ paused: true, pausedAt: "2026-01-01T00:00:00.000Z" });
    expect(await isLadderPaused()).toBe(true);
  });
});

describe("pauseLadder", () => {
  it("pauses and records a timestamp", async () => {
    vi.mocked(settingsRepo.getSettings).mockResolvedValue({ paused: false, pausedAt: "" });

    const result = await pauseLadder();

    expect(result.ok).toBe(true);
    expect(settingsRepo.setPaused).toHaveBeenCalledWith(true, expect.any(String));
  });

  it("rejects pausing an already-paused ladder", async () => {
    vi.mocked(settingsRepo.getSettings).mockResolvedValue({ paused: true, pausedAt: "2026-01-01T00:00:00.000Z" });

    const result = await pauseLadder();

    expect(result.ok).toBe(false);
    expect(settingsRepo.setPaused).not.toHaveBeenCalled();
  });
});

describe("resumeLadder", () => {
  it("rejects resuming a ladder that isn't paused", async () => {
    vi.mocked(settingsRepo.getSettings).mockResolvedValue({ paused: false, pausedAt: "" });

    const result = await resumeLadder();

    expect(result.ok).toBe(false);
    expect(matchesRepo.setExpiresAt).not.toHaveBeenCalled();
  });

  it("shifts every pending match's expiry forward by the paused duration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z")); // paused for exactly 1 day
    vi.mocked(settingsRepo.getSettings).mockResolvedValue({ paused: true, pausedAt: "2026-01-01T00:00:00.000Z" });
    const pending = matchRow({ sheetRow: 5, expiresAt: "2026-01-04T00:00:00.000Z" });
    vi.mocked(matchesRepo.getPendingMatches).mockResolvedValue([pending]);

    const result = await resumeLadder();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.shiftedMatchCount).toBe(1);
    expect(matchesRepo.setExpiresAt).toHaveBeenCalledWith(5, "2026-01-05T00:00:00.000Z");
    expect(settingsRepo.setPaused).toHaveBeenCalledWith(false, "");
    vi.useRealTimers();
  });

  it("does not shift expiries when the pause duration is zero or unknown", async () => {
    vi.mocked(settingsRepo.getSettings).mockResolvedValue({ paused: true, pausedAt: "" });
    vi.mocked(matchesRepo.getPendingMatches).mockResolvedValue([matchRow()]);

    const result = await resumeLadder();

    expect(result.ok).toBe(true);
    expect(matchesRepo.setExpiresAt).not.toHaveBeenCalled();
  });
});
