import type { ButtonInteraction, Client } from "discord.js";
import { isTrollEnabled } from "../domain/trollService.js";
import { notify } from "./notify.js";
import { scheduleMessageCleanup } from "./ephemeralCleanup.js";

export const TROLL_TARGET_USER_ID = "727586332385214516";
const TROLL_CHANCE = 1 / 5;
const TROLL_MESSAGE_CLEANUP_MS = 60 * 1000;

const TROLL_LINES = [
  "does your mom know you're using the family iPad for this?",
  "shouldn't you be making dino nuggets right now?",
  "this action requires you to be at least 18. please ask a parent or guardian for help.",
  "careful, it's past your bedtime.",
  "did you finish your homework before clicking that?",
  "asking for ID before this one goes through.",
  "put the Talking Tom app down and focus.",
  "this feature is rated M for Mature. access denied to minors.",
  "isn't it almost time for your juice box and nap?",
  "hold on, checking with the front desk if you're tall enough for this ride.",
  "did you clear this with your mom first?",
  "we've alerted your teacher about this one.",
  "you sure you're not just wearing a trench coat and standing on someone's shoulders for this?",
  "this needs a permission slip signed by a parent.",
  "pretty confident this counts as 'unsupervised internet use.'",
  "someone go check if he's tall enough to see over the podium.",
];

function rollTrollLine(): string | null {
  if (Math.random() >= TROLL_CHANCE) return null;
  return TROLL_LINES[Math.floor(Math.random() * TROLL_LINES.length)];
}

/** Rolls a random chance to publicly rib the designated target when they use an admin panel action. Toggle via the hidden slash command. */
export async function maybeTrollAdminAction(interaction: ButtonInteraction): Promise<void> {
  if (interaction.user.id !== TROLL_TARGET_USER_ID) return;
  if (!(await isTrollEnabled())) return;

  const line = rollTrollLine();
  if (!line) return;

  const sent = await notify.leagueManagers(interaction.client, { content: `<@${TROLL_TARGET_USER_ID}> ${line}` });
  scheduleMessageCleanup(sent, TROLL_MESSAGE_CLEANUP_MS);
}

/** Same roll, fired when the target successfully issues a challenge; posts to the #challenges panel channel. */
export async function maybeTrollChallenge(client: Client, challengerUserId: string): Promise<void> {
  if (challengerUserId !== TROLL_TARGET_USER_ID) return;
  if (!(await isTrollEnabled())) return;

  const line = rollTrollLine();
  if (!line) return;

  const sent = await notify.issueChallenge(client, { content: `<@${TROLL_TARGET_USER_ID}> ${line}` });
  scheduleMessageCleanup(sent, TROLL_MESSAGE_CLEANUP_MS);
}
