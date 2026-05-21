-- CourtSlot: a player can only occupy one court at a time.
CREATE UNIQUE INDEX "CourtSlot_playerId_key" ON "CourtSlot"("playerId");
