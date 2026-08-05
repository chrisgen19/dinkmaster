'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { BackPill } from './back-pill';
import { MatchHistory } from './match-history';
import { toMatch } from '@/lib/match-history';
import { activityTimeRange, activityTitle } from '@/lib/activities';

/** Medal accent per podium rank (1–3); the rest fall through to slate. */
const RANK_STYLES = {
  1: 'bg-amber-100 text-amber-700 ring-amber-200',
  2: 'bg-slate-200 text-slate-600 ring-slate-300',
  3: 'bg-orange-100 text-orange-700 ring-orange-200',
};

const STATUS_STYLES = {
  LIVE: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  SCHEDULED: 'bg-sky-100 text-sky-700 ring-sky-200',
  COMPLETED: 'bg-slate-100 text-slate-500 ring-slate-200',
  CANCELLED: 'bg-rose-100 text-rose-700 ring-rose-200',
};

const STATUS_LABELS = {
  LIVE: 'Live now',
  SCHEDULED: 'Upcoming',
  COMPLETED: 'Finished',
  CANCELLED: 'Cancelled',
};

/**
 * One activity's record: standings, every match played, and who came.
 *
 * Standings arrive pre-computed from the server (via `computeActivityStandings`,
 * the same pure function the arena board uses) so a past night and the live
 * board can never disagree about a player's record.
 */
export function ArenaActivityDetail({
  arenaId,
  activity,
  standings,
  gameCount,
  playerCount,
  canManage,
}) {
  const title = activityTitle(activity);
  const timeRange = activityTimeRange(activity);
  const normalisedMatches = useMemo(
    () => activity.matches.map((m) => toMatch(m)),
    [activity.matches],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <BackPill fallbackHref={`/arena/${arenaId}/activities`} label="All activities" />
        {canManage && activity.status === 'LIVE' && (
          <Link
            href={`/arena/${arenaId}`}
            className="inline-flex items-center rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white shadow-sm transition hover:bg-emerald-700 md:px-4 md:py-2.5 md:text-sm"
          >
            Go to the board
          </Link>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-extrabold tracking-tight text-slate-900 md:text-2xl">
              {title}
            </h1>
            {timeRange && (
              <p className="mt-1 text-sm font-medium text-slate-500 tabular-nums">{timeRange}</p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${
              STATUS_STYLES[activity.status]
            }`}
          >
            {STATUS_LABELS[activity.status]}
          </span>
        </div>

        {activity.notes && <p className="mt-3 text-sm text-slate-500">{activity.notes}</p>}

        <div className="mt-5 grid grid-cols-3 gap-2 md:gap-3">
          <StatTile label="Games" value={gameCount} tone="slate" />
          <StatTile label="Players" value={playerCount} tone="emerald" />
          <StatTile label="Attending" value={activity.counts.going + activity.counts.checkedIn} tone="sky" />
        </div>
      </div>

      <Standings standings={standings} />

      {activity.attendees.length > 0 && <Attendance attendees={activity.attendees} />}

      <MatchHistory
        matches={normalisedMatches}
        perspective="neutral"
        title="Match log"
        description="Every game finished during this session, with final scores and teams."
        emptyState={
          activity.status === 'SCHEDULED'
            ? 'This session hasn’t started yet.'
            : 'No games were finished in this session.'
        }
      />
    </div>
  );
}

function Standings({ standings }) {
  if (standings.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-display text-base font-extrabold tracking-tight text-slate-900 md:text-lg">
          🏆 Standings
        </h2>
        <div className="mt-4 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/40 py-10 text-center">
          <p className="text-sm font-semibold text-slate-500">No games played yet</p>
          <p className="mt-1 text-xs text-slate-400">Standings appear as matches are finished.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="font-display text-base font-extrabold tracking-tight text-slate-900 md:text-lg">
        🏆 Standings
      </h2>
      <p className="mt-1.5 text-xs text-slate-500">
        This session only — lifetime records and ratings are unaffected.
      </p>

      {/* The table scrolls inside its own container so a narrow screen never
          scrolls the whole page sideways. */}
      <div className="mt-4 -mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[380px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th scope="col" className="w-12 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                #
              </th>
              <th scope="col" className="py-2 text-[10px] font-black uppercase tracking-wider text-slate-400">
                Player
              </th>
              <th scope="col" className="w-14 py-2 text-right text-[10px] font-black uppercase tracking-wider text-slate-400">
                W
              </th>
              <th scope="col" className="w-14 py-2 text-right text-[10px] font-black uppercase tracking-wider text-slate-400">
                L
              </th>
              <th scope="col" className="w-16 py-2 text-right text-[10px] font-black uppercase tracking-wider text-slate-400">
                Win%
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.map((p) => (
              <tr key={p.playerId} className="border-b border-slate-100 last:border-0">
                <td className="py-2.5">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ring-1 ${
                      RANK_STYLES[p.rank] ?? 'bg-slate-100 text-slate-500 ring-slate-200'
                    }`}
                  >
                    {p.rank}
                  </span>
                </td>
                <td className="py-2.5 pr-2 font-bold text-slate-800">
                  <span className="block truncate">{p.name}</span>
                  <span className="text-[10px] font-medium text-slate-400 tabular-nums">
                    {p.games} game{p.games !== 1 ? 's' : ''}
                  </span>
                </td>
                <td className="py-2.5 text-right font-extrabold tabular-nums text-emerald-700">{p.wins}</td>
                <td className="py-2.5 text-right font-semibold tabular-nums text-slate-400">{p.losses}</td>
                <td className="py-2.5 text-right font-semibold tabular-nums text-slate-600">{p.winPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ATTENDEE_STYLES = {
  GOING: 'bg-sky-50 text-sky-700 ring-sky-200',
  CHECKED_IN: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  WAITLIST: 'bg-amber-50 text-amber-700 ring-amber-200',
  DECLINED: 'bg-slate-50 text-slate-400 ring-slate-200',
  NO_SHOW: 'bg-rose-50 text-rose-600 ring-rose-200',
};

const ATTENDEE_LABELS = {
  GOING: 'Going',
  CHECKED_IN: 'Checked in',
  WAITLIST: 'Waitlist',
  DECLINED: 'Can’t make it',
  NO_SHOW: 'No show',
};

function Attendance({ attendees }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="font-display text-base font-extrabold tracking-tight text-slate-900 md:text-lg">
        Attendance
      </h2>
      <ul className="mt-4 space-y-1.5">
        {attendees.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2"
          >
            <span className="min-w-0 truncate text-sm font-semibold text-slate-700">
              {a.displayName}
              {a.status === 'WAITLIST' && a.position != null && (
                <span className="ml-1.5 text-[10px] font-bold tabular-nums text-amber-600">
                  #{a.position}
                </span>
              )}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1 ${
                ATTENDEE_STYLES[a.status]
              }`}
            >
              {ATTENDEE_LABELS[a.status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TONE_CLASSES = {
  slate: 'text-slate-900',
  emerald: 'text-emerald-700',
  sky: 'text-sky-700',
};

function StatTile({ label, value, tone = 'slate' }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200 md:px-4 md:py-3.5">
      <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 md:text-[11px]">
        {label}
      </p>
      <p
        className={`font-display mt-1 text-2xl font-extrabold leading-none tracking-tight tabular-nums md:text-3xl ${TONE_CLASSES[tone]}`}
      >
        {value}
      </p>
    </div>
  );
}
