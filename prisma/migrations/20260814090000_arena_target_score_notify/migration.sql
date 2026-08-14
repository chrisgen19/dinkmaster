-- Widen the Arena realtime trigger to cover `targetScore`.
--
-- IMPORTANT: this trigger has now been widened four times: `20260606140000`
-- created it for `lastSessionResetAt`, `20260720140000_arena_offline_hold`
-- re-created it adding the two `offline*` columns,
-- `20260812180000_arena_deck_mode_notify` added `splitDeckByResult`, and
-- `20260813160000_arena_win_by_notify` added `winBy`. Each change is a
-- DROP + CREATE, so the WHEN clause below must repeat EVERY column any previous
-- migration added, or that feature silently stops notifying. (Dropping the
-- offline-hold columns once made two offline e2e specs fail: other viewers
-- stopped seeing the "running this board offline" banner.)
--
-- `targetScore` now rides the board stream (`getState` selects and returns it),
-- and it needs this for exactly the reason `winBy` did: `updateArenaMatchDefaults`
-- touches the Arena row alone, so none of the row-level triggers from
-- `20260606120000` fire. Without it, a manager changing the target leaves every
-- other open board on the old one until some unrelated board event happens to
-- push a fresh frame.
--
-- Both consequences are worse for the target than for the margin:
--
--   - The score dialog VALIDATES against it. A tab still on 11 disables Save on
--     a legal 15-13; a tab still on 15 offers a 15-13 the server refuses, and
--     the refusal carries only board state, so the retry fails identically
--     until someone reloads.
--   - `engineSettings` freezes it onto the offline pending log, and
--     `board-fingerprint` puts it FIRST in the legacy rules string — unlike
--     `winBy`, which is appended only for sudden death. A stale target at
--     offline entry therefore hashes a rules string the server will not
--     reproduce, and the ENTIRE batch returns as a divergence.
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
  -- Carried over from 20260813160000; dropping this leaves other boards
  -- scoring by the wrong win-by margin.
  OR OLD."winBy" IS DISTINCT FROM NEW."winBy"
  -- New here.
  OR OLD."targetScore" IS DISTINCT FROM NEW."targetScore"
)
EXECUTE FUNCTION notify_arena_self_change();
