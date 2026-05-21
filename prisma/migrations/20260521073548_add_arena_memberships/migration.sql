-- CreateTable
CREATE TABLE "ArenaMembership" (
    "id" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArenaMembership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArenaMembership_arenaId_idx" ON "ArenaMembership"("arenaId");

-- CreateIndex
CREATE INDEX "ArenaMembership_userId_idx" ON "ArenaMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ArenaMembership_arenaId_userId_key" ON "ArenaMembership"("arenaId", "userId");

-- AddForeignKey
ALTER TABLE "ArenaMembership" ADD CONSTRAINT "ArenaMembership_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaMembership" ADD CONSTRAINT "ArenaMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing arena's owner becomes an OWNER member, so the
-- members list and role checks are uniform across owner and non-owner rows.
INSERT INTO "ArenaMembership" ("id", "arenaId", "userId", "role", "createdAt")
SELECT 'mem_owner_' || a."id", a."id", a."ownerId", 'OWNER', CURRENT_TIMESTAMP
FROM "Arena" a;
