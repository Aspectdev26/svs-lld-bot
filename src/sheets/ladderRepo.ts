import {
  appendSheetRow,
  batchUpdateSpreadsheet,
  clearSheetRow,
  getSheetMetaByName,
  readSheetRange,
  updateSheetCell,
  updateSheetRow,
} from "./sheetsClient.js";
import type { Build, Element, LadderDisplayStatus, LadderRow, PlayerStatus } from "../types.js";

export const LADDER_SHEET = "Ladder";
/** Column order/labels match the league's original reference sheet exactly. */
export const LADDER_HEADERS = [
  "Rank",
  "Name",
  "spec",
  "element",
  "discUser",
  "Status",
  "cDate",
  "Opp#",
  "discord userid",
  "Notes",
  "Dodges",
  "DodgesAgainst",
];

function rowFromValues(sheetRow: number, values: string[]): LadderRow {
  const [rank, characterName, build, element, discordName, status, challengeDate, opponentRank, discordUserId, notes, dodgeWins, dodgeCount] =
    values;
  return {
    sheetRow,
    rank: Number.parseInt(rank, 10),
    characterName: characterName ?? "",
    build: build as Build,
    element: element as Element,
    discordName: discordName ?? "",
    status: (status as LadderDisplayStatus) || "Available",
    challengeDate: challengeDate ?? "",
    opponentRank: opponentRank ?? "",
    discordUserId: discordUserId ?? "",
    notes: notes ?? "",
    dodgeWins: Number.parseInt(dodgeWins, 10) || 0,
    dodgeCount: Number.parseInt(dodgeCount, 10) || 0,
    joinedAt: "", // not shown in this layout; retained on the type for internal bookkeeping only
  };
}

function toValues(entry: Omit<LadderRow, "sheetRow">): (string | number)[] {
  return [
    entry.rank,
    entry.characterName,
    entry.build,
    entry.element,
    entry.discordName,
    entry.status,
    entry.challengeDate,
    entry.opponentRank,
    entry.discordUserId,
    entry.notes,
    entry.dodgeWins,
    entry.dodgeCount,
  ];
}

/** All ladder rows, ordered by their current rank ascending (rank 1 = top). */
export async function getLadder(): Promise<LadderRow[]> {
  const values = await readSheetRange(`${LADDER_SHEET}!A2:L`);
  const rows = values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is LadderRow => r !== null);
  return rows.sort((a, b) => a.rank - b.rank);
}

export async function getPlayerRows(discordUserId: string): Promise<LadderRow[]> {
  const ladder = await getLadder();
  return ladder.filter((r) => r.discordUserId === discordUserId);
}

export async function findEntry(discordUserId: string, element: Element): Promise<LadderRow | undefined> {
  const rows = await getPlayerRows(discordUserId);
  return rows.find((r) => r.element === element);
}

/** Finds any ladder entry (any owner) sharing the same character name (case-insensitive), element, and build. */
export async function findByCharacterNameElementBuild(
  characterName: string,
  element: Element,
  build: Build,
): Promise<LadderRow | undefined> {
  const ladder = await getLadder();
  const nameLower = characterName.trim().toLowerCase();
  return ladder.find(
    (r) => r.element === element && r.build === build && r.characterName.trim().toLowerCase() === nameLower,
  );
}

export async function addLadderEntry(entry: Omit<LadderRow, "sheetRow">): Promise<void> {
  await appendSheetRow(LADDER_SHEET, toValues(entry));
}

export async function setRank(sheetRow: number, rank: number): Promise<void> {
  await updateSheetCell(LADDER_SHEET, sheetRow, "A", rank);
}

/** Sets Vacation/Available on one specific ladder entry (one character/element), not a player's whole roster. */
export async function setStatusForEntry(sheetRow: number, status: PlayerStatus): Promise<void> {
  await updateSheetCell(LADDER_SHEET, sheetRow, "F", status);
}

/** Marks an entry as actively challenging: Status="Challenge" plus the opponent's rank and a display timestamp. */
export async function setChallengeInfo(sheetRow: number, opponentRank: number, challengeDateDisplay: string): Promise<void> {
  await updateSheetCell(LADDER_SHEET, sheetRow, "F", "Challenge");
  await updateSheetCell(LADDER_SHEET, sheetRow, "G", challengeDateDisplay);
  await updateSheetCell(LADDER_SHEET, sheetRow, "H", opponentRank);
}

/** Clears an entry's active-challenge display, reverting Status to Available. */
export async function clearChallengeInfo(sheetRow: number): Promise<void> {
  await updateSheetCell(LADDER_SHEET, sheetRow, "F", "Available");
  await updateSheetCell(LADDER_SHEET, sheetRow, "G", "");
  await updateSheetCell(LADDER_SHEET, sheetRow, "H", "");
}

export async function setDodgeWins(sheetRow: number, count: number): Promise<void> {
  await updateSheetCell(LADDER_SHEET, sheetRow, "K", count);
}

/** Running count of approved dodges *against* this entry — see the `dodgeCount` doc on LadderRow. */
export async function setDodgeCount(sheetRow: number, count: number): Promise<void> {
  await updateSheetCell(LADDER_SHEET, sheetRow, "L", count);
}

export async function overwriteRow(row: LadderRow): Promise<void> {
  await updateSheetRow(LADDER_SHEET, row.sheetRow, toValues(row));
}

/** Blanks out an entry entirely (used by admin remove/ban) — leaves a gap other reads skip over. */
export async function clearRow(sheetRow: number): Promise<void> {
  await clearSheetRow(LADDER_SHEET, sheetRow, LADDER_HEADERS.length);
}

const SORT_ROW_HEADROOM = 1000;

/**
 * Physically re-sorts the sheet's data rows by Rank ascending. Rank changes (swaps, shuffles,
 * removals, manual overrides) only ever update the Rank *value* in whichever row an entry
 * already occupies — they never move rows — so without this, the raw spreadsheet drifts out of
 * visual top-to-bottom order over time. Blank rows (including gaps left by a removed entry) sort
 * to the end, so this also closes up any holes. Call once, as the last step, after any operation
 * that changes rank values.
 */
export async function sortLadderByRank(): Promise<void> {
  const meta = await getSheetMetaByName(LADDER_SHEET);
  const sheetId = meta?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) return;

  await batchUpdateSpreadsheet([
    {
      sortRange: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: SORT_ROW_HEADROOM,
          startColumnIndex: 0,
          endColumnIndex: LADDER_HEADERS.length,
        },
        sortSpecs: [{ dimensionIndex: 0, sortOrder: "ASCENDING" }],
      },
    },
  ]);
}
