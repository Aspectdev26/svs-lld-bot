import type { sheets_v4 } from "googleapis";
import { batchUpdateSpreadsheet, getSheetMetaByName } from "./sheetsClient.js";
import { LADDER_SHEET } from "./ladderRepo.js";
import {
  BLACK,
  BODY_FONT_SIZE,
  gridRange,
  standardTabRequests,
  textFormat,
  type Color,
  type Request,
} from "./sheetFormatting.js";

const COL = {
  rank: 0,
  discUser: 1,
  status: 2,
  cDate: 3,
  oppNum: 4,
  discordUserId: 5,
  notes: 6,
  dodges: 7,
  dodgesAgainst: 8,
} as const;
const COLUMN_COUNT = 9;

const BODY_BG: Color = { red: 0.812, green: 0.886, blue: 0.953 }; // #cfe2f3

const STATUS_COLORS: Record<string, { bg: Color; text: Color }> = {
  Available: { bg: { red: 0.714, green: 0.843, blue: 0.659 }, text: { red: 0.153, green: 0.306, blue: 0.075 } }, // #b6d7a8 / #274e13
  Challenge: { bg: { red: 0.976, green: 0.796, blue: 0.612 }, text: { red: 0.706, green: 0.373, blue: 0.024 } }, // #f9cb9c / #b45f06
  Vacation: { bg: { red: 1, green: 0.851, blue: 0.4 }, text: { red: 0.498, green: 0.376, blue: 0 } }, // #ffd966 / #7f6000
};

/** Gold/silver/bronze badge tint for the Rank cell itself (not the whole row) on ranks 1-3 — the only medal treatment, safe because conditional formatting never changes the cell's readable value. */
const RANK_BADGE_COLORS: Record<number, Color> = {
  1: { red: 0.945, green: 0.761, blue: 0.196 }, // gold
  2: { red: 0.827, green: 0.827, blue: 0.827 }, // silver
  3: { red: 0.878, green: 0.675, blue: 0.412 }, // bronze
};

const DISCUSER_TEXT: Color = { red: 0.067, green: 0.333, blue: 0.8 }; // #1155cc

const COLUMN_WIDTHS: Partial<Record<keyof typeof COL, number>> = {
  rank: 70,
  discUser: 160,
  status: 110,
  cDate: 130,
  oppNum: 60,
  discordUserId: 170,
  notes: 200,
  dodges: 70,
  dodgesAgainst: 90,
};

/** Conditional format rules only accept bold/italic/strikethrough/foregroundColor — no size/family. */
function conditionalTextFormat(color: Color, bold: boolean): sheets_v4.Schema$TextFormat {
  return { foregroundColor: color, bold };
}

function conditionalTextEq(sheetId: number, col: number, value: string, bg: Color, text: Color, bold = true): Request {
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [gridRange(sheetId, col, col + 1, 1)],
        booleanRule: {
          condition: { type: "TEXT_EQ", values: [{ userEnteredValue: value }] },
          format: { backgroundColor: bg, textFormat: conditionalTextFormat(text, bold) },
        },
      },
    },
  };
}

function conditionalNumberEq(sheetId: number, col: number, value: number, bg: Color): Request {
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [gridRange(sheetId, col, col + 1, 1)],
        booleanRule: {
          condition: { type: "NUMBER_EQ", values: [{ userEnteredValue: String(value) }] },
          format: { backgroundColor: bg, textFormat: conditionalTextFormat(BLACK, true) },
        },
      },
    },
  };
}

/**
 * Applies the reference-sheet look (shared header/border/font styling, plus Ladder-specific body
 * color, column widths, and conditional coloring for Rank/Status) to the Ladder tab. Safe
 * to re-run any time — cell-level styling requests just overwrite in place, and any existing
 * conditional format rules are deleted and recreated fresh each time rather than skipped or
 * duplicated, so a sheet that's drifted (wrong colors, manually cleared formatting, a reset, etc.)
 * always gets corrected. Call this after any bulk operation that could plausibly disturb the
 * sheet's look, not just on startup.
 */
