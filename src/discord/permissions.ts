import type { GuildMember } from "discord.js";
import { config } from "../config.js";

export function isLeagueManager(member: GuildMember | null): boolean {
  if (!member) return false;
  return member.roles.cache.some((r) => r.name === config.leagueManagerRoleName);
}
