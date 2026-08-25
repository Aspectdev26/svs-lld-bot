import { appendSheetRow, readSheetRange, updateSheetRow } from "./sheetsClient.js";
import type { Build, Element, LadderRow, Rank1Row } from "../types.js";

export const RANK1_SHEET = "All Time Stats";
/**
 * CurrentHolder, Wins, and Losses are all appended last (never inserted mid-row) so this stays a
 * backward-compatible migration: existing data for already-tracked rows is untouched, and new
 * columns just read blank/zero until the next write touches that row again. This tab has grown
 * from "rank-1 defends only" into the permanent all-time stat sheet for every character — Wins and
 * Losses count every resolved match (any rank), while Defends stays scoped to title defenses.
 */
export const RANK1_HEADERS = [
  "DiscordUserID",
  "DiscordName",
  "CharacterName",
  "Element",
  "Build",
  "Defends",
  "HolderSince",
  "CurrentHolder",
  "Wins",
  "Losses",
];

function toValues(row: Omit<Rank1Row, "sheetRow">): (string | number)[] {
  return [
    row.discordUserId,
    row.discordName,
    row.characterName,
    row.element,
    row.build,
    row.defends,
    row.holderSince,
    row.currentHolder ? "Yes" : "",
    row.wins,
    row.losses,
  ];
}

function rowFromValues(sheetRow: number, values: string[]): Rank1Row {
  const [discordUserId, discordName, characterName, element, build, defends, holderSince, currentHolder, wins, losses] = values;
  return {
    sheetRow,
    discordUserId: discordUserId ?? "",
    discordName: discordName ?? "",
    characterName: characterName ?? "",
    element: element as Element,
    build: build as Build,
    defends: Number.parseInt(defends, 10) || 0,
    holderSince: holderSince ?? "",
    currentHolder: (currentHolder ?? "").trim().toLowerCase() === "yes",
    wins: Number.parseInt(wins, 10) || 0,
    losses: Number.parseInt(losses, 10) || 0,
  };
}

/** Every player (per element) who has ever held rank 1 or recorded a win/loss — the tab is a permanent, append-only history. */
export async function getAllRows(): Promise<Rank1Row[]> {
  const values = await readSheetRange(`${RANK1_SHEET}!A2:J`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is Rank1Row => r !== null);
}

export async function getCurrentHolderRow(): Promise<Rank1Row | undefined> {
  return (await getAllRows()).find((r) => r.currentHolder);
}

/** Un-flags CurrentHolder on every row except (discordUserId, element) — their defend total is left untouched. */
async function clearOtherCurrentHolders(rows: Rank1Row[], discordUserId: string, element: Element): Promise<void> {
  for (const row of rows) {
    if (row.currentHolder && !(row.discordUserId === discordUserId && row.element === element)) {
      await updateSheetRow(RANK1_SHEET, row.sheetRow, toValues({ ...row, currentHolder: false }));
    }
  }
}

/**
 * Crowns `entry` as the new rank-1 holder after they beat the previous holder. Un-flags the old
 * holder (their all-time defend total stays on the sheet, untouched) and flags entry's own row —
 * creating one at 0 defends if this is their first-ever reign, or preserving their banked total if
 * they're reclaiming the title after a previous reign.
 */
export async function crownHolder(entry: LadderRow, holderSince = new Date().toISOString()): Promise<void> {
  const rows = await getAllRows();
  await clearOtherCurrentHolders(rows, entry.discordUserId, entry.element);

  const existing = rows.find((r) => r.discordUserId === entry.discordUserId && r.element === entry.element);
  if (existing) {
    await updateSheetRow(
      RANK1_SHEET,
      existing.sheetRow,
      toValues({ ...existing, discordName: entry.discordName, characterName: entry.characterName, build: entry.build, currentHolder: true, holderSince }),
    );
    return;
  }

  await appendSheetRow(
    RANK1_SHEET,
    toValues({
      discordUserId: entry.discordUserId,
      discordName: entry.discordName,
      characterName: entry.characterName,
      element: entry.element,
      build: entry.build,
      defends: 0,
      holderSince,
      currentHolder: true,
      wins: 0,
      losses: 0,
    }),
  );
}

/** Records a successful title defense for `entry`, bumping their all-time defend total. Returns the new total. */
export async function recordDefend(entry: LadderRow): Promise<number> {
  const rows = await getAllRows();
  await clearOtherCurrentHolders(rows, entry.discordUserId, entry.element);

  const existing = rows.find((r) => r.discordUserId === entry.discordUserId && r.element === entry.element);
  const defends = (existing?.defends ?? 0) + 1;
  if (existing) {
    await updateSheetRow(RANK1_SHEET, existing.sheetRow, toValues({ ...existing, currentHolder: true, defends }));
  } else {
    await appendSheetRow(
      RANK1_SHEET,
      toValues({
        discordUserId: entry.discordUserId,
        discordName: entry.discordName,
        characterName: entry.characterName,
        element: entry.element,
        build: entry.build,
        defends,
        holderSince: new Date().toISOString(),
        currentHolder: true,
        wins: 0,
        losses: 0,
      }),
    );
  }
  return defends;
}

/** Bumps `entry`'s all-time win or loss total by one, creating its row (at 0/0/0) if this is their first recorded match. */
async function upsertStat(entry: LadderRow, field: "wins" | "losses"): Promise<number> {
  const rows = await getAllRows();
  const existing = rows.find((r) => r.discordUserId === entry.discordUserId && r.element === entry.element);
  const newValue = (existing?.[field] ?? 0) + 1;

  if (existing) {
    await updateSheetRow(RANK1_SHEET, existing.sheetRow, toValues({ ...existing, [field]: newValue }));
  } else {
    await appendSheetRow(
      RANK1_SHEET,
      toValues({
        discordUserId: entry.discordUserId,
        discordName: entry.discordName,
        characterName: entry.characterName,
        element: entry.element,
        build: entry.build,
        defends: 0,
        holderSince: "",
        currentHolder: false,
        wins: field === "wins" ? 1 : 0,
        losses: field === "losses" ? 1 : 0,
      }),
    );
  }
  return newValue;
}

/** Records an all-time win for `entry` (any rank, any outcome type — reported win or dodge win). Returns the new total. */
export async function recordWin(entry: LadderRow): Promise<number> {
  return upsertStat(entry, "wins");
}

/** Records an all-time loss for `entry` (any rank, any outcome type — reported loss or dodge loss). Returns the new total. */
export async function recordLoss(entry: LadderRow): Promise<number> {
  return upsertStat(entry, "losses");
}
