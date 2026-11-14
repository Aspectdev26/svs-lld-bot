import { describe, expect, it, vi } from "vitest";

vi.mock("../src/sheets/sheetsClient.js", () => ({}));

import { parseStatusCell, statusCellValue } from "../src/sheets/ladderRepo.js";
import { LADDER_DISPLAY_STATUSES } from "../src/types.js";

describe("ladder status cells", () => {
  it("writes each status as exactly its dropdown word", () => {
    for (const status of LADDER_DISPLAY_STATUSES) {
      expect(statusCellValue(status)).toBe(status);
      expect(parseStatusCell(statusCellValue(status))).toBe(status);
    }
  });

  it("reads a status that still has an old emoji icon in front of it", () => {
    for (const status of LADDER_DISPLAY_STATUSES) {
      expect(parseStatusCell(`✅ ${status}`)).toBe(status);
    }
  });

  it("reads a bare or hand-typed status without its icon", () => {
    expect(parseStatusCell("Vacation")).toBe("Vacation");
    expect(parseStatusCell(" challenge ")).toBe("Challenge");
  });

  it("treats a blank cell as Available", () => {
    expect(parseStatusCell("")).toBe("Available");
    expect(parseStatusCell(undefined)).toBe("Available");
  });
});
