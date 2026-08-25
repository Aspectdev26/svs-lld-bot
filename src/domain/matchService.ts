import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import * as ladderRepo from "../sheets/ladderRepo.js";
import * as matchesRepo from "../sheets/matchesRepo.js";
import { swapRanks } from "./rankingService.js";
import * as rank1Tracker from "./rank1Tracker.js";
import { formatChallengeDate } from "../util/formatDate.js";
import type { Rank1Update } from "./rank1Tracker.js";
import type { Element, LadderRow, MatchRow } from "../types.js";

export function genId(): string {
  return randomUUID().slice(0, 8);
}

/** A player is limited to one pending match per element-entry, not one pending match overall. */
export async function entryHasPendingMatch(discordUserId: string, element: Element): Promise<boolean> {
  const match = await matchesRepo.getPendingMatchForEntry(discordUserId, element);
  return match !== undefined;
}

/**
 * If `challengerElement`'s entry most recently lost to `defenderElement`'s entry within the
 * configured cooldown window, returns when that cooldown lifts; otherwise null. Only a reported
 * loss counts — a dodge-approved match always credits the win to its own challenger, so it can
 * never represent this challenger losing.
 */
export async function getChallengeCooldownExpiry(
  challengerUserId: string,
  challengerElement: Element,
  defenderUserId: string,
  defenderElement: Element,
): Promise<Date | null> {
  const all = await matchesRepo.getAllMatches();
  const losses = all.filter(
    (m) =>
      m.status === "Reported" &&
      m.challengerUserId === challengerUserId &&
      m.challengerElement === challengerElement &&
      m.defenderUserId === defenderUserId &&
      m.defenderElement === defenderElement &&
      m.winnerUserId === defenderUserId,
  );
  if (losses.length === 0) return null;

  const mostRecentResolvedAt = losses.reduce((latest, m) => (m.resolvedAt > latest ? m.resolvedAt : latest), "");
  const expiry = new Date(Date.parse(mostRecentResolvedAt) + config.timing.challengeCooldownMs);
  return expiry.getTime() > Date.now() ? expiry : null;
}

/** Fetches both ladder entries for a match and clears their Ladder-sheet "Challenge" display. */
async function clearLadderChallengeDisplay(match: MatchRow): Promise<void> {
  const [challengerEntry, defenderEntry] = await Promise.all([
    ladderRepo.findEntry(match.challengerUserId, match.challengerElement),
    ladderRepo.findEntry(match.defenderUserId, match.defenderElement),
  ]);
  if (challengerEntry) await ladderRepo.clearChallengeInfo(challengerEntry.sheetRow);
  if (defenderEntry) await ladderRepo.clearChallengeInfo(defenderEntry.sheetRow);
}

export async function createMatch(challenger: LadderRow, defender: LadderRow): Promise<MatchRow> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.timing.matchLifespanMs);

  const match: Omit<MatchRow, "sheetRow"> = {
    matchId: genId(),
    challengerUserId: challenger.discordUserId,
    challengerElement: challenger.element,
    challengerRank: challenger.rank,
    defenderUserId: defender.discordUserId,
    defenderElement: defender.element,
    defenderRank: defender.rank,
    status: "Pending",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    warningSentAt: "",
    winnerUserId: "",
    resolvedAt: "",
    channelId: "",
    extensionPending: false,
    cancelRequestedByUserId: "",
  };
  await matchesRepo.addMatch(match);

  const challengeDateDisplay = formatChallengeDate(match.createdAt);
  await ladderRepo.setChallengeInfo(challenger.sheetRow, defender.rank, challengeDateDisplay);
  await ladderRepo.setChallengeInfo(defender.sheetRow, challenger.rank, challengeDateDisplay);

  const stored = await matchesRepo.getMatchById(match.matchId);
  return stored ?? { ...match, sheetRow: -1 };
}

export type ReportWinResult =
  | { ok: true; match: MatchRow; winnerMovedUp: boolean; rank1Update: Rank1Update }
  | { ok: false; reason: string };

/**
 * Either participant may report a result (no confirmation step) — `reporterUserId` just has to be
 * one of the two participants, while `winnerUserId` is whichever side they picked from the
 * winner dropdown (their own side for a self-report, or the opponent's to concede/correct).
 * `matchId` disambiguates which of the reporter's (possibly several, one-per-element) pending
 * matches this result applies to.
 */
