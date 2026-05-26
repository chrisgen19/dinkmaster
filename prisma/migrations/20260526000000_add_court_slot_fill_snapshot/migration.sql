-- Arena cancel-fill — snapshot rack state on each court slot.
--
-- Adds two nullable columns to `CourtSlot`:
--   - `prevQueueOrder` — the player's `queueOrder` immediately before being
--     stacked onto the court (fillCourt nulls the live value, so the original
--     is otherwise lost).
--   - `prevWaitRounds` — the player's `waitRounds` immediately before the fill
--     (fillCourt resets the live value to 0).
--
-- Together these let `cancelFill` restore a player to their exact pre-fill
-- rack position and wait fairness. Both are nullable: slots created before
-- this migration carry NULL and simply aren't cancellable.
--
-- Idempotency: `IF NOT EXISTS` makes the ADD COLUMN safe to re-run.
ALTER TABLE "CourtSlot"
  ADD COLUMN IF NOT EXISTS "prevQueueOrder" INTEGER,
  ADD COLUMN IF NOT EXISTS "prevWaitRounds" INTEGER;

-- `fillBumpedPlayerIds` on `Court` records exactly which players the current
-- fill bumped (+1 waitRounds), so cancelFill reverses the bump for only those
-- players — never someone recycled into the queue by a finish on another court
-- after the fill. Empty array for vacant courts / pre-feature fills.
ALTER TABLE "Court"
  ADD COLUMN IF NOT EXISTS "fillBumpedPlayerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
