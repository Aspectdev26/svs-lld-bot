import { config } from "../config.js";
import * as ladderRepo from "../sheets/ladderRepo.js";
import * as vacationRequestsRepo from "../sheets/vacationRequestsRepo.js";
import * as extendedVacationRepo from "../sheets/extendedVacationRepo.js";
import * as matchService from "./matchService.js";
import { removePlayer, setManualRank } from "./adminService.js";
import { nextRankForNewEntry } from "./rankingService.js";
import { formatElement } from "../util/formatElement.js";
import type { ExtendedVacationRow, ExtendedVacationSource, LadderRow, MatchRow, VacationRequestRow, VacationRequestType } from "../types.js";

export type CreateVacationRequestResult = { ok: true; request: VacationRequestRow } | { ok: false; reason: string };

async function createRequest(entry: LadderRow, requestType: VacationRequestType): Promise<CreateVacationRequestResult> {
  if (requestType === "Vacation" && entry.status === "Vacation") {
    return { ok: false, reason: `Your **${formatElement(entry.element)}** entry is already on Vacation.` };
  }

  const pending = await vacationRequestsRepo.getPendingRequestForUserElement(entry.discordUserId, entry.element);
  if (pending) {
    return {
      ok: false,
      reason: `You already have a pending **${pending.requestType === "Vacation" ? "Vacation" : "Extended Vacation"}** request for **${formatElement(entry.element)}** awaiting review.`,
    };
  }

  const request: Omit<VacationRequestRow, "sheetRow"> = {
    requestId: matchService.genId(),
    discordUserId: entry.discordUserId,
    discordName: entry.discordName,
    characterName: entry.characterName,
    element: entry.element,
    build: entry.build,
    requestType,
    status: "Pending",
    requestedAt: new Date().toISOString(),
    resolvedByUserId: "",
    resolvedAt: "",
    denyReason: "",
    leagueManagerMessageUrl: "",
  };
  await vacationRequestsRepo.addRequest(request);
  const stored = await vacationRequestsRepo.getRequestById(request.requestId);
  return { ok: true, request: stored ?? { ...request, sheetRow: -1 } };
}

export function createVacationRequest(entry: LadderRow): Promise<CreateVacationRequestResult> {
  return createRequest(entry, "Vacation");
}

export function createExtendedVacationRequest(entry: LadderRow): Promise<CreateVacationRequestResult> {
  return createRequest(entry, "ExtendedVacation");
}

export async function denyVacationRequest(request: VacationRequestRow, resolvedByUserId: string, reason: string): Promise<void> {
  request.status = "Denied";
  request.resolvedByUserId = resolvedByUserId;
  request.resolvedAt = new Date().toISOString();
  request.denyReason = reason;
  await vacationRequestsRepo.updateRequest(request);
}

/** Sets an entry to Vacation and starts its 14-day clock. Marks `request` Approved. */
export async function approveVacationRequest(request: VacationRequestRow, resolvedByUserId: string, entry: LadderRow): Promise<void> {
  await ladderRepo.setStatusForEntry(entry.sheetRow, "Vacation");
  await ladderRepo.setVacationSince(entry.sheetRow, new Date().toISOString());
  await ladderRepo.setVacationWarningSentAt(entry.sheetRow, "");

  request.status = "Approved";
  request.resolvedByUserId = resolvedByUserId;
  request.resolvedAt = new Date().toISOString();
  await vacationRequestsRepo.updateRequest(request);
}

/** Self-service return from regular Vacation — clears the entry back to Available with no approval step. */
export async function returnFromVacation(entry: LadderRow): Promise<void> {
  await ladderRepo.setStatusForEntry(entry.sheetRow, "Available");
  await ladderRepo.setVacationSince(entry.sheetRow, "");
  await ladderRepo.setVacationWarningSentAt(entry.sheetRow, "");
}

