# DINKMASTER

Smart pickleball **paddle-stacking & partnership-mixing arena**. Register players, stack them onto courts, record scores, and let the app handle fair, varied rotations automatically. Players, the paddle-rack queue, courts, match history, and the partnership matrix are all persisted in **PostgreSQL** via **Prisma 7** (Next.js App Router + Server Actions for every mutation).

## Features

- **Paddle rack queue** — register players (comma-separated), see who's waiting and who's **on deck** (the next four to be stacked).
- **Courts** — add/remove courts; stack the top four onto any vacant court; record a final score to finish a match.
- **Smart matchups** — when a court is filled, teams are chosen to minimise repeated partnerships (the **partnership matrix** tracks how often any two players have paired).
- **Auto-mix the rack** — after each finish the rack reshuffles so the same four don't lock together, balanced by a fairness algorithm (below).
- **Waiting badge** — a `⏳ N` badge appears on players who've waited ≥ 2 rounds (amber), turning red at ≥ 4, so you can see who's overdue.
- **Match log & stats** — full history of finished matches (with snapshotted names that survive player deletion) plus per-player games/wins/losses.

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

- **Arena** — an isolated session owned by a `User`. Players, courts, matches, and partnerships are all scoped by `arenaId`.
- **Player** — a rack entry: `firstName`/`lastName`, `gamesPlayed`, `wins`, `losses`, `queueOrder` (null when not in the rack), `waitRounds`, `gamesOffset` (games credited at join so late joiners rotate as peers, not catch-up). `userId` links the player to a registered account; it is null for temporary walk-in players. `leftAt` marks a departed member: the row (stats + history) is kept but excluded from the active rack, and a rejoin reactivates it.
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
| **6 — Skill rating** | A computed Elo/DUPR-style rating that moves per match, surfaced in the stats views. | ⏳ Planned |

### Planned phases — detail

**Phase 6 — Skill rating**

- A computed **skill rating** per player (Elo/DUPR-style), updated at the end of each match from the result and the opponents' ratings.
- Surfaced in the per-arena **My Stats** tab and the global **/profile** page, both of which already render a "Rating" placeholder slot reserved for this phase.

Phase tracking and detailed scope live in the GitHub issues.

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
