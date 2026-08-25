import { describe, expect, it } from "vitest";
import { sanitizeSheetTitle } from "../src/util/sanitizeSheetTitle.js";

describe("sanitizeSheetTitle", () => {
  it("passes through an already-safe name unchanged", () => {
    expect(sanitizeSheetTitle("Season 1")).toBe("Season 1");
  });

  it("replaces characters Google Sheets forbids in tab titles", () => {
    expect(sanitizeSheetTitle("Test/Season: 1 [Preseason]? *")).toBe("Test-Season- 1 -Preseason-- -");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeSheetTitle("  Season 1  ")).toBe("Season 1");
  });

  it("truncates to the 100-character sheet-title limit", () => {
    const result = sanitizeSheetTitle("x".repeat(150));
    expect(result).toHaveLength(100);
  });

  it("falls back to a default name for blank input", () => {
    expect(sanitizeSheetTitle("   ")).toBe("Untitled Season");
  });
});
