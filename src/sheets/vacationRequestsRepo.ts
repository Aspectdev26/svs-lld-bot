import { appendSheetRow, readSheetRange, updateSheetRow } from "./sheetsClient.js";
import type { SignupStatus, VacationRequestRow, VacationRequestType } from "../types.js";

export const VACATION_REQUESTS_SHEET = "VacationRequests";
export const VACATION_REQUESTS_HEADERS = [
  "RequestID",
  "DiscordUserID",
  "DiscordName",
  "RequestType",
  "Status",
  "RequestedAt",
  "ResolvedByUserID",
  "ResolvedAt",
  "DenyReason",
  "LeagueManagerMessageURL",
];

function rowFromValues(sheetRow: number, v: string[]): VacationRequestRow {
  return {
    sheetRow,
    requestId: v[0] ?? "",
    discordUserId: v[1] ?? "",
    discordName: v[2] ?? "",
    requestType: (v[3] as VacationRequestType) || "Vacation",
    status: (v[4] as SignupStatus) || "Pending",
    requestedAt: v[5] ?? "",
    resolvedByUserId: v[6] ?? "",
    resolvedAt: v[7] ?? "",
    denyReason: v[8] ?? "",
    leagueManagerMessageUrl: v[9] ?? "",
  };
}

function toValues(r: Omit<VacationRequestRow, "sheetRow">): (string | number)[] {
  return [
    r.requestId,
    r.discordUserId,
    r.discordName,
    r.requestType,
    r.status,
    r.requestedAt,
    r.resolvedByUserId,
    r.resolvedAt,
    r.denyReason,
    r.leagueManagerMessageUrl,
  ];
}

export async function getAllRequests(): Promise<VacationRequestRow[]> {
  const values = await readSheetRange(`${VACATION_REQUESTS_SHEET}!A2:J`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is VacationRequestRow => r !== null);
}

export async function getRequestById(requestId: string): Promise<VacationRequestRow | undefined> {
  const all = await getAllRequests();
  return all.find((r) => r.requestId === requestId);
}

export async function getPendingRequestForUser(discordUserId: string): Promise<VacationRequestRow | undefined> {
  const all = await getAllRequests();
  return all.find((r) => r.discordUserId === discordUserId && r.status === "Pending");
}

export async function addRequest(request: Omit<VacationRequestRow, "sheetRow">): Promise<void> {
  await appendSheetRow(VACATION_REQUESTS_SHEET, toValues(request));
}

export async function updateRequest(request: VacationRequestRow): Promise<void> {
  await updateSheetRow(VACATION_REQUESTS_SHEET, request.sheetRow, toValues(request));
}
