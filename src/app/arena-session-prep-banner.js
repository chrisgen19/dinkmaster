'use client';

import { useEffect, useMemo, useState } from 'react';
import { currentSession, lastSession, nextSession, IMMINENT_WINDOW_MS } from '@/lib/sessions';

/** Format a UTC instant as "Tue May 26 · 6:00 PM" in the arena's timezone. */
function formatSessionStart(instant, timeZone) {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(instant);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant);
  return `${day} · ${time}`;
}

/** "in 45 min" / "in 2 h 12 min" — banner countdown copy. */
function formatCountdown(ms) {
  if (ms <= 0) return 'now';
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `in ${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

/**
 * Derive the banner state from schedule + last-reset + now. Pure helper so
 * the component is easy to test by tweaking inputs; mirrors the same shape
 * the JSX consumes. `prepared` is true when the rack has been session-reset
 * since the previous session's end — i.e. the manager already prepped.
 */
function deriveState({ schedule, lastSessionResetAt, now }) {
  const days = Array.isArray(schedule?.days) ? schedule.days : [];
  if (days.length === 0) return { kind: 'none' };

  const live = currentSession(schedule, now);
  if (live) return { kind: 'live', session: live };

  const next = nextSession(schedule, now);
  if (!next) return { kind: 'none' };

  const prev = lastSession(schedule, now);
  const last = lastSessionResetAt ? new Date(lastSessionResetAt) : null;
  const prepared = last !== null && (!prev || last > prev.end);

  const msToStart = next.start.getTime() - now.getTime();
  const kind = msToStart < IMMINENT_WINDOW_MS ? 'imminent' : 'between';
  return { kind, session: next, prepared, msToStart };
}

/**
 * Manager-only floating banner that prompts the organizer to prep the next
 * session's roster. Hidden for non-managers (the viewer notice covers that
 * case) and for arenas without a schedule. Dismissal is per-session: the
 * key includes the upcoming session's start instant, so dismissing one
 * session's banner doesn't suppress next session's.
 *
 * Single CTA per state — *Prepare next session* when the rack hasn't been
 * reset yet for the upcoming play day, *Edit roster* once it has, and
 * *Manage roster* during a live session. The first variant resets the
 * rack + partnership matrix + waitRounds AND opens the roster modal in
 * one tap, so the manager can't accidentally check players in against a
 * still-polluted matrix.
 *
 * @param {object} props
 * @param {string} props.arenaId
 * @param {boolean} props.canManage
 * @param {{days?:number[], start?:string|null, end?:string|null, timezone?:string}} props.schedule
 * @param {string|null} props.lastSessionResetAt - ISO string from the server
 * @param {boolean} props.autoResetOnSession - per-arena setting. When false the
 *   banner won't offer the auto-reset CTA; it stays purely informational
 *   with an Edit roster opener. The arena keeps last session's queue and
 *   partnership matrix (the perpetual-rack model) until a manager hits
 *   Settings → Sessions → Reset session now.
 * @param {number} props.headerHeight - sticky offset so the banner sits flush below the header
 * @param {number} props.checkedInCount - rack length, surfaced in the `live` state
 * @param {boolean} props.isPending - disable action buttons while a server action is in flight
 * @param {() => void} props.onPrepareAndOpen - reset rack/matrix then open the roster modal
 * @param {() => void} props.onOpenRoster - just open the modal (no reset)
 */
export function ArenaSessionPrepBanner({
  arenaId,
  canManage,
  schedule,
  lastSessionResetAt = null,
  autoResetOnSession = true,
  headerHeight = 96,
  checkedInCount = 0,
  isPending = false,
  onPrepareAndOpen,
  onOpenRoster,
}) {
  // Re-evaluate every minute so a between→imminent→live transition doesn't
  // need a page refresh. Initial render uses Date.now() — re-renders update it.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const state = useMemo(
    () => deriveState({ schedule, lastSessionResetAt, now }),
    [schedule, lastSessionResetAt, now],
  );

  // Dismissal is only offered on actual play days (imminent or live) — on
  // between days the banner is the only entry to the Prep Roster modal,
  // and an accidental ✕ would strand the manager. On play days the banner
  // is mostly contextual ("starts in 45 min" / "live · N in") so a
  // manager can stash it to focus on the live UI. Scoped per (arena,
  // upcoming session): a dismiss for tonight doesn't suppress next week's.
  const isPlayDay = state.kind === 'imminent' || state.kind === 'live';
  const sessionKey = state.session && isPlayDay
    ? `arena:${arenaId}:sessionPrepDismissed:${state.session.start.toISOString()}`
    : null;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!sessionKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset dismissed when we cross from a play day back to a between day
      setDismissed(false);
      return;
    }
    setDismissed(sessionStorage.getItem(sessionKey) === '1');
  }, [sessionKey]);
  const dismiss = () => {
    if (!sessionKey) return;
    setDismissed(true);
    sessionStorage.setItem(sessionKey, '1');
  };

  if (!canManage || state.kind === 'none' || dismissed) return null;

  const tz = schedule.timezone || 'Asia/Manila';
  const sessionStartLabel = state.session ? formatSessionStart(state.session.start, tz) : null;

  // Single CTA per state. `needsReset` is the only case that does the
  // rack/matrix wipe on tap (Prepare next session) — every other case just
  // opens the modal (Edit/Manage roster). Two gates:
  //   1. The session isn't already prepped (a reset since the prior session).
  //   2. `autoResetOnSession` is on — when off the arena keeps the perpetual
  //      rack, so the banner never auto-wipes; the manager opens the roster
  //      to adjust by hand, or resets explicitly from Settings → Sessions.
  const needsReset =
    autoResetOnSession && (state.kind === 'between' || state.kind === 'imminent') && !state.prepared;
  let title;
  let label;
  if (state.kind === 'live') {
    title = `Session live · ${checkedInCount} checked in`;
    label = 'Manage roster';
  } else if (state.kind === 'imminent') {
    title = needsReset
      ? `Session starts ${formatCountdown(state.msToStart)} · ${sessionStartLabel}`
      : `${checkedInCount} on the rack · Session starts ${formatCountdown(state.msToStart)}`;
    label = needsReset ? 'Prepare next session' : 'Edit roster';
  } else {
    title = needsReset
      ? `Next session ${sessionStartLabel}`
      : `${checkedInCount} on the rack · Next session ${sessionStartLabel}`;
    label = needsReset ? 'Prepare next session' : 'Edit roster';
  }

  return (
    <div
      style={{ top: headerHeight + 12 }}
      className="sticky z-40 mt-3 w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8"
    >
      <div
        role="status"
        className={`relative p-4 ${isPlayDay ? 'pr-10' : ''} bg-amber-50/95 backdrop-blur border border-amber-200 text-amber-900 rounded-2xl shadow-lg shadow-amber-900/10 flex flex-col items-center text-center gap-3 animate-fade-in`}
      >
        {isPlayDay && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss session prep notice"
            className="absolute top-3 right-3 grid place-items-center h-7 w-7 rounded-lg text-amber-700/70 hover:text-amber-900 hover:bg-amber-100 transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
        <div className="flex items-center gap-2.5">
          <svg className="w-5 h-5 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect width="18" height="18" x="3" y="4" rx="2" />
            <path d="M16 2v4" />
            <path d="M8 2v4" />
            <path d="M3 10h18" />
            <path d="m9 16 2 2 4-4" />
          </svg>
          <p className="text-sm font-semibold leading-snug">{title}</p>
        </div>
        <button
          type="button"
          onClick={needsReset ? onPrepareAndOpen : onOpenRoster}
          className="text-sm bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg transition"
          disabled={isPending}
        >
          {label}
        </button>
      </div>
    </div>
  );
}
