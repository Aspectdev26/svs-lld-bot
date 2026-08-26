import { EmbedBuilder, type Client } from "discord.js";
import { config } from "../config.js";
import * as ladderRepo from "../sheets/ladderRepo.js";
import * as extendedVacationRepo from "../sheets/extendedVacationRepo.js";
import * as vacationService from "../domain/vacationService.js";
import * as pointsStore from "../domain/pointsStore.js";
import { isLadderPaused } from "../domain/ladderPauseService.js";
import { notify } from "../discord/notify.js";
import { refreshTop10Panel } from "../discord/top10Panel.js";
import { formatElement } from "../util/formatElement.js";

let running = false;

async function dmUser(client: Client, userId: string, content: string): Promise<void> {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ content });
  } catch {
    // DMs closed — the League Manager notice alongside each call site stands as the record.
  }
}

/** 14-day Vacation → Extended Vacation auto-escalation, plus its 3-day-before warning. Returns true if any ladder rank changed. */
async function checkVacations(client: Client): Promise<boolean> {
  const ladder = await ladderRepo.getLadder();
  const now = Date.now();
  let ladderChanged = false;

  for (const entry of ladder.filter((r) => r.status === "Vacation")) {
    const sinceMs = Date.parse(entry.vacationSince);
    if (Number.isNaN(sinceMs)) continue;
    const expiresAtMs = sinceMs + config.timing.vacationExpiryMs;

    if (now >= expiresAtMs) {
      const elementLabel = formatElement(entry.element);
      const rankAtEntry = entry.rank;
      await vacationService.autoEscalateToExtendedVacation(entry);
      ladderChanged = true;

      await dmUser(
        client,
        entry.discordUserId,
        `Your **${elementLabel}** entry's Vacation expired without a return, so it's been moved to **Extended Vacation** (was rank ${rankAtEntry}). ` +
          `You have 30 days to return before it's fully removed from the ladder.`,
      );
      const embed = new EmbedBuilder()
        .setDescription(
          `⌛ <@${entry.discordUserId}>'s **${entry.characterName}** (${elementLabel}) didn't return from Vacation in time and was auto-moved to **Extended Vacation** (was rank ${rankAtEntry}).`,
        )
        .setColor(0x992d22);
      await notify.leagueManagers(client, { embeds: [embed] });
      continue;
    }

    const warnAtMs = expiresAtMs - config.timing.vacationWarningLeadMs;
    if (!entry.vacationWarningSentAt && now >= warnAtMs) {
      await ladderRepo.setVacationWarningSentAt(entry.sheetRow, new Date().toISOString());
      await dmUser(
        client,
        entry.discordUserId,
        `⚠️ Your **${formatElement(entry.element)}** entry (**${entry.characterName}**) has **3 days left** on Vacation. ` +
          `If you don't return in time, you'll be automatically moved to Extended Vacation.`,
      );
      const embed = new EmbedBuilder()
        .setDescription(
          `⚠️ Vacation expiry warning sent to <@${entry.discordUserId}>'s **${entry.characterName}** (${formatElement(entry.element)}) — ` +
            `3 days left before auto-escalation to Extended Vacation.`,
        )
        .setColor(0xf39c12);
      await notify.leagueManagers(client, { embeds: [embed] });
    }
  }

  return ladderChanged;
}

/** 30-day Extended Vacation → full removal, plus its 3-day-before warning. Extended Vacation removal doesn't touch the Ladder tab. */
async function checkExtendedVacations(client: Client): Promise<void> {
  const entries = await extendedVacationRepo.getAllEntries();
  const now = Date.now();

  for (const evacRow of entries) {
    const expiresAtMs = Date.parse(evacRow.expiresAt);
    if (Number.isNaN(expiresAtMs)) continue;

    if (now >= expiresAtMs) {
      await pointsStore.resetPlayer(evacRow.discordUserId);
      await extendedVacationRepo.removeEntry(evacRow.sheetRow);

      await dmUser(
        client,
        evacRow.discordUserId,
        `Your **${formatElement(evacRow.element)}** entry's Extended Vacation expired without a return, so it's been fully removed from the ladder ` +
          `and your season points were reset to zero. Sign up again in #register if you'd like to rejoin.`,
      );
      const embed = new EmbedBuilder()
        .setDescription(
          `🚫 <@${evacRow.discordUserId}>'s **${evacRow.characterName}** (${formatElement(evacRow.element)}) didn't return from Extended Vacation in time and has been fully removed.`,
        )
        .setColor(0x992d22);
      await notify.leagueManagers(client, { embeds: [embed] });
      continue;
    }

    const warnAtMs = expiresAtMs - config.timing.vacationWarningLeadMs;
    if (!evacRow.warningSentAt && now >= warnAtMs) {
      await extendedVacationRepo.setWarningSentAt(evacRow.sheetRow, new Date().toISOString());
      await dmUser(
        client,
        evacRow.discordUserId,
        `⚠️ Your **${formatElement(evacRow.element)}** entry (**${evacRow.characterName}**) has **3 days left** on Extended Vacation. ` +
          `If you don't return in time, you'll be fully removed from the ladder and your season points reset to zero.`,
      );
      const embed = new EmbedBuilder()
        .setDescription(
          `⚠️ Extended Vacation expiry warning sent to <@${evacRow.discordUserId}>'s **${evacRow.characterName}** (${formatElement(evacRow.element)}) — ` +
            `3 days left before full removal.`,
        )
        .setColor(0xf39c12);
      await notify.leagueManagers(client, { embeds: [embed] });
    }
  }
}

async function runPasses(client: Client): Promise<void> {
  if (running) return; // avoid overlapping runs if a previous pass is still working through Sheets API calls
  running = true;
  try {
    if (await isLadderPaused()) return; // vacation timers are frozen while the ladder is paused, same as match timers

    const ladderChanged = await checkVacations(client);
    await checkExtendedVacations(client);
    // Extended Vacation entries hold no ladder row, so only a Vacation→Extended Vacation
    // escalation (which removes and compacts a Ladder row) can change what Top 10 shows.
    if (ladderChanged) {
      await refreshTop10Panel(client).catch((err) => console.error("Failed to refresh top 10 panel:", err));
    }
  } catch (err) {
    console.error("vacationWatcher pass failed:", err);
  } finally {
    running = false;
  }
}

export function startVacationWatcher(client: Client): void {
  runPasses(client);
  setInterval(() => runPasses(client), config.timing.schedulerIntervalMs);
}
