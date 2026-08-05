-- Activities: materialize the recurring schedule into first-class rows.
--
-- Before this migration a "session" had no identity. `src/lib/sessions.js`
-- recomputed `{start, end}` windows from the clock on every render, and the only
-- persisted trace of a boundary was one overwritten scalar,
-- `Arena.lastSessionResetAt`. That made per-session records computable ONLY for
-- the session you were currently in, left attendance unrecorded entirely, and
-- destroyed the partnership matrix on every reset.
--
-- An Activity is one of those computed windows, persisted, so it can own the
-- records a recomputed window never could.
--
-- This file is hand-written (not `prisma migrate dev` output) because it carries
-- a backfill: `Partnership.activityId` is REQUIRED, so every existing row must be
-- assigned before the NOT NULL constraint lands.
--
-- Timestamp note: Prisma maps DateTime to `timestamp(3) without time zone`, i.e.
-- UTC wall-clock. Converting to an arena's local day is therefore a two-hop
-- round trip: `(ts AT TIME ZONE 'UTC') AT TIME ZONE tz` to read local, and
-- `(local AT TIME ZONE tz) AT TIME ZONE 'UTC'` to write back.

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ActivitySource" AS ENUM ('SCHEDULE', 'MANUAL');
CREATE TYPE "AttendeeStatus" AS ENUM ('GOING', 'WAITLIST', 'DECLINED', 'CHECKED_IN', 'NO_SHOW');

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "title" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'SCHEDULED',
    "source" "ActivitySource" NOT NULL DEFAULT 'SCHEDULE',
    "capacity" INTEGER,
    "notes" TEXT,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityAttendee" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "playerId" TEXT,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "status" "AttendeeStatus" NOT NULL DEFAULT 'GOING',
    "position" INTEGER,
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityAttendee_pkey" PRIMARY KEY ("id")
);

-- AlterTable: nullable for now on both, so the backfill below has something to
-- write into. Partnership is tightened to NOT NULL after the backfill; Match
-- stays nullable forever (an arena with no schedule can finish a match with no
-- activity open, and the historical backfill is best-effort).
ALTER TABLE "Match" ADD COLUMN "activityId" TEXT;
ALTER TABLE "Partnership" ADD COLUMN "activityId" TEXT;

-- CreateIndex
CREATE INDEX "Activity_arenaId_status_idx" ON "Activity"("arenaId", "status");
CREATE INDEX "Activity_arenaId_startsAt_idx" ON "Activity"("arenaId", "startsAt");
CREATE INDEX "ActivityAttendee_activityId_status_idx" ON "ActivityAttendee"("activityId", "status");

-- ---------------------------------------------------------------------------
-- BACKFILL
-- ---------------------------------------------------------------------------

