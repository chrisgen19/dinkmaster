'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { activityTimeRange, activityTitle, deriveActivityState } from '@/lib/activities';

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
 * Activities tab — a short digest of what's next and what just happened,
 * without leaving the board.
 *
 * Deliberately not a second implementation of the full calendar: it shows a
 * handful of each and links through to `/arena/[id]/activities` for the rest,
 * where RSVP, capacity, and one-off creation live. Keeping the write
 * affordances on the dedicated route stops the board from growing a second
 * place to manage the same thing.
 *
 * @param {object} props
 * @param {string} props.arenaId
 * @param {Array<object>} props.upcoming - shaped by `listActivities`
 * @param {Array<object>} props.past
 * @param {string} props.nowIso - server-rendered instant, so badges can't
 *   disagree between SSR and hydration
 */
export function ArenaActivitiesPanel({ arenaId, upcoming = [], past = [], nowIso }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  return (
    <div role="tabpanel" id="arena-panel-activities" aria-labelledby="arena-tab-activities">
      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm animate-fade-in">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-base font-extrabold tracking-tight text-slate-900 md:text-lg">
              📅 Activities
            </h3>
            <p className="mt-1.5 text-xs text-slate-500">
              Every session keeps its own standings, match log, and attendance.
            </p>
          </div>
          <Link
            href={`/arena/${arenaId}/activities`}
            className="shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:bg-slate-200 hover:text-emerald-700"
          >
            See all
          </Link>
        </div>

        <Group
          title="Next up"
          arenaId={arenaId}
          rows={upcoming.slice(0, 3)}
          now={now}
          empty="Nothing scheduled yet."
        />
        <Group
          title="Recent"
          arenaId={arenaId}
          rows={past.slice(0, 3)}
          now={now}
          empty="No finished sessions yet."
          href={`/arena/${arenaId}/activities?scope=past`}
        />
      </div>
    </div>
  );
}

function Group({ title, arenaId, rows, now, empty, href }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
          {title}
        </h4>
        {href && rows.length > 0 && (
          <Link href={href} className="text-[11px] font-bold text-slate-400 hover:text-emerald-700">
            More
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-6 text-center text-xs text-slate-400">
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <Row key={a.id} arenaId={arenaId} activity={a} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ arenaId, activity, now }) {
  const state = deriveActivityState(activity, now);
  const timeRange = activityTimeRange(activity);
  const confirmed = activity.counts.going + activity.counts.checkedIn;

  return (
    <li>
      <Link
        href={`/arena/${arenaId}/activities/${activity.id}`}
        className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition hover:border-slate-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-800">{activityTitle(activity)}</p>
          <p className="mt-0.5 truncate text-[10px] text-slate-400 tabular-nums">
            {timeRange}
            {state === 'past'
              ? ` · ${activity.matchCount} game${activity.matchCount === 1 ? '' : 's'}`
              : confirmed > 0
                ? ` · ${confirmed} going`
                : ''}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ring-1 ${STATE_STYLES[state]}`}
        >
          {STATE_LABELS[state]}
        </span>
      </Link>
    </li>
  );
}
