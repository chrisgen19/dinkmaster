# DINKMASTER

Smart pickleball paddle-stacking & partnership-mixing arena. Players, the paddle-rack queue, courts, match history, and the partnership matrix are all persisted in **PostgreSQL** via **Prisma 7** (Server Actions for all mutations).

## Requirements

- **Node.js ≥ 20.19** (enforced via `engines`; Prisma 7 / `@prisma/dev` require it — older 20.x minors fail `prisma generate` with `ERR_REQUIRE_ESM`).
- **PostgreSQL** (local or hosted).
- **pnpm** (project package manager).

## Setup

1. Install dependencies (runs `prisma generate` via `postinstall`):

   ```bash
   pnpm install
   ```

2. Configure the database connection in `.env` (gitignored):

   ```bash
   DATABASE_URL="postgres://USER:PASSWORD@localhost:5432/dinkmaster"
   ```

3. Apply migrations and seed the starter roster:

   ```bash
   pnpm prisma migrate deploy   # apply schema
   set -a; . ./.env; pnpm db:seed   # load default players/courts/partnerships
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
| `pnpm build` | `prisma generate` + production build |
| `pnpm db:migrate` | Create/apply a dev migration (`prisma migrate dev`) |
| `pnpm db:push` | Push schema without a migration |
| `pnpm db:seed` | Seed default data from `prisma/seed.sql` (needs `DATABASE_URL` in env) |
| `pnpm db:studio` | Open Prisma Studio |

## Deployment

- Set `DATABASE_URL` in the host environment.
- `pnpm build` runs `prisma generate`; run `pnpm prisma migrate deploy` against the production database as part of the release step.
- On Vercel, the generated client lives in `src/generated/prisma` (gitignored) and is recreated at build time.

## Security note

The Server Actions in `src/app/actions.js` (`resetArena`, `removePlayer`, `fillCourt`, etc.) are **unauthenticated** — they assume a trusted, single-operator local/club deployment. Add authentication/authorization before exposing this app publicly.
