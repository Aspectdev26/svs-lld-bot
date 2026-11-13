import { appendSheetRow, clearSheetRow, readSheetRange, updateSheetCell } from "./sheetsClient.js";
import type { ExtendedVacationRow, ExtendedVacationSource } from "../types.js";

export const EXTENDED_VACATION_SHEET = "ExtendedVacation";
export const EXTENDED_VACATION_HEADERS = [
  "DiscordUserID",
  "DiscordName",
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
    rankAtEntry: Number.parseInt(v[2], 10) || 0,
    enteredAt: v[3] ?? "",
    expiresAt: v[4] ?? "",
    source: (v[5] as ExtendedVacationSource) || "Requested",
    approvedByUserId: v[6] ?? "",
    warningSentAt: v[7] ?? "",
  };
}

function toValues(r: Omit<ExtendedVacationRow, "sheetRow">): (string | number)[] {
  return [r.discordUserId, r.discordName, r.rankAtEntry, r.enteredAt, r.expiresAt, r.source, r.approvedByUserId, r.warningSentAt];
}

export async function getAllEntries(): Promise<ExtendedVacationRow[]> {
  const values = await readSheetRange(`${EXTENDED_VACATION_SHEET}!A2:H`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is ExtendedVacationRow => r !== null);
}

export async function getEntry(discordUserId: string): Promise<ExtendedVacationRow | undefined> {
  const all = await getAllEntries();
  return all.find((r) => r.discordUserId === discordUserId);
}

export async function addEntry(entry: Omit<ExtendedVacationRow, "sheetRow">): Promise<void> {
  await appendSheetRow(EXTENDED_VACATION_SHEET, toValues(entry));
}

/** "Already warned about upcoming full removal" flag — see vacationWatcher.ts. */
export async function setWarningSentAt(sheetRow: number, iso: string): Promise<void> {
  await updateSheetCell(EXTENDED_VACATION_SHEET, sheetRow, "H", iso);
}

/** Removes an entry from the Extended Vacation ledger — used both on self-return and on full 30-day expiry. */
export async function removeEntry(sheetRow: number): Promise<void> {
  await clearSheetRow(EXTENDED_VACATION_SHEET, sheetRow, EXTENDED_VACATION_HEADERS.length);
}
