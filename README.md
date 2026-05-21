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
   BETTER_AUTH_URL="http://localhost:3000"
   ```

3. Apply migrations:

   ```bash
   pnpm prisma migrate deploy        # apply schema
   ```

4. Run the dev server:

   ```bash
   pnpm dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

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

## Data model

Defined in [`prisma/schema.prisma`](prisma/schema.prisma):

- **Player** — `name`, `gamesPlayed`, `wins`, `losses`, `queueOrder` (null when not in the rack), `waitRounds`, `gamesOffset` (games credited at join so late joiners rotate as peers, not catch-up).
- **Court** + **CourtSlot** — a court's live status and the four players assigned to it (a player can be on at most one court — DB-enforced).
- **Match** + **MatchPlayer** — finished-match history with snapshotted player names.
- **Partnership** — canonical pair counts powering the matchup optimiser.
- **User** / **Session** / **Account** / **Verification** — Better Auth tables. Viewing the arena is public; managing it (registering players, running matches) requires a signed-in account.

## Authentication

Email + password auth via [Better Auth](https://www.better-auth.com), backed by the same PostgreSQL database through the Prisma adapter.

- **Sign up** at `/register`, **sign in** at `/login`; the header shows the current user with a sign-out control.
- **Viewing the arena is public.** Every mutating Server Action (`addPlayers`, `removePlayer`, `shuffleQueue`, `fillCourt`, `endMatch`, `addCourt`, `removeCourt`, `resetArena`) is gated behind a session via `requireUser()` — unauthenticated callers get a "please sign in" notice instead of a mutation.
- Sessions are cookie-backed; config lives in `src/lib/auth.js`, the browser client in `src/lib/auth-client.js`, and the catch-all API handler at `src/app/api/auth/[...all]/route.js`.
- Requires `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` in `.env` (see `.env.example`).

## Roadmap

DINKMASTER is being built toward a **multi-tenant, multi-arena** system in phases.

| Phase | Scope | Status |
|-------|-------|--------|
| **1 — Auth foundation** | Better Auth user accounts; login/register pages; header sign-in/out; all arena mutations session-gated; arena view stays public. Destructive SQL seed removed. | ✅ Done |
| **2 — Arenas** | `Arena` model + `arenaId` scoping on Player/Court/Match; each account owns its arena(s) (migration backfills existing data under an owner). | ⏳ Planned |
| **3 — Membership & roles** | `ArenaMembership` with **Owner / Organizer / Member** roles; public arena browse + join; permissions per role. | ⏳ Planned |
| **4 — Player ↔ User linking** | Link a registered Player to a User account; per-user match-history and score views so people see their own stats. | ⏳ Planned |

Phase tracking and detailed scope live in the GitHub issues.

## Project structure

```text
src/
  app/
    page.js        Server Component — reads state, renders the arena
    arena.js       Client UI (rack, courts, modals, badges)
    actions.js     Server Actions — every mutation (session-gated) + rotation algorithm
    auth-status.js Header sign-in / sign-out control
    login/         Sign-in page
    register/      Sign-up page
    api/auth/      Better Auth catch-all route handler
  lib/
    prisma.js      Prisma 7 client (node-postgres driver adapter)
    data.js        getState() — the shape the UI consumes
    matchmaking.js Shared thresholds/weights
    auth.js        Better Auth server instance
    auth-client.js Better Auth browser client
    session.js     getCurrentUser() / requireUser() helpers
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

As of Phase 1, every Server Action in `src/app/actions.js` (`resetArena`, `removePlayer`, `fillCourt`, etc.) is gated behind a Better Auth session via `requireUser()` — any signed-in user can manage the single shared arena. Per-arena ownership and role-based authorization arrive in Phases 2–3; until then, treat all authenticated users as trusted operators.
