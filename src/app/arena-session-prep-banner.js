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
 * Manager-only in-flow banner that prompts the organizer to prep the next
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
  // `null` until mounted, so this renders nothing during SSR and on the first
  // client pass. The initializer would otherwise run once on the server clock
  // and again on the client's, and the countdown below is minute-granular
  // (`formatCountdown`) — so any load where the two straddle a minute boundary
  // emits "starts in 45 min" on one side and "44" on the other, fails
  // hydration, and takes the whole page's server HTML with it. Same defect
  // class as the auth-status skeleton in #173, and the same fix: never derive
  // rendered output from a clock read before hydration has finished.
  const [now, setNow] = useState(null);
  useEffect(() => {
    if (!canManage || !hasSchedule) return undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first clock read, deliberately deferred past hydration
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [canManage, hasSchedule]);

  // Before the clock is read, report the same "nothing to show" state the
  // no-schedule case already produces, which every branch below already
  // handles. `deriveState` would otherwise call `.getTime()` on null.
  const state = useMemo(
    () =>
      now
        ? deriveState({ schedule, lastSessionResetAt, autoResetOnSession, now })
        : { kind: 'none', needsReset: false },
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
  // "+ Players" button already cover mid-game roster changes, so a prep
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
  const label = needsReset ? 'Prepare next session' : 'Edit roster';

  // Split the copy into a bold headline (the thing that matters at a glance —
  // the rack count or the countdown) and a muted meta line (the schedule), so
  // the banner reads with hierarchy instead of one dense `·`-joined string.
  let headline;
  let meta;
  if (state.kind === 'imminent') {
    const countdown = formatCountdown(state.msToStart);
    headline = needsReset ? `Session starts ${countdown}` : `${checkedInCount} on the rack`;
    meta = needsReset ? sessionStartLabel : `Starts ${countdown} · ${sessionStartLabel}`;
  } else {
    headline = needsReset ? 'Next session' : `${checkedInCount} on the rack`;
    meta = needsReset ? sessionStartLabel : `Next session · ${sessionStartLabel}`;
  }

  return (
    <div className="mt-3 w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8">
      <div
        role="status"
        className={`group relative overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/95 to-orange-50/90 px-4 py-3.5 text-amber-900 shadow-lg shadow-amber-900/[0.07] ring-1 ring-amber-900/5 backdrop-blur-md animate-fade-in flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${canDismiss ? 'sm:pr-12' : ''}`}
      >
        {/* Soft glow for depth — purely decorative, clipped by overflow-hidden. */}
        <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-amber-300/20 blur-2xl" />

        {canDismiss && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss session prep notice"
            className="absolute top-2.5 right-2.5 z-10 grid place-items-center h-7 w-7 rounded-lg text-amber-700/60 transition hover:bg-amber-500/10 hover:text-amber-900"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}

        {/* Status: icon chip + headline/meta. min-w-0 lets the meta truncate
            gracefully on narrow screens; pr-8 on mobile keeps it clear of the
            absolute dismiss ✕ (desktop reserves room via the container's pr). */}
        <div className={`relative flex items-center gap-3 min-w-0 ${canDismiss ? 'pr-8 sm:pr-0' : ''}`}>
          <span className="grid place-items-center h-10 w-10 shrink-0 rounded-xl bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-600/20">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="18" height="18" x="3" y="4" rx="2" />
              <path d="M16 2v4" />
              <path d="M8 2v4" />
              <path d="M3 10h18" />
              <path d="m9 16 2 2 4-4" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight tracking-tight text-amber-950 tabular-nums">{headline}</p>
            {meta && <p className="mt-0.5 truncate text-xs font-medium leading-tight text-amber-700/80 tabular-nums">{meta}</p>}
          </div>
        </div>

        {/* Actions: primary solid + optional reset ghost. flex-col-reverse keeps
            the primary on top (full-width) on mobile and to the right on desktop
            — primary stays the most prominent in both. onPrepareAndOpen carries
            its own confirm prompt before the destructive reset. */}
        <div className="relative flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:gap-2.5">
          {!autoResetOnSession && (
            <button
              type="button"
              onClick={onPrepareAndOpen}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/10 hover:text-amber-900 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
              disabled={isPending}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Reset session now
            </button>
          )}
          <button
            type="button"
            onClick={needsReset ? onPrepareAndOpen : onOpenRoster}
            className="inline-flex w-full sm:w-auto items-center justify-center rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-amber-900/20 transition hover:bg-amber-700 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
            disabled={isPending}
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}
