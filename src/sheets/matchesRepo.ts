import { appendSheetRow, readSheetRange, updateSheetCell, updateSheetRow } from "./sheetsClient.js";
import type { Element, MatchRow, MatchStatus } from "../types.js";

export const MATCHES_SHEET = "Matches";
export const MATCHES_HEADERS = [
  "MatchID",
  "ChallengerUserID",
  "ChallengerElement",
  "ChallengerRank",
  "DefenderUserID",
  "DefenderElement",
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
];

function rowFromValues(sheetRow: number, v: string[]): MatchRow {
  return {
    sheetRow,
    matchId: v[0] ?? "",
    challengerUserId: v[1] ?? "",
    challengerElement: v[2] as Element,
    challengerRank: Number.parseInt(v[3], 10),
    defenderUserId: v[4] ?? "",
    defenderElement: v[5] as Element,
    defenderRank: Number.parseInt(v[6], 10),
    status: (v[7] as MatchStatus) || "Pending",
    createdAt: v[8] ?? "",
    expiresAt: v[9] ?? "",
    warningSentAt: v[10] ?? "",
    winnerUserId: v[11] ?? "",
    resolvedAt: v[12] ?? "",
    channelId: v[13] ?? "",
    extensionPending: (v[14] ?? "") === "TRUE",
    cancelRequestedByUserId: v[15] ?? "",
  };
}

function toValues(match: Omit<MatchRow, "sheetRow">): (string | number)[] {
  return [
    match.matchId,
    match.challengerUserId,
    match.challengerElement,
    match.challengerRank,
    match.defenderUserId,
    match.defenderElement,
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
  ];
}

export async function getAllMatches(): Promise<MatchRow[]> {
  const values = await readSheetRange(`${MATCHES_SHEET}!A2:P`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is MatchRow => r !== null);
}

export async function getPendingMatches(): Promise<MatchRow[]> {
  const all = await getAllMatches();
  return all.filter((m) => m.status === "Pending");
}

/** All of a player's currently-pending matches — up to one per element they have on the ladder. */
export async function getPendingMatchesForPlayer(discordUserId: string): Promise<MatchRow[]> {
  const pending = await getPendingMatches();
  return pending.filter((m) => m.challengerUserId === discordUserId || m.defenderUserId === discordUserId);
}

/** The pending match (if any) tied to one specific element-entry of a player. */
export async function getPendingMatchForEntry(discordUserId: string, element: Element): Promise<MatchRow | undefined> {
  const pending = await getPendingMatchesForPlayer(discordUserId);
  return pending.find(
    (m) =>
      (m.challengerUserId === discordUserId && m.challengerElement === element) ||
      (m.defenderUserId === discordUserId && m.defenderElement === element),
  );
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
  await updateSheetCell(MATCHES_SHEET, sheetRow, "H", status);
}

export async function setWarningSentAt(sheetRow: number, iso: string): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "K", iso);
}

export async function setChannelId(sheetRow: number, channelId: string): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "N", channelId);
}

export async function setExtensionPending(sheetRow: number, pending: boolean): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "O", pending ? "TRUE" : "");
}

export async function setCancelRequestedBy(sheetRow: number, userId: string): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "P", userId);
}

export async function setExpiresAt(sheetRow: number, iso: string): Promise<void> {
  await updateSheetCell(MATCHES_SHEET, sheetRow, "J", iso);
}
