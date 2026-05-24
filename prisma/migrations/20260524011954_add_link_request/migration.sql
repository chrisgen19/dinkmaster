-- Phase 10a: move account linking into the Members tab.
-- A LinkRequest row's existence = a pending request from a member to be
-- linked to an existing walk-in (orphan) Player in that arena. Resolved
-- by deleting the row on approve (after `linkPlayerToMember` runs),
-- reject, or cancel by the requester. Cascade on FK so cleanup is
-- automatic when the arena, user, or player is deleted.
--
-- The (arenaId, playerId) FK is composite, referencing Player(arenaId, id),
-- so Postgres rejects any LinkRequest whose player belongs to a different
-- arena than the request itself. The unique index on Player(arenaId, id)
-- exists solely to make that composite reference valid (Player.id is
-- already unique on its own).

CREATE UNIQUE INDEX "Player_arenaId_id_key" ON "Player"("arenaId", "id");

CREATE TABLE "LinkRequest" (
    "id" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LinkRequest_arenaId_idx" ON "LinkRequest"("arenaId");
CREATE UNIQUE INDEX "LinkRequest_arenaId_userId_key" ON "LinkRequest"("arenaId", "userId");
CREATE UNIQUE INDEX "LinkRequest_arenaId_playerId_key" ON "LinkRequest"("arenaId", "playerId");

ALTER TABLE "LinkRequest" ADD CONSTRAINT "LinkRequest_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LinkRequest" ADD CONSTRAINT "LinkRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LinkRequest"
    ADD CONSTRAINT "LinkRequest_arenaId_playerId_fkey"
    FOREIGN KEY ("arenaId", "playerId")
    REFERENCES "Player"("arenaId", "id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
