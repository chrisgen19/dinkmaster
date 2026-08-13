-- Win-by margin — per-arena control over whether a game needs a two-point
-- margin or ends the moment someone reaches the target.
--
-- Adds:
--   - `Arena.winBy` (int) — 2 keeps standard pickleball (deuce runs until
--     someone leads by two); 1 is sudden death, where reaching the target
--     wins outright and 11-10 is a legal final. Time-boxed leagues and
--     social round robins run win-by-1 so game length is bounded.
--   - `Match.winBy` (int, nullable) — the margin rule THIS match was played
--     under, mirroring the existing `Match.targetScore` provenance column so
--     a historical correction is judged by the rules in force at the time.
--
-- `Arena.winBy` defaults to 2, which Postgres also backfills onto every
-- EXISTING row: standard pickleball stays the behaviour for all current
-- arenas, and win-by-1 is strictly opt-in from Settings → Match Defaults.
-- This follows the `autoResetOnSession` precedent (opt-in), NOT the
-- `balancedPairing` one (opt-out) — no arena's scoring rules change on deploy.
--
-- `Match.winBy` is NULLABLE with no backfill, for the same reason
-- `Match.targetScore` is (see 20260812090000_add_match_provenance): a null
-- means "unknown, recorded before this column existed", never a real value,
-- and every reader falls back to the arena setting rather than assuming. A
-- blanket backfill to 2 would be a lie for any arena that later turns
-- sudden death on, so the ambiguity is left visible instead.
--
-- Idempotent: `IF NOT EXISTS` so a re-apply on a partially-skewed DB is safe,
-- and there is no UPDATE, so a re-run can't clobber a manager's chosen value.
ALTER TABLE "Arena"
  ADD COLUMN IF NOT EXISTS "winBy" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "Match"
  ADD COLUMN IF NOT EXISTS "winBy" INTEGER;
