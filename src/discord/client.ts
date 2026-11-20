import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createClient(): Client {
  return new Client({
    // GuildMembers (privileged — must be toggled on in the Developer Portal) is needed to list
    // everyone holding the NvD Admin role so they can be added to each private match thread.
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
    partials: [Partials.Channel],
  });
}
