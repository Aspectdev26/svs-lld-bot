import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { config } from "../config.js";

export const CHALLENGE_START_BUTTON_ID = "chal_start";

/** Idempotently posts (and pins) the standing "Issue a Challenge" panel to the Issue a Challenge channel. */
export async function ensureChallengePanel(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.channels.challenges);
  if (!channel || !channel.isTextBased()) {
    console.error(`CHALLENGES_CHANNEL_ID (${config.channels.challenges}) is not a text channel`);
    return;
  }
  const textChannel = channel as TextChannel;

  const { items: pinned } = await textChannel.messages.fetchPins();
  const alreadyPosted = pinned.some(
    ({ message: m }) =>
      m.author.id === client.user?.id &&
      m.components.some((row) => "components" in row && row.components.some((c) => "customId" in c && c.customId === CHALLENGE_START_BUTTON_ID)),
  );
  if (alreadyPosted) return;

  const embed = new EmbedBuilder()
    .setTitle("Issue a Challenge")
    .setDescription(
      "Click **Challenge** below to pick an opponent within reach (up to 3 ranks up, 2 if they're in the top 10). " +
        "You must be registered on the ladder first — sign up in #register.",
    )
    .setColor(0xe67e22);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CHALLENGE_START_BUTTON_ID).setLabel("Challenge").setStyle(ButtonStyle.Danger),
  );

  const message = await textChannel.send({ embeds: [embed], components: [row] });
  await message.pin().catch((err) => console.error("Failed to pin challenge panel:", err));
}
