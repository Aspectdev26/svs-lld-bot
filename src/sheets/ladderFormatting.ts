import type { sheets_v4 } from "googleapis";
import { batchUpdateSpreadsheet, findFirstValidatedRow, getSheetMetaByName } from "./sheetsClient.js";
import { LADDER_SHEET } from "./ladderRepo.js";
import { BLACK, gridRange, type Color, type Request } from "./sheetFormatting.js";

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
  vacationSince: 9,
  vacationWarningSentAt: 10,
} as const;
const COLUMN_COUNT = 11;

// Everything below is copied from the league's original SvS Ladder reference tab.
const HEADER_BG: Color = { red: 1, green: 0.898, blue: 0.6 }; // #ffe599
const BAND_1: Color = { red: 0.776, green: 0.831, blue: 0.831 }; // #c6d4d4
const BAND_2: Color = { red: 0.894, green: 0.91, blue: 0.89 }; // #e4e8e3
const TAB_COLOR: Color = { red: 0.8, green: 0, blue: 0 }; // #cc0000

const COLUMN_WIDTHS: Record<keyof typeof COL, number> = {
  rank: 97,
  discUser: 200,
  status: 156,
  cDate: 150,
  oppNum: 68,
  discordUserId: 175,
  notes: 234,
  dodges: 123,
  dodgesAgainst: 114,
  vacationSince: 143,
  vacationWarningSentAt: 143,
};

function font(fontFamily: string, fontSize: number, bold: boolean): sheets_v4.Schema$TextFormat {
  return { fontFamily, fontSize, bold, italic: false, foregroundColor: BLACK };
}

function columnFormat(sheetId: number, col: number, format: sheets_v4.Schema$CellFormat, fields: string): Request {
  return { repeatCell: { range: gridRange(sheetId, col, col + 1, 1), cell: { userEnteredFormat: format }, fields } };
}

/**
 * Applies the original SvS Ladder reference-tab look to the Ladder tab: pale-gold Comfortaa header,
 * alternating grey-green row banding, Verdana body text, big rank numbers, bold player names and
 * statuses, black grid borders, and a red tab. Safe to re-run any time — formats overwrite in place
 * and any existing banding / conditional rules are removed and recreated rather than duplicated.
 *
 * The Status column's colored dropdown chips are a data-validation rule copied from the reference
 * sheet (chip colors can't be set through the API). This never creates or changes that rule — it only
 * re-copies it onto C2 and below if rows ever shifted it down.
 */
export async function applyLadderFormatting(): Promise<void> {
  const meta = await getSheetMetaByName(LADDER_SHEET);
  const sheetId = meta?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    console.error(`Could not find sheetId for "${LADDER_SHEET}" tab — skipping formatting.`);
    return;
  }

  const requests: Request[] = [];

  // Clear out anything a previous version of this function added.
  for (let i = (meta?.conditionalFormats?.length ?? 0) - 1; i >= 0; i--) {
    requests.push({ deleteConditionalFormatRule: { sheetId, index: i } });
  }
  for (const banded of meta?.bandedRanges ?? []) {
    if (banded.bandedRangeId != null) requests.push({ deleteBanding: { bandedRangeId: banded.bandedRangeId } });
  }

  requests.push({
    updateSheetProperties: {
      properties: { sheetId, tabColor: TAB_COLOR, gridProperties: { frozenRowCount: 1, hideGridlines: false } },
      fields: "tabColor,gridProperties.frozenRowCount,gridProperties.hideGridlines",
    },
  });

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

  // Header row: pale gold, Comfortaa 15 bold (Rank header is plain Verdana 15, as in the reference).
  requests.push({
    repeatCell: {
      range: gridRange(sheetId, 0, COLUMN_COUNT, 0, 1),
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_BG,
          textFormat: font("Comfortaa", 15, true),
          horizontalAlignment: "LEFT",
          verticalAlignment: "BOTTOM",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  });
  requests.push({
    repeatCell: {
      range: gridRange(sheetId, COL.rank, COL.rank + 1, 0, 1),
      cell: { userEnteredFormat: { textFormat: font("Verdana", 15, false) } },
      fields: "userEnteredFormat.textFormat",
    },
  });

  // Body base: no cell fill (so the banding shows), Verdana 10, bottom-aligned.
  requests.push({
    repeatCell: {
      range: gridRange(sheetId, 0, COLUMN_COUNT, 1),
      cell: {
        userEnteredFormat: {
          textFormat: font("Verdana", 10, false),
          horizontalAlignment: "LEFT",
          verticalAlignment: "BOTTOM",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  });

  // Rank: Verdana 15, right-aligned, plain "0" number format. The numberFormat is reset explicitly —
  // an earlier version used a custom format here, which changed the FORMATTED value the bot reads
  // and broke rank parsing; including it in the field mask guarantees nothing like that lingers.
  requests.push(
    columnFormat(
      sheetId,
      COL.rank,
      { textFormat: font("Verdana", 15, false), horizontalAlignment: "RIGHT", numberFormat: { type: "NUMBER", pattern: "0" } },
      "userEnteredFormat(textFormat,horizontalAlignment,numberFormat)",
    ),
  );
  // Player name: Montserrat 12 bold (the reference's Name-column style — discUser is the name now).
  requests.push(columnFormat(sheetId, COL.discUser, { textFormat: font("Montserrat", 12, true) }, "userEnteredFormat.textFormat"));
  // Status: Verdana 14 bold.
  requests.push(columnFormat(sheetId, COL.status, { textFormat: font("Verdana", 14, true) }, "userEnteredFormat.textFormat"));
  // Numeric columns right-aligned, as Sheets shows numbers by default.
  for (const col of [COL.oppNum, COL.dodges, COL.dodgesAgainst]) {
    requests.push(columnFormat(sheetId, col, { horizontalAlignment: "RIGHT" }, "userEnteredFormat.horizontalAlignment"));
  }

  // Alternating row colors under the header.
  requests.push({
    addBanding: {
      bandedRange: {
        range: gridRange(sheetId, 0, COLUMN_COUNT, 1),
        rowProperties: { firstBandColor: BAND_1, secondBandColor: BAND_2 },
      },
    },
  });

  // Put the Status dropdown back on every data row (C2 down) if it has drifted — copied from the first
  // cell that still has it, so the chip colors come along.
  const validatedRow = await findFirstValidatedRow(LADDER_SHEET, COL.status, 1);
  if (validatedRow !== undefined && validatedRow !== 1) {
    const rowCount = meta?.properties?.gridProperties?.rowCount ?? 1000;
    requests.push({
      copyPaste: {
        source: gridRange(sheetId, COL.status, COL.status + 1, validatedRow, validatedRow + 1),
        destination: gridRange(sheetId, COL.status, COL.status + 1, 1, rowCount),
        pasteType: "PASTE_DATA_VALIDATION",
      },
    });
  }

  // Thin black grid borders.
  const line = { style: "SOLID", width: 1, color: BLACK };
  requests.push({
    updateBorders: {
      range: gridRange(sheetId, 0, COLUMN_COUNT, 0),
      top: line,
      bottom: line,
      left: line,
      right: line,
      innerHorizontal: line,
      innerVertical: line,
    },
  });

  await batchUpdateSpreadsheet(requests);
}
