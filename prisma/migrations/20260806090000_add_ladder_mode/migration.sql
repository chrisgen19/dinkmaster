-- Ladder ("king of the court") matchmaking, opt-in per arena.
--
-- When on, the auto-mix groups the rack by each player's record in the OPEN
-- activity — winners with winners, losers with losers. Records are per-activity
-- (Match.activityId), so the ladder resets every session; before Activities
-- existed there was no per-session record to sort on.
--
-- Defaults false: it materially changes how a night plays, so every existing
-- arena keeps peer-based mixing until a manager opts in.

ALTER TABLE "Arena" ADD COLUMN IF NOT EXISTS "ladderMode" BOOLEAN NOT NULL DEFAULT false;
