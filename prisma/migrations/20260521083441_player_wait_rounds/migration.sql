-- Track consecutive rounds waited per player for fair queue mixing.
ALTER TABLE "Player" ADD COLUMN "waitRounds" INTEGER NOT NULL DEFAULT 0;
