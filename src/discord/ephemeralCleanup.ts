import type { Message, RepliableInteraction } from "discord.js";

const EPHEMERAL_CLEANUP_DELAY_MS = 5000;

/**
 * Schedules the ephemeral reply attached to `interaction` (whatever it currently holds — an
 * initial reply, or the result of `.update()`/`.editReply()`) for automatic deletion once its
 * flow has concluded, rather than leaving the user to click Discord's own "Dismiss Message".
 * Only call this at a flow's terminal step, never on an intermediate prompt still awaiting input.
 */
export function scheduleReplyCleanup(interaction: RepliableInteraction, delayMs = EPHEMERAL_CLEANUP_DELAY_MS): void {
  setTimeout(() => {
    interaction.deleteReply().catch(() => undefined);
  }, delayMs);
}

/** Same, for a standalone ephemeral message returned by `interaction.followUp()`. */
export function scheduleMessageCleanup(message: Message, delayMs = EPHEMERAL_CLEANUP_DELAY_MS): void {
  setTimeout(() => {
    message.delete().catch(() => undefined);
  }, delayMs);
}
