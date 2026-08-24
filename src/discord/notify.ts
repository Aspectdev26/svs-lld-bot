import type { Client, MessagePayload, MessageCreateOptions, TextChannel } from "discord.js";
import { config } from "../config.js";

async function sendTo(client: Client, channelId: string, payload: string | MessagePayload | MessageCreateOptions) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Channel ${channelId} is not a text channel or could not be fetched`);
  }
  return (channel as TextChannel).send(payload);
}

/**
 * Every challenge/result announcement (issued, won, expired, dodge-approved, force-cancelled,
 * extension outcome, etc.) posts here permanently — a running log of everything that's happened.
 * #challenges (the "Issue a Challenge" channel) is a separate channel that just holds the pinned
 * Challenge button and the pinned Active Challenges list; this function is the only thing that
 * still uses the name `challenges` for historical reasons, but it targets the results channel.
 */
function sendToChallenges(client: Client, payload: string | MessagePayload | MessageCreateOptions) {
  return sendTo(client, config.channels.challengeResults, payload);
}

export const notify = {
  rankings: (client: Client, payload: string | MessagePayload | MessageCreateOptions) =>
    sendTo(client, config.channels.rankings, payload),
  challenges: sendToChallenges,
  leagueManagers: (client: Client, payload: string | MessagePayload | MessageCreateOptions) =>
    sendTo(client, config.channels.leagueManagers, payload),
  register: (client: Client, payload: string | MessagePayload | MessageCreateOptions) =>
    sendTo(client, config.channels.register, payload),
  announcements: (client: Client, payload: string | MessagePayload | MessageCreateOptions) =>
    sendTo(client, config.channels.announcements, payload),
};

/**
 * Posts a resolution confirmation ("Approved by...", "Denied by...") to #league-managers and
 * deletes it a few seconds later, so the channel doesn't accumulate permanent clutter once the
 * original request post is gone too.
 */
export async function postAutoDeletingConfirmation(
  client: Client,
  payload: string | MessagePayload | MessageCreateOptions,
  delayMs = 5000,
): Promise<void> {
  const message = await notify.leagueManagers(client, payload);
  setTimeout(() => {
    message.delete().catch(() => undefined);
  }, delayMs);
}

function parseMessageUrl(url: string): { channelId: string; messageId: string } | null {
  const match = url.match(/channels\/\d+\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { channelId: match[1], messageId: match[2] };
}

/** Best-effort delete of a message by its stored jump URL — a no-op if it's already gone. */
export async function deleteMessageByUrl(client: Client, url: string): Promise<void> {
  const location = url ? parseMessageUrl(url) : null;
  if (!location) return;
  try {
    const channel = await client.channels.fetch(location.channelId);
    if (channel?.isTextBased()) {
      const message = await (channel as TextChannel).messages.fetch(location.messageId);
      await message.delete();
    }
  } catch {
    // Already deleted or inaccessible — nothing to clean up.
  }
}