export async function applyLadderFormatting(): Promise<void> {
  const meta = await getSheetMetaByName(LADDER_SHEET);
  const sheetId = meta?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    console.error(`Could not find sheetId for "${LADDER_SHEET}" tab — skipping formatting.`);
    return;
  }

  const requests: Request[] = [...standardTabRequests(sheetId, COLUMN_COUNT)];

  // Delete any existing conditional format rules first (highest index first, since removing one
  // shifts the rest down) so re-running this never accumulates or duplicates rules.
  const existingRuleCount = meta?.conditionalFormats?.length ?? 0;
  for (let i = existingRuleCount - 1; i >= 0; i--) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }

  // Column widths.
  for (const [key, width] of Object.entries(COLUMN_WIDTHS)) {
    const col = COL[key as keyof typeof COL];
    requests.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: col, endIndex: col + 1 },
        properties: { pixelSize: width },
        fields: "pixelSize",
      },
    });
  }

  // Rank header is right-aligned to match the numeric column below it.
  requests.push({
    repeatCell: {
      range: gridRange(sheetId, COL.rank, COL.rank + 1, 0, 1),
      cell: { userEnteredFormat: { horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat.horizontalAlignment",
    },
  });

  // Body background (overrides the shared base's plain white with the reference sheet's light blue).
  requests.push({
    repeatCell: {
      range: gridRange(sheetId, 0, COLUMN_COUNT, 1),
      cell: { userEnteredFormat: { backgroundColor: BODY_BG } },
      fields: "userEnteredFormat.backgroundColor",
    },
  });

  // Rank column: bold, right-aligned numbers. Deliberately no custom number format here — an
  // earlier version prefixed 🥇/🥈 onto ranks 1-2 via a number format, which silently changes what
  // the Sheets API returns for those cells (the bot reads FORMATTED values), broke parseInt() on
  // the rank, and corrupted `nextRankForNewEntry` for every signup approved afterward — poisoning
  // the ladder with a blank rank. Ranks 1-3 get their medal purely via the conditional background
  // tint below, which never touches the readable value.
  requests.push({
    repeatCell: {
      range: gridRange(sheetId, COL.rank, COL.rank + 1, 1),
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "RIGHT",
          textFormat: textFormat(BLACK, true, BODY_FONT_SIZE),
          numberFormat: { type: "NUMBER", pattern: "0" },
        },
      },
      // numberFormat is explicitly included (and reset to plain "0") even though this tab no
      // longer sets a custom one — omitting it from the mask leaves any format from a previous
      // run in place instead of clearing it, which is exactly what broke rank parsing before.
      fields: "userEnteredFormat(horizontalAlignment,textFormat,numberFormat)",
    },
  });

  // discUser column: bold link-blue text — it's the player's identity on the ladder.
  requests.push({
    repeatCell: {
      range: gridRange(sheetId, COL.discUser, COL.discUser + 1, 1),
      cell: { userEnteredFormat: { textFormat: textFormat(DISCUSER_TEXT, true) } },
      fields: "userEnteredFormat.textFormat",
    },
  });

  // Opp# centered.
  requests.push({
    repeatCell: {
      range: gridRange(sheetId, COL.oppNum, COL.oppNum + 1, 1),
      cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat.horizontalAlignment",
    },
  });

  // --- Conditional formatting (auto-recomputes as values change, no bot upkeep needed) ---
  for (const [status, { bg, text }] of Object.entries(STATUS_COLORS)) {
    requests.push(conditionalTextEq(sheetId, COL.status, status, bg, text));
  }
  for (const [rank, color] of Object.entries(RANK_BADGE_COLORS)) {
    requests.push(conditionalNumberEq(sheetId, COL.rank, Number(rank), color));
  }

  await batchUpdateSpreadsheet(requests);
}
