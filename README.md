# NvD League Ladder Bot

A Discord bot that runs a competitive Necro vs Druid ladder league (every match is a mirror match — no elements,
builds, or character names) with a Google Sheet as the live database. Handles signups, challenges, win reporting, vacations, and admin-reviewed dodge
requests with screenshot evidence.

## Contents

- [Channels](#channels)
- [Registration & the ladder](#registration--the-ladder)
- [Challenges & matches](#challenges--matches)
- [Vacation](#vacation)
- [Stats & leaderboard](#stats--leaderboard)
- [NvD Admin dashboard](#league-manager-dashboard)
- [Setup](#setup)
- [Deployment](#deployment)
- [Testing the flows end-to-end](#testing-the-flows-end-to-end)
- [License](#license)

## Channels

| Channel | Purpose |
| --- | --- |
| `#register` | Sign Up, Leave Ladder, Vacation, and Extended Vacation buttons (all self-service, except approvals). |
| `#challenges` | Two pinned, self-updating panels: the **Challenge** button and the **Active Challenges** list. |
| Results channel | Permanent log — every challenge, result, dodge, extension, and admin action. Nothing here auto-deletes. |
| `#rankings` | Pinned Top 10 leaderboard only (✅ available, ❌ in a challenge, 🌴 vacation). |
| `#league-managers` | Pending approvals (signups, vacations, dodges, extensions) plus the pinned NvD Admin dashboard. |
| `#announcements` | Flashy post on every approved signup. |

## Registration & the ladder

- **Sign up**: one click on the `#register` **Sign Up** button — no form. The request is just your Discord display
  name, posted to `#league-managers` for approval. Approve adds you to the bottom of the ladder, DMs you, and
  announces in `#announcements`. There's no self-service `/signup` — every entry is admin-reviewed.
- **One ladder spot per player**, shown by Discord name. A player can't sign up while already on the ladder, while a
  request is pending, or while on Extended Vacation (they use **Return** instead).
- **Leave Ladder**: self-service button in `#register`. If you have a pending match, leaving reports it as a
  loss for you first. Not reversible — you'd need to sign up again.
- **The `Ladder` tab** columns: `Rank`, `discUser`, `Status`, `cDate`, `Opp#`, `discord userid`, `Notes`, `Dodges`,
  `DodgesAgainst`, plus two bot-only vacation timestamp columns. `Status` is `Available`, `Vacation`, or `Challenge` (with `cDate`/`Opp#` filled in while a
  match is active). Colors/badges are native Sheets conditional formatting — the bot only ever writes text/numbers.
  Rows re-sort by `Rank` after any rank change; `Notes` is left alone for NvD Admins.
- Every approval request in `#league-managers` deletes itself once actioned; personal ephemeral bot replies that
  reach a final step self-delete after 5s (except the **Guide** reply, which is reference material).

## Challenges & matches

- **Issuing**: `/challenge` or the `#challenges` **Challenge** button. Reach up to 3 ranks up (`CHALLENGE_RANGE`),
  or 2 if the target is in the top 10 (`TOP_TIER_SIZE` / `TOP_TIER_CHALLENGE_RANGE`). Vacationing players are
  skipped, not counted. One active match per player at a time.
- **Post-loss cooldown**: 24h (`CHALLENGE_COOLDOWN_MS`) before re-challenging the exact player you just lost to;
  other targets are unaffected.
- **Match threads**: a private thread under `#challenges`, visible to both participants; every NvD Admin is also
  added as a member (so it shows in their sidebar), on creation and again for active matches at startup. This needs
  the **Server Members Intent** enabled in the Developer Portal. Has **Report Win**, **Request Dodge**,
  and **Request Extension** buttons. Deleted automatically on result/dodge-approval; left in place (and
  auto-archived) on plain expiry so a manager can still review it.
- **Reporting a win**: `/report-win` or the thread's button — either participant picks the winner from a dropdown
  with nothing pre-selected (so you can self-report or concede). Ranks swap only if the challenger won.
- **Dodges**: after `DODGE_ELIGIBLE_AFTER_MS` (default 24h) with no result, either side can request one via
  `/dodge-request` (with a screenshot) or the thread's button. Goes to `#league-managers` for Approve/Deny.
  Approve swaps ranks and closes the thread.
  - Each approved dodge adds 1 to the defender's `DodgesAgainst`: a warning DM at 2, auto-removal at 3.
    Completing any reported match (win or lose) subtracts 1 from both participants (floor 0) — staying active
    works the count back down. Reset Ladder zeroes it. This is separate from the permanent `All Time Stats`
    `DodgesAgainst` column, which never resets.
- **Extensions**: **Request Extension** in a match thread asks for `EXTENSION_GRANT_MS` (default 2 days) more.
  Goes to `#league-managers`. **One request per match, ever** — a denied request is spent just like an approved
  one.
- **Scheduler**: polls every `SCHEDULER_INTERVAL_MS` (default 10 min). Warns both players `MATCH_WARNING_LEAD_MS`
  before a match's `MATCH_LIFESPAN_MS` expiry, then auto-expires it (no rank change) if nothing was reported.

## Vacation

- **Vacation** (self-service): `#register` buttons, needs NvD Admin approval. If you have a pending
  match, approval auto-forfeits it as a loss (counts as a dodge against you, same thresholds as above). Lasts up
  to `VACATION_EXPIRY_MS` (default 14 days); **Return from Vacation** is self-service any time before then. Miss
  the window and it auto-escalates to Extended Vacation, with a DM warning `VACATION_WARNING_LEAD_MS` (default 3
  days) out either way.
- **Extended Vacation**: same approval/forfeit rule, but removes you from the ladder entirely (into an
  `ExtendedVacation` tab, recording its rank) for up to `EXTENDED_VACATION_EXPIRY_MS` (default 30 days).
  **Return** is self-service and reinserts you at your old rank + 1, auto-issuing a challenge against whoever now
  holds that rank (skipped if they're mid-match). Miss the window and you're fully removed, with season
  (activity) points reset to zero.
- The NvD Admin dashboard's **Vacation** button is a separate manual admin override (toggles one player);
  unlike the self-service flow, it *blocks* instead of auto-forfeiting if there's a pending match.

## Stats & leaderboard

- **All Time Stats**: permanent, append-only record for every participant. `Wins`/`Losses` climb from a match at
  any rank; `Defends` counts consecutive rank-1 title defenses (preserved across a reclaim); `DodgesAgainst` is a
  permanent counter. None of this resets with a season.
- **Top 10 leaderboard**: a single pinned text post in `#rankings`, with ✅ next to available players, ❌ next to
  players in a challenge and 🌴 next to players on vacation; refreshed in place on any rank or challenge change.

## NvD Admin dashboard

A pinned message in `#league-managers` with buttons gated to the `NvD Admin` role (self-heals on bot restart,
so new buttons don't require re-pinning by hand):

| Button | Does |
| --- | --- |
| **Reset Ladder (End Season)** 🔴 | Cancels active matches, randomizes ranks, starts a new season tab (old tab is frozen as its permanent record). Zeroes `DodgesAgainst`. Confirmation required. |
| **Remove Player** | Removes one player, closes any gap. |
| **Ban Player** 🔴 | Removes the player from the ladder and blocks future signups. |
| **Unban** | Lifts an active ban. |
| **Force-Cancel Match** | Voids any active match, no rank change. |
| **Report Win** | Pick an active match and its winner to report the result on a player's behalf (normal rank/stats/points handling; the announcement notes which admin reported it). |
| **Set Rank** | Moves one player to an exact rank; everyone between shifts by one. |
| **Pending Sign-ups** | Lists/approves signup requests, including any that failed to auto-post. |
| **Vacation** | Manual toggle for one player (see [Vacation](#vacation)). |
| **Shuffle Ranks** | Randomizes rank order only — warns first if matches are active. Confirmation required. |
| **Pause/Resume Ladder** | Freezes/resumes every active match's countdown; blocks new challenges while paused. |
| **Guide** | NvD Admin reference doc, as a non-auto-dismissing reply. |

Every action here is announced in the results channel.

## Setup

### 1. Discord application

1. Create an application + bot at https://discord.com/developers/applications. Copy the bot token →
   `DISCORD_TOKEN`, and the Application ID → `DISCORD_CLIENT_ID`.
2. OAuth2 URL Generator: scopes `bot` + `applications.commands`; permissions `Create Private Threads`,
   `Manage Threads`, `Manage Messages`, `View Channels`, `Send Messages`, `Send Messages in Threads`,
   `Embed Links`, `Attach Files`, `Mention Everyone`, `Read Message History`. Use the generated URL to invite the
   bot.
3. Enable Developer Mode (User Settings → Advanced). Copy your server ID → `DISCORD_GUILD_ID`, and each channel ID
   from the [Channels](#channels) table into its matching `.env` variable.
4. Create a `NvD Admin` role (or set `LEAGUE_MANAGER_ROLE_NAME`) and assign it to your admins.

### 2. Google Sheet

1. In Google Cloud Console: create a project, enable the **Google Sheets API**, create a **Service Account**, and
   generate a JSON key.
2. From the key, copy `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` → `GOOGLE_PRIVATE_KEY`
   (keep the literal `\n` sequences, one line).
3. Create (or reuse) a Sheet, share it with the service account email as **Editor**, and copy its ID from the URL
   → `GOOGLE_SHEET_ID`.
4. The bot creates all required tabs (`Ladder`, `Matches`, `Dodges`, `All Time Stats`, `SeasonStats`,
   `SignupRequests`, `BannedUsers`, `Settings`, `VacationRequests`, `ExtendedVacation`) automatically on first run,
   and rewrites any header row that doesn't match the current layout (data rows are never touched).

### Resetting the league

`npm run reset-league -- --yes` wipes every bot-owned tab back to just its header row (ladder, matches, stats,
signups, bans, vacations), clears the season name in `Settings`, and empties `data/points.json`. Other tabs such as
old `Season N` archives are left alone and listed so you can delete them by hand. Stop the bot before running it.
This was used for the switch from the old elements league (the last version of that is git tag
`elements-league-final`).

### 3. Configure and run

```
copy .env.example .env
```

Fill in `.env` (every variable is documented there, including match/vacation timing defaults in milliseconds).
Then:

```
npm install
npm run build
npm run check-setup         # verifies the server, channels, bot permissions, and NvD Admin role
npm run register-commands   # pushes slash commands to DISCORD_GUILD_ID — re-run whenever commands change
npm start
```

### Moving to a different Discord server

1. Invite the bot to the new server (`bot` + `applications.commands` scopes) and create the six channels and the
   NvD Admin role there.
2. Stop the bot through the dashboard agent (required if you're resetting the league).
3. Run, with the new server's IDs:

   ```
   npm run switch-server -- --guild <id> --challenges <id> --results <id> --rankings <id> --admins <id> --register <id> --announcements <id> [--role "NvD Admin"] [--reset-league]
   ```

   It backs up `.env` (`.env.bak-<timestamp>`), writes the new values, and runs `check-setup`. If any check fails
   it puts `.env` back and stops. Otherwise it optionally resets the league, builds, registers the slash commands
   on the new server, and removes them from the old one. `npm run check-setup` and
   `npm run clear-commands -- <serverId>` also work on their own.
4. Start the bot through the dashboard agent. It posts and pins every panel in the new channels by itself.

`npm run dev` runs directly from TypeScript via `tsx`, no build step. `npm test` runs the unit tests (pure
rank/challenge logic, no Discord or Google credentials required).

## Deployment

Runs 24/7 on ASPECTSRV-DT, managed by the `bot-dashboard-agent` service (not pm2) — it starts, stops, and restarts
the bot's Node process directly and exposes a health check + audit log. Deploying an update: pull the new code,
`npm install` (if dependencies changed), `npm run build`, `npm run register-commands` (only if slash command
definitions changed), then restart via the dashboard agent's API rather than any local pm2/process command.

## Testing the flows end-to-end

Use a separate test server/channels and a scratch copy of the Sheet before pointing this at the real league. To
speed up expiry/warning testing, temporarily lower the relevant `_MS` variables in `.env`.

- **Signup**: one click submits; approve and deny both work end-to-end (DM/announcement, or DM'd reason); a second
  signup while already on the ladder or with a request pending is rejected.
- **Challenge**: valid target, out-of-range, top-10-too-far, self-challenge, and vacationing-target all reject
  correctly; an unregistered account gets a clear error instead of a silent no-op. A valid challenge creates the
  private thread, results-channel post, and Active Challenges entry; the post-loss cooldown blocks a rematch but
  not other targets.
- **Report Win**: both entry points show the no-default winner dropdown; picking the opponent (concede) only
  swaps ranks when the challenger wins; thread is deleted, result posted, entry drops off Active Challenges either
  way.
- **Dashboard Vacation toggle**: flips status; blocked while a match is pending.
- **Dodges**: request → approval swaps ranks, posts the result, deletes the original request; denial DMs (or
  pings) the requester with the reason either way.
- **Expiry**: a match past full expiry is marked `Expired` with no rank change, thread left in place and
  auto-archived, static notice with no live countdown.
- **Extensions**: approval pushes expiry back and re-arms the warning; a second request (after either an approval
  or a denial) is rejected.
- **Self-service Dodge Request**: posting a screenshot then **Submit Dodge Request** reaches `#league-managers`
  the same as `/dodge-request`.
- **NvD Admin dashboard**: exercise each button — Set Rank (mid-ladder shift), Force-Cancel Match, Remove
  Player (removal + match cancellation), Ban/Unban, and Reset Ladder last
  (confirms the season-name modal, match cancellation, rank randomization, and that the old tab is preserved).
- **Top 10 panel**: posts/pins on first startup; updates in place (no duplicate/re-pin) on any rank or challenge change.
- **Ladder tab visuals**: header/colors/badges match on sight; a `Challenge` status shows the right `cDate`/`Opp#`
  and clears on resolution; hand-typed `Notes` survive later bot updates.
- **Results channel**: every announcement type stays up permanently; `#challenges` only ever shows the two pinned,
  in-place-edited panels.
- **Self-service Vacation**: request → approve flips status and sets `VacationSince`; Return is approval-free.
  Requesting with a pending match auto-forfeits it and increments `DodgesAgainst` — run it a couple more times to
  confirm the normal warning/removal DMs still fire off a vacation-caused forfeit. Confirm the 3-day warning and
  auto-escalation to Extended Vacation.
- **Self-service Extended Vacation**: approve moves the player from `Ladder` into `ExtendedVacation`; Return
  reinserts at old rank + 1 and auto-challenges whoever holds it now (skipped if they're mid-match). Confirm the
  3-day warning and that full expiry clears the row and resets activity points.

## License

[MIT](LICENSE)
