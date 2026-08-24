import type { Client } from "discord.js";

export function registerReadyEvent(client: Client): void {
  client.once("clientReady", (c) => {
    console.log(`Logged in as ${c.user.tag}`);
  });
}
