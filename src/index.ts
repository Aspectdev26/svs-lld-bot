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
import { SIGNUP_REQUESTS_SHEET, SIGNUP_REQUESTS_HEADERS } from "./sheets/signupRequestsRepo.js";
import { BANNED_SHEET, BANNED_HEADERS } from "./sheets/bannedRepo.js";
import { applyLadderFormatting } from "./sheets/ladderFormatting.js";

async function main() {
  await ensureSheetTabs([
    { name: LADDER_SHEET, headers: LADDER_HEADERS },
    { name: MATCHES_SHEET, headers: MATCHES_HEADERS },
    { name: DODGES_SHEET, headers: DODGES_HEADERS },
    { name: RANK1_SHEET, headers: RANK1_HEADERS },
    { name: SIGNUP_REQUESTS_SHEET, headers: SIGNUP_REQUESTS_HEADERS },
    { name: BANNED_SHEET, headers: BANNED_HEADERS },
  ]);

  await applyLadderFormatting().catch((err) => console.error("Failed to apply Ladder sheet formatting:", err));

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
