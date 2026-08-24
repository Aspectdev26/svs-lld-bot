import { appendSheetRow, readSheetRange, updateSheetRow } from "./sheetsClient.js";
import type { DodgeRow, DodgeStatus } from "../types.js";

export const DODGES_SHEET = "Dodges";
export const DODGES_HEADERS = [
  "DodgeID",
  "MatchID",
  "RequestedByUserID",
  "RequestedAt",
  "LeagueManagerMessageURL",
  "Status",
  "ResolvedByUserID",
  "ResolvedAt",
  "DenyReason",
];

function rowFromValues(sheetRow: number, v: string[]): DodgeRow {
  return {
    sheetRow,
    dodgeId: v[0] ?? "",
    matchId: v[1] ?? "",
    requestedByUserId: v[2] ?? "",
    requestedAt: v[3] ?? "",
    leagueManagerMessageUrl: v[4] ?? "",
    status: (v[5] as DodgeStatus) || "Pending",
    resolvedByUserId: v[6] ?? "",
    resolvedAt: v[7] ?? "",
    denyReason: v[8] ?? "",
  };
}

export async function getAllDodges(): Promise<DodgeRow[]> {
  const values = await readSheetRange(`${DODGES_SHEET}!A2:I`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is DodgeRow => r !== null);
}

export async function getDodgeById(dodgeId: string): Promise<DodgeRow | undefined> {
  const all = await getAllDodges();
  return all.find((d) => d.dodgeId === dodgeId);
}

export async function getPendingDodgeForMatch(matchId: string): Promise<DodgeRow | undefined> {
  const all = await getAllDodges();
  return all.find((d) => d.matchId === matchId && d.status === "Pending");
}

export async function addDodge(dodge: Omit<DodgeRow, "sheetRow">): Promise<void> {
  await appendSheetRow(DODGES_SHEET, [
    dodge.dodgeId,
    dodge.matchId,
    dodge.requestedByUserId,
    dodge.requestedAt,
    dodge.leagueManagerMessageUrl,
    dodge.status,
    dodge.resolvedByUserId,
    dodge.resolvedAt,
    dodge.denyReason,
  ]);
}

export async function updateDodge(dodge: DodgeRow): Promise<void> {
  await updateSheetRow(DODGES_SHEET, dodge.sheetRow, [
    dodge.dodgeId,
    dodge.matchId,
    dodge.requestedByUserId,
    dodge.requestedAt,
    dodge.leagueManagerMessageUrl,
    dodge.status,
    dodge.resolvedByUserId,
    dodge.resolvedAt,
    dodge.denyReason,
  ]);
}
