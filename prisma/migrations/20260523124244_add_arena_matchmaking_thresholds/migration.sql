-- AlterTable
ALTER TABLE "Arena" ADD COLUMN     "emergencyWait" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "starveThreshold" INTEGER NOT NULL DEFAULT 2;
