import { randomUUID } from "node:crypto";
import * as ladderRepo from "../sheets/ladderRepo.js";
import * as rank1Repo from "../sheets/rank1Repo.js";
import * as signupRequestsRepo from "../sheets/signupRequestsRepo.js";
import * as bannedRepo from "../sheets/bannedRepo.js";
import { nextRankForNewEntry } from "./rankingService.js";
import { formatElement } from "../util/formatElement.js";
import type { Build, Element, LadderRow, SignupRequestRow } from "../types.js";

function genId(): string {
  return randomUUID().slice(0, 8);
}

export type CreateSignupResult =
  | { ok: true; request: SignupRequestRow }
  | { ok: false; reason: string };

export async function createSignupRequest(
  discordUserId: string,
  discordName: string,
  characterName: string,
  element: Element,
  build: Build,
): Promise<CreateSignupResult> {
  const ban = await bannedRepo.isBanned(discordUserId, element);
  if (ban) {
    return {
      ok: false,
      reason: `You're banned from signing up${ban.element === "ALL" ? "" : ` with **${formatElement(element)}**`}${ban.reason ? ` (reason: ${ban.reason})` : ""}.`,
    };
  }
  const existingEntry = await ladderRepo.findEntry(discordUserId, element);
  if (existingEntry) {
    return { ok: false, reason: `You're already on the ladder with **${formatElement(element)}** (rank ${existingEntry.rank}).` };
  }
  const pending = await signupRequestsRepo.getPendingRequestForUserElement(discordUserId, element);
  if (pending) {
    return { ok: false, reason: `You already have a pending **${formatElement(element)}** signup request awaiting review.` };
  }

  // Character name must be unique per element+build, except a player may reclaim their own
  // former name/element/build combo (e.g. after being removed and re-registering).
  const duplicateOnLadder = await ladderRepo.findByCharacterNameElementBuild(characterName, element, build);
  if (duplicateOnLadder && duplicateOnLadder.discordUserId !== discordUserId) {
    return {
      ok: false,
      reason: `**${characterName}** is already taken for **${formatElement(element)}** (${build}) — pick a different name.`,
    };
  }
  const duplicatePending = await signupRequestsRepo.findPendingByCharacterNameElementBuild(characterName, element, build);
  if (duplicatePending && duplicatePending.discordUserId !== discordUserId) {
    return {
      ok: false,
      reason: `**${characterName}** is already pending review for **${formatElement(element)}** (${build}) — pick a different name.`,
    };
  }

  const request: Omit<SignupRequestRow, "sheetRow"> = {
    requestId: genId(),
    discordUserId,
    discordName,
    characterName,
    element,
    build,
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

export type ApproveSignupResult = { entry: LadderRow };

/** Adds the requester to the ladder in last place and marks the request Approved. */
export async function approveSignup(request: SignupRequestRow, resolvedByUserId: string): Promise<ApproveSignupResult> {
  const ladder = await ladderRepo.getLadder();
  const rank = nextRankForNewEntry(ladder);

  const newEntry: Omit<LadderRow, "sheetRow"> = {
    rank,
    element: request.element,
    build: request.build,
    characterName: request.characterName,
    discordName: request.discordName,
    discordUserId: request.discordUserId,
    status: "Available",
    joinedAt: new Date().toISOString(),
    challengeDate: "",
    opponentRank: "",
    notes: "",
    dodgeWins: 0,
    dodgeCount: 0,
  };
  await ladderRepo.addLadderEntry(newEntry);

  if (rank === 1) {
    await rank1Repo.crownHolder({ ...newEntry, sheetRow: -1 });
  }

  request.status = "Approved";
  request.resolvedByUserId = resolvedByUserId;
  request.resolvedAt = new Date().toISOString();
  await signupRequestsRepo.updateRequest(request);

  return { entry: { ...newEntry, sheetRow: -1, rank } };
}

export async function denySignup(request: SignupRequestRow, resolvedByUserId: string, reason: string): Promise<void> {
  request.status = "Denied";
  request.resolvedByUserId = resolvedByUserId;
  request.resolvedAt = new Date().toISOString();
  request.denyReason = reason;
  await signupRequestsRepo.updateRequest(request);
}
