import { appendSheetRow, readSheetRange, updateSheetRow } from "./sheetsClient.js";
import type { Build, Element, SignupRequestRow, SignupStatus } from "../types.js";

export const SIGNUP_REQUESTS_SHEET = "SignupRequests";
export const SIGNUP_REQUESTS_HEADERS = [
  "RequestID",
  "DiscordUserID",
  "DiscordName",
  "CharacterName",
  "Element",
  "Build",
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
    characterName: v[3] ?? "",
    element: v[4] as Element,
    build: v[5] as Build,
    status: (v[6] as SignupStatus) || "Pending",
    requestedAt: v[7] ?? "",
    resolvedByUserId: v[8] ?? "",
    resolvedAt: v[9] ?? "",
    denyReason: v[10] ?? "",
    leagueManagerMessageUrl: v[11] ?? "",
  };
}

function toValues(r: Omit<SignupRequestRow, "sheetRow">): (string | number)[] {
  return [
    r.requestId,
    r.discordUserId,
    r.discordName,
    r.characterName,
    r.element,
    r.build,
    r.status,
    r.requestedAt,
    r.resolvedByUserId,
    r.resolvedAt,
    r.denyReason,
    r.leagueManagerMessageUrl,
  ];
}

export async function getAllRequests(): Promise<SignupRequestRow[]> {
  const values = await readSheetRange(`${SIGNUP_REQUESTS_SHEET}!A2:L`);
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

export async function getPendingRequestForUserElement(
  discordUserId: string,
  element: Element,
): Promise<SignupRequestRow | undefined> {
  const all = await getAllRequests();
  return all.find((r) => r.discordUserId === discordUserId && r.element === element && r.status === "Pending");
}

/** Finds any pending request (any owner) sharing the same character name (case-insensitive), element, and build. */
export async function findPendingByCharacterNameElementBuild(
  characterName: string,
  element: Element,
  build: Build,
): Promise<SignupRequestRow | undefined> {
  const pending = await getPendingRequests();
  const nameLower = characterName.trim().toLowerCase();
  return pending.find(
    (r) => r.element === element && r.build === build && r.characterName.trim().toLowerCase() === nameLower,
  );
}

export async function addRequest(request: Omit<SignupRequestRow, "sheetRow">): Promise<void> {
  await appendSheetRow(SIGNUP_REQUESTS_SHEET, toValues(request));
}

export async function updateRequest(request: SignupRequestRow): Promise<void> {
  await updateSheetRow(SIGNUP_REQUESTS_SHEET, request.sheetRow, toValues(request));
}
