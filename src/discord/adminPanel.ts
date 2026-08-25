import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { config } from "../config.js";

export const ADMIN_BUTTON_IDS = {
  shuffle: "admin_shuffle_start",
  remove: "admin_remove_start",
  ban: "admin_ban_start",
  unban: "admin_unban_start",
  cancelMatch: "admin_cancel_start",
  setRank: "admin_setrank_start",
  pendingSignups: "admin_pending_signups_start",
  vacation: "admin_vacation_start",
  rankShuffle: "admin_rankshuffle_start",
  pauseToggle: "admin_pause_toggle",
} as const;

function buildPanelContent() {
  const embed = new EmbedBuilder()
    .setTitle("League Manager Dashboard")
    .setDescription(
      "**Reset Ladder (End Season)** — cancels all active matches, randomizes everyone's rank order, and asks for a " +
        "name for the new season that's starting — its defends/wins/losses track live in a tab titled with that " +
        "name from here on. The season that just ended keeps the tab it was already using, untouched. All-time " +
        "stats are unaffected. Requires confirmation.\n" +
        "**Remove Player** — pick one character (by name) to take off the ladder.\n" +
        "**Ban Player** — removes them and blocks future sign-ups for the chosen scope, with a reason.\n" +
        "**Unban** — reverses an existing ban.\n" +
        "**Force-Cancel Match** — voids an active match with no rank change (for disputes/mistakes).\n" +
        "**Set Rank** — manually moves a player to an exact rank, shifting others out of the way.\n" +
        "**Pending Sign-ups** — view and approve/deny any sign-up request, even if its original post in this " +
        "channel never showed up.\n" +
        "**Vacation** — pick one character (by name) to toggle Vacation/Available.\n" +
        "**Shuffle Ranks** — just randomizes everyone's rank order, no season archiving or match cancellation. " +
        "Warns you first if there are active challenges. Requires confirmation.\n" +
        "**Pause/Resume Ladder** — pausing blocks new challenges from being issued and freezes the timers on " +
        "already-active matches; resuming shifts those timers forward by however long the ladder was paused.",
    )
    .setColor(0x992d22);

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ADMIN_BUTTON_IDS.shuffle).setLabel("Reset Ladder (End Season)").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(ADMIN_BUTTON_IDS.remove).setLabel("Remove Player").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ADMIN_BUTTON_IDS.ban).setLabel("Ban Player").setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ADMIN_BUTTON_IDS.unban).setLabel("Unban").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(ADMIN_BUTTON_IDS.cancelMatch).setLabel("Force-Cancel Match").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ADMIN_BUTTON_IDS.setRank).setLabel("Set Rank").setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ADMIN_BUTTON_IDS.pendingSignups).setLabel("Pending Sign-ups").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(ADMIN_BUTTON_IDS.vacation).setLabel("Vacation").setStyle(ButtonStyle.Secondary),
  );
  const row4 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ADMIN_BUTTON_IDS.rankShuffle).setLabel("Shuffle Ranks").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(ADMIN_BUTTON_IDS.pauseToggle).setLabel("Pause/Resume Ladder").setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2, row3, row4] };
}

/** Posts (and pins) the League Manager admin dashboard to #league-managers, or refreshes it in place if it already exists. */
export async function ensureAdminPanel(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.channels.leagueManagers);
  if (!channel || !channel.isTextBased()) {
    console.error(`LEAGUE_MANAGERS_CHANNEL_ID (${config.channels.leagueManagers}) is not a text channel`);
    return;
  }
  const textChannel = channel as TextChannel;

  const { items: pinned } = await textChannel.messages.fetchPins();
  const existing = pinned.find(
    ({ message: m }) =>
      m.author.id === client.user?.id &&
      m.embeds.some((e) => e.title === "League Manager Dashboard"),
  )?.message;

  const content = buildPanelContent();
  if (existing) {
    await existing.edit(content);
    return;
  }

  const message = await textChannel.send(content);
  await message.pin().catch((err) => console.error("Failed to pin admin panel:", err));
}
