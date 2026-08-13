-- Organizer pins for the win/lose decks.
--
-- Hand-topping a short deck already existed, but as CLIENT state: a value in
-- one manager's browser tab, invisible to every other board and dropped by a
-- reload. That was survivable while a pin was only a hint. It is not, now that
-- a pin is authoritative — the whole point is that the board stops moving a
-- paddle the organizer deliberately placed, and a rule that evaporates on
-- refresh cannot promise that.
--
-- Adds:
--   - `Player.draftedDeck` (text, nullable) — "W" | "L" | NULL. Which deck the
--     organizer pinned this paddle into. Beats the natural W/L split for that
--     slot; a natural member who would have taken it becomes a "challenger"
--     the organizer is asked about, rather than silently swapping in.
--   - `Player.draftedLocked` (boolean) — the organizer was shown that contest
--     and chose to keep their pick. Stops the same question being re-asked
--     every time another game returns a winner. Meaningless without
--     `draftedDeck` set, and always cleared alongside it.
--
-- Both are cleared when the pin's deck stacks a court, and when the paddle
-- leaves the rack for any reason (stacked, checked out, subbed out) — those
-- are movements the organizer already consented to.
--
-- Every statement here is idempotent and there is no UPDATE, matching
-- 20260812140000_add_split_deck_by_result: a re-apply on a partially-skewed
-- database cannot clobber a live arena's pins. `ADD CONSTRAINT` has no
-- `IF NOT EXISTS` form in Postgres, hence the two guarded DO blocks below.
ALTER TABLE "Player"
  ADD COLUMN IF NOT EXISTS "draftedDeck" TEXT;

ALTER TABLE "Player"
  ADD COLUMN IF NOT EXISTS "draftedLocked" BOOLEAN NOT NULL DEFAULT false;

-- Same defense-in-depth as 20260812160000_deck_column_constraints: the value
-- drives which four go on court, so an out-of-domain write would not fail, it
-- would silently drop the pin (nothing matches 'w') and hand the slot back to
-- the natural member — the exact bug these columns exist to stop.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Player_draftedDeck_domain_chk'
  ) THEN
    ALTER TABLE "Player"
      ADD CONSTRAINT "Player_draftedDeck_domain_chk"
        CHECK ("draftedDeck" IS NULL OR "draftedDeck" IN ('W', 'L'));
  END IF;
END $$;

-- A lock with no pin is meaningless state that would survive an unpin and then
-- silently suppress the next challenge for whoever gets pinned there later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Player_draftedLocked_requires_deck_chk'
  ) THEN
    ALTER TABLE "Player"
      ADD CONSTRAINT "Player_draftedLocked_requires_deck_chk"
        CHECK ("draftedLocked" = false OR "draftedDeck" IS NOT NULL);
  END IF;
END $$;

-- Deliberately NO index on `draftedDeck`.
--
-- A partial index (`WHERE "draftedDeck" IS NOT NULL`) is the natural fit, but
-- Prisma 7 cannot express one in the schema, so it would exist only in raw
-- SQL — and the next `prisma migrate dev` diffs the schema against the
-- database, sees an index it does not know about, and emits a DROP for it. An
-- index that silently deletes itself is worse than no index.
--
-- No plain index either: `Player` already carries `@@index([arenaId])`, every
-- pin read is scoped to one arena, and an arena's roster is dozens of rows.
-- There is nothing here to optimize yet.
