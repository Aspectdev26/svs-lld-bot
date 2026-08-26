import type { sheets_v4 } from "googleapis";
import { batchUpdateSpreadsheet, getSheetMetaByName } from "./sheetsClient.js";

export type Color = { red: number; green: number; blue: number };
export type Request = sheets_v4.Schema$Request;

export const HEADER_BG: Color = { red: 0.945, green: 0.761, blue: 0.196 }; // #f1c232 (gold)
export const BLACK: Color = { red: 0, green: 0, blue: 0 };
export const BORDER_COLOR: Color = { red: 0.6, green: 0.6, blue: 0.6 }; // #999999

export const HEADER_FONT_SIZE = 12;
export const BODY_FONT_SIZE = 11;

const MAX_ROWS = 1000; // generous headroom for row growth

export function gridRange(
  sheetId: number,
  startCol: number,
  endCol: number,
  startRow = 0,
  endRow = MAX_ROWS,
): sheets_v4.Schema$GridRange {
  return { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: startCol, endColumnIndex: endCol };
}

export function textFormat(color: Color, bold: boolean, fontSize = BODY_FONT_SIZE): sheets_v4.Schema$TextFormat {
  return { foregroundColor: color, bold, fontSize, fontFamily: "Arial" };
}

/** Frozen header row, gold bold header, larger body text, and a full grid of thin borders — the shared look for every tab. */
export function standardTabRequests(sheetId: number, columnCount: number): Request[] {
  const requests: Request[] = [];

  requests.push({
    updateSheetProperties: {
      properties: { sheetId, gridProperties: { frozenRowCount: 1, hideGridlines: false } },
      fields: "gridProperties.frozenRowCount,gridProperties.hideGridlines",
    },
  });

  requests.push({
    repeatCell: {
      range: gridRange(sheetId, 0, columnCount, 0, 1),
      cell: {
        userEnteredFormat: {
          backgroundColor: HEADER_BG,
          textFormat: textFormat(BLACK, true, HEADER_FONT_SIZE),
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
    },
  });

  requests.push({
    repeatCell: {
      range: gridRange(sheetId, 0, columnCount, 1),
      cell: { userEnteredFormat: { textFormat: textFormat(BLACK, false) } },
      fields: "userEnteredFormat.textFormat",
    },
  });

  requests.push({
    updateBorders: {
      range: gridRange(sheetId, 0, columnCount, 0),
      top: { style: "SOLID", width: 1, color: BORDER_COLOR },
      bottom: { style: "SOLID", width: 1, color: BORDER_COLOR },
      left: { style: "SOLID", width: 1, color: BORDER_COLOR },
      right: { style: "SOLID", width: 1, color: BORDER_COLOR },
      innerHorizontal: { style: "SOLID", width: 1, color: BORDER_COLOR },
      innerVertical: { style: "SOLID", width: 1, color: BORDER_COLOR },
    },
  });

  return requests;
}

/** Applies just the shared header/border/font look to a tab with no bespoke coloring (Matches, Dodges, etc.). */
export async function applyStandardTabFormatting(sheetName: string, columnCount: number): Promise<void> {
  const meta = await getSheetMetaByName(sheetName);
  const sheetId = meta?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    console.error(`Could not find sheetId for "${sheetName}" tab — skipping formatting.`);
    return;
  }
  await batchUpdateSpreadsheet(standardTabRequests(sheetId, columnCount));
}
