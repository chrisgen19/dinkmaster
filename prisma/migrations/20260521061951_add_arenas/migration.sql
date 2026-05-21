-- Phase 2: introduce Arena and scope all arena data under it.
-- This migration is hand-edited (from `prisma migrate dev --create-only`) to
-- backfill existing players/courts/matches/partnerships under one default
-- arena owned by the oldest registered user, so the new `arenaId` columns can
-- be made NOT NULL without data loss.

-- 1. Arena table -----------------------------------------------------------
CREATE TABLE "Arena" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Arena_pkey" PRIMARY KEY ("id")
);

-- 2. Add arenaId columns as NULLABLE so the backfill can populate them ------
ALTER TABLE "Player" ADD COLUMN "arenaId" TEXT;
ALTER TABLE "Court" ADD COLUMN "arenaId" TEXT;
ALTER TABLE "Match" ADD COLUMN "arenaId" TEXT;
ALTER TABLE "Partnership" ADD COLUMN "arenaId" TEXT;

-- 3. Backfill: create one default arena owned by the OLDEST user, but only
--    when there is existing arena data to migrate. On a fresh database this
--    inserts nothing and the NOT NULL step below runs against empty tables.
INSERT INTO "Arena" ("id", "name", "ownerId", "createdAt")
SELECT
    'arena_legacy_default',
    COALESCE(NULLIF(u."name", ''), 'Main') || '''s Arena',
    u."id",
    CURRENT_TIMESTAMP
FROM "User" u
WHERE EXISTS (SELECT 1 FROM "Player")
   OR EXISTS (SELECT 1 FROM "Court")
   OR EXISTS (SELECT 1 FROM "Match")
ORDER BY u."createdAt" ASC
LIMIT 1;

-- Guard: if legacy data exists but no default arena could be created (because
-- there are no User rows to own it), fail now with a clear, actionable message
-- instead of a generic foreign-key violation further down.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Arena" WHERE "id" = 'arena_legacy_default')
     AND (
       EXISTS (SELECT 1 FROM "Player")
       OR EXISTS (SELECT 1 FROM "Court")
       OR EXISTS (SELECT 1 FROM "Match")
     )
  THEN
    RAISE EXCEPTION 'add_arenas migration: existing players/courts/matches need an owning arena, but no User account exists to own it. Register at least one account, then re-run the migration.';
  END IF;
END $$;

UPDATE "Player" SET "arenaId" = 'arena_legacy_default' WHERE "arenaId" IS NULL;
UPDATE "Court" SET "arenaId" = 'arena_legacy_default' WHERE "arenaId" IS NULL;
UPDATE "Match" SET "arenaId" = 'arena_legacy_default' WHERE "arenaId" IS NULL;
UPDATE "Partnership" SET "arenaId" = 'arena_legacy_default' WHERE "arenaId" IS NULL;

-- 4. Enforce NOT NULL now that every row is scoped -------------------------
ALTER TABLE "Player" ALTER COLUMN "arenaId" SET NOT NULL;
ALTER TABLE "Court" ALTER COLUMN "arenaId" SET NOT NULL;
ALTER TABLE "Match" ALTER COLUMN "arenaId" SET NOT NULL;
ALTER TABLE "Partnership" ALTER COLUMN "arenaId" SET NOT NULL;

-- 5. Indexes ---------------------------------------------------------------
CREATE INDEX "Arena_ownerId_idx" ON "Arena"("ownerId");
CREATE INDEX "Player_arenaId_idx" ON "Player"("arenaId");
CREATE INDEX "Court_arenaId_idx" ON "Court"("arenaId");
CREATE INDEX "Match_arenaId_idx" ON "Match"("arenaId");
CREATE INDEX "Partnership_arenaId_idx" ON "Partnership"("arenaId");

-- 6. Foreign keys ----------------------------------------------------------
ALTER TABLE "Arena" ADD CONSTRAINT "Arena_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Player" ADD CONSTRAINT "Player_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Court" ADD CONSTRAINT "Court_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
