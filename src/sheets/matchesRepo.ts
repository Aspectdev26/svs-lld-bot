import { appendSheetRow, readSheetRange, updateSheetCell, updateSheetRow } from "./sheetsClient.js";
import type { MatchRow, MatchStatus } from "../types.js";

export const MATCHES_SHEET = "Matches";
export const MATCHES_HEADERS = [
  "MatchID",
  "ChallengerUserID",
  "ChallengerRank",
  "DefenderUserID",
  "DefenderRank",
  "Status",
  "CreatedAt",
  "ExpiresAt",
  "WarningSentAt",
  "WinnerUserID",
  "ResolvedAt",
  "ChannelID",
  "ExtensionPending",
  "CancelRequestedBy",
  "ExtensionRequestedBy",
];

function rowFromValues(sheetRow: number, v: string[]): MatchRow {
  return {
    sheetRow,
    matchId: v[0] ?? "",
    challengerUserId: v[1] ?? "",
    challengerRank: Number.parseInt(v[2], 10),
    defenderUserId: v[3] ?? "",
    defenderRank: Number.parseInt(v[4], 10),
    status: (v[5] as MatchStatus) || "Pending",
    createdAt: v[6] ?? "",
    expiresAt: v[7] ?? "",
    warningSentAt: v[8] ?? "",
    winnerUserId: v[9] ?? "",
    resolvedAt: v[10] ?? "",
    channelId: v[11] ?? "",
    extensionPending: (v[12] ?? "") === "TRUE",
    cancelRequestedByUserId: v[13] ?? "",
    extensionRequestedByUserId: v[14] ?? "",
  };
}

function toValues(match: Omit<MatchRow, "sheetRow">): (string | number)[] {
  return [
    match.matchId,
    match.challengerUserId,
    match.challengerRank,
    match.defenderUserId,
    match.defenderRank,
    match.status,
    match.createdAt,
    match.expiresAt,
    match.warningSentAt,
    match.winnerUserId,
    match.resolvedAt,
    match.channelId,
    match.extensionPending ? "TRUE" : "",
    match.cancelRequestedByUserId,
    match.extensionRequestedByUserId,
  ];
}

export async function getAllMatches(): Promise<MatchRow[]> {
  const values = await readSheetRange(`${MATCHES_SHEET}!A2:O`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is MatchRow => r !== null);
}

export async function getPendingMatches(): Promise<MatchRow[]> {
  const all = await getAllMatches();
  return all.filter((m) => m.status === "Pending");
}

/** A player's currently-pending match, if any — each player can be in at most one at a time. */
export async function getPendingMatchForPlayer(discordUserId: string): Promise<MatchRow | undefined> {
  const pending = await getPendingMatches();
  return pending.find((m) => m.challengerUserId === discordUserId || m.defenderUserId === discordUserId);
}

export async function getMatchById(matchId: string): Promise<MatchRow | undefined> {
  const all = await getAllMatches();
  return all.find((m) => m.matchId === matchId);
}

export async function addMatch(match: Omit<MatchRow, "sheetRow">): Promise<void> {
  await appendSheetRow(MATCHES_SHEET, toValues(match));
}

export async function updateMatch(match: MatchRow): Promise<void> {
  await updateSheetRow(MATCHES_SHEET, match.sheetRow, toValues(match));
}

export async function setMatchStatus(sheetRow: number, status: MatchStatus): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "F", status);
}

export async function setWarningSentAt(sheetRow: number, iso: string): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "I", iso);
}

export async function setChannelId(sheetRow: number, channelId: string): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "L", channelId);
}

export async function setExtensionPending(sheetRow: number, pending: boolean): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "M", pending ? "TRUE" : "");
}

export async function setCancelRequestedBy(sheetRow: number, userId: string): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "N", userId);
}

export async function setExtensionRequestedBy(sheetRow: number, userId: string): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "O", userId);
}

export async function setExpiresAt(sheetRow: number, iso: string): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "H", iso);
}
