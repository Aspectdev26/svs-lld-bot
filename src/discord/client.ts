import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel],
  });
}
