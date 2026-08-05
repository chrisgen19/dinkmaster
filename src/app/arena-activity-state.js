// Pure banner-state derivation — no JSX, no React, no DB. Split out from
// arena-activity-banner.js so the state machine is unit-testable in isolation
// (vitest can't import a JSX .js file), mirroring the
// activities.js / sessions.js / leaderboard.js pure-module convention.
//
// Supersedes arena-session-prep-state.js. That version had to infer whether the
// manager had prepped the upcoming session by comparing one overwritten
// timestamp against a RECOMPUTED window boundary:
//
//     prepared = lastSessionResetAt !== null && lastSessionResetAt >= prev.end
//
// which quietly rewrote itself whenever a manager edited the schedule — every
// historical boundary moved, and with it the answer to "is tonight prepped?".
// Now that each occurrence is a row, the same question is an identity check.

/**
 * Derive the banner state from the open activity, the next one up, and the clock.
 *
 * Returns `{ kind, activity?, prepared, msToStart?, needsReset }`:
 * - `kind`       — 'none' | 'between' | 'imminent' | 'live'
 * - `activity`   — the activity the CTA acts on (the next one up), or the live one
 * - `prepared`   — the open activity IS the next one up; the manager already
 *                  opened tonight's session
 * - `needsReset` — the CTA should close the current activity and open the next.
 *                  True only when auto-reset is on, the day is between/imminent,
 *                  and the session isn't already open. When auto-reset is off the
 *                  banner stays informational (Edit roster, no boundary crossed).
 *
 * @param {{id:string, startsAt:string, endsAt:string}|null} currentActivity - the LIVE row
 * @param {{id:string, startsAt:string, endsAt:string}|null} nextActivity - soonest upcoming row
 * @param {boolean} autoResetOnSession
 * @param {Date} now
 */
export function deriveActivityBannerState({
  currentActivity = null,
  nextActivity = null,
  autoResetOnSession = true,
  now = new Date(),
}) {
  // A live session needs no banner: the rack, courts, and the always-on
  // "+ Players" button already cover mid-game roster changes. Judged by the
  // open activity's own window rather than the schedule rule, so an impromptu
  // session (a MANUAL activity with no scheduled window behind it) counts too.
  if (currentActivity && withinWindow(currentActivity, now)) {
    return { kind: 'live', activity: currentActivity, prepared: true, needsReset: false };
  }

  if (!nextActivity) return { kind: 'none', prepared: false, needsReset: false };

  // The crux, and the whole reason this module replaces the old one: "has the
  // manager prepped the upcoming session?" is now a row-identity question, not
  // a timestamp comparison that schedule edits can retroactively rewrite.
  const prepared = currentActivity?.id === nextActivity.id;

  const msToStart = new Date(nextActivity.startsAt).getTime() - now.getTime();
  const kind = msToStart < IMMINENT_WINDOW_MS ? 'imminent' : 'between';
  const needsReset = autoResetOnSession && !prepared;

  return { kind, activity: nextActivity, prepared, msToStart, needsReset };
}

/**
 * How far ahead of an activity's start the banner flips from `between` to
 * `imminent`. Re-declared here rather than imported from sessions.js: this
 * module is about activity rows, and sessions.js is the schedule-rule layer the
 * Activity model was built to replace.
 */
export const IMMINENT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Is `now` inside `[startsAt, endsAt)`? Half-open, matching every other window check. */
function withinWindow(activity, now) {
  const start = new Date(activity.startsAt).getTime();
  const end = new Date(activity.endsAt).getTime();
  const t = now.getTime();
  return t >= start && t < end;
}