export async function reportWin(reporterUserId: string, matchId: string, winnerUserId: string): Promise<ReportWinResult> {
  const match = await matchesRepo.getMatchById(matchId);
  if (!match || match.status !== "Pending") {
    return { ok: false, reason: "that match isn't currently active." };
  }
  const participants = [match.challengerUserId, match.defenderUserId];
  if (!participants.includes(reporterUserId)) {
    return { ok: false, reason: "you're not a participant in that match." };
  }
  if (!participants.includes(winnerUserId)) {
    return { ok: false, reason: "that's not a participant in this match." };
  }

  const winnerIsChallenger = winnerUserId === match.challengerUserId;
  let winnerMovedUp = false;
  let rank1Update: Rank1Update = { changed: false };

  const [challengerEntry, defenderEntry] = await Promise.all([
    ladderRepo.findEntry(match.challengerUserId, match.challengerElement),
    ladderRepo.findEntry(match.defenderUserId, match.defenderElement),
  ]);

  if (challengerEntry && defenderEntry) {
    const preMatchDefenderRank = defenderEntry.rank;
    rank1Update = await rank1Tracker.recordMatchResult(
      preMatchDefenderRank,
      defenderEntry,
      challengerEntry,
      winnerIsChallenger,
    );

    if (winnerIsChallenger) {
      const { challengerRank, defenderRank } = swapRanks(challengerEntry, defenderEntry);
      await ladderRepo.setRank(challengerEntry.sheetRow, challengerRank);
      await ladderRepo.setRank(defenderEntry.sheetRow, defenderRank);
      winnerMovedUp = true;
    }

    await ladderRepo.clearChallengeInfo(challengerEntry.sheetRow);
    await ladderRepo.clearChallengeInfo(defenderEntry.sheetRow);

    // Rank changes only update the Rank value in place — re-sort so the raw sheet stays in
    // visual top-to-bottom rank order.
    if (winnerMovedUp) await ladderRepo.sortLadderByRank();
  }

  match.status = "Reported";
  match.winnerUserId = winnerUserId;
  match.resolvedAt = new Date().toISOString();
  await matchesRepo.updateMatch(match);

  return { ok: true, match, winnerMovedUp, rank1Update };
}

export async function expireMatch(match: MatchRow): Promise<void> {
  match.status = "Expired";
  match.resolvedAt = new Date().toISOString();
  await matchesRepo.updateMatch(match);
  await clearLadderChallengeDisplay(match);
}

/** Admin override / ban side-effect: voids a match with no rank change. */
export async function cancelMatch(match: MatchRow): Promise<void> {
  match.status = "Cancelled";
  match.resolvedAt = new Date().toISOString();
  await matchesRepo.updateMatch(match);
  await clearLadderChallengeDisplay(match);
}

/** Apply a dodge-approved win for the challenger (same rank-swap rule as a normal reported win). */
export async function applyDodgeWin(match: MatchRow): Promise<Rank1Update> {
  const [challengerEntry, defenderEntry] = await Promise.all([
    ladderRepo.findEntry(match.challengerUserId, match.challengerElement),
    ladderRepo.findEntry(match.defenderUserId, match.defenderElement),
  ]);

  let rank1Update: Rank1Update = { changed: false };

  if (challengerEntry && defenderEntry) {
    rank1Update = await rank1Tracker.recordMatchResult(defenderEntry.rank, defenderEntry, challengerEntry, true);
    const { challengerRank, defenderRank } = swapRanks(challengerEntry, defenderEntry);
    await ladderRepo.setRank(challengerEntry.sheetRow, challengerRank);
    await ladderRepo.setRank(defenderEntry.sheetRow, defenderRank);
    await ladderRepo.setDodgeWins(challengerEntry.sheetRow, challengerEntry.dodgeWins + 1);
    await ladderRepo.clearChallengeInfo(challengerEntry.sheetRow);
    await ladderRepo.clearChallengeInfo(defenderEntry.sheetRow);

    // Rank changes only update the Rank value in place — re-sort so the raw sheet stays in
    // visual top-to-bottom rank order.
    await ladderRepo.sortLadderByRank();
  }
  match.status = "DodgeApproved";
  match.winnerUserId = match.challengerUserId;
  match.resolvedAt = new Date().toISOString();
  await matchesRepo.updateMatch(match);

  return rank1Update;
}
