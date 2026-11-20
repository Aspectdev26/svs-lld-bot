import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
  type Client,
  type TextChannel,
} from "discord.js";
import { config } from "../config.js";
import * as ladderRepo from "../sheets/ladderRepo.js";
import type { LadderRow } from "../types.js";

const PANEL_TITLE = "🏆 NvD Ladder — Live Rankings 🏆";
/** Titles the panel used before; still matched so the existing pinned post is edited, not duplicated. */
const LEGACY_PANEL_TITLES = ["🏆 Top 10 Ladder", "🏆 Ladder Rankings"];

const STATUS_EMOJI: Record<LadderRow["status"], string> = { Available: "✅", Challenge: "❌", Vacation: "🌴" };
const STATUS_LABEL: Record<LadderRow["status"], string> = {
  Available: "Available",
  Challenge: "Challenge",
  Vacation: "Vacation",
};

function sheetUrl(): string {
  return `https://docs.google.com/spreadsheets/d/${config.sheets.sheetId}/edit`;
}

let inFlight: Promise<void> | null = null;
let rerunRequested = false;

/**
 * Finds (or creates + pins) the standing Top 10 post in #rankings and refreshes it. The list is plain
 * embed text (not an image) so Discord shows it at full text size: each player's rank and name, with
 * a status line underneath (✅ Available, ❌ Challenge, 🌴 Vacation), plus a link button to the sheet.
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
  const header = `Top ${top10.length} of ${ladder.length} — [Open the full ladder in Google Sheets](${url})`;
  const entries = top10.map(
    (r) =>
      `**#${r.rank} - ${escapeMarkdown(r.discordName || "(unknown)")}**\n` +
      `Status: ${STATUS_EMOJI[r.status]} ${STATUS_LABEL[r.status]}`,
  );
  const body = entries.length > 0 ? entries.join("\n\n") : "Nobody's signed up yet — check the register channel!";
  const embed = new EmbedBuilder()
    .setTitle(PANEL_TITLE)
    .setDescription(`${header}\n\n${body}`)
    .setColor(0x2ecc71)
    .setFooter({ text: "Auto-updating • Top 10" })
    .setTimestamp(new Date());
  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("View full ladder").setEmoji("📋").setURL(url),
    ),
  ];

  const titles = [PANEL_TITLE, ...LEGACY_PANEL_TITLES];
  const { items: pinned } = await textChannel.messages.fetchPins();
  // Note: the pins-listing endpoint omits attachment data on each message, so detection has to
  // key off the embed title instead — matching an attachment name here would never find a hit.
  const existing = pinned.find(
    ({ message: m }) => m.author.id === client.user?.id && m.embeds.some((e) => titles.includes(e.title ?? "")),
  )?.message;

  if (existing) {
    // attachments: [] clears the image the panel used to carry.
    await existing.edit({ embeds: [embed], components, attachments: [] });
    return;
  }

  const sent = await textChannel.send({ embeds: [embed], components });
  await sent.pin().catch((err) => console.error("Failed to pin rankings panel:", err));
}
