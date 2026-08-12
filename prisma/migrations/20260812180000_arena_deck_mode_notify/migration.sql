-- Widen the Arena realtime trigger to cover `splitDeckByResult`.
--
-- IMPORTANT: this trigger has been widened once already — `20260606140000`
-- created it for `lastSessionResetAt`, then `20260720140000_arena_offline_hold`
-- re-created it adding the two `offline*` columns. Because each change is a
-- DROP + CREATE, the WHEN clause below must repeat EVERY column any previous
-- migration added, or that feature silently stops notifying. (Dropping the
-- offline-hold columns here made two offline e2e specs fail: other viewers
-- stopped seeing the "running this board offline" banner.)
--
-- getState now also returns `lastDeckFilled` and `splitDeckByResult`:
--
--   - `lastDeckFilled` needs nothing here. It only ever changes inside a
--     transaction that also writes Court/CourtSlot/Player rows, each of which
--     already fires `notify_arena_change()`, so the pointer always rides along.
--   - `splitDeckByResult` DOES need it. `updateArenaMatchmaking` touches the
--     Arena row alone, so without this a manager toggling win/lose decks
--     mid-session left every other open board deriving its four the old way.
--     That is not merely cosmetic: the client sends those four as `fillCourt`'s
--     `expected` guard, so the server refused every stack — and, because the
--     refusal response carries only board state, the stale client never learned
--     better and retried into the same refusal until someone reloaded.
--
-- Still scoped rather than firing on every Arena UPDATE: an ordinary settings
-- save (name, schedule, thresholds) would otherwise emit a NOTIFY whose state
-- push changes nothing on the board.
-- Both names: the old one from the previous migrations, and this one, so a
-- re-apply on a partially-migrated database is safe.
DROP TRIGGER IF EXISTS arena_session_reset_notify ON "Arena";
DROP TRIGGER IF EXISTS arena_board_settings_notify ON "Arena";

CREATE TRIGGER arena_board_settings_notify
AFTER UPDATE ON "Arena"
FOR EACH ROW
WHEN (
  OLD."lastSessionResetAt" IS DISTINCT FROM NEW."lastSessionResetAt"
  -- Carried over from 20260720140000; dropping these stops other viewers
  -- seeing the advisory "running this board offline" banner.
  OR OLD."offlineHolderLabel" IS DISTINCT FROM NEW."offlineHolderLabel"
  OR OLD."offlineHeldAt" IS DISTINCT FROM NEW."offlineHeldAt"
  -- New here.
  OR OLD."splitDeckByResult" IS DISTINCT FROM NEW."splitDeckByResult"
)
EXECUTE FUNCTION notify_arena_self_change();
