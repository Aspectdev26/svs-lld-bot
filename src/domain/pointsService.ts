import * as matchesRepo from "../sheets/matchesRepo.js";
import * as pointsStore from "./pointsStore.js";

/**
 * Private, admin-only activity score — never exposed to players anywhere. Deliberately weighted
 * toward completing/reporting matches promptly rather than toward winning, so it serves "keep the
 * ladder active" rather than just re-ranking skill. See the League Manager DM for the full formula.
 */

const HOUR_MS = 60 * 60 * 1000;
const MATCH_COMPLETED_POINTS = 3;
const CHALLENGE_ISSUED_POINTS = 1;
const CHALLENGE_ISSUED_WEEKLY_CAP = 2;
const CHALLENGE_ISSUED_WINDOW_MS = 7 * 24 * HOUR_MS;
const EXTENSION_REQUESTED_POINTS = -1;
const DODGE_AGAINST_POINTS = -3;
const MATCH_EXPIRED_POINTS = -4;
const DEFEND_POINTS = 4;

/** Tiered bonus on top of MATCH_COMPLETED_POINTS, based on how fast the result came in. */
export function speedBonus(createdAt: string, resolvedAt: string): number {
  const elapsedMs = Date.parse(resolvedAt) - Date.parse(createdAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  if (elapsedMs <= 24 * HOUR_MS) return 3;
  if (elapsedMs <= 48 * HOUR_MS) return 2;
  if (elapsedMs <= 72 * HOUR_MS) return 1;
  return 0;
}

/**
 * Awards the challenge-issuance bonus, capped at CHALLENGE_ISSUED_WEEKLY_CAP per player within the
 * rolling CHALLENGE_ISSUED_WINDOW_MS window ending at `asOf` (the match's own createdAt, not
 * necessarily "now") — using the match's own timestamp as the reference point is what lets this same
 * function produce correct, order-independent results during a historical backfill as well as live.
 */
export async function recordChallengeIssued(discordUserId: string, discordName: string, asOf: string): Promise<void> {
  const asOfMs = Date.parse(asOf);
  const windowStartMs = asOfMs - CHALLENGE_ISSUED_WINDOW_MS;

  const all = await matchesRepo.getAllMatches();
  const countInWindow = all.filter((m) => {
    if (m.challengerUserId !== discordUserId) return false;
    const createdAtMs = Date.parse(m.createdAt);
    return createdAtMs > windowStartMs && createdAtMs <= asOfMs;
  }).length;

  // countInWindow includes the match we're currently awarding for (its row already exists in the
  // sheet by the time this is called), so the cap check is `<=` against the cap, not `<`.
  if (countInWindow <= CHALLENGE_ISSUED_WEEKLY_CAP) {
    await pointsStore.addPoints(discordUserId, discordName, CHALLENGE_ISSUED_POINTS);
  }
}

export async function recordMatchCompleted(
  discordUserId: string,
  discordName: string,
  createdAt: string,
  resolvedAt: string,
): Promise<void> {
  await pointsStore.addPoints(discordUserId, discordName, MATCH_COMPLETED_POINTS + speedBonus(createdAt, resolvedAt));
}

export async function recordDodgeAgainst(discordUserId: string, discordName: string): Promise<void> {
  await pointsStore.addPoints(discordUserId, discordName, DODGE_AGAINST_POINTS);
}

/** Rank-1 title defense only — a challenger can never already hold rank 1, so this never applies to them. */
export async function recordDefend(discordUserId: string, discordName: string): Promise<void> {
  await pointsStore.addPoints(discordUserId, discordName, DEFEND_POINTS);
}

export async function recordMatchExpired(discordUserId: string, discordName: string): Promise<void> {
  await pointsStore.addPoints(discordUserId, discordName, MATCH_EXPIRED_POINTS);
}

/** Live-only — never called from the retroactive backfill, since past requesters were never recorded. */
export async function recordExtensionRequested(discordUserId: string, discordName: string): Promise<void> {
  await pointsStore.addPoints(discordUserId, discordName, EXTENSION_REQUESTED_POINTS);
}