-- Every arena gets exactly one LIVE activity representing the session it is
-- currently in, so `startActivity` always has something to close.
--
-- Its start is the current session boundary, resolved in the same priority order
-- the app used before Activities existed:
--   1. `lastSessionResetAt` — the manager explicitly opened this session
--   2. local midnight of the most recent day that has a match — a never-reset
--      arena's "today", which is what `computeSessionStats(matches, null)`
--      effectively showed
--   3. the arena's own createdAt — a brand new or empty arena
CREATE TEMP TABLE _live_activity AS
SELECT
    gen_random_uuid()::text AS id,
    a.id AS arena_id,
    a.timezone AS tz,
    COALESCE(
        a."lastSessionResetAt",
        (
            SELECT (date_trunc('day', (m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE a.timezone)
                    AT TIME ZONE a.timezone) AT TIME ZONE 'UTC'
            FROM "Match" m
            WHERE m."arenaId" = a.id
            ORDER BY m."createdAt" DESC
            LIMIT 1
        ),
        a."createdAt"
    ) AS starts_at
FROM "Arena" a;

INSERT INTO "Activity" ("id", "arenaId", "startsAt", "endsAt", "timezone", "status", "source", "openedAt", "createdAt")
SELECT
    l.id,
    l.arena_id,
    l.starts_at,
    -- A 12h window is a placeholder, not a claim about when play ends. Activities
    -- created from here on get exact bounds from `sessionWindow()`.
    l.starts_at + INTERVAL '12 hours',
    l.tz,
    'LIVE',
    -- MANUAL, not SCHEDULE: these bounds were not derived from the schedule rule,
    -- so the materializer must never treat them as one of its own rows.
    'MANUAL',
    l.starts_at,
    CURRENT_TIMESTAMP
FROM _live_activity l;

-- Historical activities: one per (arena, local calendar day) that has matches
-- finished strictly BEFORE the current session boundary. Grouping by local day
-- rather than by the schedule rule keeps the backfill honest — it reflects when
-- people actually played, not when they were supposed to.
CREATE TEMP TABLE _past_activity AS
SELECT
    gen_random_uuid()::text AS id,
    m."arenaId" AS arena_id,
    a.timezone AS tz,
    date_trunc('day', (m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE a.timezone) AS local_day
FROM "Match" m
JOIN "Arena" a ON a.id = m."arenaId"
JOIN _live_activity l ON l.arena_id = m."arenaId"
WHERE m."createdAt" < l.starts_at
GROUP BY m."arenaId", a.timezone, date_trunc('day', (m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE a.timezone);

INSERT INTO "Activity" ("id", "arenaId", "startsAt", "endsAt", "timezone", "status", "source", "openedAt", "closedAt", "createdAt")
SELECT
    p.id,
    p.arena_id,
    (p.local_day AT TIME ZONE p.tz) AT TIME ZONE 'UTC',
    ((p.local_day + INTERVAL '1 day') AT TIME ZONE p.tz) AT TIME ZONE 'UTC',
    p.tz,
    'COMPLETED',
    'MANUAL',
    (p.local_day AT TIME ZONE p.tz) AT TIME ZONE 'UTC',
    ((p.local_day + INTERVAL '1 day') AT TIME ZONE p.tz) AT TIME ZONE 'UTC',
    CURRENT_TIMESTAMP
FROM _past_activity p;

-- Stamp historical matches onto their day's activity.
UPDATE "Match" m
SET "activityId" = p.id
FROM _past_activity p, "Arena" a
WHERE a.id = m."arenaId"
  AND p.arena_id = m."arenaId"
  AND p.local_day = date_trunc('day', (m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE a.timezone);

-- Everything at or after the boundary belongs to the session still in progress.
UPDATE "Match" m
SET "activityId" = l.id
FROM _live_activity l
WHERE l.arena_id = m."arenaId"
  AND m."activityId" IS NULL;

-- Existing partnership rows are ALWAYS current-session by construction — the old
-- `prepareNextSession` wiped them on every boundary — so they all belong to the
-- LIVE activity.
UPDATE "Partnership" pt
SET "activityId" = l.id
FROM _live_activity l
WHERE l.arena_id = pt."arenaId";

-- Defensive: an orphan partnership whose arena vanished can't be assigned, and
-- would block the NOT NULL below.
DELETE FROM "Partnership" WHERE "activityId" IS NULL;

DROP TABLE _live_activity;
DROP TABLE _past_activity;

-- ---------------------------------------------------------------------------
-- CONSTRAINTS (after the backfill, so they can be enforced immediately)
-- ---------------------------------------------------------------------------

ALTER TABLE "Partnership" ALTER COLUMN "activityId" SET NOT NULL;

-- The pair uniqueness moves from arena-wide to activity-scoped. This is what
-- lets a new activity start with a clean matrix without deleting anything.
DROP INDEX "Partnership_playerA_playerB_key";
CREATE UNIQUE INDEX "Partnership_activityId_playerA_playerB_key" ON "Partnership"("activityId", "playerA", "playerB");
CREATE INDEX "Partnership_activityId_idx" ON "Partnership"("activityId");

CREATE UNIQUE INDEX "Activity_arenaId_startsAt_key" ON "Activity"("arenaId", "startsAt");
CREATE UNIQUE INDEX "ActivityAttendee_activityId_playerId_key" ON "ActivityAttendee"("activityId", "playerId");
CREATE UNIQUE INDEX "ActivityAttendee_activityId_userId_key" ON "ActivityAttendee"("activityId", "userId");

-- Serves every `where: { arenaId, createdAt: {gte, lt} }` read (session windows,
-- the weekly leaderboard, activity ranges). The pre-existing single-column
-- indexes can't cover that as well.
CREATE INDEX "Match_arenaId_createdAt_idx" ON "Match"("arenaId", "createdAt");
CREATE INDEX "Match_activityId_idx" ON "Match"("activityId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityAttendee" ADD CONSTRAINT "ActivityAttendee_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull, not Cascade: deleting an activity must never destroy match history.
ALTER TABLE "Match" ADD CONSTRAINT "Match_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Cascade: the matrix belongs to the activity and is meaningless without it.
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- REALTIME
-- ---------------------------------------------------------------------------
-- Both new tables feed the arena view, so open SSE viewers must be notified.
-- Activity carries `arenaId` directly and can reuse the shared function from
-- `20260606120000_add_realtime_notify_triggers`; ActivityAttendee resolves it
-- through its Activity, mirroring `notify_court_slot_change()`.

CREATE OR REPLACE FUNCTION notify_activity_attendee_change() RETURNS trigger AS $$
DECLARE
  aid text;
BEGIN
  SELECT "arenaId" INTO aid
  FROM "Activity"
  WHERE id = COALESCE(NEW."activityId", OLD."activityId");
  IF aid IS NOT NULL THEN
    PERFORM pg_notify('arena_events', aid);
  END IF;
  RETURN NULL; -- AFTER trigger: return value is ignored.
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER activity_notify_arena
AFTER INSERT OR UPDATE OR DELETE ON "Activity"
FOR EACH ROW EXECUTE FUNCTION notify_arena_change();

CREATE TRIGGER activity_attendee_notify_arena
AFTER INSERT OR UPDATE OR DELETE ON "ActivityAttendee"
FOR EACH ROW EXECUTE FUNCTION notify_activity_attendee_change();
