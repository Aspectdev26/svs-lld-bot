import type { LadderRow } from "../types.js";

export interface ChallengeRuleConfig {
  challengeRange: number;
  topTierSize: number;
  topTierChallengeRange: number;
}

export interface EligibleTarget {
  row: LadderRow;
  /** 1-indexed position among the reachable rows above the challenger (closest = 1). */
  step: number;
}

/**
 * Walks upward from the challenger's rank (toward rank 1), skipping any row whose player is on
 * Vacation (doesn't consume a step and can't be challenged), and collects up to
 * `rules.challengeRange` reachable rows.
 */
export function getEligibleTargets(
  ladder: LadderRow[],
  challenger: LadderRow,
  rules: ChallengeRuleConfig,
): EligibleTarget[] {
  const sortedAsc = [...ladder].sort((a, b) => a.rank - b.rank);
  const idx = sortedAsc.findIndex((r) => r.sheetRow === challenger.sheetRow);
  const results: EligibleTarget[] = [];
  if (idx === -1) return results;

  let step = 0;
  for (let i = idx - 1; i >= 0 && step < rules.challengeRange; i--) {
    const row = sortedAsc[i];
    if (row.discordUserId === challenger.discordUserId) continue;
    if (row.status === "Vacation") continue;
    step++;
    results.push({ row, step });
  }
  return results;
}

/** Whether `target` (from {@link getEligibleTargets}) is actually within reach given the top-tier sub-rule. */
export function isTargetReachable(target: EligibleTarget, rules: ChallengeRuleConfig): boolean {
  return !(target.row.rank <= rules.topTierSize && target.step > rules.topTierChallengeRange);
}

export interface ChallengeCheckParams {
  ladder: LadderRow[];
  challenger: LadderRow;
  defender: LadderRow;
  /** Whether the challenger already has a pending match. */
  challengerHasPendingMatch: boolean;
  /** Whether the defender already has a pending match. */
  defenderHasPendingMatch: boolean;
  /** When the challenger's post-loss cooldown against this exact defender lifts, if they're currently on one. */
  cooldownExpiresAt?: Date | null;
  rules: ChallengeRuleConfig;
}

/** Returns null if the challenge is allowed, otherwise a human-readable rejection reason. */
export function checkChallenge(params: ChallengeCheckParams): string | null {
  const { ladder, challenger, defender, challengerHasPendingMatch, defenderHasPendingMatch, cooldownExpiresAt, rules } = params;

  if (challenger.discordUserId === defender.discordUserId) {
    return "you can't challenge yourself.";
  }
  if (challenger.status === "Vacation") {
    return "you're currently on Vacation and can't issue challenges.";
  }
  if (defender.status === "Vacation") {
    return `${defender.discordName} is currently on Vacation and can't be challenged.`;
  }
  if (cooldownExpiresAt) {
    const expiresUnix = Math.floor(cooldownExpiresAt.getTime() / 1000);
    return `you're on a cooldown after losing to ${defender.discordName} — you can challenge them again <t:${expiresUnix}:R> (<t:${expiresUnix}:f>).`;
  }
  if (challengerHasPendingMatch) {
    return "you already have a match in progress — resolve it before challenging again.";
  }
  if (defenderHasPendingMatch) {
    return `${defender.discordName} already has a match in progress and can't be challenged right now.`;
  }
  if (defender.rank >= challenger.rank) {
    return "you can only challenge players ranked above you.";
  }

  const eligible = getEligibleTargets(ladder, challenger, rules);
  const match = eligible.find((e) => e.row.sheetRow === defender.sheetRow);

  if (!match) {
    return `that's more than ${rules.challengeRange} ranks above you.`;
  }
  if (!isTargetReachable(match, rules)) {
    return `${defender.discordName} is ranked in the top ${rules.topTierSize} — only players within ${rules.topTierChallengeRange} ranks of them may challenge.`;
  }

  return null;
}
