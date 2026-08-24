import { appendSheetRow, clearSheetRow, readSheetRange } from "./sheetsClient.js";
import type { BanRow, Element } from "../types.js";

export const BANNED_SHEET = "BannedUsers";
export const BANNED_HEADERS = ["DiscordUserID", "DiscordName", "Element", "Reason", "BannedAt", "BannedByUserID"];

/** Sentinel meaning "banned from every element", not one of the real Element values. */
export const ALL_ELEMENTS = "ALL" as const;
export type BanScope = Element | typeof ALL_ELEMENTS;

function rowFromValues(sheetRow: number, v: string[]): BanRow {
  return {
    sheetRow,
    discordUserId: v[0] ?? "",
    discordName: v[1] ?? "",
    element: (v[2] as BanScope) || ALL_ELEMENTS,
    reason: v[3] ?? "",
    bannedAt: v[4] ?? "",
    bannedByUserId: v[5] ?? "",
  };
}

export async function getAllBans(): Promise<BanRow[]> {
  const values = await readSheetRange(`${BANNED_SHEET}!A2:F`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is BanRow => r !== null);
}

export async function isBanned(discordUserId: string, element: Element): Promise<BanRow | undefined> {
  const bans = await getAllBans();
  return bans.find((b) => b.discordUserId === discordUserId && (b.element === ALL_ELEMENTS || b.element === element));
}

export async function addBan(ban: Omit<BanRow, "sheetRow">): Promise<void> {
  await appendSheetRow(BANNED_SHEET, [
    ban.discordUserId,
    ban.discordName,
    ban.element,
    ban.reason,
    ban.bannedAt,
    ban.bannedByUserId,
  ]);
}

export async function clearBan(sheetRow: number): Promise<void> {
  await clearSheetRow(BANNED_SHEET, sheetRow, BANNED_HEADERS.length);
}
