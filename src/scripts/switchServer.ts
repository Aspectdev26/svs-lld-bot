/**
 * Points the bot at a different Discord server in one go.
 *
 *   npm run switch-server -- --guild <id> --challenges <id> --results <id> --rankings <id> \
 *     --admins <id> --register <id> --announcements <id> [--role "NvD Admin"] [--reset-league]
 *
 * Steps, stopping at the first failure:
 *   1. Back up .env (to .env.bak-<timestamp>) and write the new server/channel/role values.
 *   2. Run check-setup against the new values. If anything fails, .env is restored and nothing else runs.
 *   3. --reset-league only: wipe all league data (`reset-league --yes`). STOP THE BOT FIRST.
 *   4. Build, register slash commands on the new server, and remove them from the old one.
 * Restarting the bot afterwards is left to the bot-dashboard-agent (see README → Deployment).
 */
import { execSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ENV_FILE = path.resolve(".env");

const FLAGS: Record<string, string> = {
  guild: "DISCORD_GUILD_ID",
  challenges: "CHALLENGES_CHANNEL_ID",
  results: "CHALLENGE_RESULTS_CHANNEL_ID",
  rankings: "RANKINGS_CHANNEL_ID",
  admins: "LEAGUE_MANAGERS_CHANNEL_ID",
  register: "REGISTER_CHANNEL_ID",
  announcements: "ANNOUNCEMENTS_CHANNEL_ID",
};

function parseArgs(argv: string[]): { values: Record<string, string>; resetLeague: boolean } {
  const values: Record<string, string> = { LEAGUE_MANAGER_ROLE_NAME: "NvD Admin" };
  let resetLeague = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i].replace(/^--/, "");
    if (flag === "reset-league") {
      resetLeague = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for --${flag}`);
    if (flag === "role") {
      values.LEAGUE_MANAGER_ROLE_NAME = value;
    } else if (FLAGS[flag]) {
      if (!/^\d{17,20}$/.test(value)) throw new Error(`--${flag} must be a Discord ID, got "${value}"`);
      values[FLAGS[flag]] = value;
    } else {
      throw new Error(`Unknown option --${flag}`);
    }
  }
  const missing = Object.entries(FLAGS)
    .filter(([, key]) => !values[key])
    .map(([flag]) => `--${flag}`);
  if (missing.length > 0) throw new Error(`Missing: ${missing.join(", ")}`);
  return { values, resetLeague };
}

/** Replaces `KEY=...` lines in place (appending any key that isn't there yet), leaving everything else untouched. */
export function setEnvValues(content: string, values: Record<string, string>): string {
  let out = content;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    out = pattern.test(out) ? out.replace(pattern, () => line) : `${out.replace(/\n?$/, "\n")}${line}\n`;
  }
  return out;
}

function readEnvValue(content: string, key: string): string | undefined {
  return content.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
}

function run(command: string): void {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: "inherit" });
}

function main() {
  const { values, resetLeague } = parseArgs(process.argv.slice(2));
  const original = readFileSync(ENV_FILE, "utf8");
  const oldGuild = readEnvValue(original, "DISCORD_GUILD_ID");

  const backup = `${ENV_FILE}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(ENV_FILE, backup);
  writeFileSync(ENV_FILE, setEnvValues(original, values));
  console.log(`Backed up .env to ${path.basename(backup)} and wrote the new server settings.`);

  try {
    run("npm run check-setup");
  } catch {
    writeFileSync(ENV_FILE, original);
    console.error("\nSetup check failed — .env restored to the old server. Fix the problems above and re-run.");
    process.exit(1);
  }

  if (resetLeague) run("npm run reset-league -- --yes");
  run("npm run build");
  run("npm run register-commands");
  if (oldGuild && oldGuild !== values.DISCORD_GUILD_ID) run(`npm run clear-commands -- ${oldGuild}`);

  console.log("\nDone. Restart the bot through the dashboard agent to bring it up on the new server.");
}

// Only run when launched as a script (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
