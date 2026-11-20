/**
 * Pre-flight check for the Discord server the bot is configured for (DISCORD_GUILD_ID in .env):
 * confirms the bot is in the server, every configured channel exists and is a text channel, the
 * bot has the permissions it needs in each one, and the NvD Admin role exists.
 * Read-only — changes nothing. Run with `npm run check-setup` before (re)starting the bot on a new server.
 */
import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits, type PermissionResolvable } from "discord.js";
import { config } from "../config.js";

const BASE: [string, PermissionResolvable][] = [
  ["View Channel", PermissionFlagsBits.ViewChannel],
  ["Send Messages", PermissionFlagsBits.SendMessages],
  ["Embed Links", PermissionFlagsBits.EmbedLinks],
  ["Read Message History", PermissionFlagsBits.ReadMessageHistory],
];
const PIN: [string, PermissionResolvable][] = [
  ["Pin Messages", PermissionFlagsBits.PinMessages],
  ["Manage Messages", PermissionFlagsBits.ManageMessages],
];

/** What each configured channel is used for, and the extra permissions the bot needs there. */
const CHANNELS: { key: keyof typeof config.channels; env: string; label: string; extra: [string, PermissionResolvable][] }[] = [
  {
    key: "challenges",
    env: "CHALLENGES_CHANNEL_ID",
    label: "Challenges (Challenge button, Active Challenges list, private match threads)",
    extra: [
      ...PIN,
      ["Create Private Threads", PermissionFlagsBits.CreatePrivateThreads],
      ["Send Messages in Threads", PermissionFlagsBits.SendMessagesInThreads],
      ["Manage Threads", PermissionFlagsBits.ManageThreads],
      ["Manage Roles (to let NvD Admins into match threads)", PermissionFlagsBits.ManageRoles],
      ["Mention All Roles (NvD Admin pings)", PermissionFlagsBits.MentionEveryone],
    ],
  },
  { key: "challengeResults", env: "CHALLENGE_RESULTS_CHANNEL_ID", label: "Challenge Results", extra: [] },
  {
    key: "rankings",
    env: "RANKINGS_CHANNEL_ID",
    label: "Rankings (ladder image)",
    extra: [...PIN, ["Attach Files", PermissionFlagsBits.AttachFiles]],
  },
  {
    key: "leagueManagers",
    env: "LEAGUE_MANAGERS_CHANNEL_ID",
    label: "NvD Admins (dashboard + approval requests)",
    extra: [...PIN, ["Mention All Roles (NvD Admin pings)", PermissionFlagsBits.MentionEveryone]],
  },
  { key: "register", env: "REGISTER_CHANNEL_ID", label: "Register (signup panel)", extra: [] },
  { key: "announcements", env: "ANNOUNCEMENTS_CHANNEL_ID", label: "Announcements", extra: [] },
];

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const ready = new Promise<void>((resolve) => client.once(Events.ClientReady, () => resolve()));
  await client.login(config.discord.token);
  await ready;
  let problems = 0;
  const fail = (msg: string) => {
    problems++;
    console.log(`  ✗ ${msg}`);
  };

  try {
    const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
    if (!guild) {
      fail(`Bot is not in server ${config.discord.guildId} (DISCORD_GUILD_ID) — invite it first.`);
      return;
    }
    console.log(`Server: ${guild.name} (${guild.id}) — bot is ${client.user?.tag}`);
    const me = await guild.members.fetchMe();
    await guild.roles.fetch();

    for (const ch of CHANNELS) {
      const id = config.channels[ch.key];
      console.log(`\n${ch.label} — ${ch.env}=${id}`);
      const channel = await guild.channels.fetch(id).catch(() => null);
      if (!channel) {
        fail("Channel not found in this server.");
        continue;
      }
      if (channel.type !== ChannelType.GuildText) {
        fail(`#${channel.name} is not a regular text channel.`);
        continue;
      }
      const perms = channel.permissionsFor(me);
      const required = [...BASE, ...ch.extra];
      // Pin Messages is newer and replaces Manage Messages for pinning — either one is enough.
      const hasPin = perms.has(PermissionFlagsBits.PinMessages) || perms.has(PermissionFlagsBits.ManageMessages);
      const missing = required
        .filter(([name]) => name !== "Pin Messages" && name !== "Manage Messages")
        .filter(([, flag]) => !perms.has(flag))
        .map(([name]) => name);
      if (ch.extra.some(([name]) => name === "Pin Messages") && !hasPin) missing.push("Pin Messages (or Manage Messages)");
      if (missing.length > 0) fail(`#${channel.name} — bot is missing: ${missing.join(", ")}`);
      else console.log(`  ✓ #${channel.name}`);
    }

    console.log(`\nNvD Admin role — LEAGUE_MANAGER_ROLE_NAME="${config.leagueManagerRoleName}"`);
    const role = guild.roles.cache.find((r) => r.name === config.leagueManagerRoleName);
    if (!role) {
      fail("No role with exactly that name exists in this server.");
    } else {
      console.log(`  ✓ @${role.name}${role.mentionable ? "" : " (not mentionable — pings rely on the bot's Mention All Roles permission)"}`);
    }
  } finally {
    console.log(problems === 0 ? "\nAll checks passed." : `\n${problems} problem(s) found.`);
    await client.destroy();
    process.exitCode = problems === 0 ? 0 : 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
