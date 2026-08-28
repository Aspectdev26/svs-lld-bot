# SVS League Ladder Bot

A Discord bot that runs a competitive ladder league (Cold / Light / Fire elements, Vita / ES builds) with the
Google Sheet as the live database. Handles signups, challenges, win reporting, vacations, and admin-reviewed dodge
requests with screenshot evidence.

## How it works

- **Sign-ups**: `#register` has a standing **Sign Up** button (the bot posts it automatically if it's ever
  missing). Clicking it walks you through element → build → character name (element/build are select menus,
  character name is a short text prompt), then posts the request to `#league-managers` with Approve/Deny buttons.
  Approve places the character at the bottom of the ladder, DMs the requester a confirmation, and posts a flashy
  announcement to `#announcements`; Deny opens a reason modal and DMs the requester (falls back to a `#register`
  mention if DMs are closed). There's no self-service `/signup` command — every ladder entry goes through this
  admin-reviewed flow.
- **Leaving the ladder**: `#register` also has a standing **Leave Ladder** button. If you only have one entry it
  goes straight to a confirmation; with more than one it first asks which element-entry you mean. Confirming
  removes that entry and closes the gap — everyone ranked below it shifts up by one. If that entry is in an active
  match, leaving reports the match as **a loss for you** (your opponent is credited the win, including any rank
  swap) before the entry is removed, exactly like a normal reported result. Leaving isn't reversible — you'd need
  to sign up (and be re-approved) to rejoin.
- **Vacation (self-service)**: `#register` has **Request Vacation** and **Return from Vacation** buttons. Requesting
  needs League Manager Approve/Deny (same review pattern as sign-ups, posted to `#league-managers`); if the entry
  still has a pending match when it's approved, that match is auto-forfeited (your opponent is credited the win,
  same as Leave Ladder) and it counts as a dodge against you — including toward the same 2-warning/3-removal
  thresholds as a normal dodge. Approved Vacation lasts up to **14 days**; **Return from Vacation** is fully
  self-service (no approval) any time before then, and puts the entry straight back to Available/challengeable. Miss
  the 14 days and it auto-escalates to Extended Vacation with no League Manager involved — you'll get a DM warning
  3 days before that happens either way.
