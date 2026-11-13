import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import type { LadderRow } from "../../../types.js";

/** Discord string selects cap out at 25 options — the league is well under that today. */
export const LADDER_SELECT_MAX_OPTIONS = 25;

/** Builds a dropdown of ladder entries keyed by sheetRow, labeled by the player's Discord name. */
export function buildLadderPlayerSelectRow(
  ladder: LadderRow[],
  customId: string,
  placeholder: string,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(
      ladder.slice(0, LADDER_SELECT_MAX_OPTIONS).map((r) => ({
        label: `${r.rank}. ${r.discordName}`.slice(0, 100),
        description: r.status !== "Available" ? r.status : undefined,
        value: String(r.sheetRow),
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}
