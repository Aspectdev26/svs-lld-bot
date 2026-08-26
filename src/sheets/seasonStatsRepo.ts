import { addSheetTab, appendSheetRow, getSheetMetaByName, readSheetRange, updateSheetRow, writeSheetRows } from "./sheetsClient.js";
import * as settingsRepo from "./settingsRepo.js";
import { applyStandardTabFormatting } from "./sheetFormatting.js";
import type { Build, Element, LadderRow, SeasonStatsRow } from "../types.js";

/** Legacy/fallback tab name, used until the first reset under the named-season-tab scheme. */
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

/**
 * The tab the current season's stats live in — named after the season itself once a reset has
 * named one, falling back to the generic `SeasonStats` tab until then.
 */
async function currentSheetName(): Promise<string> {
  const { currentSeasonName } = await settingsRepo.getSettings();
  return currentSeasonName || SEASON_STATS_SHEET;
}

/** Every character with recorded activity so far this season. */
export async function getAllRows(): Promise<SeasonStatsRow[]> {
  const sheetName = await currentSheetName();
  const values = await readSheetRange(`${sheetName}!A2:H`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is SeasonStatsRow => r !== null);
}

async function upsertStat(entry: LadderRow, field: "defends" | "wins" | "losses"): Promise<number> {
  const sheetName = await currentSheetName();
  const rows = await getAllRows();
  const existing = rows.find((r) => r.discordUserId === entry.discordUserId && r.element === entry.element);
  const newValue = (existing?.[field] ?? 0) + 1;

  if (existing) {
    await updateSheetRow(sheetName, existing.sheetRow, toValues({ ...existing, [field]: newValue }));
  } else {
    await appendSheetRow(
      sheetName,
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

/** True if a tab with this exact (already-sanitized) name already exists — used to reject a reused season name. */
export async function tabExists(name: string): Promise<boolean> {
  return (await getSheetMetaByName(name)) !== undefined;
}

/**
 * Appends a 0/0/0 row for every ladder entry with no recorded activity into the current season's
 * tab, so historically-active-but-quiet characters still show up once that tab stops being
 * written to and becomes this season's permanent record.
 */
export async function backfillInactiveEntries(ladder: LadderRow[]): Promise<void> {
  const sheetName = await currentSheetName();
  const rows = await getAllRows();
  const statKeys = new Set(rows.map((r) => `${r.discordUserId}:${r.element}`));
  const inactive = ladder.filter((entry) => !statKeys.has(`${entry.discordUserId}:${entry.element}`));

  for (const entry of inactive) {
    await appendSheetRow(
      sheetName,
      toValues({
        discordUserId: entry.discordUserId,
        discordName: entry.discordName,
        characterName: entry.characterName,
        element: entry.element,
        build: entry.build,
        defends: 0,
        wins: 0,
        losses: 0,
      }),
    );
  }
}

/**
 * Creates a brand-new, empty tab titled `seasonName` and points future season-stat writes at it.
 * The previous season's tab is left exactly as it was — no copy step — so it stands as that
 * season's permanent record from the moment this one begins.
 */
export async function startNewSeason(seasonName: string): Promise<void> {
  await addSheetTab(seasonName);
  await writeSheetRows(seasonName, 1, [SEASON_STATS_HEADERS]);
  await settingsRepo.setCurrentSeasonName(seasonName);
  await applyStandardTabFormatting(seasonName, SEASON_STATS_HEADERS.length).catch((err) =>
    console.error(`Failed to apply formatting to new "${seasonName}" tab:`, err),
  );
}
