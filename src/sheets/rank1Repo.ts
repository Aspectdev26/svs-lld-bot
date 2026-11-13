import { appendSheetRow, readSheetRange, updateSheetRow } from "./sheetsClient.js";
import type { LadderRow, Rank1Row } from "../types.js";

export const RANK1_SHEET = "All Time Stats";
/**
 * The permanent all-time stat sheet for every player — Wins and Losses count every resolved match
 * (any rank), while Defends stays scoped to title defenses.
 */
export const RANK1_HEADERS = [
  "DiscordUserID",
  "DiscordName",
  "Defends",
  "HolderSince",
  "CurrentHolder",
  "Wins",
  "Losses",
  "DodgesAgainst",
];

function toValues(row: Omit<Rank1Row, "sheetRow">): (string | number)[] {
  return [
    row.discordUserId,
    row.discordName,
    row.defends,
    row.holderSince,
    row.currentHolder ? "Yes" : "",
    row.wins,
    row.losses,
    row.dodgesAgainst,
  ];
}

function rowFromValues(sheetRow: number, values: string[]): Rank1Row {
  const [discordUserId, discordName, defends, holderSince, currentHolder, wins, losses, dodgesAgainst] = values;
  return {
    sheetRow,
    discordUserId: discordUserId ?? "",
    discordName: discordName ?? "",
    defends: Number.parseInt(defends, 10) || 0,
    holderSince: holderSince ?? "",
    currentHolder: (currentHolder ?? "").trim().toLowerCase() === "yes",
    wins: Number.parseInt(wins, 10) || 0,
    losses: Number.parseInt(losses, 10) || 0,
    dodgesAgainst: Number.parseInt(dodgesAgainst, 10) || 0,
  };
}

/** Every player who has ever held rank 1 or recorded a win/loss — the tab is a permanent, append-only history. */
export async function getAllRows(): Promise<Rank1Row[]> {
  const values = await readSheetRange(`${RANK1_SHEET}!A2:H`);
  return values
    .map((row, i) => (row.length > 0 && row[0] ? rowFromValues(i + 2, row) : null))
    .filter((r): r is Rank1Row => r !== null);
}

export async function getCurrentHolderRow(): Promise<Rank1Row | undefined> {
  return (await getAllRows()).find((r) => r.currentHolder);
}

/** Un-flags CurrentHolder on every row except discordUserId's — their defend total is left untouched. */
async function clearOtherCurrentHolders(rows: Rank1Row[], discordUserId: string): Promise<void> {
  for (const row of rows) {
    if (row.currentHolder && row.discordUserId !== discordUserId) {
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
  await clearOtherCurrentHolders(rows, entry.discordUserId);

  const existing = rows.find((r) => r.discordUserId === entry.discordUserId);
  if (existing) {
    await updateSheetRow(
      RANK1_SHEET,
      existing.sheetRow,
      toValues({ ...existing, discordName: entry.discordName, currentHolder: true, holderSince }),
    );
    return;
  }

  await appendSheetRow(
    RANK1_SHEET,
    toValues({
      discordUserId: entry.discordUserId,
      discordName: entry.discordName,
      defends: 0,
      holderSince,
      currentHolder: true,
      wins: 0,
      losses: 0,
      dodgesAgainst: 0,
    }),
  );
}

/** Records a successful title defense for `entry`, bumping their all-time defend total. Returns the new total. */
export async function recordDefend(entry: LadderRow): Promise<number> {
  const rows = await getAllRows();
  await clearOtherCurrentHolders(rows, entry.discordUserId);

  const existing = rows.find((r) => r.discordUserId === entry.discordUserId);
  const defends = (existing?.defends ?? 0) + 1;
  if (existing) {
    await updateSheetRow(RANK1_SHEET, existing.sheetRow, toValues({ ...existing, currentHolder: true, defends }));
  } else {
    await appendSheetRow(
      RANK1_SHEET,
      toValues({
        discordUserId: entry.discordUserId,
        discordName: entry.discordName,
        defends,
        holderSince: new Date().toISOString(),
        currentHolder: true,
        wins: 0,
        losses: 0,
        dodgesAgainst: 0,
      }),
    );
  }
  return defends;
}

/**
 * Bumps `entry`'s all-time win/loss/dodgesAgainst total by one, creating its row (at 0/0/0/0) if
 * this is their first recorded activity. Pass `rows` (an already-fetched `getAllRows()` snapshot)
 * when the caller is about to make several of these calls back to back — e.g. recording both
 * sides of a match — so they share one read instead of each re-fetching the whole sheet. Only
 * safe to share across calls that target different rows and happen before any of them write.
 */
async function upsertStat(entry: LadderRow, field: "wins" | "losses" | "dodgesAgainst", rows?: Rank1Row[]): Promise<number> {
  const allRows = rows ?? (await getAllRows());
  const existing = allRows.find((r) => r.discordUserId === entry.discordUserId);
  const newValue = (existing?.[field] ?? 0) + 1;

  if (existing) {
    await updateSheetRow(RANK1_SHEET, existing.sheetRow, toValues({ ...existing, [field]: newValue }));
  } else {
    await appendSheetRow(
      RANK1_SHEET,
      toValues({
        discordUserId: entry.discordUserId,
        discordName: entry.discordName,
        defends: 0,
        holderSince: "",
        currentHolder: false,
        wins: field === "wins" ? 1 : 0,
        losses: field === "losses" ? 1 : 0,
        dodgesAgainst: field === "dodgesAgainst" ? 1 : 0,
      }),
    );
  }
  return newValue;
}

/** Records an all-time win for `entry` (any rank, any outcome type — reported win or dodge win). Returns the new total. */
export async function recordWin(entry: LadderRow, rows?: Rank1Row[]): Promise<number> {
  return upsertStat(entry, "wins", rows);
}

/** Records an all-time loss for `entry` (any rank, any outcome type — reported loss or dodge loss). Returns the new total. */
export async function recordLoss(entry: LadderRow, rows?: Rank1Row[]): Promise<number> {
  return upsertStat(entry, "losses", rows);
}

/**
 * Records an all-time, never-reset dodge against `entry` on this permanent tab — distinct from the
 * Ladder's `dodgeCount`, which is the resettable warning/removal counter. Returns the new total.
 */
export async function recordDodgeAgainst(entry: LadderRow): Promise<number> {
  return upsertStat(entry, "dodgesAgainst");
}
