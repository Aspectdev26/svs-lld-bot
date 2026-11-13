import { appendSheetRow, readSheetRange, updateSheetRow } from "./sheetsClient.js";
import type { SignupRequestRow, SignupStatus } from "../types.js";

export const SIGNUP_REQUESTS_SHEET = "SignupRequests";
export const SIGNUP_REQUESTS_HEADERS = [
  "RequestID",
  "DiscordUserID",
  "DiscordName",
  "Status",
  "RequestedAt",
  "ResolvedByUserID",
  "ResolvedAt",
  "DenyReason",
  "LeagueManagerMessageURL",
];

function rowFromValues(sheetRow: number, v: string[]): SignupRequestRow {
  return {
    sheetRow,
    requestId: v[0] ?? "",
    discordUserId: v[1] ?? "",
    discordName: v[2] ?? "",
    status: (v[3] as SignupStatus) || "Pending",
    requestedAt: v[4] ?? "",
    resolvedByUserId: v[5] ?? "",
    resolvedAt: v[6] ?? "",
    denyReason: v[7] ?? "",
    leagueManagerMessageUrl: v[8] ?? "",
  };
}

function toValues(r: Omit<SignupRequestRow, "sheetRow">): (string | number)[] {
  return [
    r.requestId,
    r.discordUserId,
    r.discordName,
    r.status,
    r.requestedAt,
    r.resolvedByUserId,
    r.resolvedAt,
    r.denyReason,
    r.leagueManagerMessageUrl,
  ];
}

export async function getAllRequests(): Promise<SignupRequestRow[]> {
  const values = await readSheetRange(`${SIGNUP_REQUESTS_SHEET}!A2:I`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is SignupRequestRow => r !== null);
}

export async function getRequestById(requestId: string): Promise<SignupRequestRow | undefined> {
  const all = await getAllRequests();
  return all.find((r) => r.requestId === requestId);
}

export async function getPendingRequests(): Promise<SignupRequestRow[]> {
  const all = await getAllRequests();
  return all.filter((r) => r.status === "Pending");
}

export async function getPendingRequestForUser(discordUserId: string): Promise<SignupRequestRow | undefined> {
  const pending = await getPendingRequests();
  return pending.find((r) => r.discordUserId === discordUserId);
}

export async function addRequest(request: Omit<SignupRequestRow, "sheetRow">): Promise<void> {
  await appendSheetRow(SIGNUP_REQUESTS_SHEET, toValues(request));
}

export async function updateRequest(request: SignupRequestRow): Promise<void> {
  await updateSheetRow(SIGNUP_REQUESTS_SHEET, request.sheetRow, toValues(request));
}
