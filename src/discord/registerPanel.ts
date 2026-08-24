import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { config } from "../config.js";

export const REGISTER_START_BUTTON_ID = "reg_start";

/** Idempotently posts the standing "Sign Up" panel to #register if it isn't already there. */
export async function ensureRegisterPanel(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.channels.register);
  if (!channel || !channel.isTextBased()) {
    console.error(`REGISTER_CHANNEL_ID (${config.channels.register}) is not a text channel`);
    return;
  }
  const textChannel = channel as TextChannel;

  const recent = await textChannel.messages.fetch({ limit: 25 });
  const alreadyPosted = recent.some(
    (m) => m.author.id === client.user?.id && m.components.some((row) => "components" in row && row.components.some((c) => "customId" in c && c.customId === REGISTER_START_BUTTON_ID)),
  );
  if (alreadyPosted) return;

  const embed = new EmbedBuilder()
    .setTitle("Join the Ladder")
    .setDescription(
      "Click **Sign Up** below to register a character on the ladder. You'll pick an element and build, " +
        "then give us your character's name. A League Manager reviews every request before it's added.",
    )
    .setColor(0x3498db);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(REGISTER_START_BUTTON_ID).setLabel("Sign Up").setStyle(ButtonStyle.Primary),
  );

  await textChannel.send({ embeds: [embed], components: [row] });
}
