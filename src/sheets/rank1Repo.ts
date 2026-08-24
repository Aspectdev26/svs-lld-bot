import { readSheetRange, updateSheetRow } from "./sheetsClient.js";
import type { Build, Element, LadderRow, Rank1Row } from "../types.js";

export const RANK1_SHEET = "Rank1Defends";
export const RANK1_HEADERS = ["DiscordUserID", "DiscordName", "CharacterName", "Element", "Build", "Defends", "HolderSince"];

/** This tab always holds exactly one data row: the current rank-1 holder and their defend streak. */
const TRACKED_ROW = 2;

function toValues(discordUserId: string, discordName: string, characterName: string, element: Element, build: Build, defends: number, holderSince: string): (string | number)[] {
  return [discordUserId, discordName, characterName, element, build, defends, holderSince];
}

export async function getRank1Row(): Promise<Rank1Row | undefined> {
  const values = await readSheetRange(`${RANK1_SHEET}!A2:G2`);
  const v = values[0];
  if (!v || !v[0]) return undefined;
  return {
    sheetRow: TRACKED_ROW,
    discordUserId: v[0] ?? "",
    discordName: v[1] ?? "",
    characterName: v[2] ?? "",
    element: v[3] as Element,
    build: v[4] as Build,
    defends: Number.parseInt(v[5], 10) || 0,
    holderSince: v[6] ?? "",
  };
}

/** Sets a new (or refreshed) rank-1 holder with an explicit defend count. */
export async function setRank1Holder(entry: LadderRow, defends: number, holderSince = new Date().toISOString()): Promise<void> {
  await updateSheetRow(
    RANK1_SHEET,
    TRACKED_ROW,
    toValues(entry.discordUserId, entry.discordName, entry.characterName, entry.element, entry.build, defends, holderSince),
  );
}

export async function incrementDefends(current: Rank1Row): Promise<void> {
  await updateSheetRow(
    RANK1_SHEET,
    TRACKED_ROW,
    toValues(
      current.discordUserId,
      current.discordName,
      current.characterName,
      current.element,
      current.build,
      current.defends + 1,
      current.holderSince,
    ),
  );
}
