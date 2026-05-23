# DINKMASTER

Smart pickleball **paddle-stacking & partnership-mixing arena**. Register players, stack them onto courts, record scores, and let the app handle fair, varied rotations automatically. Players, the paddle-rack queue, courts, match history, and the partnership matrix are all persisted in **PostgreSQL** via **Prisma 7** (Next.js App Router + Server Actions for every mutation).

## Features

- **Paddle rack queue** — register players (comma-separated), see who's waiting and who's **on deck** (the next four to be stacked).
- **Courts** — add/remove courts; stack the top four onto any vacant court; record a final score to finish a match.
- **Smart matchups** — when a court is filled, teams are chosen to minimise repeated partnerships (the **partnership matrix** tracks how often any two players have paired).
- **Auto-mix the rack** — after each finish the rack reshuffles so the same four don't lock together, balanced by a fairness algorithm (below).
- **Waiting badge** — a `⏳ N` badge appears on players who've waited ≥ 2 rounds (amber), turning red at ≥ 4, so you can see who's overdue.
- **Match log & stats** — full history of finished matches (with snapshotted names that survive player deletion) plus per-player games/wins/losses.
- **Skill rating** — every player carries an Elo-based **skill rating**, shown DUPR-style on a 2.0–8.0 scale, that moves after each finished match. Surfaced in the per-arena **My Stats** tab and the global **/profile** page.
- **Player of the Week** — a **This Week** tab ranks the top 5 players by wins for the current week (everyone who played is eligible; ties broken first by win %, then by most recent win). It's derived live from match history, so it updates on every score. Owners and organizers set the arena's recurring **schedule** (play days + time window + timezone); the **timezone** fixes the Mon–Sun week boundary and the schedule shows for context, while *every* game in the week counts (off-schedule games included). The viewer's own weekly wins/rank also appear on **/profile**.

## How the rotation algorithm works

