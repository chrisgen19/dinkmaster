-- Balanced pairing — per-arena control over how `fillCourt` splits the four
-- paddles it stacks.
--
-- Adds:
--   - `Arena.balancedPairing` (boolean) — when on, each recent LOSER is paired
--     with a recent WINNER, ties broken by the closer-rated split and then by
--     fewest repeat partnerships. When off, the arena keeps the legacy rule
--     (fewest repeat partnerships only, random tie-break, no skill input).
--
-- Default `true`, which Postgres also backfills onto every EXISTING row: the
-- balanced rule becomes the product default for all arenas, and any manager
-- who prefers the old rotation can switch it off from Settings → Matchmaking.
-- This follows the `skipPickReplacement` precedent (opt-out), NOT the
-- `autoResetOnSession` one (opt-in) — a deliberate product call, since the
-- balanced rule is the behaviour we want new and existing clubs to get.
--
-- Idempotent: `IF NOT EXISTS` so a re-apply on a partially-skewed DB is safe,
-- and there is no UPDATE, so a re-run can't clobber a manager's chosen value.
ALTER TABLE "Arena"
  ADD COLUMN IF NOT EXISTS "balancedPairing" BOOLEAN NOT NULL DEFAULT true;
