const FORBIDDEN_CHARS = /[[\]*?/\\:]/g;
const MAX_SHEET_TITLE_LENGTH = 100;

/** Makes a user-supplied string safe as a Google Sheets tab title: swaps out characters Sheets forbids in tab names and enforces the 100-character limit. */
export function sanitizeSheetTitle(input: string): string {
  const cleaned = input.trim().replace(FORBIDDEN_CHARS, "-").slice(0, MAX_SHEET_TITLE_LENGTH).trim();
  return cleaned.length > 0 ? cleaned : "Untitled Season";
}
