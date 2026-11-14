import { EmbedBuilder, type Client } from "discord.js";
import { config } from "../config.js";
import * as dodgesRepo from "../sheets/dodgesRepo.js";
import { removePlayer } from "./adminService.js";
import { notify } from "../discord/notify.js";
import { closeMatchChannel } from "../discord/matchChannels.js";
import type { DodgeRow, MatchRow } from "../types.js";
import { genId } from "./matchService.js";

/** dodgeCount at which the dodged-against player gets a private warning DM + NvD Admin notice. */
export const DODGE_WARNING_THRESHOLD = 2;
/** dodgeCount at which the dodged-against player's entry is automatically removed from the ladder. */
export const DODGE_REMOVAL_THRESHOLD = 3;

/**
 * Reacts to a player's dodgeCount after it's been incremented for some entry (a dodge-approved
 * match, or a forfeited match caused by a Vacation/Extended Vacation approval — see
 * vacationService.ts): a private warning DM (+ NvD Admin notice) at DODGE_WARNING_THRESHOLD,
 * or an automatic ladder removal at DODGE_REMOVAL_THRESHOLD. A no-op below the warning threshold,
 * or if the dodged-against player's ladder entry couldn't be found. `dodgedUserId` identifies
 * whose count this is — usually the match's defender, but a vacation-forfeit can charge
 * either side.
 */
export async function handleDodgeCountThreshold(
  client: Client,
  dodgedUserId: string,
  dodgedDodgeCount: number | null,
): Promise<void> {
  if (dodgedDodgeCount === null || dodgedDodgeCount < DODGE_WARNING_THRESHOLD) return;

  if (dodgedDodgeCount >= DODGE_REMOVAL_THRESHOLD) {
    const { removedEntry, cancelledMatches } = await removePlayer(dodgedUserId);
    if (!removedEntry) return;
    // Defensive: whatever match caused this increment is already resolved by this point, so this
    // should normally find nothing, but any other pending match for this player gets cleaned up.
    for (const cancelled of cancelledMatches) {
      await closeMatchChannel(client, cancelled, "Player removed by automatic dodge-count removal");
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle("Removed from the ladder")
      .setDescription(
        `You reached ${dodgedDodgeCount} dodges against you and have been automatically removed from the ladder.`,
      )
      .setColor(0x992d22);
    try {
      const user = await client.users.fetch(dodgedUserId);
      await user.send({ embeds: [dmEmbed] });
    } catch {
      // DMs closed — the NvD Admin/results-channel notices below stand as the record.
    }

    const lmEmbed = new EmbedBuilder()
      .setDescription(
        `🚫 <@${dodgedUserId}> reached ${dodgedDodgeCount} dodges against them and was automatically removed from the ladder.`,
      )
      .setColor(0x992d22);
    await notify.leagueManagers(client, { embeds: [lmEmbed] });
    await notify.challenges(client, { embeds: [lmEmbed] });
    return;
  }

  // dodgedDodgeCount === DODGE_WARNING_THRESHOLD
  const dmEmbed = new EmbedBuilder()
    .setTitle("Dodge warning")
    .setDescription(
      `You now have **${dodgedDodgeCount}** dodges against you. One more and you'll be ` +
        `automatically removed from the ladder. Completing a challenge (win or lose) removes one dodge from the count.`,
    )
    .setColor(0xe67e22);
  try {
    const user = await client.users.fetch(dodgedUserId);
    await user.send({ embeds: [dmEmbed] });
  } catch {
    // DMs closed — the NvD Admin notice below still records it.
  }

  const lmEmbed = new EmbedBuilder()
    .setDescription(
      `⚠️ <@${dodgedUserId}> now has ${dodgedDodgeCount} dodges against them — ` +
        `one more triggers automatic removal from the ladder.`,
    )
    .setColor(0xe67e22);
  await notify.leagueManagers(client, { embeds: [lmEmbed] });
}

export function isDodgeEligible(match: MatchRow): boolean {
  if (match.status !== "Pending") return false;
  const createdAt = Date.parse(match.createdAt);
  if (Number.isNaN(createdAt)) return false;
  return Date.now() - createdAt >= config.timing.dodgeEligibleAfterMs;
}

export async function createDodgeRequest(
  match: MatchRow,
  requestedByUserId: string,
  leagueManagerMessageUrl: string,
): Promise<DodgeRow> {
  const dodge: Omit<DodgeRow, "sheetRow"> = {
    dodgeId: genId(),
    matchId: match.matchId,
    requestedByUserId,
    requestedAt: new Date().toISOString(),
    leagueManagerMessageUrl,
    status: "Pending",
    resolvedByUserId: "",
    resolvedAt: "",
    denyReason: "",
  };
  await dodgesRepo.addDodge(dodge);
  return { ...dodge, sheetRow: -1 };
}

export async function resolveDodge(
  dodge: DodgeRow,
  resolvedByUserId: string,
  approved: boolean,
  denyReason?: string,
): Promise<void> {
  dodge.status = approved ? "Approved" : "Denied";
  dodge.resolvedByUserId = resolvedByUserId;
  dodge.resolvedAt = new Date().toISOString();
  dodge.denyReason = approved ? "" : denyReason ?? "";
  await dodgesRepo.updateDodge(dodge);
}
