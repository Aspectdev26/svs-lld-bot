import { config } from "./config.js";
import { createClient } from "./discord/client.js";
import { registerReadyEvent } from "./discord/events/ready.js";
import { registerInteractionEvent } from "./discord/events/interactionCreate.js";
import { startMatchWatcher } from "./scheduler/matchWatcher.js";
import { ensureRegisterPanel } from "./discord/registerPanel.js";
import { ensureChallengePanel } from "./discord/challengePanel.js";
import { ensureAdminPanel } from "./discord/adminPanel.js";
import { refreshTop10Panel } from "./discord/top10Panel.js";
import { refreshActiveChallengesPanel } from "./discord/activeChallengesPanel.js";
import { ensureSheetTabs } from "./sheets/sheetsClient.js";
import { LADDER_SHEET, LADDER_HEADERS } from "./sheets/ladderRepo.js";
import { MATCHES_SHEET, MATCHES_HEADERS } from "./sheets/matchesRepo.js";
import { DODGES_SHEET, DODGES_HEADERS } from "./sheets/dodgesRepo.js";
import { RANK1_SHEET, RANK1_HEADERS } from "./sheets/rank1Repo.js";
import { SEASON_STATS_SHEET, SEASON_STATS_HEADERS } from "./sheets/seasonStatsRepo.js";
import { SIGNUP_REQUESTS_SHEET, SIGNUP_REQUESTS_HEADERS } from "./sheets/signupRequestsRepo.js";
import { BANNED_SHEET, BANNED_HEADERS } from "./sheets/bannedRepo.js";
import { SETTINGS_SHEET, SETTINGS_HEADERS, getSettings } from "./sheets/settingsRepo.js";
import { applyLadderFormatting } from "./sheets/ladderFormatting.js";
import { applyStandardTabFormatting } from "./sheets/sheetFormatting.js";

const NON_LADDER_TABS = [
  { name: MATCHES_SHEET, headers: MATCHES_HEADERS },
  { name: DODGES_SHEET, headers: DODGES_HEADERS },
  { name: RANK1_SHEET, headers: RANK1_HEADERS },
  { name: SEASON_STATS_SHEET, headers: SEASON_STATS_HEADERS },
  { name: SIGNUP_REQUESTS_SHEET, headers: SIGNUP_REQUESTS_HEADERS },
  { name: BANNED_SHEET, headers: BANNED_HEADERS },
  { name: SETTINGS_SHEET, headers: SETTINGS_HEADERS },
];

async function main() {
  await ensureSheetTabs([{ name: LADDER_SHEET, headers: LADDER_HEADERS }, ...NON_LADDER_TABS]);

  await applyLadderFormatting().catch((err) => console.error("Failed to apply Ladder sheet formatting:", err));
  for (const tab of NON_LADDER_TABS) {
    await applyStandardTabFormatting(tab.name, tab.headers.length).catch((err) =>
      console.error(`Failed to apply formatting to "${tab.name}" tab:`, err),
    );
  }
  // The tab the current season's stats live in is dynamically named — not in the static list above.
  const { currentSeasonName } = await getSettings();
  if (currentSeasonName) {
    await applyStandardTabFormatting(currentSeasonName, SEASON_STATS_HEADERS.length).catch((err) =>
      console.error(`Failed to apply formatting to "${currentSeasonName}" tab:`, err),
    );
  }

  const client = createClient();
  registerReadyEvent(client);
  registerInteractionEvent(client);

  client.once("clientReady", () => {
    startMatchWatcher(client);
    ensureRegisterPanel(client).catch((err) => console.error("Failed to post register panel:", err));
    ensureChallengePanel(client).catch((err) => console.error("Failed to post challenge panel:", err));
    ensureAdminPanel(client).catch((err) => console.error("Failed to post admin panel:", err));
    refreshTop10Panel(client).catch((err) => console.error("Failed to post top 10 panel:", err));
    refreshActiveChallengesPanel(client).catch((err) => console.error("Failed to post active challenges panel:", err));
  });

  await client.login(config.discord.token);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