/** Removes `entry` from the ladder and logs it to the Extended Vacation ledger with a fresh 30-day clock. */
async function enterExtendedVacation(entry: LadderRow, source: ExtendedVacationSource, approvedByUserId: string): Promise<void> {
  await removePlayer(entry.discordUserId, entry.element);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.timing.extendedVacationExpiryMs);
  await extendedVacationRepo.addEntry({
    discordUserId: entry.discordUserId,
    discordName: entry.discordName,
    characterName: entry.characterName,
    element: entry.element,
    build: entry.build,
    rankAtEntry: entry.rank,
    enteredAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    source,
    approvedByUserId,
    warningSentAt: "",
  });
}

/** Approved League-Manager request path: removes `entry` from the ladder into Extended Vacation. Marks `request` Approved. */
export async function approveExtendedVacationRequest(request: VacationRequestRow, resolvedByUserId: string, entry: LadderRow): Promise<void> {
  await enterExtendedVacation(entry, "Requested", resolvedByUserId);

  request.status = "Approved";
  request.resolvedByUserId = resolvedByUserId;
  request.resolvedAt = new Date().toISOString();
  await vacationRequestsRepo.updateRequest(request);
}

/** Scheduler path: a 14-day-unreturned Vacation auto-escalates into Extended Vacation with no League Manager involved. */
export function autoEscalateToExtendedVacation(entry: LadderRow): Promise<void> {
  return enterExtendedVacation(entry, "AutoEscalated", "");
}

export interface ReturnFromExtendedVacationResult {
  /** The re-added ladder entry, at its final (post-shift) rank. */
  entry: LadderRow;
  /** Set only if an auto-challenge was created against whoever currently holds the entry's old rank. */
  match?: MatchRow;
  opponentEntry?: LadderRow;
}

/**
 * Self-service return from Extended Vacation: reinserts the entry at `rankAtEntry + 1` (shifting
 * everyone from that position down by one — reuses the same "Set Rank" mechanics as the admin
 * manual-rank override), then auto-issues a challenge against whoever now holds `rankAtEntry`
 * (unchanged by the insert), unless that entry already has a pending match, in which case the
 * returner just settles at the new rank as a normal Available entry.
 */
export async function returnFromExtendedVacation(evacRow: ExtendedVacationRow): Promise<ReturnFromExtendedVacationResult> {
  const ladderBeforeAdd = await ladderRepo.getLadder();
  const bottomRank = nextRankForNewEntry(ladderBeforeAdd);

  const newEntryData: Omit<LadderRow, "sheetRow"> = {
    rank: bottomRank,
    characterName: evacRow.characterName,
    build: evacRow.build,
    element: evacRow.element,
    discordName: evacRow.discordName,
    discordUserId: evacRow.discordUserId,
    status: "Available",
    joinedAt: "",
    challengeDate: "",
    opponentRank: "",
    notes: "",
    dodgeWins: 0,
    dodgeCount: 0,
    vacationSince: "",
    vacationWarningSentAt: "",
  };
  await ladderRepo.addLadderEntry(newEntryData);

  const added = await ladderRepo.findEntry(evacRow.discordUserId, evacRow.element);
  if (!added) {
    throw new Error(`Failed to re-add ladder entry for ${evacRow.discordUserId} (${evacRow.element}) returning from Extended Vacation`);
  }

  await setManualRank(added.sheetRow, evacRow.rankAtEntry + 1);
  await extendedVacationRepo.removeEntry(evacRow.sheetRow);

  const updatedLadder = await ladderRepo.getLadder();
  const finalEntry = updatedLadder.find((r) => r.sheetRow === added.sheetRow) ?? added;

  const oldRankHolder = updatedLadder.find((r) => r.rank === evacRow.rankAtEntry && r.sheetRow !== finalEntry.sheetRow);
  if (!oldRankHolder) {
    return { entry: finalEntry };
  }

  const opponentHasPending = await matchService.entryHasPendingMatch(oldRankHolder.discordUserId, oldRankHolder.element);
  if (opponentHasPending) {
    return { entry: finalEntry };
  }

  const match = await matchService.createMatch(finalEntry, oldRankHolder);
  return { entry: finalEntry, match, opponentEntry: oldRankHolder };
}
