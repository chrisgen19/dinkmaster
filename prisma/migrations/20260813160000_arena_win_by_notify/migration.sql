-- Widen the Arena realtime trigger to cover `winBy`.
--
-- IMPORTANT: this trigger has now been widened three times: `20260606140000`
-- created it for `lastSessionResetAt`, `20260720140000_arena_offline_hold`
-- re-created it adding the two `offline*` columns, and
-- `20260812180000_arena_deck_mode_notify` added `splitDeckByResult`. Each
-- change is a DROP + CREATE, so the WHEN clause below must repeat EVERY column
-- any previous migration added, or that feature silently stops notifying.
--
-- `winBy` now rides the board stream (`getState` selects and returns it), and
-- it needs this for exactly the reason `splitDeckByResult` did:
-- `updateArenaMatchDefaults` touches the Arena row alone, so none of the
-- row-level triggers from `20260606120000` fire. Without this, a manager
-- switching the margin leaves every other open board on the old rule until
-- some unrelated board event happens to push a fresh frame.
--
-- The consequences of that stale window are not cosmetic:
--
--   - The score dialog VALIDATES against it. A stale win-by-2 tab disables
--     Save on an 11-10 the arena now allows; a stale sudden-death tab offers
--     an 11-10 the server then refuses, and the refusal carries board state,
--     so the retry fails identically until someone reloads.
--   - Worse, `engineSettings` freezes this value onto the offline pending log
--     at offline entry, and `boardFingerprint` hashes it (`|w1` for sudden
--     death). A stale margin at that moment produces a rules string the server
--     will not reproduce, so the ENTIRE sync batch comes back as a divergence.
--
-- Still scoped rather than firing on every Arena UPDATE: an ordinary settings
-- save (name, schedule, thresholds) would otherwise emit a NOTIFY whose state
-- push changes nothing on the board.
--
-- Both trigger names are dropped: the original from 20260606140000 and the
-- current one, so a re-apply on a partially-migrated database is safe.
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
  -- Carried over from 20260812180000; dropping this leaves other boards
  -- deriving their four the old way and every stack refused.
  OR OLD."splitDeckByResult" IS DISTINCT FROM NEW."splitDeckByResult"
  -- New here.
  OR OLD."winBy" IS DISTINCT FROM NEW."winBy"
)
EXECUTE FUNCTION notify_arena_self_change();
