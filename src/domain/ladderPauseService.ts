import * as settingsRepo from "../sheets/settingsRepo.js";
import * as matchesRepo from "../sheets/matchesRepo.js";

export async function isLadderPaused(): Promise<boolean> {
  const settings = await settingsRepo.getSettings();
  return settings.paused;
}

export type PauseResult = { ok: true } | { ok: false; reason: string };

export async function pauseLadder(): Promise<PauseResult> {
  const settings = await settingsRepo.getSettings();
  if (settings.paused) {
    return { ok: false, reason: "The ladder is already paused." };
  }
  await settingsRepo.setPaused(true, new Date().toISOString());
  return { ok: true };
}

export type ResumeResult = { ok: true; shiftedMatchCount: number } | { ok: false; reason: string };

/**
 * Resumes a paused ladder, shifting every pending match's expiry forward by however long the
 * ladder was paused — so the remaining time a match had left is preserved rather than lost to
 * the pause.
 */
export async function resumeLadder(): Promise<ResumeResult> {
  const settings = await settingsRepo.getSettings();
  if (!settings.paused) {
    return { ok: false, reason: "The ladder isn't currently paused." };
  }

  const pausedAtMs = Date.parse(settings.pausedAt);
  const pauseDurationMs = Number.isNaN(pausedAtMs) ? 0 : Date.now() - pausedAtMs;

  const pending = await matchesRepo.getPendingMatches();
  if (pauseDurationMs > 0) {
    for (const match of pending) {
      const newExpiresAt = new Date(Date.parse(match.expiresAt) + pauseDurationMs).toISOString();
      await matchesRepo.setExpiresAt(match.sheetRow, newExpiresAt);
    }
  }

  await settingsRepo.setPaused(false, "");
  return { ok: true, shiftedMatchCount: pending.length };
}
