import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type Message, type TextChannel } from "discord.js";
import { config } from "../config.js";

export const REGISTER_START_BUTTON_ID = "reg_start";
export const LEAVE_LADDER_BUTTON_ID = "leave_start";

function buildPanelRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(REGISTER_START_BUTTON_ID).setLabel("Sign Up").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(LEAVE_LADDER_BUTTON_ID).setLabel("Leave Ladder").setStyle(ButtonStyle.Danger),
  );
}

function hasButton(message: Message, customId: string): boolean {
  return message.components.some((row) => "components" in row && row.components.some((c) => "customId" in c && c.customId === customId));
}

/**
 * Idempotently posts the standing "Sign Up" / "Leave Ladder" panel to #register. If an older
 * panel (from before the Leave Ladder button existed) is already there, it's edited in place
 * rather than skipped, so upgrading the bot doesn't require anyone to manually repost it.
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
    if (!hasButton(existing, LEAVE_LADDER_BUTTON_ID)) {
      await existing.edit({ components: [buildPanelRow()] });
    }
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Join the Ladder")
    .setDescription(
      "Click **Sign Up** below to register a character on the ladder. You'll pick an element and build, " +
        "then give us your character's name. A League Manager reviews every request before it's added.\n\n" +
        "Already on the ladder and want out? Click **Leave Ladder** — this removes your entry and shifts " +
        "everyone below you up a rank. If you're in an active match, leaving counts as a loss.",
    )
    .setColor(0x3498db);

  await textChannel.send({ embeds: [embed], components: [buildPanelRow()] });
}
