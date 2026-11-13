import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  config: {
    channels: {
      challenges: "c1",
      challengeResults: "c2",
      rankings: "c3",
      register: "c4",
      announcements: "c5",
      leagueManagers: "c6",
    },
  },
}));

import type { ButtonInteraction } from "discord.js";
import { handleGuideButton } from "../src/discord/components/admin/adminGuide.js";

function messageLength(payload: { embeds: { data: { title?: string; description?: string } }[] }): number {
  return payload.embeds.reduce((sum, e) => sum + (e.data.title?.length ?? 0) + (e.data.description?.length ?? 0), 0);
}

describe("handleGuideButton", () => {
  it("sends the whole guide without any one message exceeding Discord's 6000-character embed limit", async () => {
    const sent: { embeds: { data: { title?: string; description?: string } }[] }[] = [];
    const interaction = {
      reply: vi.fn(async (p) => void sent.push(p)),
      followUp: vi.fn(async (p) => void sent.push(p)),
    } as unknown as ButtonInteraction;

    await handleGuideButton(interaction);

    expect(sent.length).toBeGreaterThanOrEqual(1);
    for (const message of sent) {
      expect(messageLength(message)).toBeLessThanOrEqual(6000);
      for (const embed of message.embeds) expect(embed.data.description?.length ?? 0).toBeLessThanOrEqual(4096);
    }
    expect(sent.flatMap((m) => m.embeds.map((e) => e.data.title))).toContain("How To: Reset Ladder (End Season)");
  });
});
