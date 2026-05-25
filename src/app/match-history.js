'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  differential,
  groupByDay,
  summarise,
  viewerWon,
  winnerSide,
} from '@/lib/match-history';

/**
 * Reusable match-history ledger. Renders a normalised list of `Match` records
 * (see `src/lib/match-history.js`) in one of two perspectives:
 *
 *   - `neutral` — Team A vs Team B, no viewer bias. Used by the arena's
 *     History tab to show every game played on every court.
 *   - `player`  — viewer is always on side A; outcome rail, score order, and
 *     differential are colored from their perspective. Adds the optional
 *     summary header (W/L/streak) and All/Wins/Losses filter chips.
 *
 * Pure presentational. All data shaping happens in the lib helpers so the
 * component stays focused on layout and interaction.
 */
export function MatchHistory({
  matches,
  perspective = 'neutral',
  title,
  description,
  summary = perspective === 'player',
  filters = perspective === 'player',
  // Caller-supplied stats override for the summary strip — use when the page
  // has a broader source of truth (e.g. /profile passes lifetime totals from
  // the user record so the strip isn't scoped to the visible match slice).
  // FilterPills still derive their counts from `matches` so the pill badges
  // always reflect what's actually in the filterable list.
  summaryStats,
  groupByDate = true,
  maxHeight = '600px',
  formatTimestamp,
  emptyState,
  className = '',
}) {
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'wins' | 'losses'

  // Day-bucket grouping derives keys from the viewer's local timezone, so it
  // can drift between SSR (UTC on Vercel) and hydration (the user's locale).
  // Render as a single flat list on first paint and regroup once mounted —
  // same pattern arena.js uses to mount-gate `formatTimestamp`.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag for hydration-safe day bucketing
  useEffect(() => setMounted(true), []);

  const filtered = useMemo(() => {
    if (!filters || activeFilter === 'all') return matches;
    return matches.filter((m) => {
      const w = viewerWon(m);
      // Undecided (neutral or tie) matches are excluded from win/loss buckets
      // so they only appear under "All".
      if (w === null) return false;
      return activeFilter === 'wins' ? w : !w;
    });
  }, [matches, activeFilter, filters]);

  // Auto-computed stats from the visible match slice — drives FilterPills'
  // badge counts so they always match the filterable list. SummaryRow uses
  // these too unless the caller passes `summaryStats` to override.
  const localStats = useMemo(
    () => (summary || filters ? summarise(matches) : null),
    [matches, summary, filters],
  );
  const summaryRowStats = summaryStats ?? localStats;

  const groups = useMemo(
    () =>
      groupByDate && mounted
        ? groupByDay(filtered)
        : [{ key: 'all', label: '', matches: filtered }],
    [filtered, groupByDate, mounted],
  );

  const empty = emptyState ?? DEFAULT_EMPTY[perspective];
  const formatTime = formatTimestamp ?? defaultTimeFormatter;

  return (
    <div
      className={`bg-white border border-slate-200 rounded-2xl shadow-sm animate-fade-in ${className}`}
    >
      {(title || description) && (
        <div className="px-5 md:px-6 pt-5 md:pt-6 pb-4">
          {title && (
            <h3 className="font-display text-base md:text-lg font-extrabold tracking-tight text-slate-900">
              {title}
            </h3>
          )}
          {description && (
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{description}</p>
          )}
        </div>
      )}

      {summary && summaryRowStats && summaryRowStats.total > 0 && (
        <SummaryRow stats={summaryRowStats} />
      )}

      {filters && matches.length > 0 && localStats && (
        <FilterPills
          active={activeFilter}
          onChange={setActiveFilter}
          stats={localStats}
        />
      )}

      <div
        className="px-5 md:px-6 pb-5 md:pb-6 overflow-y-auto custom-scrollbar"
        style={{ maxHeight }}
      >
        {filtered.length === 0 ? (
          <EmptyState {...empty} filtered={matches.length > 0} />
        ) : (
          <ol className="space-y-6">
            {groups.map((group) => (
              <li key={group.key}>
                {groupByDate && group.label && <GroupHeader label={group.label} count={group.matches.length} />}
                <ul className="space-y-2.5">
                  {group.matches.map((m) => (
                    <li key={m.id}>
                      <MatchRow
                        match={m}
                        perspective={perspective}
                        formatTime={formatTime}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/** Player-perspective W–L–% strip. Renders as an edge-bordered ribbon (no
 *  inner card fill) so it reads as a confident scoreboard band sitting on
 *  top of the parent card — instead of a card-in-a-card. Streak surfaces
 *  with its kind prefix ("W3" / "L2") so the value carries its own context
 *  and stays visible on mobile. */
function SummaryRow({ stats }) {
  const streakTone =
    stats.streak?.kind === 'W' ? 'emerald' : stats.streak?.kind === 'L' ? 'slate-dim' : 'slate';
  const streakValue = stats.streak
    ? `${stats.streak.kind}${stats.streak.count}`
    : stats.winPct !== null
      ? `${stats.winPct}%`
      : '—';
  return (
    <div className="mx-5 md:mx-6 mb-5 grid grid-cols-4 divide-x divide-slate-200/70 border-y border-slate-200/70">
      <Stat label="Played" value={stats.total} tone="slate" />
      <Stat label="Wins" value={stats.wins} tone="emerald" />
      <Stat label="Losses" value={stats.losses} tone="slate-dim" />
      <Stat
        label={stats.streak ? 'Streak' : 'Win rate'}
        value={streakValue}
        tone={streakTone}
      />
    </div>
  );
}

const STAT_TONE = {
  slate: 'text-slate-900',
  'slate-dim': 'text-slate-500',
  emerald: 'text-emerald-600',
};

function Stat({ label, value, tone = 'slate' }) {
  return (
    <div className="px-3 py-3.5 md:px-4 md:py-4 min-w-0">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400 truncate">
        {label}
      </p>
      <p
        className={`font-display font-extrabold tracking-tight tabular-nums leading-none mt-1.5 text-2xl md:text-[28px] ${STAT_TONE[tone]}`}
      >
        {value}
      </p>
    </div>
  );
}

const FILTER_OPTIONS = [
  { id: 'all', label: 'All' },
  { id: 'wins', label: 'Wins' },
  { id: 'losses', label: 'Losses' },
];

function FilterPills({ active, onChange, stats }) {
  const count = (id) => (id === 'wins' ? stats.wins : id === 'losses' ? stats.losses : stats.total);
  // Toggle-button group, not a tablist — the buttons don't control associated
  // tabpanels and don't implement roving focus / arrow-key navigation, so
  // `aria-pressed` is the honest pattern. The pills filter the list below;
  // assistive tech announces the active filter via `aria-pressed="true"`.
  return (
    <div className="flex gap-1.5 px-5 md:px-6 pb-4" role="group" aria-label="Filter matches">
      {FILTER_OPTIONS.map((opt) => {
        const isActive = active === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(opt.id)}
            className={[
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider transition',
              isActive
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700',
            ].join(' ')}
          >
            {opt.label}
            <span
              className={`tabular-nums text-[10px] font-bold ${
                isActive ? 'text-slate-300' : 'text-slate-400'
              }`}
            >
              {count(opt.id)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Sticky day-bucket header. Uses `sticky` so it pins as the user scrolls
 *  through long ledgers — the scroll container above gives it something to
 *  stick against. */
function GroupHeader({ label, count }) {
  return (
    <div className="sticky top-0 z-10 -mx-5 md:-mx-6 px-5 md:px-6 py-2 bg-white/95 backdrop-blur-sm border-b border-slate-100 mb-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
          {label}
        </p>
        <p className="text-[10px] font-bold tabular-nums text-slate-400">
          {count} {count === 1 ? 'match' : 'matches'}
        </p>
      </div>
    </div>
  );
}

function MatchRow({ match, perspective, formatTime }) {
  const winner = winnerSide(match);
  const youOn = match.youOn;
  const youWon = perspective === 'player' ? viewerWon(match) : null;
  const diff = differential(match);

  // Rail tone: emerald when the focused side won, slate when they lost / tie /
  // neutral. In neutral mode the focused side is always Team A.
  const railWon = perspective === 'player' ? youWon === true : winner === 'a';
  const railClass = railWon
    ? 'bg-emerald-500'
    : winner === 'tie'
      ? 'bg-slate-300'
      : 'bg-slate-200';

  return (
    <article
      className={[
        'relative grid grid-cols-[3px_1fr] gap-3 rounded-xl overflow-hidden',
        'border border-slate-200/70 bg-white',
        'hover:border-slate-300 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        'transition',
      ].join(' ')}
    >
      <span className={railClass} aria-hidden="true" />

      <div className="py-3 pr-4 min-w-0">
        {/* Meta row */}
        <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="truncate">{match.courtName}</span>
            {match.arenaName && (
              <>
                <Dot />
                <span className="truncate text-slate-500">{match.arenaName}</span>
              </>
            )}
          </div>
          <span className="shrink-0 normal-case tracking-normal text-slate-400 font-medium">
            {formatTime(match.timestamp)}
          </span>
        </div>

        {/* Teams + score — in player mode the viewer's side always sits on
            the left so the row reads "you : them". Ordering happens once
            here so the team column and the score column can't drift apart
            (which would put the wrong score under the wrong name). */}
        {(() => {
          const viewerOnLeft = perspective !== 'player' || youOn !== 'b';
          const leftSide = viewerOnLeft ? 'a' : 'b';
          const rightSide = viewerOnLeft ? 'b' : 'a';
          return (
            <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
              <TeamCell
                team={match.teams[leftSide]}
                isYou={youOn === leftSide}
                isWinner={winner === leftSide}
                align="left"
                label={labelFor(leftSide, perspective, youOn)}
              />

              <ScoreBlock
                scoreLeft={match.teams[leftSide].score}
                scoreRight={match.teams[rightSide].score}
                leftWon={winner === leftSide}
                rightWon={winner === rightSide}
                differential={diff}
                perspective={perspective}
                youWon={youWon}
              />

              <TeamCell
                team={match.teams[rightSide]}
                isYou={youOn === rightSide}
                isWinner={winner === rightSide}
                align="right"
                label={labelFor(rightSide, perspective, youOn)}
              />
            </div>
          );
        })()}
      </div>
    </article>
  );
}

function TeamCell({ team, isYou, isWinner, align, label }) {
  const names = team.players?.length
    ? team.players.map((p) => p.firstName).join(' & ')
    : '—';
  const justify = align === 'right' ? 'text-right items-end' : 'text-left items-start';
  return (
    <div className={`flex flex-col ${justify} min-w-0`}>
      <span
        className={[
          'text-[9px] font-black uppercase tracking-widest mb-1',
          isYou ? 'text-emerald-600' : 'text-slate-400',
        ].join(' ')}
      >
        {label}
      </span>
      <span
        className={[
          'text-xs md:text-[13px] font-bold truncate max-w-full',
          isWinner ? 'text-slate-900' : 'text-slate-500',
        ].join(' ')}
        title={names}
      >
        {names}
      </span>
    </div>
  );
}

/** Label for a side in the current perspective. In player mode the viewer's
 *  side reads "You" and the other reads "Opponents"; in neutral mode it's
 *  always "Team A"/"Team B". */
function labelFor(side, perspective, youOn) {
  if (perspective === 'player') {
    return youOn === side ? 'You' : 'Opponents';
  }
  return side === 'a' ? 'Team A' : 'Team B';
}

/** Dumb score renderer — receives already-ordered values from the parent so
 *  the team columns and the score columns can't get out of sync. */
function ScoreBlock({ scoreLeft, scoreRight, leftWon, rightWon, differential, perspective, youWon }) {
  const diffSign = differential > 0 ? '+' : differential < 0 ? '−' : '';
  const diffMag = Math.abs(differential);
  const diffTone = perspective === 'player'
    ? youWon
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
      : 'bg-slate-50 text-slate-500 ring-slate-200'
    : differential > 0
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
      : differential < 0
        ? 'bg-sky-50 text-sky-700 ring-sky-100'
        : 'bg-slate-50 text-slate-500 ring-slate-200';

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-baseline gap-2 font-display font-extrabold tabular-nums leading-none">
        <span className={`text-2xl md:text-[28px] ${leftWon ? 'text-slate-900' : 'text-slate-400'}`}>
          {scoreLeft}
        </span>
        <span className="text-base text-slate-300 font-normal">:</span>
        <span className={`text-2xl md:text-[28px] ${rightWon ? 'text-slate-900' : 'text-slate-400'}`}>
          {scoreRight}
        </span>
      </div>
      <span
        className={`mt-1.5 text-[9px] font-extrabold uppercase tracking-widest tabular-nums px-1.5 py-0.5 rounded ring-1 ${diffTone}`}
      >
        {diffSign}
        {diffMag}
      </span>
    </div>
  );
}

function Dot() {
  return <span className="text-slate-300" aria-hidden="true">·</span>;
}

const DEFAULT_EMPTY = {
  neutral: {
    icon: '📊',
    title: 'No matches recorded yet',
    hint: 'Completed game summaries will show up here.',
  },
  player: {
    icon: '🎾',
    title: 'No matches yet',
    hint: 'Your finished games will appear here as you play.',
  },
};

function EmptyState({ icon, title, hint, filtered }) {
  return (
    <div className="py-14 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/30">
      <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-3 text-lg">
        {icon}
      </div>
      <p className="text-sm font-semibold text-slate-600">
        {filtered ? 'No matches match this filter' : title}
      </p>
      <p className="text-xs mt-1 text-slate-400">
        {filtered ? 'Try a different filter to see more.' : hint}
      </p>
    </div>
  );
}

/** Pure string-slice fallback so server and client agree on first paint.
 *  Callers that want localized time should inject a mount-gated formatter
 *  (see `arena.js`'s `formatTimestamp`) — `toLocaleString()` here would
 *  diverge between SSR and the client and trigger hydration warnings. */
function defaultTimeFormatter(iso) {
  if (!iso || typeof iso !== 'string') return '';
  // "2026-05-25T19:42:00.000Z" → "2026-05-25 19:42"
  return iso.slice(0, 16).replace('T', ' ');
}
