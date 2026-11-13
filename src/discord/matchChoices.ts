import * as ladderRepo from "../sheets/ladderRepo.js";
import * as matchesRepo from "../sheets/matchesRepo.js";
import type { MatchRow } from "../types.js";

/** Builds autocomplete choices (name/value pairs) for a player's pending matches. */
export async function buildMatchChoices(
  discordUserId: string,
  typed: string,
  filter: (m: MatchRow) => boolean = () => true,
) {
  const [pending, ladder] = await Promise.all([
    matchesRepo.getPendingMatchForPlayer(discordUserId),
    ladderRepo.getLadder(),
  ]);
  const lowerTyped = typed.toLowerCase();
  return (pending ? [pending] : [])
    .filter(filter)
    .map((m) => {
      const oppId = m.challengerUserId === discordUserId ? m.defenderUserId : m.challengerUserId;
      const oppName = ladder.find((r) => r.discordUserId === oppId)?.discordName ?? "Unknown opponent";
      return { name: `vs ${oppName}`.slice(0, 100), value: m.matchId };
    })
    .filter((c) => c.name.toLowerCase().includes(lowerTyped));
}
