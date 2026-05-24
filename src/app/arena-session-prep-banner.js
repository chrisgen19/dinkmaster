'use client';

import { useEffect, useMemo, useState } from 'react';
import { deriveState } from './arena-session-prep-state';

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
 * Manager-only floating banner that prompts the organizer to prep the next
 * session's roster. Hidden for non-managers (the viewer notice covers that
 * case) and for arenas without a schedule. Dismissal is per-session: the
 * key includes the upcoming session's start instant, so dismissing one
 * session's banner doesn't suppress next session's.
 *
 * Primary CTA per state — *Prepare next session* when the rack hasn't been
 * reset yet for the upcoming play day, *Edit roster* once it has. The first
 * variant resets the rack + partnership matrix + waitRounds AND opens the
 * roster modal in one tap, so the manager can't accidentally check players in
 * against a still-polluted matrix. (The live session has no banner — see the
 * early return below.)
 *
 * Perpetual-rack mode (`autoResetOnSession` off) is the one state with two
 * actions: the primary stays a non-destructive *Edit roster* opener, plus a
 * low-emphasis *Reset session now* secondary that runs the same wipe on
 * demand. Every other state keeps a single CTA.
 *
 * @param {object} props
 * @param {string} props.arenaId
 * @param {boolean} props.canManage
 * @param {{days?:number[], start?:string|null, end?:string|null, timezone?:string}} props.schedule
 * @param {string|null} props.lastSessionResetAt - ISO string from the server
 * @param {boolean} props.autoResetOnSession - per-arena setting. When false the
 *   banner won't auto-offer the wipe as its primary CTA; the primary stays an
 *   Edit roster opener (the perpetual-rack model keeps last session's queue and
 *   partnership matrix). It DOES surface a low-emphasis "Reset session now"
 *   secondary action so a manager can clear the rack + matrix on demand without
 *   the Settings → Sessions detour — it runs the same `prepareNextSession`
 *   transaction behind a confirm prompt.
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
  // Re-evaluate every minute so a between→imminent→live transition (and the
  // "starts in N min" countdown) update without a page refresh. Only tick
  // when the banner can actually render something — a manager with a
  // scheduled arena. Spectators and unscheduled arenas render null, so a
  // perpetual no-op timer would just be waste.
  const hasSchedule = (schedule?.days?.length ?? 0) > 0;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!canManage || !hasSchedule) return undefined;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [canManage, hasSchedule]);

  const state = useMemo(
    () => deriveState({ schedule, lastSessionResetAt, autoResetOnSession, now }),
    [schedule, lastSessionResetAt, autoResetOnSession, now],
  );

  // Dismissal is only offered on actual play days (imminent or live) — on
  // between days the banner is the only entry to the Prep Roster modal,
  // and an accidental ✕ would strand the manager. On play days the banner
  // is mostly contextual ("starts in 45 min" / "live · N in") so a
  // manager can stash it to focus on the live UI. Scoped per (arena,
  // upcoming session): a dismiss for tonight doesn't suppress next week's.
  // Only the imminent banner is dismissible — it's a pre-session nudge the
  // manager may want to stash. The between banner is the sole entry to the
  // prep modal so it must not be dismissable; the live banner isn't
  // rendered at all (see early return below). Scoped per (arena, session)
  // so a dismiss for tonight doesn't suppress next week's.
  const canDismiss = state.kind === 'imminent';
  const sessionKey = state.session && canDismiss
    ? `arena:${arenaId}:sessionPrepDismissed:${state.session.start.toISOString()}`
    : null;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!sessionKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset dismissed when the session window changes (e.g. imminent → between)
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

  // Suppressed during a live session: the rack, courts, and the always-on
  // "+ Players" button already cover mid-game roster changes, so a sticky
  // banner here is just wasted space. Also hidden for spectators, arenas
  // with no schedule, and a dismissed imminent nudge.
  if (!canManage || state.kind === 'none' || state.kind === 'live' || dismissed) return null;

  const tz = schedule.timezone || 'Asia/Manila';
  const sessionStartLabel = state.session ? formatSessionStart(state.session.start, tz) : null;

  // `needsReset` (computed in deriveState) is the only case whose CTA wipes
  // rack + matrix on tap — every other case just opens the modal. It's
  // false for already-prepped days and arenas with auto-reset off (those
  // keep the perpetual rack).
  const { needsReset } = state;
  let title;
  let label;
  if (state.kind === 'imminent') {
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
        className={`relative p-4 ${canDismiss ? 'pr-10' : ''} bg-amber-50/95 backdrop-blur border border-amber-200 text-amber-900 rounded-2xl shadow-lg shadow-amber-900/10 flex flex-col items-center text-center gap-3 animate-fade-in`}
      >
        {canDismiss && (
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
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={needsReset ? onPrepareAndOpen : onOpenRoster}
            className="text-sm bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg transition"
            disabled={isPending}
          >
            {label}
          </button>
          {/* Perpetual-rack mode: the primary CTA only opens the roster (no
              wipe), so without this the only way to clear the carried-over rack
              + partnership matrix is buried in Settings → Sessions. Surface it
              here as a secondary action. onPrepareAndOpen carries its own
              confirm prompt before the destructive reset. */}
          {!autoResetOnSession && (
            <button
              type="button"
              onClick={onPrepareAndOpen}
              className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline underline-offset-2 disabled:opacity-50 transition"
              disabled={isPending}
            >
              Reset session now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
