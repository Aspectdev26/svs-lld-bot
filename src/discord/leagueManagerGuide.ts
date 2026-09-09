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
        `📝 <#${config.channels.register}> — **Sign Up**, **Leave Ladder**, **Request/Return from Vacation**, and **Request/Return from Extended Vacation** buttons.\n` +
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
        "it lost to again for 12h. Only applies to that one matchup — every other target is unaffected.\n\n" +
        "**Report Win** → either player can report; they pick the actual winner from a dropdown (nothing " +
        "pre-selected). Challenger wins → ranks swap. Defender wins → nothing changes.\n\n" +
        "**Dodge** → requestable once a match has sat 24h with no result, with a screenshot attached. Comes here " +
        "for Approve/Deny. Approved = counts as a challenger win, and adds 1 to the defender's dodge count. At 2 " +
        "dodges the defender gets a private warning DM and this channel gets a notice; at 3 their entry is " +
        "automatically removed from the ladder (DM + notice here + results channel). Completing any reported " +
        "match — win or lose — removes 1 from a player's dodge count, down to a floor of 0. That dodge count " +
        "resets to 0 whenever the entry is removed (dodge-removed, banned, or manually removed) or the season " +
        "ends — separate from the **All Time Stats** tab's own dodge total, which is permanent and never reset " +
        "or decremented, same as its Wins/Losses/Defends.\n\n" +
        "**Extension** → +2 days on a match, one request per match (denying spends it too), comes here for Approve/Deny.\n\n" +
        "**Leave Ladder** → a player can remove one of their own entries any time. An active match on it is " +
        "recorded as a loss for them first. Not reversible.\n\n" +
        "**Vacation (self-service)** → *Request Vacation* in #register needs League Manager Approve/Deny here " +
        "(same as sign-ups). If approved while the entry has a pending match, that match is auto-forfeited (opponent " +
        "wins) and counts as a dodge for the requester — including toward the 2/3 warning-removal thresholds. " +
        "Approved Vacation lasts up to 14 days; *Return from Vacation* is self-service, no approval needed. Miss the " +
        "14 days and the entry auto-escalates to Extended Vacation with no League Manager involved. The Dashboard's " +
        "own **Vacation** toggle still exists as a manual admin override (blocks instead of auto-forfeiting if a " +
        "match is pending).\n\n" +
        "**Extended Vacation (self-service)** → *Request Extended Vacation* works from Available or Vacation, also " +
        "needs Approve/Deny here (same pending-match forfeit/dodge rule as above), and removes the entry from the " +
        "ladder entirely into the `ExtendedVacation` tab (with the rank it held). Lasts up to 30 days from whenever " +
        "it started (request or auto-escalation). *Return from Extended Vacation* is self-service: reinserts at " +
        "`old rank + 1` and auto-issues a challenge against whoever now holds the old rank (skipped if they're " +
        "already in a match). Miss the 30 days and the entry is fully removed with season (activity) points reset " +
        "to zero — resigning up is the only way back in. Both timers send a DM + a notice here 3 days before they " +
        "expire.",
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
        "• Every currently active match is cancelled and every rank is randomized.\n" +
        "• Every entry's dodge count (the warning/removal counter) resets to 0.\n\n" +
        "**Unaffected:** nobody is removed from the ladder, dodge *wins* aren't touched, and All-Time Stats are " +
        "never touched.\n\n" +
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
        "the bot never touches it.\n" +
        "**VacationRequests / ExtendedVacation tabs** — the approval queue for both self-service vacation flows, " +
        "and the current roster of everyone on Extended Vacation (with the rank they left at).\n\n" +
        "**Questions, bugs, or a feature request?** Reach out to Aspect@discord or Capacitor@jsp.",
    )
    .setColor(0x3498db);

  return [overview, howItWorks, resetHowTo, statsAndHelp];
}
