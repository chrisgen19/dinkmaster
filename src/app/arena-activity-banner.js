'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { deriveActivityBannerState } from './arena-activity-state';
import { activityTitle } from '@/lib/activities';

/** "in 45 min" / "in 2 h 12 min" — banner countdown copy. */
function formatCountdown(ms) {
  if (ms <= 0) return 'now';
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `in ${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

/** Format an activity's start as "Tue May 26 · 6:00 PM" in its own timezone. */
function formatStart(activity) {
  const instant = new Date(activity.startsAt);
  const timeZone = activity.timezone || 'Asia/Manila';
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

/**
 * Manager-only in-flow banner that prompts the organizer to prep the next
 * activity. Supersedes ArenaSessionPrepBanner.
 *
 * The visible behaviour is deliberately unchanged — same states, same copy
 * shape, same dismissal rules — but the CTA now acts on a specific Activity row
 * rather than on whatever the schedule rule happens to imply at tap time. That
 * closes a real gap: a manager tapping "Prepare next session" now opens exactly
 * the night shown in the banner, so the activity they see is the activity that
 * gets the rack, the matches, and the standings.
 *
 * Perpetual-rack mode (`autoResetOnSession` off) is still the one state with two
 * actions: the primary stays a non-destructive *Edit roster* opener, plus a
 * low-emphasis *Start this activity* secondary that crosses the boundary on
 * demand. Every other state keeps a single CTA.
 *
 * @param {object} props
 * @param {string} props.arenaId
 * @param {boolean} props.canManage
 * @param {{id:string, startsAt:string, endsAt:string, timezone:string}|null} props.currentActivity - the open (LIVE) activity
 * @param {{id:string, startsAt:string, endsAt:string, timezone:string, title?:string|null}|null} props.nextActivity - soonest upcoming
 * @param {boolean} props.autoResetOnSession
 * @param {number} props.checkedInCount - rack length
 * @param {boolean} props.isPending - disable action buttons while a server action is in flight
 * @param {(activityId: string) => void} props.onStartActivity - close the open activity, open this one, then open the roster modal
 * @param {() => void} props.onOpenRoster - just open the modal (no boundary crossed)
 */
export function ArenaActivityBanner({
  arenaId,
  canManage,
  currentActivity = null,
  nextActivity = null,
  autoResetOnSession = true,
  checkedInCount = 0,
  isPending = false,
  onStartActivity,
  onOpenRoster,
}) {
  // Re-evaluate every minute so a between→imminent→live transition (and the
  // "starts in N min" countdown) update without a page refresh. Only tick when
  // the banner can actually render something — a manager with an upcoming
  // activity. Spectators and arenas with no activities render null, so a
  // perpetual no-op timer would just be waste.
  const canTick = canManage && !!nextActivity;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!canTick) return undefined;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [canTick]);

  const state = useMemo(
    () => deriveActivityBannerState({ currentActivity, nextActivity, autoResetOnSession, now }),
    [currentActivity, nextActivity, autoResetOnSession, now],
  );

  // Dismissal is only offered on the imminent nudge — it's contextual ("starts
  // in 45 min") so a manager may want to stash it to focus on the live UI. The
  // between banner is the sole entry to the Prep Roster modal, so an accidental
  // ✕ would strand them; the live banner isn't rendered at all. Scoped per
  // (arena, activity), so dismissing tonight doesn't suppress next week's — and
  // now keyed by the activity's own id rather than a derived start instant.
  const canDismiss = state.kind === 'imminent';
  const activityKey = state.activity && canDismiss
    ? `arena:${arenaId}:activityPrepDismissed:${state.activity.id}`
    : null;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!activityKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset dismissed when the activity window changes (e.g. imminent → between)
      setDismissed(false);
      return;
    }
    setDismissed(sessionStorage.getItem(activityKey) === '1');
  }, [activityKey]);
  const dismiss = () => {
    if (!activityKey) return;
    setDismissed(true);
    sessionStorage.setItem(activityKey, '1');
  };

  // Suppressed during a live activity: the rack, courts, and the always-on
  // "+ Players" button already cover mid-game roster changes. Also hidden for
  // spectators, arenas with nothing upcoming, and a dismissed imminent nudge.
  if (!canManage || state.kind === 'none' || state.kind === 'live' || dismissed) return null;

  const { needsReset, activity } = state;
  const label = needsReset ? 'Prepare next session' : 'Edit roster';
  const startLabel = formatStart(activity);

  // Split the copy into a bold headline (the thing that matters at a glance —
  // the rack count or the countdown) and a muted meta line (the date), so the
  // banner reads with hierarchy instead of one dense `·`-joined string.
  let headline;
  let meta;
  if (state.kind === 'imminent') {
    const countdown = formatCountdown(state.msToStart);
    headline = needsReset ? `Session starts ${countdown}` : `${checkedInCount} on the rack`;
    meta = needsReset ? startLabel : `Starts ${countdown} · ${startLabel}`;
  } else {
    headline = needsReset ? activityTitle(activity) : `${checkedInCount} on the rack`;
    meta = needsReset ? startLabel : `Next session · ${startLabel}`;
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
            {meta && (
              <p className="mt-0.5 truncate text-xs font-medium leading-tight text-amber-700/80 tabular-nums">
                {/* The date is also the link into this activity's own page, so a
                    manager can check who's coming before prepping the rack. */}
                <Link
                  href={`/arena/${arenaId}/activities/${activity.id}`}
                  className="rounded underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/40"
                >
                  {meta}
                </Link>
              </p>
            )}
          </div>
        </div>

        {/* Actions: primary solid + optional start ghost. flex-col-reverse keeps
            the primary on top (full-width) on mobile and to the right on desktop
            — primary stays the most prominent in both. onStartActivity carries
            its own confirm prompt before crossing the boundary. */}
        <div className="relative flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:gap-2.5">
          {!autoResetOnSession && (
            <button
              type="button"
              onClick={() => onStartActivity(activity.id)}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-500/10 hover:text-amber-900 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
              disabled={isPending}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Start this activity
            </button>
          )}
          <button
            type="button"
            onClick={needsReset ? () => onStartActivity(activity.id) : onOpenRoster}
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
