import type { Client } from "discord.js";
import { maybeTrollMessage } from "../troll.js";

export function registerMessageEvent(client: Client): void {
  client.on("messageCreate", (message) => {
    maybeTrollMessage(message).catch((err) => console.error("Troll message check failed:", err));
  });
}
