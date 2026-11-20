import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { config } from "../config.js";
import * as ladderRepo from "../sheets/ladderRepo.js";
import { renderLadderImage } from "./ladderImage.js";

const IMAGE_FILENAME = "top10.png";
const PANEL_TITLE = "🏆 Top 10 Ladder";
/** Titles the panel used before; still matched so the existing pinned post is edited, not duplicated. */
const LEGACY_PANEL_TITLES = ["🏆 Ladder Rankings"];

function sheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${config.sheets.sheetId}/edit`;
}

let inFlight: Promise<void> | null = null;
let rerunRequested = false;

/**
 * Finds (or creates + pins) the standing Top 10 post in #rankings and refreshes it with a freshly
 * rendered image, marking each player ✅ (available) or ❌ (in a challenge).
 * Safe to call after any rank- or challenge-changing action, and once at startup — idempotent
 * either way. Overlapping calls are coalesced: while a refresh is running, further calls just
 * queue one more run afterwards, so concurrent triggers can't race into duplicate posts.
 */
export function refreshTop10Panel(client: Client): Promise<void> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        rerunRequested = false;
        await refreshOnce(client);
      } while (rerunRequested);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function refreshOnce(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.channels.rankings);
  if (!channel || !channel.isTextBased()) {
    console.error(`RANKINGS_CHANNEL_ID (${config.channels.rankings}) is not a text channel`);
    return;
  }
  const textChannel = channel as TextChannel;

  const ladder = await ladderRepo.getLadder();
  const url = sheetUrl();

  const top10 = ladder.slice(0, 10);
  const embed = new EmbedBuilder()
    .setTitle(PANEL_TITLE)
    .setURL(url)
    .setDescription(`✅ Available · ❌ In a challenge\n📊 [Open the full ladder in Google Sheets](${url})`)
    .setImage(`attachment://${IMAGE_FILENAME}`)
    .setColor(0xf1c40f)
    .setTimestamp(new Date());
  const embeds = [embed];
  const files = [{ attachment: await renderLadderImage(top10, "Top 10 Ladder"), name: IMAGE_FILENAME }];

  const titles = [PANEL_TITLE, ...LEGACY_PANEL_TITLES];
  const { items: pinned } = await textChannel.messages.fetchPins();
  // Note: the pins-listing endpoint omits attachment data on each message, so detection has to
  // key off the embed title instead — matching an attachment name here would never find a hit.
  const existing = pinned.find(
    ({ message: m }) => m.author.id === client.user?.id && m.embeds.some((e) => titles.includes(e.title ?? "")),
  )?.message;

  if (existing) {
    await existing.edit({ embeds, files, attachments: [] });
    return;
  }

  const sent = await textChannel.send({ embeds, files });
  await sent.pin().catch((err) => console.error("Failed to pin rankings panel:", err));
}
