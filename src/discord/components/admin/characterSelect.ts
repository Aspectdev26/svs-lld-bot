import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import type { LadderRow } from "../../../types.js";

/** Discord string selects cap out at 25 options — the league is well under that today. */
export const LADDER_SELECT_MAX_OPTIONS = 25;

/** Builds a dropdown of ladder entries keyed by sheetRow, labeled by character name (not Discord name). */
export function buildLadderCharacterSelectRow(
  ladder: LadderRow[],
  customId: string,
  placeholder: string,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(
      ladder.slice(0, LADDER_SELECT_MAX_OPTIONS).map((r) => ({
        label: `${r.characterName} — ${r.element}, ${r.build}`.slice(0, 100),
        description: `${r.discordName} — Rank ${r.rank}${r.status !== "Available" ? ` — ${r.status}` : ""}`.slice(0, 100),
        value: String(r.sheetRow),
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}
