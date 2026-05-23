-- Phase 9b (v2): re-adds the four columns originally introduced by
-- 20260523125032_add_arena_match_leaderboard_defaults and dropped by
-- 20260523140000_revert_arena_match_leaderboard_defaults after PR #38 was
-- merged without review and rolled back (see PR #39).
--
-- A fresh migration filename is required: re-using the original
-- 20260523125032_… would be flagged "already applied" by _prisma_migrations
-- on any environment that ran #38, so its ADD COLUMN statements would never
-- execute and the columns would silently fail to come back. With this new
-- name every environment sees a pending migration and applies it cleanly.
--
-- Defaults match the prior hardcoded behaviour, so existing arenas play
-- exactly as before until a manager edits them in Arena Settings.
--
-- IF NOT EXISTS on each ADD COLUMN makes this idempotent: it's a no-op on
-- any DB that still has the columns from the rolled-back #38 (e.g. a deploy
-- where 20260523140000_revert_arena_match_leaderboard_defaults did not run
-- for some reason). Without it the migration would fail with "column already
-- exists" on that skew.
ALTER TABLE "Arena"
  ADD COLUMN IF NOT EXISTS "autoMixDefault" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "countOffScheduleGames" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "leaderboardSize" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "targetScore" INTEGER NOT NULL DEFAULT 11;
