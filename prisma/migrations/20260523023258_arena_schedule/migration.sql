-- AlterTable
ALTER TABLE "Arena" ADD COLUMN     "scheduleDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "scheduleEnd" TEXT,
ADD COLUMN     "scheduleStart" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila';
