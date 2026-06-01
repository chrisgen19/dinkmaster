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

      {summary && summaryRowStats && (
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

/** Player-perspective stats strip. Edge-bordered ribbon (no inner card fill)
 *  so it reads as a scoreboard band on top of the parent card. Always four
 *  cells — Played / Wins / Losses / Win rate — so the cumulative win-rate
 *  stays visible at all times. Active streaks surface as a small inline chip
 *  on the corresponding outcome cell ("W3" on Wins, "L2" on Losses). */
function SummaryRow({ stats }) {
  const winStreak = stats.streak?.kind === 'W' ? stats.streak : null;
  const lossStreak = stats.streak?.kind === 'L' ? stats.streak : null;
  return (
    <div className="mx-5 md:mx-6 mb-5 grid grid-cols-4 divide-x divide-slate-200/70 border-y border-slate-200/70">
      <Stat label="Played" value={stats.total} tone="slate" />
      <Stat
        label="Wins"
        value={stats.wins}
        tone="emerald"
        chip={winStreak ? { text: `W${winStreak.count}`, tone: 'emerald' } : null}
      />
      <Stat
        label="Losses"
        value={stats.losses}
        tone="slate-dim"
        chip={lossStreak ? { text: `L${lossStreak.count}`, tone: 'slate-dim' } : null}
      />
      <Stat
        label="Win rate"
        value={stats.winPct !== null ? `${stats.winPct}%` : '—'}
        tone="slate"
      />
    </div>
  );
}

const STAT_TONE = {
  slate: 'text-slate-900',
  'slate-dim': 'text-slate-500',
  emerald: 'text-emerald-600',
};

const CHIP_TONE = {
  emerald: 'text-emerald-700 bg-emerald-50 ring-emerald-100',
  'slate-dim': 'text-slate-600 bg-slate-100 ring-slate-200',
  slate: 'text-slate-600 bg-slate-100 ring-slate-200',
};

function Stat({ label, value, tone = 'slate', chip = null }) {
  return (
    <div className="px-3 py-3.5 md:px-4 md:py-4 min-w-0">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400 truncate">
        {label}
      </p>
      <p
        className={`font-display font-extrabold tracking-tight tabular-nums leading-none mt-1.5 text-2xl md:text-[28px] flex items-baseline gap-1.5 ${STAT_TONE[tone]}`}
      >
        <span>{value}</span>
        {chip && (
          <span
            className={`text-[9px] font-extrabold uppercase tracking-widest tabular-nums rounded ring-1 px-1.5 py-0.5 ${CHIP_TONE[chip.tone]}`}
          >
            {chip.text}
          </span>
        )}
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
    <div className="sticky top-0 z-10 -mx-5 md:-mx-6 px-5 md:px-6 py-2.5 bg-slate-50/85 backdrop-blur-md border-b border-slate-200/40 mb-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">
          {label}
        </p>
        <span className="inline-flex items-center gap-1 bg-emerald-50/70 text-emerald-700 ring-1 ring-emerald-200/50 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider">
          {count} {count === 1 ? 'match' : 'matches'}
        </span>
      </div>
    </div>
  );
}

function MatchRow({ match, perspective, formatTime }) {
  const winner = winnerSide(match);
  const youOn = match.youOn;
  const youWon = perspective === 'player' ? viewerWon(match) : null;
  const diff = differential(match);

  // Border & Glow styling based on outcome
  const isPos = perspective === 'player' ? youWon === true : winner === 'a';
  const isTie = winner === 'tie';
  
  const desktopGlowClass = isPos
    ? 'sm:border-emerald-200/70 sm:shadow-[0_6px_24px_rgba(16,185,129,0.03)] sm:hover:border-emerald-400 sm:hover:shadow-[0_12px_32px_rgba(16,185,129,0.07)]'
    : isTie
      ? 'sm:border-slate-200/70 sm:hover:border-slate-350 sm:hover:shadow-[0_8px_24px_rgba(15,23,42,0.03)]'
      : 'sm:border-slate-200/50 sm:hover:border-slate-300 sm:hover:shadow-[0_8px_24px_rgba(15,23,42,0.03)]';

  const indicatorClass = isPos
    ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]'
    : isTie
      ? 'bg-slate-350'
      : 'bg-slate-200';

  return (
    <article
      className={[
        'relative overflow-hidden bg-white px-0 py-5 sm:p-5',
        'border-y border-x-0 border-dashed border-slate-200/60 rounded-none',
        'sm:border sm:border-solid sm:rounded-3xl',
        desktopGlowClass,
        'transition-all duration-300 ease-out sm:hover:-translate-y-0.5 group',
      ].join(' ')}
    >
      {/* Top glowing accent line (hover revealed) */}
      <div 
        className={[
          'absolute top-0 inset-x-0 h-[3px] transition-transform duration-500 origin-left scale-x-0 group-hover:scale-x-100',
          isPos ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-slate-300 to-slate-400'
        ].join(' ')}
        aria-hidden="true" 
      />

      {/* Meta Row */}
      <div className="flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 mb-4 pb-3 border-b border-slate-100/70">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-2 h-2 rounded-full ${indicatorClass} shrink-0`} />
          <span className="font-display font-black text-slate-800 tracking-[0.12em]">{match.courtName}</span>
          {match.arenaName && (
            <span className="truncate font-sans font-extrabold text-[8px] tracking-wider text-slate-500 bg-slate-100 border border-slate-200/40 rounded-full px-2.5 py-0.5 normal-case">
              {match.arenaName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 font-medium normal-case tracking-normal text-slate-400 font-mono text-[10px]">
          <svg className="w-3.5 h-3.5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span>{formatTime(match.timestamp)}</span>
        </div>
      </div>

      {/* Teams + score */}
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
              perspective={perspective}
              isTie={winner === 'tie'}
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
              perspective={perspective}
              isTie={winner === 'tie'}
            />
          </div>
        );
      })()}
    </article>
  );
}

function TeamCell({ team, isYou, isWinner, align, label, perspective, isTie }) {
  const justify = align === 'right' ? 'text-right items-end' : 'text-left items-start';
  const players = team.players ?? [];
  return (
    <div className={`flex flex-col ${justify} min-w-0`}>
      {/* 1. Dynamic Outcome Badge (At the very top) */}
      {isTie ? (
        <span className="inline-flex items-center gap-1 text-[8px] font-black tracking-wider uppercase bg-slate-100 text-slate-500 ring-1 ring-slate-200/50 px-2 py-0.5 rounded-full shrink-0 mb-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          Tie
        </span>
      ) : isWinner ? (
        <span className="inline-flex items-center gap-1 text-[8px] font-black tracking-wider uppercase bg-emerald-500 text-white px-2 py-0.5 rounded-full shadow-xs shadow-emerald-500/10 shrink-0 mb-1.5 animate-fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          Win
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[8px] font-black tracking-wider uppercase bg-rose-50 text-rose-600 border border-rose-100/60 px-2 py-0.5 rounded-full shrink-0 mb-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
          Lose
        </span>
      )}

      {/* 2. Team Category Label (Below win/lose) */}
      {isYou && perspective === 'player' ? (
        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-emerald-700 bg-emerald-50 border border-emerald-100/60 rounded px-1.5 py-0.5">
          {label}
        </span>
      ) : (
        <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-400 px-0.5">
          {label}
        </span>
      )}
      
      {/* 3. Roster of Player Badges (with explicit gap below the team label) */}
      <div className={`flex flex-wrap gap-2 ${align === 'right' ? 'justify-end' : 'justify-start'} max-w-full mt-2.5`}>
        {/* Render "You" pill if isYou is true and we are in player perspective */}
        {isYou && perspective === 'player' && (
          <span 
            className="inline-flex items-center gap-1.5 text-xs md:text-[13px] font-black bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-2.5 py-1 rounded-xl shadow-xs shadow-emerald-500/10 transition-all duration-300 hover:scale-102"
          >
            <svg className="w-3.5 h-3.5 text-emerald-100 shrink-0 hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>You</span>
          </span>
        )}

        {players.length === 0 && (!isYou || perspective !== 'player') ? (
          <span className="text-xs md:text-[13px] font-medium text-slate-400">—</span>
        ) : (
          players.map((p, idx) => {
            const isViewerHighlight = isYou && perspective !== 'player';
            
            const badgeClass = isViewerHighlight
              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white border-emerald-500 font-black shadow-xs shadow-emerald-500/10'
              : isWinner
                ? 'bg-slate-900 text-white border-slate-900 font-bold shadow-xs'
                : 'bg-slate-50 text-slate-600 border-slate-200/60 font-semibold hover:bg-slate-100';

            const iconClass = isViewerHighlight
              ? 'text-emerald-100'
              : isWinner
                ? 'text-slate-300'
                : 'text-slate-400';

            return (
              <span
                key={idx}
                className={[
                  'inline-flex items-center gap-1.5 text-xs md:text-[13px] px-2.5 py-1 rounded-xl border transition-all duration-300 truncate max-w-full',
                  badgeClass
                ].join(' ')}
                title={p.firstName}
              >
                <svg className={`w-3.5 h-3.5 ${iconClass} shrink-0 hidden sm:block`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <span className="truncate">{p.firstName}</span>
              </span>
            );
          })
        )}
      </div>
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

  // Score Split ratio calculation
  const total = scoreLeft + scoreRight || 1;
  const pctLeft = (scoreLeft / total) * 100;

  const isPos = perspective === 'player' ? youWon === true : differential > 0;
  const isNeg = perspective === 'player' ? youWon === false : differential < 0;
  
  const diffClass = isPos
    ? 'bg-emerald-500 text-white shadow-xs shadow-emerald-500/15'
    : isNeg
      ? 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/50'
      : 'bg-slate-50 text-slate-400 ring-1 ring-slate-150';

  return (
    <div className="flex flex-col items-center justify-center shrink-0 px-2">
      {/* Scoreboard Hub */}
      <div className="flex items-center justify-center bg-slate-50/70 border border-slate-200/30 px-4 py-1.5 rounded-2xl shadow-3xs gap-2 font-display tabular-nums leading-none">
        <span className={`text-2xl md:text-3xl font-black tracking-tight transition-colors duration-300 ${leftWon ? 'text-slate-900 font-black' : 'text-slate-400 font-bold'}`}>
          {scoreLeft}
        </span>
        <span className="text-sm text-slate-300 font-extrabold">:</span>
        <span className={`text-2xl md:text-3xl font-black tracking-tight transition-colors duration-300 ${rightWon ? 'text-slate-900 font-black' : 'text-slate-400 font-bold'}`}>
          {scoreRight}
        </span>
      </div>
      
      {/* Visual Balance Bar */}
      <div className="w-16 h-1.5 rounded-full overflow-hidden bg-slate-100 border border-slate-200/10 mt-2.5 flex shadow-4xs shrink-0">
        <div 
          className="h-full bg-emerald-500 transition-all duration-500" 
          style={{ width: `${pctLeft}%` }} 
        />
        <div 
          className="h-full bg-slate-300 transition-all duration-500" 
          style={{ width: `${100 - pctLeft}%` }} 
        />
      </div>

      {/* Spread Badge */}
      <span
        className={[
          'mt-2 text-[9px] font-black uppercase tracking-wider tabular-nums px-2 py-0.5 rounded-full transition-all duration-300 shrink-0',
          diffClass
        ].join(' ')}
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
