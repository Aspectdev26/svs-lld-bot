/**
 * One-time full league reset, written for the switch from the Cold/Light/Fire elements league to
 * the Necro vs Druid league (no elements, builds, or character names — one ladder spot per player).
 *
 * Wipes every row the bot owns and rewrites each tab's header row to the current layout:
 *   Ladder, Matches, Dodges, All Time Stats, SeasonStats, SignupRequests, BannedUsers,
 *   VacationRequests, ExtendedVacation, plus the current season's tab (named in Settings).
 * Clears the season name in Settings (the pause toggle is kept) and wipes the local season
 * points store (data/points.json).
 *
 * Any other tabs (e.g. old `Season N` archives) are left alone and listed at the end so they can
 * be deleted by hand. Stop the bot before running this, and start it again afterwards.
 *
 *   npm run reset-league -- --yes
 */
import "dotenv/config";
import { clearSheetRange, getSheetMetaByName, writeSheetRows } from "../sheets/sheetsClient.js";
import { LADDER_SHEET, LADDER_HEADERS } from "../sheets/ladderRepo.js";
import { MATCHES_SHEET, MATCHES_HEADERS } from "../sheets/matchesRepo.js";
import { DODGES_SHEET, DODGES_HEADERS } from "../sheets/dodgesRepo.js";
import { RANK1_SHEET, RANK1_HEADERS } from "../sheets/rank1Repo.js";
import { SEASON_STATS_SHEET, SEASON_STATS_HEADERS } from "../sheets/seasonStatsRepo.js";
import { SIGNUP_REQUESTS_SHEET, SIGNUP_REQUESTS_HEADERS } from "../sheets/signupRequestsRepo.js";
import { BANNED_SHEET, BANNED_HEADERS } from "../sheets/bannedRepo.js";
import { VACATION_REQUESTS_SHEET, VACATION_REQUESTS_HEADERS } from "../sheets/vacationRequestsRepo.js";
import { EXTENDED_VACATION_SHEET, EXTENDED_VACATION_HEADERS } from "../sheets/extendedVacationRepo.js";
import { SETTINGS_SHEET, getSettings, setCurrentSeasonName } from "../sheets/settingsRepo.js";
import { resetForNewSeason } from "../domain/pointsStore.js";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { config } from "../config.js";

const TABS: { name: string; headers: string[] }[] = [
  { name: LADDER_SHEET, headers: LADDER_HEADERS },
  { name: MATCHES_SHEET, headers: MATCHES_HEADERS },
  { name: DODGES_SHEET, headers: DODGES_HEADERS },
  { name: RANK1_SHEET, headers: RANK1_HEADERS },
  { name: SEASON_STATS_SHEET, headers: SEASON_STATS_HEADERS },
  { name: SIGNUP_REQUESTS_SHEET, headers: SIGNUP_REQUESTS_HEADERS },
  { name: BANNED_SHEET, headers: BANNED_HEADERS },
  { name: VACATION_REQUESTS_SHEET, headers: VACATION_REQUESTS_HEADERS },
  { name: EXTENDED_VACATION_SHEET, headers: EXTENDED_VACATION_HEADERS },
];

async function listAllTabTitles(): Promise<string[]> {
  const auth = new JWT({
    email: config.sheets.serviceAccountEmail,
    key: config.sheets.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const res = await google.sheets({ version: "v4", auth }).spreadsheets.get({ spreadsheetId: config.sheets.sheetId });
  return (res.data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
}

async function resetTab(name: string, headers: string[]): Promise<void> {
  if (!(await getSheetMetaByName(name))) {
    console.log(`  ${name}: tab doesn't exist yet — the bot will create it on startup.`);
    return;
  }
  await clearSheetRange(name, "A:ZZ");
  await writeSheetRows(name, 1, [headers]);
  console.log(`  ${name}: cleared, header reset (${headers.length} columns).`);
}

async function main(): Promise<void> {
  if (!process.argv.includes("--yes")) {
    console.error(
      "This permanently deletes ALL ladder, match, stats, signup, ban, and vacation data in the configured\n" +
        `Google Sheet (${config.sheets.sheetId}) and wipes data/points.json.\n\n` +
        "Stop the bot first, then re-run with --yes to confirm:  npm run reset-league -- --yes",
    );
    process.exit(1);
  }

  const { currentSeasonName } = await getSettings();
  const tabs = [...TABS];
  if (currentSeasonName && currentSeasonName !== SEASON_STATS_SHEET) {
    tabs.push({ name: currentSeasonName, headers: SEASON_STATS_HEADERS });
  }

  console.log("Resetting tabs:");
  for (const tab of tabs) {
    await resetTab(tab.name, tab.headers);
  }

  // Keep the Paused toggle; only drop the season name so stats go back to the
  // SeasonStats tab until the next Reset Ladder (End Season) names a new one.
  if (currentSeasonName) {
    await setCurrentSeasonName("");
    console.log(`  ${SETTINGS_SHEET}: cleared current season name (was "${currentSeasonName}").`);
  }

  await resetForNewSeason("", new Date().toISOString());
  console.log("  data/points.json: season points wiped.");

  const known = new Set([...tabs.map((t) => t.name), SETTINGS_SHEET]);
  const leftovers = (await listAllTabTitles()).filter((t) => !known.has(t));
  if (leftovers.length > 0) {
    console.log(
      `\nThese other tabs were left untouched (old season archives etc.) — delete them by hand if you don't want them:\n` +
        leftovers.map((t) => `  - ${t}`).join("\n"),
    );
  }

  console.log("\nDone. Start the bot — it re-applies sheet formatting and refreshes the Discord panels on startup.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reset failed:", err);
    process.exit(1);
  });
