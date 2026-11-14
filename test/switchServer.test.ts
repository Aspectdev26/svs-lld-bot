import { describe, expect, it } from "vitest";
import { setEnvValues } from "../src/scripts/switchServer.js";

describe("setEnvValues", () => {
  it("replaces existing keys in place and leaves other lines alone", () => {
    const before = "# Discord\nDISCORD_GUILD_ID=111\nDISCORD_TOKEN=secret\nLEAGUE_MANAGER_ROLE_NAME=League Manager\n";
    const after = setEnvValues(before, { DISCORD_GUILD_ID: "222", LEAGUE_MANAGER_ROLE_NAME: "NvD Admin" });
    expect(after).toBe("# Discord\nDISCORD_GUILD_ID=222\nDISCORD_TOKEN=secret\nLEAGUE_MANAGER_ROLE_NAME=NvD Admin\n");
  });

  it("appends a key that isn't there yet", () => {
    expect(setEnvValues("A=1", { B: "2" })).toBe("A=1\nB=2\n");
  });

  it("writes values containing $ literally", () => {
    expect(setEnvValues("X=1\n", { X: "a$&b" })).toBe("X=a$&b\n");
  });
});
