'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { BackPill } from './back-pill';
import { activityTimeRange, activityTitle, deriveActivityState } from '@/lib/activities';

/** Badge styling per derived state. */
const STATE_STYLES = {
  live: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  upcoming: 'bg-sky-100 text-sky-700 ring-sky-200',
  past: 'bg-slate-100 text-slate-500 ring-slate-200',
  cancelled: 'bg-rose-100 text-rose-700 ring-rose-200',
};

const STATE_LABELS = {
  live: 'Live now',
  upcoming: 'Upcoming',
  past: 'Finished',
  cancelled: 'Cancelled',
};

/**
 * The club calendar — every scheduled night, upcoming and past.
 *
 * Scope switching is real URL navigation (`?scope=past`) rather than local
 * state, so a link to a past night's list survives a share and the back button
 * behaves. The `<Link>`s below are what actually change scope; `scope` is only
 * read here to style the active pill.
 *
 * @param {object} props
 * @param {string} props.arenaId
 * @param {string} props.arenaName
 * @param {Array<object>} props.activities - shaped by `listActivities`
 * @param {'upcoming'|'past'} props.scope
 * @param {boolean} props.canManage
 * @param {boolean} props.hasSchedule - drives the empty-state copy: no schedule
 *   is a fixable setup problem, an empty list with a schedule just means quiet.
 */
export function ArenaActivitiesList({
  arenaId,
  arenaName,
  activities,
  scope,
  canManage,
  hasSchedule,
  nowIso,
}) {
  // `now` comes from the server rather than `new Date()` here: the badge is
  // derived by comparing against `endsAt`, and a clock read on the client would
  // be a different instant than the one that rendered the HTML — a hydration
  // mismatch for any row sitting near its boundary.
  //
  // No such care is needed for the date/time labels: `activityTitle` and
  // `activityTimeRange` format against each activity's OWN timezone snapshot,
  // not the viewer's locale, so they're identical on both sides.
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <BackPill fallbackHref={`/arena/${arenaId}`} label="Back to arena" />
        {canManage && (
          <Link
            href={`/arena/${arenaId}/settings/schedule`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs md:text-sm font-extrabold px-3 py-2 md:px-4 md:py-2.5 shadow-sm transition"
          >
            Edit schedule
          </Link>
        )}
      </div>

      <div>
        <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900">
          Activities
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Every session at {arenaName}. Each one keeps its own standings and match log.
        </p>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Activity scope">
        <ScopePill arenaId={arenaId} target="upcoming" active={scope === 'upcoming'}>
          Upcoming
        </ScopePill>
        <ScopePill arenaId={arenaId} target="past" active={scope === 'past'}>
          Past
        </ScopePill>
      </div>

      {activities.length === 0 ? (
        <EmptyState arenaId={arenaId} scope={scope} canManage={canManage} hasSchedule={hasSchedule} />
      ) : (
        <ul className="space-y-3">
          {activities.map((a) => (
            <ActivityCard key={a.id} arenaId={arenaId} activity={a} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScopePill({ arenaId, target, active, children }) {
  return (
    <Link
      href={`/arena/${arenaId}/activities${target === 'past' ? '?scope=past' : ''}`}
      role="tab"
      aria-selected={active}
      className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
        active
          ? 'bg-slate-900 text-white shadow-sm'
          : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
      }`}
    >
      {children}
    </Link>
  );
}

function ActivityCard({ arenaId, activity, now }) {
  const state = deriveActivityState(activity, now);
  const title = activityTitle(activity);
  const timeRange = activityTimeRange(activity);
  const { going, waitlist, checkedIn } = activity.counts;
  const confirmed = going + checkedIn;

  return (
    <li>
      <Link
        href={`/arena/${arenaId}/activities/${activity.id}`}
        className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-base font-extrabold tracking-tight text-slate-900 truncate">
              {title}
            </p>
            {timeRange && (
              <p className="mt-0.5 text-xs font-medium text-slate-500 tabular-nums">{timeRange}</p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${STATE_STYLES[state]}`}
          >
            {STATE_LABELS[state]}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          {/* A finished night is judged by games played; an upcoming one by who's
              coming. Showing "0 games" on a night that hasn't happened would read
              as a failure rather than a fact. */}
          {state === 'past' || state === 'live' ? (
            <Stat value={activity.matchCount} noun="game" />
          ) : null}
          {confirmed > 0 && <Stat value={confirmed} noun="going" plural="going" />}
          {waitlist > 0 && <Stat value={waitlist} noun="on the waitlist" plural="on the waitlist" />}
          {activity.capacity != null && (
            <span className="tabular-nums">cap {activity.capacity}</span>
          )}
          {confirmed === 0 && waitlist === 0 && state !== 'past' && state !== 'live' && (
            <span className="text-slate-400">No RSVPs yet</span>
          )}
        </div>

        {activity.notes && (
          <p className="mt-2 line-clamp-2 text-xs text-slate-500">{activity.notes}</p>
        )}
      </Link>
    </li>
  );
}

function Stat({ value, noun, plural }) {
  const label = value === 1 ? noun : (plural ?? `${noun}s`);
  return (
    <span className="tabular-nums">
      <strong className="font-bold text-slate-700">{value}</strong> {label}
    </span>
  );
}

function EmptyState({ arenaId, scope, canManage, hasSchedule }) {
  // Two genuinely different situations: no schedule is a setup problem a manager
  // can fix right now, whereas an empty list with a schedule set just means
  // nothing has happened yet.
  const needsSchedule = scope === 'upcoming' && !hasSchedule;

  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/40 py-14 text-center">
      <p className="text-sm font-semibold text-slate-500">
        {needsSchedule
          ? 'No schedule set yet'
          : scope === 'past'
            ? 'No finished sessions yet'
            : 'No upcoming sessions'}
      </p>
      <p className="mx-auto mt-1 max-w-sm px-6 text-xs text-slate-400">
        {needsSchedule
          ? 'Set your club’s play days and activities will be created automatically, week after week.'
          : scope === 'past'
            ? 'Once a session is closed it lands here with its standings and match log.'
            : 'Activities are generated from your schedule as each play day approaches.'}
      </p>
      {needsSchedule && canManage && (
        <Link
          href={`/arena/${arenaId}/settings/schedule`}
          className="mt-4 inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
        >
          Set a schedule
        </Link>
      )}
    </div>
  );
}
