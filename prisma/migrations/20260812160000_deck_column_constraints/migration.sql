-- Defense-in-depth for the win/lose deck columns added by
-- 20260812140000_add_split_deck_by_result. Both are plain `TEXT`, but only
-- 'W', 'L', and NULL are meaningful: the value drives `nextDeck`'s alternation
-- (src/lib/decks.js) and is hashed into the offline sync fingerprint
-- (src/lib/board-fingerprint.js), so an out-of-domain write doesn't fail — it
-- silently degrades the rotation to "always prefer winners" and forks the
-- fingerprint. Same reasoning as the matchmaking-threshold constraints in
-- 20260523133800.
--
-- The application validates this too (`applyFillCourtTx` / `applyFillCourt`
-- reject an outcome whose `deck` is outside the domain); this stops the paths
-- that bypass those — Prisma Studio, ad-hoc SQL, a future bulk import.
--
-- Safe to add without a backfill: both columns ship in the migration above and
-- are NULL on every existing row.
--
-- Separate migration rather than an edit to that file: it has already been
-- applied to development databases, so a re-run would not pick up an edit.
ALTER TABLE "Arena"
  ADD CONSTRAINT "Arena_lastDeckFilled_domain_chk"
    CHECK ("lastDeckFilled" IS NULL OR "lastDeckFilled" IN ('W', 'L'));

ALTER TABLE "Court"
  ADD CONSTRAINT "Court_fillPrevDeck_domain_chk"
    CHECK ("fillPrevDeck" IS NULL OR "fillPrevDeck" IN ('W', 'L'));
