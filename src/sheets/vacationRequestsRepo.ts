import { appendSheetRow, readSheetRange, updateSheetRow } from "./sheetsClient.js";
import type { Build, Element, SignupStatus, VacationRequestRow, VacationRequestType } from "../types.js";

export const VACATION_REQUESTS_SHEET = "VacationRequests";
export const VACATION_REQUESTS_HEADERS = [
  "RequestID",
  "DiscordUserID",
  "DiscordName",
  "CharacterName",
  "Element",
  "Build",
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
    characterName: v[3] ?? "",
    element: v[4] as Element,
    build: v[5] as Build,
    requestType: (v[6] as VacationRequestType) || "Vacation",
    status: (v[7] as SignupStatus) || "Pending",
    requestedAt: v[8] ?? "",
    resolvedByUserId: v[9] ?? "",
    resolvedAt: v[10] ?? "",
    denyReason: v[11] ?? "",
    leagueManagerMessageUrl: v[12] ?? "",
  };
}

function toValues(r: Omit<VacationRequestRow, "sheetRow">): (string | number)[] {
  return [
    r.requestId,
    r.discordUserId,
    r.discordName,
    r.characterName,
    r.element,
    r.build,
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
  const values = await readSheetRange(`${VACATION_REQUESTS_SHEET}!A2:M`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is VacationRequestRow => r !== null);
}

export async function getRequestById(requestId: string): Promise<VacationRequestRow | undefined> {
  const all = await getAllRequests();
  return all.find((r) => r.requestId === requestId);
}

export async function getPendingRequestForUserElement(
  discordUserId: string,
  element: Element,
): Promise<VacationRequestRow | undefined> {
  const all = await getAllRequests();
  return all.find((r) => r.discordUserId === discordUserId && r.element === element && r.status === "Pending");
}

export async function addRequest(request: Omit<VacationRequestRow, "sheetRow">): Promise<void> {
  await appendSheetRow(VACATION_REQUESTS_SHEET, toValues(request));
}

export async function updateRequest(request: VacationRequestRow): Promise<void> {
  await updateSheetRow(VACATION_REQUESTS_SHEET, request.sheetRow, toValues(request));
}
