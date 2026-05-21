-- Link Player to a User account (Phase 4). `userId` is nullable: it stays
-- NULL for temporary walk-in players who have no account. Data-preserving —
-- a nullable ADD COLUMN; existing players simply become temp players.

-- AlterTable
ALTER TABLE "Player" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "Player_userId_idx" ON "Player"("userId");

-- CreateIndex: one linked player per user per arena (Postgres allows
-- multiple NULLs, so multiple temp players per arena still work).
CREATE UNIQUE INDEX "Player_arenaId_userId_key" ON "Player"("arenaId", "userId");

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
