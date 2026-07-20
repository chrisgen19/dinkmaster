-- Advisory offline hold: while a manager runs the board offline, other
-- viewers see a soft "X is running the board offline" warning. Purely
-- advisory (never enforced): a truly offline device cannot declare it, and
-- the sync fingerprint check is what actually protects correctness.
ALTER TABLE "Arena" ADD COLUMN "offlineHolderLabel" TEXT;
ALTER TABLE "Arena" ADD COLUMN "offlineHeldAt" TIMESTAMP(3);

-- The Arena self-notify trigger (20260606140000) fires only on
-- lastSessionResetAt changes; widen it so declaring/releasing a hold also
-- pushes fresh state to open SSE viewers, while ordinary settings saves
-- stay silent.
DROP TRIGGER IF EXISTS arena_session_reset_notify ON "Arena";
CREATE TRIGGER arena_session_reset_notify
AFTER UPDATE ON "Arena"
FOR EACH ROW
WHEN (
  OLD."lastSessionResetAt" IS DISTINCT FROM NEW."lastSessionResetAt"
  OR OLD."offlineHolderLabel" IS DISTINCT FROM NEW."offlineHolderLabel"
  OR OLD."offlineHeldAt" IS DISTINCT FROM NEW."offlineHeldAt"
)
EXECUTE FUNCTION notify_arena_self_change();
