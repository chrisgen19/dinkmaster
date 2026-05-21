-- Games credited at join (group average) so late joiners slot in as peers.
ALTER TABLE "Player" ADD COLUMN "gamesOffset" INTEGER NOT NULL DEFAULT 0;
