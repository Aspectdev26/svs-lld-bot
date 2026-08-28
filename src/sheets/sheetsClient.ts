import { google, sheets_v4 } from "googleapis";
import { JWT } from "google-auth-library";
import { config } from "../config.js";

let sheetsApi: sheets_v4.Sheets | null = null;

function getSheetsApi(): sheets_v4.Sheets {
  if (sheetsApi) return sheetsApi;
  const auth = new JWT({
    email: config.sheets.serviceAccountEmail,
    key: config.sheets.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsApi = google.sheets({ version: "v4", auth });
  return sheetsApi;
}

/**
 * The Sheets API allows bursts but throttles sustained per-minute request rates.
 * Serializing all calls through one queue with a small minimum gap keeps us well
 * under quota without needing a local DB, since the sheet itself is our datastore.
 */
class RequestQueue {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly minGapMs = 150;

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const value = await fn();
      await new Promise((resolve) => setTimeout(resolve, this.minGapMs));
      return value;
    });
    // Swallow errors in the chain so one failed call doesn't wedge the queue.
    this.queue = result.catch(() => undefined);
    return result;
  }
}

const queue = new RequestQueue();

export async function readSheetRange(range: string): Promise<string[][]> {
  return queue.run(async () => {
    const res = await getSheetsApi().spreadsheets.values.get({
      spreadsheetId: config.sheets.sheetId,
      range,
    });
    return (res.data.values as string[][] | undefined) ?? [];
  });
}

export async function appendSheetRow(sheetName: string, values: (string | number)[]): Promise<void> {
  await queue.run(async () => {
    await getSheetsApi().spreadsheets.values.append({
      spreadsheetId: config.sheets.sheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [values] },
    });
  });
}

export async function updateSheetRow(
  sheetName: string,
  rowNumber: number,
  values: (string | number)[],
): Promise<void> {
  await queue.run(async () => {
    const lastCol = String.fromCharCode("A".charCodeAt(0) + values.length - 1);
    await getSheetsApi().spreadsheets.values.update({
      spreadsheetId: config.sheets.sheetId,
      range: `${sheetName}!A${rowNumber}:${lastCol}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
  });
}

/**
 * Blanks out a row rather than deleting it, so row indices of every other row stay stable — safe
 * to call even while other cached sheetRow numbers are in flight elsewhere. Rows with an empty
 * first cell are already skipped by every repo's parser, so a cleared row is invisible to reads.
 */
export async function clearSheetRow(sheetName: string, rowNumber: number, columnCount: number): Promise<void> {
  await queue.run(async () => {
    const lastCol = String.fromCharCode("A".charCodeAt(0) + columnCount - 1);
    await getSheetsApi().spreadsheets.values.clear({
      spreadsheetId: config.sheets.sheetId,
      range: `${sheetName}!A${rowNumber}:${lastCol}${rowNumber}`,
    });
  });
}

/** Writes multiple contiguous rows in one API call (e.g. seeding a new archive tab). */
export async function writeSheetRows(sheetName: string, startRow: number, rows: (string | number)[][]): Promise<void> {
  if (rows.length === 0) return;
  await queue.run(async () => {
    const lastCol = String.fromCharCode("A".charCodeAt(0) + rows[0].length - 1);
    const endRow = startRow + rows.length - 1;
    await getSheetsApi().spreadsheets.values.update({
      spreadsheetId: config.sheets.sheetId,
      range: `${sheetName}!A${startRow}:${lastCol}${endRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });
  });
}

/** Clears every value in the given A1 range (e.g. wiping all data rows out of a sheet). */
export async function clearSheetRange(sheetName: string, range: string): Promise<void> {
  await queue.run(async () => {
    await getSheetsApi().spreadsheets.values.clear({
      spreadsheetId: config.sheets.sheetId,
      range: `${sheetName}!${range}`,
    });
  });
}

/** Creates a new tab with the given title. No-ops silently if it already exists. */
export async function addSheetTab(title: string): Promise<void> {
  await queue.run(async () => {
    try {
      await getSheetsApi().spreadsheets.batchUpdate({
        spreadsheetId: config.sheets.sheetId,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("already exists")) throw err;
    }
  });
}

export async function updateSheetCell(
  sheetName: string,
  rowNumber: number,
  column: string,
  value: string | number,
): Promise<void> {
  await queue.run(async () => {
    await getSheetsApi().spreadsheets.values.update({
      spreadsheetId: config.sheets.sheetId,
      range: `${sheetName}!${column}${rowNumber}:${column}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value]] },
    });
  });
}

/**
 * Writes several independent ranges (any mix of single cells, row slices, even different tabs) in
 * one HTTP round trip instead of one call each — use this whenever a flow would otherwise issue a
 * handful of unrelated `updateSheetCell`/`updateSheetRow` calls back to back, since every call here
 * is serialized through the same queue regardless of how it's awaited.
 */
export async function batchUpdateValues(updates: { range: string; values: (string | number)[][] }[]): Promise<void> {
  if (updates.length === 0) return;
  await queue.run(async () => {
    await getSheetsApi().spreadsheets.values.batchUpdate({
      spreadsheetId: config.sheets.sheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates.map((u) => ({ range: u.range, values: u.values })),
      },
    });
  });
}

/** Runs an arbitrary spreadsheets.batchUpdate (formatting, sheet properties, etc.), queued like everything else. */
export async function batchUpdateSpreadsheet(requests: sheets_v4.Schema$Request[]): Promise<void> {
  if (requests.length === 0) return;
  await queue.run(() =>
    getSheetsApi().spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.sheetId,
      requestBody: { requests },
    }),
  );
}

/** Full metadata for one tab (sheetId, grid properties, conditional formats, etc.). */
export async function getSheetMetaByName(sheetName: string): Promise<sheets_v4.Schema$Sheet | undefined> {
  const meta = await queue.run(() =>
    getSheetsApi().spreadsheets.get({ spreadsheetId: config.sheets.sheetId, includeGridData: false }),
  );
  return meta.data.sheets?.find((s) => s.properties?.title === sheetName) ?? undefined;
}

/** Ensures the given tabs exist with the given header rows. Safe to call on every startup. */
export async function ensureSheetTabs(tabs: { name: string; headers: string[] }[]): Promise<void> {
  const api = getSheetsApi();
  const meta = await queue.run(() =>
    api.spreadsheets.get({ spreadsheetId: config.sheets.sheetId }),
  );
  const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));

  const missing = tabs.filter((t) => !existing.has(t.name));
  if (missing.length > 0) {
    await queue.run(() =>
      api.spreadsheets.batchUpdate({
        spreadsheetId: config.sheets.sheetId,
        requestBody: {
          requests: missing.map((t) => ({ addSheet: { properties: { title: t.name } } })),
        },
      }),
    );
  }

  for (const tab of tabs) {
    const existingHeader = await readSheetRange(`${tab.name}!A1:${String.fromCharCode(64 + tab.headers.length)}1`);
    // Also re-writes the header row if it's shorter than expected, so schema additions (new
    // trailing columns) get backfilled on an existing sheet without touching existing data rows.
    if (existingHeader.length === 0 || (existingHeader[0]?.length ?? 0) < tab.headers.length) {
      await updateSheetRow(tab.name, 1, tab.headers);
    }
  }
}
