import { EmbedBuilder } from "discord.js";
import { config } from "../config.js";

/** Consolidated League Manager reference — shown on demand via the Dashboard's Guide button. */
export function buildLeagueManagerGuideEmbeds(): EmbedBuilder[] {
  const overview = new EmbedBuilder()
    .setTitle("📘 League Manager Guide")
    .setDescription(
      "Single up-to-date reference for how the league bot works and what League Managers can do. The action " +
        "buttons themselves live on the **Dashboard** — click **Guide** there any time to pull this back up.\n\n" +
        "**Channels**\n" +
        `⚔️ <#${config.channels.challenges}> — pinned **Challenge** button + the always-current **Active Challenges** list. Nothing else posts here.\n` +
        `📜 <#${config.channels.challengeResults}> — permanent log of every challenge issued, match result, dodge/extension outcome, sign-up approval, and expiry warning/notice. The place to check "what happened."\n` +
        `🏆 <#${config.channels.rankings}> — pinned Top 10 leaderboard image, kept updated automatically, with a link to the full sheet.\n` +
        `🛡️ this channel — the Dashboard plus every pending approval: sign-ups, dodge requests, and extension requests.\n` +
        `📝 <#${config.channels.register}> — **Sign Up** and **Leave Ladder** buttons.\n` +
        `📢 <#${config.channels.announcements}> — only used when a player leaves the ladder; everything else posts to the results channel above.`,
    )
    .setColor(0x3498db);

  const howItWorks = new EmbedBuilder()
    .setTitle("How the ladder works")
    .setDescription(
      "**Sign up** → element, build, character name → the approval request lands in this channel → Approve/Deny. " +
        "Character names must be unique per element+build (case-insensitive).\n\n" +
        "**Challenge** → reach up to 3 ranks up (2 if the target's in the Top 10). Can't hit your own other-element " +
        "entries or anyone on Vacation. Opens a private match channel (the two players + League Managers) with " +
        "Report Win / Request Dodge / Request Extension. 72h to resolve, warned at the 24h mark.\n\n" +
        "**Post-loss cooldown** → after a reported loss, that exact character can't re-challenge the exact character " +
        "it lost to again for 24h. Only applies to that one matchup — every other target is unaffected.\n\n" +
        "**Report Win** → either player can report; they pick the actual winner from a dropdown (nothing " +
        "pre-selected). Challenger wins → ranks swap. Defender wins → nothing changes.\n\n" +
        "**Dodge** → requestable once a match has sat 24h with no result, with a screenshot attached. Comes here " +
        "for Approve/Deny. Approved = counts as a challenger win.\n\n" +
        "**Extension** → +2 days on a match, one pending request at a time, comes here for Approve/Deny.\n\n" +
        "**Leave Ladder** → a player can remove one of their own entries any time. An active match on it is " +
        "recorded as a loss for them first. Not reversible.\n\n" +
        "**Vacation** → League Manager only (see Dashboard) — a player can never self-exempt from challenges.",
    )
    .setColor(0x3498db);

  const resetHowTo = new EmbedBuilder()
    .setTitle("How To: Reset Ladder (End Season)")
    .setDescription(
      "**When:** end of a season, or to try the flow out before a real season starts.\n\n" +
        "**Steps:** Dashboard → **Reset Ladder (End Season)** → confirm the warning → type a name for the **new** " +
        "season that's starting (e.g. `Season 2`; use `Test` if you're just trying it out).\n\n" +
        "**What happens automatically:**\n" +
        "• A brand-new, empty tab is created under that name, and the new season's stats (defends/wins/losses) " +
        "track live in it from that moment on.\n" +
        "• The season that just ended keeps the tab it was already using — automatically frozen in place as its " +
        "permanent record, no copy step needed.\n" +
        "• Every currently active match is cancelled and every rank is randomized.\n\n" +
        "**Unaffected:** nobody is removed from the ladder, and All-Time Stats are never touched.\n\n" +
        "**Note:** a season name can't be reused — you'll be asked to pick a different one. Once confirmed with a " +
        "valid name, this **can't be undone**.",
    )
    .setColor(0x3498db);

  const statsAndHelp = new EmbedBuilder()
    .setTitle("Stats & records")
    .setDescription(
      "**Season stats** (defends/wins/losses) — tracked since the last Reset Ladder, live in a tab named after " +
        "the current season.\n" +
        "**All-Time Stats** — a permanent record for every player who's ever won or lost a match, at any rank; " +
        "survives every reset. `Defends` is scoped to Rank 1 specifically (consecutive title defenses), and the " +
        "tab as a whole doubles as a hall-of-fame of everyone who's ever held #1.\n" +
        "**Banned Users** — every active ban, its scope (one element or ALL), and reason.\n" +
        "**Ladder tab** — the live source of truth for ranks/status. The `Notes` column is yours to use freely; " +
        "the bot never touches it.\n\n" +
        "**Questions, bugs, or a feature request?** Reach out to Aspect@discord or Capacitor@jsp.",
    )
    .setColor(0x3498db);

  return [overview, howItWorks, resetHowTo, statsAndHelp];
}
