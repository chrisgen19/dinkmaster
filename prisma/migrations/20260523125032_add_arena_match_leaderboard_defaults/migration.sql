-- AlterTable
ALTER TABLE "Arena" ADD COLUMN     "autoMixDefault" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "countOffScheduleGames" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "leaderboardSize" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "targetScore" INTEGER NOT NULL DEFAULT 11;
