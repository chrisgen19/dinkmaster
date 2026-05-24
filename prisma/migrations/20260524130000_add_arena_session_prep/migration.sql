-- Phase 10a — session prep state on Arena.
--
-- Adds:
--   - `lastSessionResetAt` (nullable timestamp) — when the rack/partnerships
--     were last cleared via `prepareNextSession`. Null for arenas that
--     pre-date this feature and have never been session-reset.
--   - `autoResetOnSession` (boolean) — whether the session boundary should
--     auto-empty the rack. Schema declares `@default(true)`, but this
--     migration backfills EXISTING rows to `false` by adding the column
--     with a TEMPORARY default of `false`, then switching the column
--     default to `true` for any rows inserted AFTER this migration. Net
--     effect: existing arenas opt-in (perpetual-rack behaviour preserved
--     until a manager flips the setting on), new arenas opt-in by default.
--
-- Idempotency: `IF NOT EXISTS` on ADD COLUMN and `SET DEFAULT` on ALTER
-- make every statement safe to re-run on a partially-skewed DB. No UPDATE
-- statement, so a re-apply can't clobber user-toggled state.
ALTER TABLE "Arena"
  ADD COLUMN IF NOT EXISTS "lastSessionResetAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "autoResetOnSession" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Arena" ALTER COLUMN "autoResetOnSession" SET DEFAULT true;
