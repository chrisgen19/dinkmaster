-- Match provenance — what a finished match needs to remember about itself so a
-- later correction can be judged and, eventually, reversed.
--
-- Adds:
--   - `Match.ratingDelta` (int) — the Elo points team 1 gained (negative if
--     they lost). `computeMatchRatings` is zero-sum with a fixed K, so team 2
--     moved by exactly the negative and one integer captures the match's
--     entire rating effect. A correction that flips the winner can then
--     reverse the match exactly instead of guessing.
--   - `Match.targetScore` (int) — the arena's target WHEN THIS MATCH WAS
--     PLAYED. The arena target is editable, and a historical correction has to
--     be validated against the rules the game was actually played under, not
--     today's.
--   - `Match.editedAt` (timestamp) — set when a manager corrects the score.
--
-- ALL THREE ARE NULLABLE ON PURPOSE, and there is deliberately no backfill.
-- Every existing row predates the writes, and none of the three can be
-- reconstructed after the fact: the pre-match ratings a delta would need are
-- long overwritten, the arena's target may have changed since, and whether an
-- old row was ever edited was never recorded. A null therefore means
-- "unknown", never a real value, and each reader falls back explicitly rather
-- than treating null as a default.
--
-- Nothing reads these columns yet — this migration is pure groundwork and
-- changes no behaviour.
--
-- Idempotent: `IF NOT EXISTS` so a re-apply on a partially-migrated database
-- is safe, and there is no UPDATE, so a re-run cannot clobber a written value.
ALTER TABLE "Match"
  ADD COLUMN IF NOT EXISTS "ratingDelta" INTEGER,
  ADD COLUMN IF NOT EXISTS "targetScore" INTEGER,
  ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
