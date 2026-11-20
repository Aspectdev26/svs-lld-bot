import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { config } from "../config.js";
import * as ladderRepo from "../sheets/ladderRepo.js";
import type { LadderRow } from "../types.js";
import { renderLadderImage } from "./ladderImage.js";

const RANKS_PER_PAGE = 10;
/** Discord allows at most 10 embeds per message; past 100 players the pages just get longer. */
const MAX_EMBEDS = 10;
const PANEL_TITLE = "🏆 Ladder Rankings";
/** Titles the panel used before; still matched so the existing pinned post is edited, not duplicated. */
const LEGACY_PANEL_TITLES = ["🏆 Top 10 Ladder"];

function sheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${config.sheets.sheetId}/edit`;
}

let inFlight: Promise<void> | null = null;
let rerunRequested = false;

/**
 * Finds (or creates + pins) the standing ladder rankings post in #rankings and refreshes it with
 * freshly rendered images of every rank (one per 10 ranks), marking each player ✅ (available) or
 * ❌ (in a challenge).
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

  // One image per page of ranks: a single tall image of the whole ladder gets scaled down by
  // Discord until it's unreadable, while 10-row pages display at the same size the old Top 10 did.
  const pageSize = Math.max(RANKS_PER_PAGE, Math.ceil(ladder.length / MAX_EMBEDS));
  const pages: LadderRow[][] = [];
  for (let i = 0; i < ladder.length; i += pageSize) pages.push(ladder.slice(i, i + pageSize));
  if (pages.length === 0) pages.push([]);

  const embeds: EmbedBuilder[] = [];
  const files: { attachment: Buffer; name: string }[] = [];
  for (const [i, rows] of pages.entries()) {
    const name = `ladder-${i + 1}.png`;
    const title = i === 0 ? "Ladder Rankings" : `Ranks ${rows[0].rank}–${rows[rows.length - 1].rank}`;
    files.push({ attachment: await renderLadderImage(rows, title, i === 0), name });
    // Only the first embed gets the URL — Discord merges embeds sharing a URL into one shrunken gallery.
    const embed = new EmbedBuilder().setImage(`attachment://${name}`).setColor(0xf1c40f);
    if (i === 0) {
      embed
        .setTitle(PANEL_TITLE)
        .setURL(url)
        .setDescription(`✅ Available · ❌ In a challenge\n📊 [Open the full ladder in Google Sheets](${url})`);
    }
    if (i === pages.length - 1) embed.setTimestamp(new Date());
    embeds.push(embed);
  }

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
