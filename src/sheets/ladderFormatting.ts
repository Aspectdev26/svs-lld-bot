import type { sheets_v4 } from "googleapis";
import { batchUpdateSpreadsheet, getSheetMetaByName } from "./sheetsClient.js";
import { LADDER_SHEET } from "./ladderRepo.js";

type Color = { red: number; green: number; blue: number };
type Request = sheets_v4.Schema$Request;

const COL = {
  rank: 0,
  name: 1,
  spec: 2,
  element: 3,
  discUser: 4,
  status: 5,
  cDate: 6,
  oppNum: 7,
  discordUserId: 8,
  notes: 9,
  dodges: 10,
} as const;
const COLUMN_COUNT = 11;
const MAX_ROWS = 1000; // generous headroom for ladder growth

const HEADER_BG: Color = { red: 0.788, green: 0.855, blue: 0.973 }; // #c9daf8
const BODY_BG: Color = { red: 0.812, green: 0.886, blue: 0.953 }; // #cfe2f3
const BLACK: Color = { red: 0, green: 0, blue: 0 };

const ELEMENT_COLORS: Record<string, Color> = {
  Cold: { red: 0.643, green: 0.761, blue: 0.957 }, // #a4c2f4
  Fire: { red: 0.918, green: 0.6, blue: 0.6 }, // #ea9999
  Light: { red: 1, green: 0.898, blue: 0.6 }, // #ffe599
};

const STATUS_COLORS: Record<string, { bg: Color; text: Color }> = {
  Available: { bg: { red: 0.714, green: 0.843, blue: 0.659 }, text: { red: 0.153, green: 0.306, blue: 0.075 } }, // #b6d7a8 / #274e13
  Challenge: { bg: { red: 0.976, green: 0.796, blue: 0.612 }, text: { red: 0.706, green: 0.373, blue: 0.024 } }, // #f9cb9c / #b45f06
  Vacation: { bg: { red: 1, green: 0.851, blue: 0.4 }, text: { red: 0.498, green: 0.376, blue: 0 } }, // #ffd966 / #7f6000
};

const RANK_COLORS: Record<number, Color> = {
  1: { red: 0.945, green: 0.761, blue: 0.196 }, // gold
  2: { red: 0.827, green: 0.827, blue: 0.827 }, // silver
  3: { red: 0.878, green: 0.675, blue: 0.412 }, // bronze
};

const DISCUSER_TEXT: Color = { red: 0.067, green: 0.333, blue: 0.8 }; // #1155cc

const COLUMN_WIDTHS: Partial<Record<keyof typeof COL, number>> = {
  rank: 70,
  name: 140,
  spec: 60,
  element: 90,
  discUser: 120,
  status: 110,
  cDate: 130,
  oppNum: 60,
  discordUserId: 170,
  notes: 200,
  dodges: 70,
};

function range(sheetId: number, startCol: number, endCol: number, startRow = 0, endRow = MAX_ROWS): sheets_v4.Schema$GridRange {
  return { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol };
}

function textFormat(color: Color, bold: boolean, fontSize = 10): sheets_v4.Schema$TextFormat {
  return { foregroundColor: color, bold, fontSize, fontFamily: "Arial" };
}

/** Conditional format rules only accept bold/italic/strikethrough/foregroundColor — no size/family. */
function conditionalTextFormat(color: Color, bold: boolean): sheets_v4.Schema$TextFormat {
  return { foregroundColor: color, bold };
}

function conditionalTextEq(sheetId: number, col: number, value: string, bg: Color, text: Color, bold = true): Request {
  return {
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [range(sheetId, col, col + 1, 1)],
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
        ranges: [range(sheetId, col, col + 1, 1)],
        booleanRule: {
          condition: { type: "NUMBER_EQ", values: [{ userEnteredValue: String(value) }] },
          format: { backgroundColor: bg, textFormat: conditionalTextFormat(BLACK, true) },
        },
      },
    },
  };
}

/**
 * Applies the reference-sheet look (header/body colors, column widths, frozen header, and
 * conditional coloring for Rank/element/Status) to the Ladder tab. Idempotent — skipped if the
 * tab already has conditional format rules from a previous run, so re-running on every startup
 * never accumulates duplicate rules.
 */
export async function applyLadderFormatting(): Promise<void> {
  const meta = await getSheetMetaByName(LADDER_SHEET);
  const sheetId = meta?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    console.error(`Could not find sheetId for "${LADDER_SHEET}" tab — skipping formatting.`);
    return;
  }
  if ((meta?.conditionalFormats?.length ?? 0) >= 6) {
    return; // already applied in a previous run
  }

  const requests: Request[] = [];

  // Frozen header row + visible gridlines.
  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1, hideGridlines: false } },
      fields: "gridProperties.frozenRowCount,gridProperties.hideGridlines",
    },
  });

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

  // Header row style.
  requests.push({
    repeatCell: {
      range: range(sheetId, 0, COLUMN_COUNT, 0, 1),
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_BG,
          textFormat: textFormat(BLACK, true, 11),
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  });
  // Rank header is right-aligned to match the numeric column below it.
  requests.push({
    repeatCell: {
      range: range(sheetId, COL.rank, COL.rank + 1, 0, 1),
      cell: { userEnteredFormat: { horizontalAlignment: "RIGHT" } },
      fields: "userEnteredFormat.horizontalAlignment",
    },
  });

  // Base body formatting: uniform background + default text style across the whole data area.
  requests.push({
    repeatCell: {
      range: range(sheetId, 0, COLUMN_COUNT, 1),
      cell: { userEnteredFormat: { backgroundColor: BODY_BG, textFormat: textFormat(BLACK, false) } },
      fields: "userEnteredFormat(backgroundColor,textFormat)",
    },
  });

  // Rank column: bold, right-aligned numbers.
  requests.push({
    repeatCell: {
      range: range(sheetId, COL.rank, COL.rank + 1, 1),
      cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", textFormat: textFormat(BLACK, true) } },
      fields: "userEnteredFormat(horizontalAlignment,textFormat)",
    },
  });

  // Name column: bold.
  requests.push({
    repeatCell: {
      range: range(sheetId, COL.name, COL.name + 1, 1),
      cell: { userEnteredFormat: { textFormat: textFormat(BLACK, true) } },
      fields: "userEnteredFormat.textFormat",
    },
  });

  // discUser column: link-blue text.
  requests.push({
    repeatCell: {
      range: range(sheetId, COL.discUser, COL.discUser + 1, 1),
      cell: { userEnteredFormat: { textFormat: textFormat(DISCUSER_TEXT, false) } },
      fields: "userEnteredFormat.textFormat",
    },
  });

  // Opp# centered.
  requests.push({
    repeatCell: {
      range: range(sheetId, COL.oppNum, COL.oppNum + 1, 1),
      cell: { userEnteredFormat: { horizontalAlignment: "CENTER" } },
      fields: "userEnteredFormat.horizontalAlignment",
    },
  });

  // --- Conditional formatting (auto-recomputes as values change, no bot upkeep needed) ---
  for (const [element, color] of Object.entries(ELEMENT_COLORS)) {
    requests.push(conditionalTextEq(sheetId, COL.element, element, color, BLACK));
  }
  for (const [status, { bg, text }] of Object.entries(STATUS_COLORS)) {
    requests.push(conditionalTextEq(sheetId, COL.status, status, bg, text));
  }
  for (const [rank, color] of Object.entries(RANK_COLORS)) {
    requests.push(conditionalNumberEq(sheetId, COL.rank, Number(rank), color));
  }

  await batchUpdateSpreadsheet(requests);
}
