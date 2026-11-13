import { randomUUID } from "node:crypto";
import * as ladderRepo from "../sheets/ladderRepo.js";
import * as rank1Repo from "../sheets/rank1Repo.js";
import * as signupRequestsRepo from "../sheets/signupRequestsRepo.js";
import * as bannedRepo from "../sheets/bannedRepo.js";
import * as extendedVacationRepo from "../sheets/extendedVacationRepo.js";
import { nextRankForNewEntry } from "./rankingService.js";
import { enqueueResolution } from "./resolutionQueue.js";
import type { LadderRow, SignupRequestRow } from "../types.js";

function genId(): string {
  return randomUUID().slice(0, 8);
}

export type CreateSignupResult =
  | { ok: true; request: SignupRequestRow }
  | { ok: false; reason: string };

export async function createSignupRequest(discordUserId: string, discordName: string): Promise<CreateSignupResult> {
  const ban = await bannedRepo.isBanned(discordUserId);
  if (ban) {
    return { ok: false, reason: `You're banned from signing up${ban.reason ? ` (reason: ${ban.reason})` : ""}.` };
  }
  const existingEntry = await ladderRepo.findEntry(discordUserId);
  if (existingEntry) {
    return { ok: false, reason: `You're already on the ladder (rank ${existingEntry.rank}).` };
  }
  const pending = await signupRequestsRepo.getPendingRequestForUser(discordUserId);
  if (pending) {
    return { ok: false, reason: "You already have a signup request awaiting review." };
  }
  const onExtendedVacation = await extendedVacationRepo.getEntry(discordUserId);
  if (onExtendedVacation) {
    return { ok: false, reason: "You're on Extended Vacation — use **Return from Extended Vacation** instead of signing up again." };
  }

  const request: Omit<SignupRequestRow, "sheetRow"> = {
    requestId: genId(),
    discordUserId,
    discordName,
    status: "Pending",
    requestedAt: new Date().toISOString(),
    resolvedByUserId: "",
    resolvedAt: "",
    denyReason: "",
    leagueManagerMessageUrl: "",
  };
  await signupRequestsRepo.addRequest(request);
  const stored = await signupRequestsRepo.getRequestById(request.requestId);
  return { ok: true, request: stored ?? { ...request, sheetRow: -1 } };
}

export type ApproveSignupResult = { ok: true; entry: LadderRow } | { ok: false };
export type DenySignupResult = { ok: true } | { ok: false };

/** Adds the requester to the ladder in last place and marks the request Approved. */
export async function approveSignup(requestId: string, resolvedByUserId: string): Promise<ApproveSignupResult> {
  return enqueueResolution(async () => {
    const request = await signupRequestsRepo.getRequestById(requestId);
    if (!request || request.status !== "Pending") return { ok: false };

    // Guard against a double-add if the player somehow ended up on the ladder while this was pending.
    if (await ladderRepo.findEntry(request.discordUserId)) {
      request.status = "Denied";
      request.resolvedByUserId = resolvedByUserId;
      request.resolvedAt = new Date().toISOString();
      request.denyReason = "Already on the ladder.";
      await signupRequestsRepo.updateRequest(request);
      return { ok: false };
    }

    const ladder = await ladderRepo.getLadder();
    const rank = nextRankForNewEntry(ladder);

    const newEntry: Omit<LadderRow, "sheetRow"> = {
      rank,
      discordName: request.discordName,
      discordUserId: request.discordUserId,
      status: "Available",
      joinedAt: new Date().toISOString(),
      challengeDate: "",
      opponentRank: "",
      notes: "",
      dodgeWins: 0,
      dodgeCount: 0,
      vacationSince: "",
      vacationWarningSentAt: "",
    };
    await ladderRepo.addLadderEntry(newEntry);

    if (rank === 1) {
      await rank1Repo.crownHolder({ ...newEntry, sheetRow: -1 });
    }

    request.status = "Approved";
    request.resolvedByUserId = resolvedByUserId;
    request.resolvedAt = new Date().toISOString();
    await signupRequestsRepo.updateRequest(request);

    return { ok: true, entry: { ...newEntry, sheetRow: -1, rank } };
  });
}

export async function denySignup(requestId: string, resolvedByUserId: string, reason: string): Promise<DenySignupResult> {
  return enqueueResolution(async () => {
    const request = await signupRequestsRepo.getRequestById(requestId);
    if (!request || request.status !== "Pending") return { ok: false };

    request.status = "Denied";
    request.resolvedByUserId = resolvedByUserId;
    request.resolvedAt = new Date().toISOString();
    request.denyReason = reason;
    await signupRequestsRepo.updateRequest(request);

    return { ok: true };
  });
}
