-- Complete the realtime trigger set: `getState` also reads
-- `Arena.lastSessionResetAt`, and `prepareNextSession` on an arena with no
-- active players and no partnerships changes ONLY that column — none of the
-- row triggers from `20260606120000_add_realtime_notify_triggers` fire, so
-- other open SSE viewers kept a stale session-prep banner until the next
-- unrelated mutation.
--
-- Arena's own id IS the arena id (the shared `notify_arena_change()` reads
-- an `arenaId` column, which Arena doesn't have), hence a dedicated function.
CREATE OR REPLACE FUNCTION notify_arena_self_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('arena_events', NEW.id);
  RETURN NULL; -- AFTER trigger: return value is ignored.
END;
$$ LANGUAGE plpgsql;

-- Scoped with WHEN to the one Arena column getState consumes, so ordinary
-- settings saves (name, schedule, thresholds, …) don't emit a NOTIFY whose
-- resulting state push would change nothing on the board.
CREATE TRIGGER arena_session_reset_notify
AFTER UPDATE ON "Arena"
FOR EACH ROW
WHEN (OLD."lastSessionResetAt" IS DISTINCT FROM NEW."lastSessionResetAt")
EXECUTE FUNCTION notify_arena_self_change();
