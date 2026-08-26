import { appendSheetRow, clearSheetRow, readSheetRange, updateSheetCell } from "./sheetsClient.js";
import type { Build, Element, ExtendedVacationRow, ExtendedVacationSource } from "../types.js";

export const EXTENDED_VACATION_SHEET = "ExtendedVacation";
export const EXTENDED_VACATION_HEADERS = [
  "DiscordUserID",
  "DiscordName",
  "CharacterName",
  "Element",
  "Build",
  "RankAtEntry",
  "EnteredAt",
  "ExpiresAt",
  "Source",
  "ApprovedByUserID",
  "WarningSentAt",
];

function rowFromValues(sheetRow: number, v: string[]): ExtendedVacationRow {
  return {
    sheetRow,
    discordUserId: v[0] ?? "",
    discordName: v[1] ?? "",
    characterName: v[2] ?? "",
    element: v[3] as Element,
    build: v[4] as Build,
    rankAtEntry: Number.parseInt(v[5], 10) || 0,
    enteredAt: v[6] ?? "",
    expiresAt: v[7] ?? "",
    source: (v[8] as ExtendedVacationSource) || "Requested",
    approvedByUserId: v[9] ?? "",
    warningSentAt: v[10] ?? "",
  };
}

function toValues(r: Omit<ExtendedVacationRow, "sheetRow">): (string | number)[] {
  return [
    r.discordUserId,
    r.discordName,
    r.characterName,
    r.element,
    r.build,
    r.rankAtEntry,
    r.enteredAt,
    r.expiresAt,
    r.source,
    r.approvedByUserId,
    r.warningSentAt,
  ];
}

export async function getAllEntries(): Promise<ExtendedVacationRow[]> {
  const values = await readSheetRange(`${EXTENDED_VACATION_SHEET}!A2:K`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is ExtendedVacationRow => r !== null);
}

export async function getPlayerEntries(discordUserId: string): Promise<ExtendedVacationRow[]> {
  const all = await getAllEntries();
  return all.filter((r) => r.discordUserId === discordUserId);
}

export async function getEntry(discordUserId: string, element: Element): Promise<ExtendedVacationRow | undefined> {
  const rows = await getPlayerEntries(discordUserId);
  return rows.find((r) => r.element === element);
}

export async function addEntry(entry: Omit<ExtendedVacationRow, "sheetRow">): Promise<void> {
  await appendSheetRow(EXTENDED_VACATION_SHEET, toValues(entry));
}

/** "Already warned about upcoming full removal" flag — see vacationWatcher.ts. */
export async function setWarningSentAt(sheetRow: number, iso: string): Promise<void> {
  await updateSheetCell(EXTENDED_VACATION_SHEET, sheetRow, "K", iso);
}

/** Removes an entry from the Extended Vacation ledger — used both on self-return and on full 30-day expiry. */
export async function removeEntry(sheetRow: number): Promise<void> {
  await clearSheetRow(EXTENDED_VACATION_SHEET, sheetRow, EXTENDED_VACATION_HEADERS.length);
}