- **Extended Vacation (self-service)**: **Request Extended Vacation** works from Available or regular Vacation, also
  needs League Manager approval (same pending-match forfeit/dodge rule as above), and — once approved — removes the
  entry from the ladder entirely into a dedicated `ExtendedVacation` sheet tab, recording the rank it held. It lasts
  up to **30 days** from whenever it started (either the approval, or an auto-escalation from an unreturned regular
  Vacation) — again with a DM warning 3 days out. **Return from Extended Vacation** is self-service: you rejoin the
  ladder at **your old rank + 1**, and the bot automatically issues a challenge against whoever now holds your old
  rank (skipped if they're already mid-match, in which case you just settle in at the new rank as normal). Miss the
  30 days and the entry is fully removed — same as a League Manager removal, plus your season (activity) points are
  reset to zero — and you'd need to sign up again from scratch to rejoin.
- **Character names are unique per element+build**: you can't sign up with a name someone else already has on the
  ladder (or already has pending review) for that exact element+build combo (case-insensitive) — pick a different
  name instead. The one exception: you can reclaim your *own* former name/element/build combo (e.g. after being
  removed and re-registering) without it counting as a conflict against yourself. The same name is completely fine
  on a different element or a different build (two players can both have a Fire "Blaze", one Vita and one ES).
- **Approval requests clean up after themselves**: every request posted to `#league-managers` for review — sign-up,
  dodge, or extension — is deleted the moment a manager approves or denies it (rather than sitting there forever
  with disabled buttons), and the small "Approved/Denied by..." confirmation that replaces it in that channel
  auto-deletes itself 5 seconds later. Keeps the channel showing only what's still actually pending.
- **Ephemeral replies clean up after themselves too**: server-wide, every personal (only-you-can-see) bot reply that
  reaches a terminal step of its flow — a final confirmation, or a rejection that ends things right there — deletes
  itself 5 seconds later instead of sitting there needing a manual "Dismiss Message" click. Prompts still mid-flow
  (waiting on your next click, selection, or upload) are left alone so you don't lose the instructions before you
  can act on them, and the Dashboard's **Guide** reply is also exempt since it's reference material meant to be
  read. None of this touches the permanent public posts in the results channel.
- **Two separate channels split "issue a challenge" from "everything that happened"**: `#challenges` (the "Issue a
  Challenge" channel) just holds two pinned, standing panels — the **Challenge** button and the **Active
  Challenges** list (every currently pending match, refreshed after anything that creates, resolves, expires,
  cancels, or extends one; edited in place, not reposted). A separate results channel gets every announcement —
  new challenge, match result, dodge approval/denial, extension outcome, admin cancellation, the 24h-before-expiry
  warning, the expiry notice — and none of it auto-deletes; it's a permanent running log.
- **The `Ladder` tab matches the league's original reference sheet**: same column order and labels (`Rank`, `Name`,
  `spec`, `element`, `discUser`, `Status`, `cDate`, `Opp#`, `discord userid`, `Notes`, `Dodges`), plus one trailing
  `DodgesAgainst` column the bot added, same color scheme, and the same three-state `Status` display. `Status`
  shows **Challenge** (with `cDate`/`Opp#` filled in — the timestamp and the opponent's rank at the moment the
  challenge was issued) whenever that entry has an active match, reverting to **Available**/**Vacation** the
  moment it resolves — no separate "in a match" tracking to read elsewhere. `Dodges` counts how many matches that
  entry has won via an approved dodge. `DodgesAgainst` counts approved dodges *against* that entry (see **Dodges**
  below for the warning/removal behavior it drives). `Notes` is left
  entirely alone for League Managers to use by hand. Colors (element/status backgrounds, rank-1/2/3 badges, header
  banding) are applied via native Google Sheets conditional formatting, so they recompute automatically as values
  change — the bot only ever writes plain text/numbers, never touches cell formatting after initial setup.
  Rank changes (swaps, shuffles, removals, manual overrides) update the `Rank` *value* wherever a row already
  sits — the row itself never physically moves — so after any operation that changes ranks, the sheet's rows are
  automatically re-sorted by `Rank` ascending, keeping the raw spreadsheet in clean top-to-bottom order rather
  than drifting out of sequence over time.
- **Ladder**: one combined ranking. Each player can hold up to 3 rows (one per element they've signed up with),
  each with its own rank number and its own **character name** (the primary display identity everywhere — ladder
  listings, challenge targets, match channels — separate from the player's Discord name).
- **Elements always carry their emoji**: ❄️ Cold, ⚡ Light, 🔥 Fire — anywhere an element name shows up in a bot
  message, embed, select menu, or channel topic. The one exception is the rendered Top 10 leaderboard image, which
  uses its own color-coding instead since canvas-rendered emoji isn't reliable across platforms.
- **Challenges**: `/challenge` (or the pinned **Challenge** button in `#challenges`) lets you reach up to 3 ranks
  up the ladder, skipping any of your *own* other-element rows and any row whose player is on **Vacation** (neither
  counts against your range and neither can be targeted). If the target is in the top 10, you must be within 2
  ranks of them instead of 3. The button flow adapts to how many elements you have registered: if you only have
  one, it skips straight to picking a target; with more than one it asks which element is challenging first.
  Discord can't hide a shared message's buttons per-viewer, so an unregistered user who clicks **Challenge** gets
  an immediate "you're not registered" reply rather than the button silently doing nothing or being invisible to
  them — that's the practical equivalent of "not accessible" the platform allows.
- **Post-loss cooldown**: after a reported loss, that specific element-entry can't re-challenge the exact entry it
  lost to for 12h (`CHALLENGE_COOLDOWN_MS`) — an attempt during the cooldown is rejected with when it lifts. Only a
  reported loss counts (a dodge-approved match always credits the win to its own challenger, so it never triggers
  this), and it's scoped to that specific matchup — other targets are unaffected.
- **All-time stats**: the `All Time Stats` tab is a permanent, append-only record covering every ladder
  participant, not just rank-1 holders — a row is created (at 0/0/0) for a character the first time they win or
  lose *any* match, at any rank, and their all-time `Wins`/`Losses` totals climb from there for as long as they're
  active. Rows are never deleted or reset, even after a "Reset Ladder (End Season)" (that only wipes the
  season-specific stats tab). `Defends` is the one column scoped to rank 1 specifically: it counts consecutive
  successful title defenses, increments when the rank-1 holder wins a challenge against them, is preserved (not
  reset) if that player later reclaims rank 1 after losing it, and the tab doubles as a hall-of-fame list of
  everyone who's ever held the top spot. Announced in the results channel alongside the match result.
  `DodgesAgainst` is the same kind of permanent counter, bumped once per approved dodge against that
  character — unaffected by season resets or by the character being removed from (or rejoining) the ladder.
- **One match per element**: a player can have up to 3 matches running at once (one per element), but a given
  element-entry can only be in one match at a time.
- **Match channels**: issuing a challenge (`/challenge`) auto-creates a private text channel under the
  **Current Challenges** category, visible only to the two participants and the `League Manager` role. It comes
  with **Report Win**, **Request Dodge**, and **Request Extension** buttons, and is deleted automatically once a
  result is reported or a dodge is approved (not on plain expiry — an expired match's channel is left in place in
  case a League Manager wants to review it; delete it manually or ask me to add auto-cleanup there too if you'd
  rather it disappear).
- **Win reporting**: either participant can report a result — via `/report-win` or the channel's **Report Win**
  button — no confirmation step. Both surface a **dropdown to pick who actually won** (both players' character
  names, nothing pre-selected — Discord clients can silently swallow a "selection" of an option that's already
  shown as the default, so both sides always require an explicit pick) rather than assuming the reporter always
  won — so a player can self-report, or just as easily report their opponent's win (concede) or correct a mistake.
  If the challenger is picked as the winner, ranks swap; if the defender wins, nothing changes.
- **Vacation**: self-service via `#register`'s **Request Vacation**/**Return from Vacation** and **Request Extended
  Vacation**/**Return from Extended Vacation** buttons — see the dedicated section below. The League Manager
  dashboard's **Vacation** button still exists as a manual admin override: pick one character (by name, not Discord
  name) to toggle just that entry's status, leaving the player's other elements untouched. Unlike the self-service
  request flow, the admin toggle *blocks* instead of auto-forfeiting when the entry has a pending match.
- **Dodges**: once 24h pass on a match with no result, either side can request a dodge — via `/dodge-request` with
  a screenshot attachment, or the channel's **Request Dodge** button (which, since Discord buttons can't accept
  file uploads, asks you to post the screenshot as a message in the channel first, then click **Submit Dodge
  Request**). It posts to `#league-managers` with Approve/Deny buttons (gated to the `League Manager` role).
  Approve swaps ranks in the challenger's favor and closes the match channel; Deny opens a reason modal and DMs
  the requester (falls back to a mention in the results channel if DMs are closed).
- **Dodge counts (warning/auto-removal)**: each approved dodge adds 1 to the defender's `DodgesAgainst`. At 2, the
  defender gets a private warning DM plus a notice in `#league-managers`; at 3, their entry is automatically
  removed from the ladder (DM to the player, plus a notice in both `#league-managers` and the results channel).
  Completing any reported match — win or lose, via `/report-win` or the **Report Win** button — subtracts 1 from
  *both* participants' `DodgesAgainst` (floor 0), so staying active is how a player works their count back down;
  a dodge-approved win doesn't count as "completing" a match for this purpose, since nothing was actually played.
  A "Reset Ladder (End Season)" also zeroes every entry's `DodgesAgainst`, and the counter is gone entirely if the
  entry itself is removed (auto-removal, ban, or manual admin removal) — see below. This is separate from the
  `All Time Stats` tab's own `DodgesAgainst` column: a permanent, append-only historical total that's never reset
  or decremented by anything, same as that tab's `Wins`/`Losses`/`Defends`.
- **Extensions**: either participant can hit **Request Extension** in their match channel to ask for 2 extra days.
  It posts to `#league-managers` with Approve/Deny buttons; Approve pushes the match's expiry back by
  `EXTENSION_GRANT_MS` (default 2 days) and re-arms the 24h-before-expiry warning.
- **Scheduler**: polls the `Matches` sheet every 10 minutes (configurable). Warns both players 24h before a match's
  72h expiry, and auto-expires (no rank change) matches that go the full 72h with no result.
- **League Manager dashboard**: a pinned message in `#league-managers` with eleven buttons, all gated to the
  `League Manager` role (the panel refreshes itself in place on every bot restart, so adding buttons in a future
  update doesn't require deleting the old pinned post by hand). All buttons are blue except **Ban Player** and
  **Reset Ladder (End Season)**, which stay red to flag their higher stakes:
  - **Reset Ladder (End Season)** — cancels every active match, randomizes rank order among all current entries, and
    asks for a name for the new season that's starting. Season stats (defends/wins/losses) live in a tab named
    after the season — this creates a fresh, empty one under the given name and points future stat-tracking at it;
    the season that just ended simply keeps the tab it's been using the whole time, now frozen as its permanent
    record, with no separate archive/copy step. All-time stats (`All Time Stats` tab) are unaffected. Every entry's
    `DodgesAgainst` also resets to 0 (a clean slate for the warning/removal count each season); `Dodges` (dodge
    wins) is left untouched. Requires a confirmation click since it's irreversible.
  - **Remove Player** — pick one character directly from a dropdown of every ladder entry (by character name, not
    Discord name); removes just that entry and cancels any match it was in, then closes the gap by renumbering
    everyone below it. Always targets exactly one character — to clear out all of a player's entries, remove each
    one individually or use Ban Player instead.
  - **Ban Player** — pick a player, a scope (one element or all), and a reason; removes matching entries the same
    way Remove does, and blocks future sign-up requests for that scope (checked both at signup submission and
    earlier, right when picking an element in `#register`, so a banned user finds out before filling anything in).
  - **Unban** — lists active bans, lift one with a click.
  - **Force-Cancel Match** — pick any active match league-wide and void it with no rank change (for disputes or
    mistaken challenges that don't fit the dodge process).
  - **Set Rank** — pick a player/entry and type an exact new rank; everyone between the old and new position
    shifts by one, same as inserting into a sorted list, and the ladder stays a clean 1..N afterward.
  - **Pending Sign-ups** — lists every sign-up request still awaiting review and lets you approve/deny it right
    there, even if its original auto-post to this channel never showed up (e.g. a slow response caused the bot to
    save the request but fail to post it — this is the recovery path for that).
  - **Vacation** — pick one character directly from the same by-name dropdown as Remove Player, to toggle just
    that entry between Available and Vacation. This is a manual override alongside the self-service Vacation
    request flow in `#register` (see below) — the dashboard toggle *blocks* instead of auto-forfeiting if the
    entry has a pending match.
  - **Shuffle Ranks** — randomizes rank order only, with no season archiving or match cancellation (unlike Reset
    Ladder). Warns first if there are currently active challenges, since shuffling ranks mid-challenge can make the
    challenge context (who challenged whom, at what rank) confusing. Requires a confirmation click.
  - **Pause/Resume Ladder** — a toggle. Pausing blocks new challenges from being issued and freezes the countdown
    on every already-active match; resuming shifts each of those matches' expiry forward by exactly how long the
    ladder was paused, so no one loses time to the pause. Backed by a new single-row `Settings` tab.
  - **Guide** — pulls up the consolidated League Manager reference (channels, player-facing rules, the Reset
    Ladder walkthrough, stats tracking) as a reply visible only to whoever clicked it. Unlike other dashboard
    replies it does *not* auto-dismiss after 5s — it's reference material meant to be read, not a quick
    confirmation, so it's dismissed manually.
  Every League Manager action is announced in the results channel so the whole server can see what changed and who
  did it — `#rankings` is left alone, reserved for the pinned Top 10 leaderboard only. A new `BannedUsers` tab
  tracks active bans (`Element` is either one element or `ALL`).
- **Top 10 leaderboard**: a pinned post in `#rankings` with a rendered leaderboard graphic (rank badges, character
  names, element/build, a Vacation tag) for the current top 10, plus a link to the full Google Sheet. It's the same
  message edited in place every time — refreshed automatically after anything that can change rank order (reported
  wins, approved dodges, a new sign-up landing in the top 10, and every rank-changing admin action) — so it never
  needs to be re-pinned or reposted by hand. Rendered with `@napi-rs/canvas`, which ships prebuilt native binaries,
  so `npm install` picks up the right one per platform with no build tools required.

## Setup

### 1. Discord application

1. Create an application + bot at https://discord.com/developers/applications.
2. Under **Bot**, copy the token → `DISCORD_TOKEN`.
3. Under **OAuth2 → General**, copy the **Application ID** → `DISCORD_CLIENT_ID`.
4. Under **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; bot permissions: `Manage Channels`
   (needed to create/delete per-match channels), `Manage Messages` (needed to pin the challenge panel), `View
   Channels`, `Send Messages`, `Embed Links`, `Attach Files`, `Mention Everyone` (needed to ping the League Manager
   role and players), `Read Message History`. Use the generated URL to invite the bot to your server.
5. Enable Developer Mode in Discord (User Settings → Advanced), then right-click your server → Copy Server ID →
   `DISCORD_GUILD_ID`, and right-click each of the `#challenges` ("Issue a Challenge" — hosts the pinned Challenge
   button and Active Challenges list), the results channel (a permanent log of every challenge/result
   announcement), `#rankings`, `#league-managers`, `#register`, `#announcements` channels → Copy Channel ID for
   `CHALLENGES_CHANNEL_ID` / `CHALLENGE_RESULTS_CHANNEL_ID` / `RANKINGS_CHANNEL_ID` / `LEAGUE_MANAGERS_CHANNEL_ID` /
   `REGISTER_CHANNEL_ID` / `ANNOUNCEMENTS_CHANNEL_ID`.
6. Create a server role named exactly `League Manager` (or set `LEAGUE_MANAGER_ROLE_NAME` to whatever you name it)
   and assign it to your admins.

### 2. Google Sheet

1. In Google Cloud Console, create a project, enable the **Google Sheets API**, and create a **Service Account**.
   Generate a JSON key for it.
2. From the JSON key, copy `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` →
   `GOOGLE_PRIVATE_KEY` (keep it as one line with literal `\n` sequences — that's how Google exports it).
3. Create a new Google Sheet (or use an existing one), **share it with the service account email as Editor**.
4. Copy the sheet ID from its URL (`https://docs.google.com/spreadsheets/d/<THIS_PART>/edit`) → `GOOGLE_SHEET_ID`.
5. The bot creates the `Ladder`, `Matches`, `Dodges`, `All Time Stats`, `SeasonStats`, `SignupRequests`, `BannedUsers`, and
   `Settings` tabs (with
   headers) automatically on first run if they don't already exist — and backfills new columns onto an existing tab's
   header row if the schema grows in a future update, without touching existing data rows.

### 3. Configure and run

```
copy .env.example .env
```

Fill in `.env` with the values above. Then:

```
npm install
npm run build
npm run register-commands   # pushes slash commands to your test guild — re-run whenever commands change
npm start
```

For local iteration, `npm run dev` runs directly from TypeScript via `tsx` without a build step.

Run `npm test` to run the unit tests (pure rank/challenge-rule logic — no Discord or Google credentials required).

## Running 24/7 on ASPECTSRV-DT

This deploys with [pm2](https://pm2.keymetrics.io/) so the bot restarts on crash and starts automatically on boot.

```
npm install -g pm2 pm2-windows-startup
npm run build
pm2 start dist/index.js --name svs-lld-bot
pm2-startup install     # registers pm2 itself as a Windows startup task
pm2 save                # persists the current process list so it's restored on reboot
```

Useful pm2 commands:

```
pm2 logs svs-lld-bot     # tail logs
pm2 restart svs-lld-bot  # after pulling code changes + npm run build
pm2 status
```

When you deploy an update: pull the new code, `npm install` (if dependencies changed), `npm run build`,
`npm run register-commands` (only if slash command definitions changed), then `pm2 restart svs-lld-bot`.

## Testing the flows end-to-end

Use a separate test Discord server/channels and a scratch copy of the Sheet before pointing this at the real
league. To speed up expiry/warning testing, temporarily lower `MATCH_LIFESPAN_MS`, `MATCH_WARNING_LEAD_MS`,
`DODGE_ELIGIBLE_AFTER_MS`, and `SCHEDULER_INTERVAL_MS` in `.env` (documented with their millisecond defaults there).

1. Click **Sign Up** in `#register` with 2-3 test accounts across different elements — confirm the request lands in
   `#league-managers`; **Approve** should add the row to `Ladder` at the bottom, DM the requester a confirmation,
   and post the flashy announcement to `#announcements`; try **Deny** too and confirm the requester gets the reason
   (DM or `#register` mention). Either way, confirm the original request post in `#league-managers` is deleted and
   the small "Approved/Denied by..." message that follows it disappears on its own after ~5 seconds. Then try
   signing up a second account with the exact same character name, element, and build as an already-approved
   entry — confirm it's rejected; change just the build (or element) and confirm it's accepted.
2. `/challenge` and the pinned **Challenge** button in `#challenges` — try a valid target, an out-of-range target,
   a top-10 target from too far below, a self-challenge, and a vacationing target, to see each rejection message.
   Try the button as an unregistered account too — confirm it replies with a "you're not registered" error instead
   of doing anything. On a valid challenge, confirm a private channel appears under **Current Challenges** visible
   only to the two participants + League Managers, a permanent "New challenge" post lands in the results channel,
   and the pinned **Active Challenges** list in `#challenges` updates in place to include it. Report a loss for the
   challenger, then immediately try challenging that same defender entry again — confirm it's rejected with a
   cooldown message naming when it lifts, while challenging a *different* eligible target still works.
3. `/report-win` and the channel's **Report Win** button — confirm both show the winner dropdown with nothing
   pre-selected. Try a normal self-report (pick your own name), then try picking the *opponent's* name instead
   (concede/correct) and confirm ranks only swap when the challenger is the one picked as winner. Confirm the
   `Matches` row updates, the match channel is deleted either way, a permanent result post lands in the results
   channel, and the match drops off the pinned **Active Challenges** list.
4. League Manager dashboard's **Vacation** button — pick one character from the dropdown, confirm its status flips
   on `Ladder` and it becomes un-challengeable/challengeable accordingly, while the player's other elements (if
   any) are untouched. Try it again against a character with an active match — confirm it's rejected until the
   match is resolved or cancelled.
5. `/dodge-request` (after the configured eligibility window) with a screenshot — confirm the embed, image, and
   buttons land in `#league-managers` and ping the `League Manager` role.
6. Click **Approve** as a League Manager — confirm ranks swap, the results channel gets a permanent "Dodge
   approved" post, the match drops off the pinned **Active Challenges** list, and the original dodge request post
   in `#league-managers` is deleted (replaced briefly by an auto-deleting confirmation).
7. Repeat a dodge request and click **Deny** — fill in the reason modal, confirm the requester gets DMed (or
   pinged in the results channel if DMs are off) with the reason, and the original request post in
   `#league-managers` is deleted the same way.
8. Let a match sit past the warning threshold — confirm both players get tagged in the results channel; let it run
   past the full expiry — confirm it's marked `Expired` with no rank change (its match channel is left in place),
   a permanent "Match expired" post lands in the results channel, and it drops off the **Active Challenges** list.
9. Click **Request Extension** in a match channel — confirm the request lands in `#league-managers`; **Approve**
   should push the match's expiry back 2 days and re-arm the warning; **Deny** should leave the expiry untouched.
   Try requesting a second extension while one is already pending — confirm it's rejected. Either way, confirm the
   original request post in `#league-managers` is deleted and replaced briefly by an auto-deleting confirmation.
10. Click **Request Dodge** in a match channel, post a screenshot as instructed, then click **Submit Dodge
    Request** — confirm it reaches `#league-managers` the same way `/dodge-request` does.
11. League Manager dashboard (pinned in `#league-managers`), with a few test accounts on the ladder:
    - **Set Rank** a player to a rank in the middle of the ladder — confirm everyone in between shifts by one and
      the ladder stays a clean 1..N in the `Ladder` tab.
    - **Force-Cancel Match** an active match — confirm it's marked `Cancelled`, no rank change, its match channel
      is deleted, a permanent post lands in the results channel, and it drops off the **Active Challenges** list.
    - **Remove Player** one element from a multi-element player — confirm just that row clears and ranks below it
      compact; confirm any match it was in gets cancelled too and drops off the **Active Challenges** list.
    - **Ban Player** someone (try "one element" and "all elements" separately) — confirm their entries are removed,
      they show up in the `BannedUsers` tab, and both the `#register` element-select step and a direct sign-up
      attempt reject them with the ban reason.
    - **Unban** them — confirm they can sign up again afterward.
    - **Reset Ladder (End Season)** last (it cancels every active match) — confirm the confirmation prompt works,
      the season-name modal opens, all active matches get cancelled with their channels deleted, every rank is
      randomized afterward, and a new tab titled with the name you gave appears with just the header row while the
      previous season's tab is left untouched.
12. Top 10 panel in `#rankings` — confirm it's posted and pinned on first startup with an image and a working link
    to the Sheet. Do anything that changes a top-10 rank (report a win, approve a dodge, Set Rank, Shuffle) and
    confirm the *same* pinned message updates in place (no duplicate posts, no re-pinning needed).
13. `Ladder` tab visuals — confirm the header/column layout, colors, and rank-1/2/3 badges match on sight. Issue a
    `/challenge`: confirm both rows flip to `Status: Challenge` with `cDate`/`Opp#` filled in and colored orange;
    report the win (or let it expire/get cancelled) and confirm both rows revert to `Available`. Approve a dodge
    and confirm the challenger's `Dodges` count increments. Type something into a `Notes` cell by hand and confirm
    a later bot update (a rank change, a status change) leaves it untouched.
14. Results channel permanence — trigger a few different challenge/result posts (issue a challenge, report a win,
    approve a dodge, let a warning fire) and confirm none of them disappear; they should all stay up permanently.
    Separately, confirm `#challenges` only ever shows the two pinned panels (**Challenge** button and **Active
    Challenges**), both edited in place rather than reposted, and that the Active Challenges list always matches
    the `Matches` tab's currently-`Pending` rows.
15. Self-service Vacation — **Request Vacation** in `#register` with a test account, confirm the request lands in
    `#league-managers`; **Approve** should flip the entry to `Vacation` in `Ladder` and set `VacationSince`.
    **Return from Vacation** should flip it straight back to `Available` with no approval step. Then repeat the
    request while the entry has an active match: on **Approve**, confirm the match auto-resolves as a loss for the
    requester (opponent gets the rank swap, same as **Leave Ladder**) and the requester's `DodgesAgainst` increments
    by 1 — get them to 2 and 3 across a couple of these to confirm the normal dodge warning/removal DMs and
    `#league-managers` notices still fire correctly off a vacation-caused forfeit. Lower `VACATION_EXPIRY_MS` and
    `VACATION_WARNING_LEAD_MS` in `.env` to confirm the warning DM/notice fires 3 days out and the entry
    auto-escalates into `ExtendedVacation` (with the right `RankAtEntry`) once it fully expires.
16. Self-service Extended Vacation — **Request Extended Vacation**, **Approve** it, and confirm the entry disappears
    from `Ladder` (ranks below it compact) and a row appears in `ExtendedVacation`. **Return from Extended
    Vacation** should reinsert it at `old rank + 1` (everyone from that position down shifts by one) and
    auto-create a challenge against whoever now holds the old rank — confirm the auto-challenge is skipped instead
    when that entry already has a pending match. Lower `EXTENDED_VACATION_EXPIRY_MS`/`VACATION_WARNING_LEAD_MS` to
    confirm the 3-day warning fires and, on full expiry, the `ExtendedVacation` row is removed and the player's
    private activity-points entry (see League Manager dashboard's **Points Standing**) resets to zero.