When auto-mix runs (after a finish, if more than one court's worth of players are waiting), each waiting player is sorted into three **bands**, highest priority first:

| Band | Condition | Ordering within the band |
|------|-----------|--------------------------|
| **Emergency** | waited ≥ `EMERGENCY_WAIT` (4) | strictly longest-waiting first — bounds the worst-case wait |
| **Protected** (⏳ badge) | waited ≥ `STARVE_THRESHOLD` (2) | always ahead of fresher players, but **random** among themselves so a big pool doesn't lock into a fixed rotation |
| **Fresh** | waited 0–1 | mixed by a small games-played nudge + randomness |

Within a band the order is `GAMES_WEIGHT × (mostGames − gamesPlayed) + RANDOM_WEIGHT × random()` — the games term gently evens out totals (and eases newcomers in without letting them hog the court), while randomness keeps groups varied. The thresholds/weights live in [`src/lib/matchmaking.js`](src/lib/matchmaking.js) and are shared by the server logic and the UI badge so they never drift.

> **Inherent trade-off:** when players ÷ (courts × 4) divides evenly (e.g. 12 players on 1 court), the *only* arrangement with minimal waiting is a fixed rotation — so variety is naturally low there. Adding a court or a few more players restores high variety.

## Requirements

- **Node.js ≥ 20.19** (enforced via `engines` and `.nvmrc`; Prisma 7 / `@prisma/dev` require it — older 20.x minors fail `prisma generate` with `ERR_REQUIRE_ESM`).
- **PostgreSQL** (local or hosted).
- **pnpm** (project package manager).

## Setup

1. Install dependencies (runs `prisma generate` via `postinstall`):

   ```bash
   pnpm install
   ```

2. Configure environment variables in `.env` (gitignored) — see `.env.example`:

   ```bash
   DATABASE_URL="postgres://USER:PASSWORD@localhost:5432/dinkmaster"
   BETTER_AUTH_SECRET="<run: openssl rand -base64 32>"
   BETTER_AUTH_URL="http://localhost:3020"
   ```

3. Apply migrations:

   ```bash
   pnpm prisma migrate deploy        # apply schema
   ```

4. Run the dev server:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3020](http://localhost:3020) (the app runs on port 3020).

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm dev` | Start the dev server |
| `pnpm build` | `prisma generate` + production build (no migration) |
| `pnpm vercel-build` | `prisma generate` + `migrate deploy` + build (used automatically by Vercel) |
| `pnpm db:migrate` | Create/apply a dev migration (`prisma migrate dev`) |
| `pnpm db:deploy` | Apply pending migrations (`prisma migrate deploy`) |
| `pnpm db:push` | Push schema without a migration |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm test` | Run Vitest unit/integration tests |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:e2e` | Run Playwright e2e tests (starts a dev server) |

## Testing

- **Vitest** — unit/integration tests co-located as `src/**/*.test.js`. `src/app/actions.test.js` verifies every mutating Server Action is auth-gated (Prisma and the session helper are mocked, so no database is needed).
- **Playwright** — e2e specs in `e2e/`. `e2e/auth.spec.js` covers the `/register` and `/login` happy and failure paths against a real dev server and database. First run needs the browser: `pnpm exec playwright install chromium`.

## Data model

Defined in [`prisma/schema.prisma`](prisma/schema.prisma):

- **Arena** — an isolated session owned by a `User`. Players, courts, matches, and partnerships are all scoped by `arenaId`. Carries an optional `description` blurb and a recurring **schedule** (`scheduleDays` 0–6, `scheduleStart`/`scheduleEnd` `"HH:MM"`, `timezone`); the `timezone` fixes the Mon–Sun window for the weekly **Player of the Week** leaderboard, and the days/times show for context.
- **Player** — a rack entry: `firstName`/`lastName`, `gamesPlayed`, `wins`, `losses`, `queueOrder` (null when not in the rack), `waitRounds`, `gamesOffset` (games credited at join so late joiners rotate as peers, not catch-up), `rating` (Elo skill rating, see [Skill rating](#skill-rating)). `userId` links the player to a registered account; it is null for temporary walk-in players. `leftAt` marks a departed member: the row (stats + history) is kept but excluded from the active rack, and a rejoin reactivates it.
- **Court** + **CourtSlot** — a court's live status and the four players assigned to it (a player can be on at most one court — DB-enforced).
- **Match** + **MatchPlayer** — finished-match history with snapshotted player names.
- **Partnership** — canonical pair counts powering the matchup optimiser.
- **ArenaMembership** — a user's role in an arena (`OWNER` / `ORGANIZER` / `MEMBER`), one row per `(arena, user)` pair. A member always has a linked `Player` row; temporary walk-in `Player` rows may exist without an `ArenaMembership`.
- **JoinRequest** — a pending request to join an arena, one row per `(arena, user)`; deleted when an owner/organizer accepts (creating an `ArenaMembership`) or rejects it.
- **User** / **Session** / **Account** / **Verification** — Better Auth tables.

## Authentication

Email + password auth via [Better Auth](https://www.better-auth.com), backed by the same PostgreSQL database through the Prisma adapter.

- **Sign up** at `/register`, **sign in** at `/login`; the header shows the current user with a sign-out control.
- Sessions are cookie-backed; config lives in `src/lib/auth.js`, the browser client in `src/lib/auth-client.js`, and the catch-all API handler at `src/app/api/auth/[...all]/route.js`.
- Requires `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in `.env` (see `.env.example`).

## Roles & permissions

Viewing any arena is public. Managing one depends on the caller's `ArenaMembership` role:

| Role | Can do |
|------|--------|
| **Owner** | Everything — run the session, rename, manage members, transfer ownership |
| **Organizer** | Run the full session: add/remove players & courts, fill courts, end matches, shuffle, reset |
| **Member** | View the arena; can leave |

- Arenas are public to browse but **join-gated**: a signed-in user **requests** to join (`requestToJoin`), and an owner or organizer **accepts** (`approveJoinRequest`) or **rejects** (`rejectJoinRequest`) it. On acceptance the user becomes a `MEMBER` and a queued player. Anyone can **create** their own arena (owner, no request needed).
- Leaving (`leaveArena`) or being removed (`removeMember`) **deactivates** the user's `Player` (sets `leftAt`, off the rack) and drops their membership — stats and match history are kept, and approving a later request reactivates the same record.
- Play actions and join-request decisions are gated by `requireArenaManager(arenaId)` (owner or organizer); owner-only actions (`renameArena`, `updateMemberRole`, `removeMember`, `transferOwnership`, `linkPlayerToMember`) by `requireArenaOwner(arenaId)`.
- `Arena.ownerId` stays the canonical owner; the owner also has an `OWNER` membership row, kept in sync on transfer.

## Routing

- `/` — public **arena directory**: lists every arena; signed-in users get a "create arena" form.
- `/arena/[id]` — a single arena (rack, courts, match log, members, my stats). Public to view; owners and organizers see management controls plus a pending-requests queue, members see it read-only, and non-members get a "request to join" prompt (showing "pending approval" once requested).
- `/arena/[id]/settings` — **manager-only** arena settings (General, Schedule, and an owner-only Danger Zone: reset, transfer ownership, delete). Non-managers are redirected to the arena view.
- `/profile` — your account: aggregate stats and match history across every arena you play in.
- `/login`, `/register` — auth pages.

## Roadmap

DINKMASTER is being built toward a **multi-tenant, multi-arena** system in phases.

| Phase | Scope | Status |
|-------|-------|--------|
| **1 — Auth foundation** | Better Auth user accounts; login/register pages; header sign-in/out; all arena mutations session-gated; arena view stays public. Destructive SQL seed removed. | ✅ Done |
| **2 — Arenas** | `Arena` model + `arenaId` scoping on Player/Court/Match/Partnership; create/own arenas; arena directory at `/` and per-arena routing at `/arena/[id]`; owner-only management. | ✅ Done |
| **3 — Membership & roles** | `ArenaMembership` with **Owner / Organizer / Member** roles; public join/leave; promote/demote/remove members; transfer ownership. | ✅ Done |
| **4 — Player ↔ User linking** | `Player.userId` links rack entries to accounts; creating or joining an arena auto-adds you as a queued player; owners can link walk-ins to members; per-arena **My Stats** tab and a global **/profile** page. Temporary players kept for walk-ins. | ✅ Done |
| **5 — Join approval & history retention** | Arenas are public to browse but join-gated: anyone **requests** to join and an owner/organizer accepts or rejects via the Members tab. Leaving/removal **deactivates** the `Player` (`leftAt`) instead of deleting it, so stats & match history survive and a rejoin reclaims them; `/profile` still lists left arenas. | ✅ Done |
| **6 — Skill rating** | Elo-based per-player rating updated at the end of each match; DUPR-style 2.0–8.0 display; surfaced in **My Stats** and **/profile**. | ✅ Done |
| **7 — Player of the Week** | Per-arena recurring **schedule** (days/time/timezone, manager-set); a **This Week** tab ranking the top 5 by wins for the scheduled week, derived live from match history; weekly wins/rank on **/profile**. | ✅ Done |
| **8 — Arena Settings (foundation)** | A dedicated, **manager-gated** `/arena/[id]/settings` page with left-nav sections, consolidating today's scattered controls: **General** (rename + new arena `description`), **Schedule** (the existing days/time/timezone editor), and an **owner-only Danger Zone** (reset, transfer ownership, and a new **delete arena**). Adds a Settings entry point from the arena. | ✅ Done |
| **9 — Configurable play behavior** | Per-arena overrides for what are now hardcoded constants, with current values as defaults so existing arenas don't change: **matchmaking** (starve / emergency wait thresholds), **match defaults** (target score, team size, auto-mix default), and **leaderboard** (top-N size, count off-schedule games). Threaded into the rotation, the ⏳ badge, the score modal, and the weekly leaderboard. New `Arena` columns + migration. | 🔜 Planned |

Phase tracking and detailed scope live in the GitHub issues.

> **Phases 8–9 ship incrementally** — Phase 8 lands the settings page + consolidation in its own PR; Phase 9 adds the behavior-config columns and threading in a follow-up PR.

## Skill rating

Every player carries a **skill rating** that moves after each finished match.

- **Internally** it is classic integer **Elo** (`baseline 1000`, `scale 400`, `K 32`) — robust, well-understood constants. A match's two teams are each rated by their players' average; the winning team gains and the losing team loses an equal, zero-sum delta (a tie applies the expected-score difference). Both teammates share their team's delta.
- **For display** the Elo value is linearly mapped to a **DUPR-style decimal** — `1000 Elo = 3.500`, every `100 Elo = 0.500` — and clamped to `2.000–8.000`. The math and the mapping live in [`src/lib/rating.js`](src/lib/rating.js), imported by both the server action that finishes a match and the stats UIs so they never drift.
- Ratings are **per-arena** (stored on `Player`), fair within one group. The global **/profile** "Rating" tile is a **match-weighted** average of the user's active arenas (weight = games played there), so an unconverged baseline row in a new or secondary arena can't deflate a strong player's headline rating.
- New players start at the baseline; there is **no backfill**, so only matches finished after Phase 6 shipped move ratings. `resetArena` returns every player to the baseline along with their other stats.

> **Known limitation (V1):** teammates share one Elo delta and `fillCourt` builds teams to minimise repeated partnerships, not to balance skill — so a player carried by a stronger partner can gain unearned rating. Fixing this needs a per-player performance signal beyond the final score; it is left to a future phase.

## Player of the Week

The **This Week** tab ranks the top 5 players by wins for the current week. Everyone who played is eligible — registered members *and* temporary walk-ins.

**Where the data comes from.** Nothing new is stored per win. The leaderboard is **derived** from existing finished-match history: for each `Match` in the window, the winning team is simply the one with the higher score (`score1` vs `score2`), and every `MatchPlayer` on that team gets a win. Ties (equal scores) count as a game played but no win. Because it reads the same `matchHistory` the client already holds, the board **recomputes on every score with no extra request** — finish a match and the standings move immediately.

**Ranking.** Players are sorted by, in order:

| Key | Tie-break reasoning |
|-----|---------------------|
| **Wins** (desc) | the headline metric |
| **Win %** (desc) | among equal win counts, reward the more efficient player — and since win % is `wins ÷ games`, equal wins + equal win % already implies equal games |
| **Most recent win** (desc) | a final, deterministic tie-break so order never wobbles |

Only players with **at least one win** appear, and the list is capped at five. Win % is shown rounded to a whole percent.

**The week window & the schedule.** Owners and organizers set a recurring **schedule** on the arena — play days, a time window, and a **timezone** (`scheduleDays`, `scheduleStart`, `scheduleEnd`, `timezone` on `Arena`; editable by managers from arena settings, and by owners from the tab). The window is the current **calendar week, Monday 00:00 → the next Monday 00:00, in the arena's timezone**. The timezone is the part that actually matters to the maths — it fixes where the week boundary falls (e.g. in `Asia/Manila`, local Monday midnight is the previous Sunday 16:00 UTC). The day/time fields are shown for context (e.g. "Tue, Thu · 6:00 PM–10:00 PM").

> **Design trade-off — every game counts, not just scheduled days.** An earlier version filtered matches to the scheduled weekdays (so only Tue/Thu games counted for a Tue/Thu arena). That silently emptied the board whenever people played off-schedule — a pickup session on a Saturday produced *zero* Player of the Week, which is surprising when you clearly played all week. We chose the opposite: **any game inside the week's window counts**, regardless of weekday. The schedule still sets the timezone and provides context, but it never *excludes* a game. The cost is that ad-hoc games dilute a "regular session" leaderboard; the upside is the board is never mysteriously empty while play is happening, which matched what people expected from "this week".

**Shared, drift-free maths.** The ranking and the timezone week-window are a **pure function** in [`src/lib/leaderboard.js`](src/lib/leaderboard.js) (no database, browser-safe), so the live client tab and the server `/profile` read use exactly the same logic and can't diverge — the same pattern as [`src/lib/matchmaking.js`](src/lib/matchmaking.js) and [`src/lib/rating.js`](src/lib/rating.js). The database-backed reader (`getWeeklyLeaderboard`) lives in [`src/lib/leaderboard-server.js`](src/lib/leaderboard-server.js), split out so Prisma never leaks into the client bundle.

**On `/profile`.** The same per-arena leaderboard powers two profile additions: a *Wins this week* total and an *Arenas led* count (how many arenas you currently top), plus a per-arena *This week* column showing your weekly wins and rank (🏆 for #1). Departed arenas are skipped — you're not competing there this week.

## Project structure

```text
src/
  app/
    page.js            Server Component — the public arena directory
    arena/[id]/page.js Server Component — reads one arena's state, renders it
    arena.js           Client UI (rack, courts, modals, my-stats, badges)
    arena-members.js   Client UI — members tab (roles, join/leave, pending requests, owner controls)
    actions.js         Server Actions — every mutation (role-gated) + rotation algorithm
    create-arena-form.js  Client form for creating an arena
    auth-status.js     Header sign-in / sign-out control + profile link
    profile/           Per-user stats & match history across all arenas
    login/             Sign-in page
    register/          Sign-up page
    api/auth/          Better Auth catch-all route handler
  lib/
    prisma.js      Prisma 7 client (node-postgres driver adapter)
    data.js        getState(arenaId) — the shape the UI consumes
    arenas.js      directory + member/join-request reads, getUserPlayerStats()
    user-profile.js  normalizeUserProfile() — server-side signup validation
    roles.js       Role constants (OWNER/ORGANIZER/MEMBER) + helpers
    matchmaking.js Shared thresholds/weights
    rating.js      Elo skill-rating math + DUPR-style display mapping
    leaderboard.js Pure weekly-leaderboard ranking + schedule week-window math (client-safe)
    leaderboard-server.js  DB-backed getWeeklyLeaderboard() reader
    auth.js        Better Auth server instance
    auth-client.js Better Auth browser client
    session.js     getCurrentUser() / requireUser() / requireArenaOwner() / requireArenaManager()
prisma/            schema, migrations
```

## Deployment

- Set `DATABASE_URL` in the host environment.
- **On Vercel:** migrations run automatically. Vercel uses the `vercel-build`
  script (`prisma generate && prisma migrate deploy && next build`) when present,
  so each deploy applies pending migrations against the deploy's `DATABASE_URL`.
- **Elsewhere / manually:** run `pnpm db:deploy` (`prisma migrate deploy`) as a
  release step, then `pnpm build`.
- The plain `pnpm build` deliberately omits `migrate deploy` so local and CI
  builds don't require a database.
- The generated client lives in `src/generated/prisma` (gitignored) and is
  recreated at build time via `prisma generate`.

> **Heads up:** if Vercel preview deployments share the production `DATABASE_URL`,
> they will also run `migrate deploy`. Use a separate preview/staging database to
> avoid previews migrating production.

## Security note

Every mutating Server Action in `src/app/actions.js` is role-gated: play actions and join-request decisions (`approveJoinRequest` / `rejectJoinRequest`) require `requireArenaManager` (owner or organizer), owner-only actions (`renameArena`, `updateMemberRole`, `removeMember`, `transferOwnership`, `linkPlayerToMember`) require `requireArenaOwner`, and both verify the session against `ArenaMembership` / `Arena.ownerId`. `createArena`, `requestToJoin`, and `leaveArena` only require a signed-in account.
