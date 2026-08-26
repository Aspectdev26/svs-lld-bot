import { config } from "../config.js";
import * as dodgesRepo from "../sheets/dodgesRepo.js";
import type { DodgeRow, MatchRow } from "../types.js";
import { genId } from "./matchService.js";

/** dodgeCount at which the dodged-against player gets a private warning DM + League Manager notice. */
export const DODGE_WARNING_THRESHOLD = 2;
/** dodgeCount at which the dodged-against player's entry is automatically removed from the ladder. */
export const DODGE_REMOVAL_THRESHOLD = 3;

export function isDodgeEligible(match: MatchRow): boolean {
  if (match.status !== "Pending") return false;
  const createdAt = Date.parse(match.createdAt);
  if (Number.isNaN(createdAt)) return false;
  return Date.now() - createdAt >= config.timing.dodgeEligibleAfterMs;
}

export async function createDodgeRequest(
  match: MatchRow,
  requestedByUserId: string,
  leagueManagerMessageUrl: string,
): Promise<DodgeRow> {
  const dodge: Omit<DodgeRow, "sheetRow"> = {
    dodgeId: genId(),
    matchId: match.matchId,
    requestedByUserId,
    requestedAt: new Date().toISOString(),
    leagueManagerMessageUrl,
    status: "Pending",
    resolvedByUserId: "",
    resolvedAt: "",
    denyReason: "",
  };
  await dodgesRepo.addDodge(dodge);
  return { ...dodge, sheetRow: -1 };
}

export async function resolveDodge(
  dodge: DodgeRow,
  resolvedByUserId: string,
  approved: boolean,
  denyReason?: string,
): Promise<void> {
  dodge.status = approved ? "Approved" : "Denied";
  dodge.resolvedByUserId = resolvedByUserId;
  dodge.resolvedAt = new Date().toISOString();
  dodge.denyReason = approved ? "" : denyReason ?? "";
  await dodgesRepo.updateDodge(dodge);
}
