-- Backfill: drop duplicate participant rows (same match + same player),
-- keeping the lowest id. These arose from a link/merge that re-pointed a
-- player's finished-match snapshots onto a player already present in the
-- same match, leaving two rows with the same (matchId, playerId).
DELETE FROM "MatchPlayer" a
USING "MatchPlayer" b
WHERE a.id > b.id
  AND a."matchId" = b."matchId"
  AND a."playerId" = b."playerId";

-- Enforce one row per (match, player) going forward.
CREATE UNIQUE INDEX "MatchPlayer_matchId_playerId_key" ON "MatchPlayer"("matchId", "playerId");
