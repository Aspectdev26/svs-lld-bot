import { describe, expect, it } from "vitest";
import { checkChallenge, getEligibleTargets, isTargetReachable } from "../src/domain/challengeRules.js";
import type { LadderRow } from "../src/types.js";

const rules = { challengeRange: 3, topTierSize: 10, topTierChallengeRange: 2 };

function row(rank: number, userId: string, overrides: Partial<LadderRow> = {}): LadderRow {
  return {
    sheetRow: rank + 1,
    rank,
    discordName: `User${userId}`,
    discordUserId: userId,
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

function buildLadder(size: number): LadderRow[] {
  return Array.from({ length: size }, (_, i) => row(i + 1, `u${i + 1}`));
}

describe("checkChallenge - basic range", () => {
  it("allows challenging within 3 ranks up", () => {
    const ladder = buildLadder(12);
    const challenger = ladder.find((r) => r.rank === 5)!;
    const defender = ladder.find((r) => r.rank === 4)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: false,
      rules,
    });
    expect(result).toBeNull();
  });

  it("rejects challenging more than 3 ranks up", () => {
    const ladder = buildLadder(12);
    const challenger = ladder.find((r) => r.rank === 5)!;
    const defender = ladder.find((r) => r.rank === 1)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: false,
      rules,
    });
    expect(result).toMatch(/more than 3 ranks/);
  });

  it("rejects challenging downward", () => {
    const ladder = buildLadder(12);
    const challenger = ladder.find((r) => r.rank === 5)!;
    const defender = ladder.find((r) => r.rank === 6)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: false,
      rules,
    });
    expect(result).toMatch(/ranked above you/);
  });

  it("rejects self-challenge", () => {
    const ladder = buildLadder(12);
    const challenger = ladder.find((r) => r.rank === 5)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender: challenger,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: false,
      rules,
    });
    expect(result).toMatch(/challenge yourself/);
  });
});

describe("checkChallenge - top tier sub-rule", () => {
  it("allows a rank-12 player to challenge rank-10 (2 ranks below)", () => {
    const ladder = buildLadder(15);
    const challenger = ladder.find((r) => r.rank === 12)!;
    const defender = ladder.find((r) => r.rank === 10)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: false,
      rules,
    });
    expect(result).toBeNull();
  });

  it("rejects a rank-13 player challenging rank-10 (3 ranks below, exceeds top-tier limit of 2)", () => {
    const ladder = buildLadder(15);
    const challenger = ladder.find((r) => r.rank === 13)!;
    const defender = ladder.find((r) => r.rank === 10)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: false,
      rules,
    });
    expect(result).toMatch(/top 10/);
  });
});

describe("checkChallenge - vacation and pending matches", () => {
  it("rejects challenging a player on vacation", () => {
    const ladder = buildLadder(12).map((r) => (r.rank === 4 ? { ...r, status: "Vacation" as const } : r));
    const challenger = ladder.find((r) => r.rank === 5)!;
    const defender = ladder.find((r) => r.rank === 4)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: false,
      rules,
    });
    expect(result).toMatch(/Vacation/);
  });

  it("rejects when the challenger already has a pending match", () => {
    const ladder = buildLadder(12);
    const challenger = ladder.find((r) => r.rank === 5)!;
    const defender = ladder.find((r) => r.rank === 4)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender,
      challengerHasPendingMatch: true,
      defenderHasPendingMatch: false,
      rules,
    });
    expect(result).toMatch(/already has a match in progress|match in progress/);
  });

  it("rejects when the defender already has a pending match", () => {
    const ladder = buildLadder(12);
    const challenger = ladder.find((r) => r.rank === 5)!;
    const defender = ladder.find((r) => r.rank === 4)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: true,
      rules,
    });
    expect(result).toMatch(/match in progress/);
  });
});

describe("checkChallenge - post-loss cooldown", () => {
  it("rejects re-challenging the same defender while a cooldown is active", () => {
    const ladder = buildLadder(12);
    const challenger = ladder.find((r) => r.rank === 5)!;
    const defender = ladder.find((r) => r.rank === 4)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: false,
      cooldownExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      rules,
    });
    expect(result).toMatch(/cooldown/);
  });

  it("allows the challenge once no cooldown is passed in", () => {
    const ladder = buildLadder(12);
    const challenger = ladder.find((r) => r.rank === 5)!;
    const defender = ladder.find((r) => r.rank === 4)!;
    const result = checkChallenge({
      ladder,
      challenger,
      defender,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: false,
      cooldownExpiresAt: null,
      rules,
    });
    expect(result).toBeNull();
  });
});

describe("getEligibleTargets - Vacation skipping", () => {
  it("does not count a Vacationing player's row against the range either", () => {
    const ladder = buildLadder(6).map((r) => (r.rank === 3 ? { ...r, status: "Vacation" as const } : r));
    const challenger = ladder.find((r) => r.rank === 5)!;

    const eligible = getEligibleTargets(ladder, challenger, rules);
    const ranks = eligible.map((e) => e.row.rank);

    // Rank 3 is on Vacation: skipped, doesn't consume a step, and range still reaches ranks 4, 2, 1.
    expect(ranks).not.toContain(3);
    expect(ranks).toEqual([4, 2, 1]);
  });
});

describe("isTargetReachable - top-tier display filtering", () => {
  it("marks a top-tier target beyond topTierChallengeRange as unreachable, matching checkChallenge's rejection", () => {
    const ladder = buildLadder(15);
    const challenger = ladder.find((r) => r.rank === 13)!;
    const eligible = getEligibleTargets(ladder, challenger, rules);
    const rank10Target = eligible.find((e) => e.row.rank === 10)!;

    expect(isTargetReachable(rank10Target, rules)).toBe(false);
    // The reachable subset (what a target-select menu should show) must exclude it.
    expect(eligible.filter((e) => isTargetReachable(e, rules)).map((e) => e.row.rank)).not.toContain(10);

    // And checkChallenge independently rejects the same target for the same reason.
    const result = checkChallenge({
      ladder,
      challenger,
      defender: ladder.find((r) => r.rank === 10)!,
      challengerHasPendingMatch: false,
      defenderHasPendingMatch: false,
      rules,
    });
    expect(result).toMatch(/top 10/);
  });

  it("marks in-range, non-top-tier targets as reachable", () => {
    const ladder = buildLadder(15);
    // Challenger is well below the top tier (topTierSize: 10), so none of ranks 13/12/11 are
    // top-tier — the tighter topTierChallengeRange never applies to them.
    const challenger = ladder.find((r) => r.rank === 14)!;
    const eligible = getEligibleTargets(ladder, challenger, rules);

    expect(eligible.map((e) => e.row.rank)).toEqual([13, 12, 11]);
    for (const target of eligible) {
      expect(isTargetReachable(target, rules)).toBe(true);
    }
  });
});
