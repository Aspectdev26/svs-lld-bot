import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${raw}`);
  }
  return parsed;
}

export const config = {
  discord: {
    token: required("DISCORD_TOKEN"),
    clientId: required("DISCORD_CLIENT_ID"),
    guildId: required("DISCORD_GUILD_ID"),
  },
  channels: {
    challenges: required("CHALLENGES_CHANNEL_ID"),
    challengeResults: required("CHALLENGE_RESULTS_CHANNEL_ID"),
    rankings: required("RANKINGS_CHANNEL_ID"),
    leagueManagers: required("LEAGUE_MANAGERS_CHANNEL_ID"),
    register: required("REGISTER_CHANNEL_ID"),
    announcements: required("ANNOUNCEMENTS_CHANNEL_ID"),
  },
  leagueManagerRoleName: process.env.LEAGUE_MANAGER_ROLE_NAME || "League Manager",
  sheets: {
    sheetId: required("GOOGLE_SHEET_ID"),
    serviceAccountEmail: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  },
  timing: {
    matchLifespanMs: int("MATCH_LIFESPAN_MS", 72 * 60 * 60 * 1000),
    matchWarningLeadMs: int("MATCH_WARNING_LEAD_MS", 24 * 60 * 60 * 1000),
    dodgeEligibleAfterMs: int("DODGE_ELIGIBLE_AFTER_MS", 48 * 60 * 60 * 1000),
    schedulerIntervalMs: int("SCHEDULER_INTERVAL_MS", 10 * 60 * 1000),
    extensionGrantMs: int("EXTENSION_GRANT_MS", 2 * 24 * 60 * 60 * 1000),
  },
  rules: {
    challengeRange: int("CHALLENGE_RANGE", 3),
    topTierSize: int("TOP_TIER_SIZE", 10),
    topTierChallengeRange: int("TOP_TIER_CHALLENGE_RANGE", 2),
  },
  matchChannels: {
    categoryName: process.env.MATCH_CHANNEL_CATEGORY_NAME || "Current Challenges",
  },
};
