-- Realtime arena updates: emit a Postgres NOTIFY on the `arena_events`
-- channel whenever any row that feeds `getState` changes, carrying the
-- affected arenaId as the payload. A singleton LISTEN client in the Node
-- process (src/lib/realtime-listener.js) fans the signal out to open SSE
-- connections, which re-read getState and push fresh state to every viewer.
--
-- Why a trigger (not app-level notify calls): the ~20 mutating server
-- actions all funnel row changes through these five tables, so one trigger
-- per table covers every current and future action with no app edits.
-- Postgres collapses duplicate (channel, payload) NOTIFYs within a single
-- transaction, so a multi-row change (e.g. a rack shuffle updating every
-- queued Player) results in exactly one delivered notification. NOTIFYs are
-- queued until COMMIT, so subscribers never observe uncommitted state.

-- Tables that carry `arenaId` directly: Player, Court, Match, Partnership.
CREATE OR REPLACE FUNCTION notify_arena_change() RETURNS trigger AS $$
DECLARE
  aid text;
BEGIN
  -- COALESCE so the function works for INSERT (NEW), UPDATE (NEW), and
  -- DELETE (OLD is the only populated record).
  aid := COALESCE(NEW."arenaId", OLD."arenaId");
  IF aid IS NOT NULL THEN
    PERFORM pg_notify('arena_events', aid);
  END IF;
  RETURN NULL; -- AFTER trigger: return value is ignored.
END;
$$ LANGUAGE plpgsql;

-- CourtSlot has no arenaId of its own; resolve it through its Court. On a
-- cascade delete of the parent Court the lookup may find nothing, but that
-- path is already covered by the Court table's own DELETE trigger, so the
-- arena still gets notified.
CREATE OR REPLACE FUNCTION notify_court_slot_change() RETURNS trigger AS $$
DECLARE
  aid text;
BEGIN
  SELECT "arenaId" INTO aid
  FROM "Court"
  WHERE id = COALESCE(NEW."courtId", OLD."courtId");
  IF aid IS NOT NULL THEN
    PERFORM pg_notify('arena_events', aid);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER player_notify_arena
AFTER INSERT OR UPDATE OR DELETE ON "Player"
FOR EACH ROW EXECUTE FUNCTION notify_arena_change();

CREATE TRIGGER court_notify_arena
AFTER INSERT OR UPDATE OR DELETE ON "Court"
FOR EACH ROW EXECUTE FUNCTION notify_arena_change();

CREATE TRIGGER match_notify_arena
AFTER INSERT OR UPDATE OR DELETE ON "Match"
FOR EACH ROW EXECUTE FUNCTION notify_arena_change();

CREATE TRIGGER partnership_notify_arena
AFTER INSERT OR UPDATE OR DELETE ON "Partnership"
FOR EACH ROW EXECUTE FUNCTION notify_arena_change();

CREATE TRIGGER court_slot_notify_arena
AFTER INSERT OR UPDATE OR DELETE ON "CourtSlot"
FOR EACH ROW EXECUTE FUNCTION notify_court_slot_change();
