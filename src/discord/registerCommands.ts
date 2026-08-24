import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { commands } from "./commands/index.js";

async function main() {
  const rest = new REST().setToken(config.discord.token);
  const body = commands.map((c) => c.data.toJSON());

  console.log(`Registering ${body.length} slash commands to guild ${config.discord.guildId}...`);
  await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body });
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
