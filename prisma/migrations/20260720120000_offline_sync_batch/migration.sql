-- Idempotency ledger for offline session sync (syncOfflineEvents). The id is
-- the client-generated batch uuid; a retried batch whose transaction already
-- committed finds its row and returns current state instead of re-applying.
-- Deliberately no FK to "Arena" so the ledger survives arena deletion and a
-- late retry for a deleted arena still dedupes cleanly.
CREATE TABLE "OfflineSyncBatch" (
    "id" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "appliedEventIds" TEXT[],
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfflineSyncBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfflineSyncBatch_arenaId_idx" ON "OfflineSyncBatch"("arenaId");
