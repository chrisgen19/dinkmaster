-- Per-arena Activity settings, backing the Settings → Activities section.
--
-- All three are additive with defaults that preserve current behaviour:
-- every existing arena keeps RSVP available, uncapped activities, and the
-- 28-day materialization horizon `ensureUpcomingActivities` already used as
-- its hardcoded default.
--
-- IF NOT EXISTS so the migration is re-runnable, matching the precedent in
-- 20260524130000_add_arena_session_prep.

ALTER TABLE "Arena" ADD COLUMN IF NOT EXISTS "rsvpEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Arena" ADD COLUMN IF NOT EXISTS "defaultActivityCapacity" INTEGER;
ALTER TABLE "Arena" ADD COLUMN IF NOT EXISTS "activityHorizonDays" INTEGER NOT NULL DEFAULT 28;
