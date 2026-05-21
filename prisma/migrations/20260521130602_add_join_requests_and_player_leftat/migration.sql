-- Phase 5: join approval + history retention.
-- Both changes are data-preserving: a nullable ADD COLUMN and a new table.

-- Player.leftAt: null = active member; set = left/removed (row kept for history).
ALTER TABLE "Player" ADD COLUMN "leftAt" TIMESTAMP(3);

-- JoinRequest: a row's existence = a pending request to join an arena.
CREATE TABLE "JoinRequest" (
    "id" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JoinRequest_arenaId_idx" ON "JoinRequest"("arenaId");
CREATE INDEX "JoinRequest_userId_idx" ON "JoinRequest"("userId");
CREATE UNIQUE INDEX "JoinRequest_arenaId_userId_key" ON "JoinRequest"("arenaId", "userId");

ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
