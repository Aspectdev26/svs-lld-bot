import {
  addSheetTab,
  appendSheetRow,
  clearSheetRange,
  getSheetMetaByName,
  readSheetRange,
  updateSheetRow,
  writeSheetRows,
} from "./sheetsClient.js";
import type { Build, Element, LadderRow, SeasonStatsRow } from "../types.js";

export const SEASON_STATS_SHEET = "SeasonStats";
export const SEASON_STATS_HEADERS = ["DiscordUserID", "DiscordName", "CharacterName", "Element", "Build", "Defends", "Wins", "Losses"];

export function toValues(row: Omit<SeasonStatsRow, "sheetRow">): (string | number)[] {
  return [row.discordUserId, row.discordName, row.characterName, row.element, row.build, row.defends, row.wins, row.losses];
}

function rowFromValues(sheetRow: number, values: string[]): SeasonStatsRow {
  const [discordUserId, discordName, characterName, element, build, defends, wins, losses] = values;
  return {
    sheetRow,
    discordUserId: discordUserId ?? "",
    discordName: discordName ?? "",
    characterName: characterName ?? "",
    element: element as Element,
    build: build as Build,
    defends: Number.parseInt(defends, 10) || 0,
    wins: Number.parseInt(wins, 10) || 0,
    losses: Number.parseInt(losses, 10) || 0,
  };
}

/** Every character with recorded activity so far this season. */
export async function getAllRows(): Promise<SeasonStatsRow[]> {
  const values = await readSheetRange(`${SEASON_STATS_SHEET}!A2:H`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is SeasonStatsRow => r !== null);
}

async function upsertStat(entry: LadderRow, field: "defends" | "wins" | "losses"): Promise<number> {
  const rows = await getAllRows();
  const existing = rows.find((r) => r.discordUserId === entry.discordUserId && r.element === entry.element);
  const newValue = (existing?.[field] ?? 0) + 1;

  if (existing) {
    await updateSheetRow(SEASON_STATS_SHEET, existing.sheetRow, toValues({ ...existing, [field]: newValue }));
  } else {
    await appendSheetRow(
      SEASON_STATS_SHEET,
      toValues({
        discordUserId: entry.discordUserId,
        discordName: entry.discordName,
        characterName: entry.characterName,
        element: entry.element,
        build: entry.build,
        defends: field === "defends" ? 1 : 0,
        wins: field === "wins" ? 1 : 0,
        losses: field === "losses" ? 1 : 0,
      }),
    );
  }
  return newValue;
}

/** Records a title defense for `entry` this season. Returns the new season total. */
export async function recordDefend(entry: LadderRow): Promise<number> {
  return upsertStat(entry, "defends");
}

/** Records a win for `entry` this season (any rank, any outcome type). Returns the new season total. */
export async function recordWin(entry: LadderRow): Promise<number> {
  return upsertStat(entry, "wins");
}

/** Records a loss for `entry` this season (any rank, any outcome type). Returns the new season total. */
export async function recordLoss(entry: LadderRow): Promise<number> {
  return upsertStat(entry, "losses");
}

/** Wipes every data row (used right after archiving the season to a `Season N` tab). Headers are left intact. */
export async function clearAll(): Promise<void> {
  await clearSheetRange(SEASON_STATS_SHEET, "A2:H100000");
}

/** True if a tab with this exact (already-sanitized) name already exists — used to reject a reused season name. */
export async function archiveTabExists(seasonName: string): Promise<boolean> {
  return (await getSheetMetaByName(seasonName)) !== undefined;
}

/** Snapshots `rows` into a brand-new tab titled `seasonName` — a permanent, never-touched-again record. */
export async function archiveSeason(seasonName: string, rows: Omit<SeasonStatsRow, "sheetRow">[]): Promise<void> {
  await addSheetTab(seasonName);
  await writeSheetRows(seasonName, 1, [SEASON_STATS_HEADERS, ...rows.map(toValues)]);
}
