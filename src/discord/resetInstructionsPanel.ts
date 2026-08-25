import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { config } from "../config.js";

const PANEL_TITLE = "🔄 Ladder Reset — How It Works";

function buildPanelContent() {
  const embed = new EmbedBuilder()
    .setTitle(PANEL_TITLE)
    .setDescription(
      "**When to use this:** at the end of a season, or to try the system out before a real season starts.\n\n" +
        "**How to do it:**\n" +
        "1. On the League Manager Dashboard, click **Reset Ladder (End Season)**.\n" +
        "2. Confirm the warning.\n" +
        "3. Type a name for the season that's ending (e.g. `Season 1`). If you're just testing, name it `Test` — " +
        "that keeps it clearly separate from real seasons.\n\n" +
        "**What happens automatically once you confirm:**\n" +
        "• Everyone's Defends / Wins / Losses **for this season** are saved into a brand-new spreadsheet tab named " +
        "after whatever you typed.\n" +
        "• Those season numbers then reset to 0 for everyone, so the new season starts clean.\n" +
        "• Any matches currently in progress are cancelled.\n" +
        "• Everyone's rank on the ladder gets shuffled/randomized.\n\n" +
        "**What does NOT change:**\n" +
        "• Nobody is removed from the ladder — this only touches ranks and stats.\n" +
        "• All-time totals (Defends / Wins / Losses across every season ever) are never reset — those live " +
        "permanently in the `All Time Stats` tab.\n\n" +
        "**Good to know:** you can't reuse a season name that's already been used — if you try, nothing happens and " +
        "you'll be asked to pick a different name. Once you confirm with a valid name, this **can't be undone**.",
    )
    .setColor(0x3498db);

  return { embeds: [embed] };
}

/** Posts (and pins) the plain-language Ladder Reset explainer to #league-managers, or refreshes it in place if it already exists. */
export async function ensureResetInstructionsPanel(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.channels.leagueManagers);
  if (!channel || !channel.isTextBased()) {
    console.error(`LEAGUE_MANAGERS_CHANNEL_ID (${config.channels.leagueManagers}) is not a text channel`);
    return;
  }
  const textChannel = channel as TextChannel;

  const { items: pinned } = await textChannel.messages.fetchPins();
  const existing = pinned.find(
    ({ message: m }) => m.author.id === client.user?.id && m.embeds.some((e) => e.title === PANEL_TITLE),
  )?.message;

  const content = buildPanelContent();
  if (existing) {
    await existing.edit(content);
    return;
  }

  const message = await textChannel.send(content);
  await message.pin().catch((err) => console.error("Failed to pin reset instructions panel:", err));
}
