// Pure banner-state derivation — no JSX, no React, no DB. Split out from
// arena-session-prep-banner.js so the state machine is unit-testable in
// isolation (vitest can't import a JSX .js file), mirroring the
// sessions.js / leaderboard.js pure-module convention.

import { currentSession, lastSession, nextSession, IMMINENT_WINDOW_MS } from '@/lib/sessions';

/**
 * Derive the banner state from schedule + last-reset + autoReset + now.
 *
 * Returns `{ kind, session?, prepared?, msToStart?, needsReset }`:
 * - `kind`     — 'none' | 'between' | 'imminent' | 'live'
 * - `prepared` — the rack was session-reset since the previous session's
 *                end (the manager already prepped this upcoming session)
 * - `needsReset` — the CTA should wipe rack + matrix on tap. True only when
 *                auto-reset is on, the day is between/imminent, and the
 *                session isn't already prepped. When auto-reset is off the
 *                banner stays informational (Edit roster, no wipe).
 *
 * @param {{days?:number[], start?:string|null, end?:string|null, timezone?:string}} schedule
 * @param {string|null} lastSessionResetAt - ISO string or null
 * @param {boolean} autoResetOnSession
 * @param {Date} now
 */
export function deriveState({ schedule, lastSessionResetAt, autoResetOnSession = true, now }) {
  const days = Array.isArray(schedule?.days) ? schedule.days : [];
  if (days.length === 0) return { kind: 'none', needsReset: false };

  const live = currentSession(schedule, now);
  if (live) return { kind: 'live', session: live, needsReset: false };

  const next = nextSession(schedule, now);
  if (!next) return { kind: 'none', needsReset: false };

  const prev = lastSession(schedule, now);
  const last = lastSessionResetAt ? new Date(lastSessionResetAt) : null;
  const prepared = last !== null && (!prev || last > prev.end);

  const msToStart = next.start.getTime() - now.getTime();
  const kind = msToStart < IMMINENT_WINDOW_MS ? 'imminent' : 'between';
  const needsReset = autoResetOnSession && !prepared;
  return { kind, session: next, prepared, msToStart, needsReset };
}
