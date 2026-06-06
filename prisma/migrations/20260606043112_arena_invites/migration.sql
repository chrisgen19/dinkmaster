-- CreateEnum
CREATE TYPE "InviteMode" AS ENUM ('AUTO_JOIN', 'APPROVAL');

-- CreateTable
CREATE TABLE "ArenaInvite" (
    "id" TEXT NOT NULL,
    "arenaId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "mode" "InviteMode" NOT NULL DEFAULT 'APPROVAL',
    "createdBy" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArenaInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArenaInvite_code_key" ON "ArenaInvite"("code");

-- CreateIndex
CREATE INDEX "ArenaInvite_arenaId_idx" ON "ArenaInvite"("arenaId");

-- CreateIndex
CREATE INDEX "ArenaInvite_code_idx" ON "ArenaInvite"("code");

-- AddForeignKey
ALTER TABLE "ArenaInvite" ADD CONSTRAINT "ArenaInvite_arenaId_fkey" FOREIGN KEY ("arenaId") REFERENCES "Arena"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArenaInvite" ADD CONSTRAINT "ArenaInvite_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
