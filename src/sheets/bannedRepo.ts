import { appendSheetRow, clearSheetRow, readSheetRange } from "./sheetsClient.js";
import type { BanRow } from "../types.js";

export const BANNED_SHEET = "BannedUsers";
export const BANNED_HEADERS = ["DiscordUserID", "DiscordName", "Reason", "BannedAt", "BannedByUserID"];

function rowFromValues(sheetRow: number, v: string[]): BanRow {
  return {
    sheetRow,
    discordUserId: v[0] ?? "",
    discordName: v[1] ?? "",
    reason: v[2] ?? "",
    bannedAt: v[3] ?? "",
    bannedByUserId: v[4] ?? "",
  };
}

export async function getAllBans(): Promise<BanRow[]> {
  const values = await readSheetRange(`${BANNED_SHEET}!A2:E`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is BanRow => r !== null);
}

export async function isBanned(discordUserId: string): Promise<BanRow | undefined> {
  const bans = await getAllBans();
  return bans.find((b) => b.discordUserId === discordUserId);
}

export async function addBan(ban: Omit<BanRow, "sheetRow">): Promise<void> {
  await appendSheetRow(BANNED_SHEET, [ban.discordUserId, ban.discordName, ban.reason, ban.bannedAt, ban.bannedByUserId]);
}

export async function clearBan(sheetRow: number): Promise<void> {
  await clearSheetRow(BANNED_SHEET, sheetRow, BANNED_HEADERS.length);
}
