import { readSheetRange, updateSheetCell, updateSheetRow } from "./sheetsClient.js";

export const SETTINGS_SHEET = "Settings";
export const SETTINGS_HEADERS = ["Paused", "PausedAt", "CurrentSeasonName"];

export interface Settings {
  paused: boolean;
  /** ISO timestamp of when the ladder was paused; blank if not currently paused. */
  pausedAt: string;
  /** Title of the tab season stats are currently being written to; blank means the legacy default tab. */
  currentSeasonName: string;
}

/** Single-row settings tab — row 2 holds the only record. */
export async function getSettings(): Promise<Settings> {
  const values = await readSheetRange(`${SETTINGS_SHEET}!A2:C2`);
  const row = values[0] ?? [];
  return {
    paused: (row[0] ?? "") === "TRUE",
    pausedAt: row[1] ?? "",
    currentSeasonName: row[2] ?? "",
  };
}

export async function setPaused(paused: boolean, pausedAt: string): Promise<void> {
  await updateSheetRow(SETTINGS_SHEET, 2, [paused ? "TRUE" : "", pausedAt]);
}

export async function setCurrentSeasonName(name: string): Promise<void> {
  await updateSheetCell(SETTINGS_SHEET, 2, "C", name);
}
