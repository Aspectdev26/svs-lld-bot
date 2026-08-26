import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type Message, type TextChannel } from "discord.js";
import { config } from "../config.js";

export const REGISTER_START_BUTTON_ID = "reg_start";
export const LEAVE_LADDER_BUTTON_ID = "leave_start";
export const VACATION_REQUEST_START_BUTTON_ID = "vac_request_start";
export const VACATION_RETURN_BUTTON_ID = "vac_return";
export const EXTENDED_VACATION_REQUEST_START_BUTTON_ID = "evac_request_start";
export const EXTENDED_VACATION_RETURN_BUTTON_ID = "evac_return";

function buildPanelRows(): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(REGISTER_START_BUTTON_ID).setLabel("Sign Up").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(LEAVE_LADDER_BUTTON_ID).setLabel("Leave Ladder").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(VACATION_REQUEST_START_BUTTON_ID).setLabel("Request Vacation").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(VACATION_RETURN_BUTTON_ID).setLabel("Return from Vacation").setStyle(ButtonStyle.Success),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(EXTENDED_VACATION_REQUEST_START_BUTTON_ID)
      .setLabel("Request Extended Vacation")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(EXTENDED_VACATION_RETURN_BUTTON_ID)
      .setLabel("Return from Extended Vacation")
      .setStyle(ButtonStyle.Success),
  );
  return [row1, row2];
}

function hasButton(message: Message, customId: string): boolean {
  return message.components.some((row) => "components" in row && row.components.some((c) => "customId" in c && c.customId === customId));
}

/**
 * Idempotently posts the standing register-channel panel. If an older panel (missing any button
 * added since) is already there, its components are simply re-set to the current full layout —
 * cheap and safe to do unconditionally, so upgrading the bot doesn't require anyone to manually
 * repost it.
 */
export async function ensureRegisterPanel(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.channels.register);
  if (!channel || !channel.isTextBased()) {
    console.error(`REGISTER_CHANNEL_ID (${config.channels.register}) is not a text channel`);
    return;
  }
  const textChannel = channel as TextChannel;

  const recent = await textChannel.messages.fetch({ limit: 25 });
  const existing = recent.find((m) => m.author.id === client.user?.id && hasButton(m, REGISTER_START_BUTTON_ID));

  if (existing) {
    await existing.edit({ components: buildPanelRows() });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Join the Ladder")
    .setDescription(
      "Click **Sign Up** below to register a character on the ladder. You'll pick an element and build, " +
        "then give us your character's name. A League Manager reviews every request before it's added.\n\n" +
        "Already on the ladder and want out? Click **Leave Ladder** — this removes your entry and shifts " +
        "everyone below you up a rank. If you're in an active match, leaving counts as a loss.\n\n" +
        "**Request Vacation** pauses your entry (up to 14 days) so you can't be challenged — click **Return from Vacation** " +
        "any time before then, or you'll be auto-moved to Extended Vacation. **Request Extended Vacation** removes you from " +
        "the ladder entirely (up to 30 days) — click **Return from Extended Vacation** to rejoin at your old rank + 1, or you'll " +
        "be fully removed and your season points reset. Both Vacation requests need League Manager approval, and being in an " +
        "active match when one is approved counts as a loss.",
    )
    .setColor(0x3498db);

  await textChannel.send({ embeds: [embed], components: buildPanelRows() });
}
