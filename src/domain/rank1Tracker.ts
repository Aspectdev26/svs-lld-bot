import * as rank1Repo from "../sheets/rank1Repo.js";
import type { LadderRow } from "../types.js";

export type Rank1Update =
  | { changed: false }
  | { changed: true; kind: "defended"; holderName: string; defends: number }
  | { changed: true; kind: "newChampion"; holderName: string };

/**
 * Call after a match resolves (reported win or approved dodge) to keep the Rank1Defends tab in
 * sync. `preMatchDefenderRank` must be the defender's rank *before* any swap was applied — only
 * matches involving the rank-1 holder as defender are relevant (a challenger can never already be
 * rank 1, since you can only challenge players ranked above you).
 */
export async function recordMatchResult(
  preMatchDefenderRank: number,
  defenderEntry: LadderRow,
  challengerEntry: LadderRow,
  winnerIsChallenger: boolean,
): Promise<Rank1Update> {
  if (preMatchDefenderRank !== 1) return { changed: false };

  if (winnerIsChallenger) {
    await rank1Repo.setRank1Holder(challengerEntry, 0);
    return { changed: true, kind: "newChampion", holderName: challengerEntry.characterName };
  }

  const current = await rank1Repo.getRank1Row();
  if (current && current.discordUserId === defenderEntry.discordUserId && current.element === defenderEntry.element) {
    await rank1Repo.incrementDefends(current);
    return { changed: true, kind: "defended", holderName: defenderEntry.characterName, defends: current.defends + 1 };
  }

  // Tracker was empty or out of sync with the sheet (e.g. the tab was blank) — (re)initialize it.
  await rank1Repo.setRank1Holder(defenderEntry, 1);
  return { changed: true, kind: "defended", holderName: defenderEntry.characterName, defends: 1 };
}
