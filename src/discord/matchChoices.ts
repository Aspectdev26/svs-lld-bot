import * as ladderRepo from "../sheets/ladderRepo.js";
import * as matchesRepo from "../sheets/matchesRepo.js";
import { formatElement } from "../util/formatElement.js";
import type { MatchRow } from "../types.js";

/** Builds autocomplete choices (name/value pairs) for a player's pending matches. */
export async function buildMatchChoices(
  discordUserId: string,
  typed: string,
  filter: (m: MatchRow) => boolean = () => true,
) {
  const [pending, ladder] = await Promise.all([
    matchesRepo.getPendingMatchesForPlayer(discordUserId),
    ladderRepo.getLadder(),
  ]);
  const lowerTyped = typed.toLowerCase();
  return pending
    .filter(filter)
    .map((m) => {
      const isChallenger = m.challengerUserId === discordUserId;
      const myElement = isChallenger ? m.challengerElement : m.defenderElement;
      const oppId = isChallenger ? m.defenderUserId : m.challengerUserId;
      const oppElement = isChallenger ? m.defenderElement : m.challengerElement;
      const oppEntry = ladder.find((r) => r.discordUserId === oppId && r.element === oppElement);
      const oppName = oppEntry?.characterName ?? "Unknown opponent";
      return { name: `${formatElement(myElement)} vs ${oppName} (${formatElement(oppElement)})`, value: m.matchId };
    })
    .filter((c) => c.name.toLowerCase().includes(lowerTyped));
}
