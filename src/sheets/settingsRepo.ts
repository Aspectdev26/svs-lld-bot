import { readSheetRange, updateSheetRow } from "./sheetsClient.js";

export const SETTINGS_SHEET = "Settings";
export const SETTINGS_HEADERS = ["Paused", "PausedAt"];

export interface Settings {
  paused: boolean;
  /** ISO timestamp of when the ladder was paused; blank if not currently paused. */
  pausedAt: string;
}

/** Single-row settings tab — row 2 holds the only record. */
export async function getSettings(): Promise<Settings> {
  const values = await readSheetRange(`${SETTINGS_SHEET}!A2:B2`);
  const row = values[0] ?? [];
  return {
    paused: (row[0] ?? "") === "TRUE",
    pausedAt: row[1] ?? "",
  };
}

export async function setPaused(paused: boolean, pausedAt: string): Promise<void> {
  await updateSheetRow(SETTINGS_SHEET, 2, [paused ? "TRUE" : "", pausedAt]);
}
