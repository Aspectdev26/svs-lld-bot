/**
 * Removes this bot's slash commands from one server — e.g. the old test server after moving the
 * bot elsewhere, so stale /challenge etc. don't linger there.
 * Usage: `npm run clear-commands -- <serverId>`
 */
import { REST, Routes } from "discord.js";
import { config } from "../config.js";

async function main() {
  const guildId = process.argv[2];
  if (!guildId || !/^\d+$/.test(guildId)) {
    console.error("Usage: npm run clear-commands -- <serverId>");
    process.exit(1);
  }
  const rest = new REST().setToken(config.discord.token);
  await rest.put(Routes.applicationGuildCommands(config.discord.clientId, guildId), { body: [] });
  console.log(`Removed all slash commands from server ${guildId}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
