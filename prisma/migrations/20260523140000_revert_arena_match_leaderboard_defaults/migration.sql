-- Reverts the columns added by 20260523125032_add_arena_match_leaderboard_defaults
-- (Phase 9b) — see PR #39, which backs out PR #38 so Phase 9b can be reopened
-- for proper review. The original migration file is intentionally kept in tree
-- so `_prisma_migrations` (which records it as applied on any DB that ran it,
-- including Vercel preview/prod deploys triggered by #38) does not drift from
-- the on-disk migrations directory.
--
-- IF EXISTS makes this idempotent: safe on DBs that applied #38 (drops the
-- columns) and a no-op on fresh DBs that don't have them yet (running both
-- migrations in sequence is wasteful but correct — adds then drops, net zero).
--
-- When Phase 9b is reopened it must ship a NEW migration filename — re-using
-- `20260523125032_…` would be marked "already applied" on every DB whose
-- `_prisma_migrations` row from #38 still exists, and the columns would
-- silently fail to come back.
ALTER TABLE "Arena"
  DROP COLUMN IF EXISTS "targetScore",
  DROP COLUMN IF EXISTS "autoMixDefault",
  DROP COLUMN IF EXISTS "leaderboardSize",
  DROP COLUMN IF EXISTS "countOffScheduleGames";
