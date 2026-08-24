import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { config } from "../config.js";
import * as ladderRepo from "../sheets/ladderRepo.js";
import { renderTop10Image } from "./top10Image.js";

const IMAGE_FILENAME = "top10.png";

function sheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${config.sheets.sheetId}/edit`;
}

/**
 * Finds (or creates + pins) the standing Top 10 leaderboard post in #rankings and refreshes it
 * with a freshly rendered image. Safe to call after every rank-changing action, and once at
 * startup — idempotent either way.
 */
export async function refreshTop10Panel(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.channels.rankings);
  if (!channel || !channel.isTextBased()) {
    console.error(`RANKINGS_CHANNEL_ID (${config.channels.rankings}) is not a text channel`);
    return;
  }
  const textChannel = channel as TextChannel;

  const ladder = await ladderRepo.getLadder();
  const top10 = ladder.slice(0, 10);
  const image = await renderTop10Image(top10);
  const url = sheetUrl();

  const embed = new EmbedBuilder()
    .setTitle("🏆 Top 10 Ladder")
    .setURL(url)
    .setDescription(`📊 [Open the full ladder in Google Sheets](${url})`)
    .setImage(`attachment://${IMAGE_FILENAME}`)
    .setColor(0xf1c40f)
    .setTimestamp(new Date());
  const file = { attachment: image, name: IMAGE_FILENAME };

  const { items: pinned } = await textChannel.messages.fetchPins();
  // Note: the pins-listing endpoint omits attachment data on each message, so detection has to
  // key off the embed title instead — matching an attachment name here would never find a hit.
  const existing = pinned.find(
    ({ message: m }) => m.author.id === client.user?.id && m.embeds.some((e) => e.title === "🏆 Top 10 Ladder"),
  )?.message;

  if (existing) {
    await existing.edit({ embeds: [embed], files: [file], attachments: [] });
    return;
  }

  const sent = await textChannel.send({ embeds: [embed], files: [file] });
  await sent.pin().catch((err) => console.error("Failed to pin top 10 panel:", err));
}
