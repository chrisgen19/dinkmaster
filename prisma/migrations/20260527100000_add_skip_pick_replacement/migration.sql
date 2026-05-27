-- Skip-pick-replacement — manager-only picker for who fills a freed
-- on-deck slot when a paddle is skipped.
--
-- Adds:
--   - `Arena.skipPickReplacement` (boolean) — when on, manager Skip opens
--     a picker modal listing waiting paddles and the chosen one fills the
--     freed on-deck slot. When off, the first waiting paddle auto-fills
--     (the prior behavior). Default `true` so existing arenas opt in (the
--     manager flow gains a step, but they can disable it from Settings →
--     Matchmaking if they prefer the old auto-pick flow).
--
-- Idempotent: `IF NOT EXISTS` so a re-apply on a partially-skewed DB is safe.
ALTER TABLE "Arena"
  ADD COLUMN IF NOT EXISTS "skipPickReplacement" BOOLEAN NOT NULL DEFAULT true;
