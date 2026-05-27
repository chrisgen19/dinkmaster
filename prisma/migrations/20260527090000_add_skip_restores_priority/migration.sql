-- Skip-restores-priority — Arena setting + per-Player boost flag.
--
-- Adds:
--   - `Arena.skipRestoresPriority` (boolean) — when on, Skip stamps the paddle
--     with a "Next in Line" boost (above emergency band) and pushes them just
--     past on-deck, instead of sending them to the back with `waitRounds = 0`.
--     Schema declares `@default(true)`, and we want existing arenas to opt in
--     by default (the user's choice — "default is On"), so the simple
--     `DEFAULT true` is used here (no temp-default trick).
--   - `Player.skipBoosted` (boolean) — set by `skipPlayer` when the arena
--     setting is on; the next auto-mix uses it to sort the paddle into the
--     new top band, then clears it.
--
-- Idempotent: `IF NOT EXISTS` so a re-apply on a partially-skewed DB is safe.
ALTER TABLE "Arena"
  ADD COLUMN IF NOT EXISTS "skipRestoresPriority" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Player"
  ADD COLUMN IF NOT EXISTS "skipBoosted" BOOLEAN NOT NULL DEFAULT false;
