'use client';

import { useMemo } from 'react';
import { eloToDupr } from '@/lib/rating';
import {
  arenaMatchToRow,
  bestPartner,
  currentStreak,
  enrichRecentMatches,
  favoriteCourt,
  monogram,
} from '@/lib/user-insights';
import { toMatch } from '@/lib/match-history';
import { MatchHistory } from './match-history';

/**
 * My Stats tab — the viewer's per-arena page within an arena. Mirrors the
 * editorial layout of `/profile` but scoped to a single arena's match history:
 * compact monogram + name, a live-status strip (queue position + per-arena
 * DUPR), three insight cards (best partner / favorite court / streak), and
 * the shared <MatchHistory perspective="player"> for the matches feed.
 *
 * Pure presentational over already-loaded state — the parent (`arena.js`)
 * owns `matchHistory`, `queue`, `courts`, and `myPlayer`.
 *
 * @param {object} props
 * @param {object} props.myPlayer - viewer's player record in this arena
 * @param {object[]} props.matchHistory - arena-shape match records
 * @param {string[]} props.queue - player ids in rack order
 * @param {{team1: string[], team2: string[]}[]} props.courts - active courts
 * @param {(iso: string) => string} props.formatTimestamp - SSR-safe formatter
 *   from the parent's mount-gated helper
 */
export function ArenaMyStats({
  myPlayer,
  matchHistory,
  queue,
  courts,
  formatTimestamp,
}) {
  const fullName = myPlayer.lastName
    ? `${myPlayer.firstName} ${myPlayer.lastName}`
    : myPlayer.firstName;

  // Convert arena matches to the matchPlayer-row shape used by user-insights
  // helpers. Filter drops matches the viewer wasn't in.
  const rows = useMemo(
    () => matchHistory.map((m) => arenaMatchToRow(m, myPlayer.id)).filter(Boolean),
    [matchHistory, myPlayer.id],
  );

  const insights = useMemo(
    () => ({
      bestPartner: bestPartner(rows, new Set([myPlayer.id])),
      favoriteCourt: favoriteCourt(rows),
      streak: currentStreak(rows),
    }),
    [rows, myPlayer.id],
  );

  // Player-shape feed for <MatchHistory> — partner/opponent rosters baked in
  // so the row labels read "you : opponents" with names.
  const matches = useMemo(() => {
    const enriched = enrichRecentMatches(rows, new Set([myPlayer.id]));
    return enriched.map((m) => toMatch({ ...m, id: m.matchId }));
  }, [rows, myPlayer.id]);

  const decided = myPlayer.wins + myPlayer.losses;
  // SummaryRow draws from this so the ribbon reads as arena-lifetime instead
  // of just the visible feed; streak comes from `insights` so it agrees with
  // the Insights card above. Same pattern used on /profile.
  const lifetimeSummary = {
    total: myPlayer.gamesPlayed,
    wins: myPlayer.wins,
    losses: myPlayer.losses,
    winPct: decided > 0 ? Math.round((myPlayer.wins / decided) * 100) : null,
    streak: insights.streak,
  };

  const queueIndex = queue.indexOf(myPlayer.id);
  const onCourt = courts.some(
    (c) => c.team1.includes(myPlayer.id) || c.team2.includes(myPlayer.id),
  );
  const queueLabel = queueIndex >= 0
    ? `In the rack · #${queueIndex + 1}`
    : onCourt ? 'On a court' : 'Not in the rack';
  const queueTone = queueIndex >= 0 ? 'emerald' : onCourt ? 'sky' : 'slate';
  const ratingLabel = myPlayer.gamesPlayed > 0
    ? eloToDupr(myPlayer.rating).toFixed(3)
    : '—';
  const hasGames = myPlayer.gamesPlayed > 0;

  return (
    <div
      role="tabpanel"
      id="arena-panel-mystats"
      aria-labelledby="arena-tab-mystats"
      className="space-y-8 animate-fade-in"
    >
      {/* IDENTITY ── smaller monogram than /profile so it doesn't fight the
          arena hero above. "In this arena" eyebrow makes the scope explicit. */}
      <header className="flex items-center gap-4">
        <Monogram name={fullName} />
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400 mb-1">
            In this arena
          </p>
          <h3 className="font-display font-extrabold tracking-tight text-slate-900 leading-[1.05] text-2xl md:text-[28px] truncate">
            {fullName}
          </h3>
        </div>
      </header>

      {/* LIVE STATUS ── two compact tiles: where am I right now, what's my
          rating in this arena. Both are arena-specific and change in real time
          (queue updates) so they sit prominently near the top. */}
      <LiveStatus
        queueLabel={queueLabel}
        queueTone={queueTone}
        ratingLabel={ratingLabel}
      />

      {/* INSIGHTS ── three cards scoped to this arena's matches. */}
      <section>
        <SectionHeader
          title="Insights"
          hint={hasGames ? null : 'Play a few matches in this arena and patterns will show up here.'}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 mt-4">
          <InsightCard
            eyebrow="Best partner"
            primary={insights.bestPartner?.name ?? '—'}
            secondary={
              insights.bestPartner
                ? `${insights.bestPartner.games} together · ${insights.bestPartner.winPct}% win rate`
                : 'No partners yet'
            }
            accent={insights.bestPartner && insights.bestPartner.winPct >= 50 ? 'emerald' : 'slate'}
          />
          <InsightCard
            eyebrow="Favorite court"
            primary={insights.favoriteCourt?.name ?? '—'}
            secondary={
              insights.favoriteCourt
                ? `${insights.favoriteCourt.games} ${insights.favoriteCourt.games === 1 ? 'match' : 'matches'} here`
                : 'No matches yet'
            }
          />
          <InsightCard
            eyebrow={insights.streak ? `${insights.streak.kind === 'W' ? 'Win' : 'Loss'} streak` : 'Streak'}
            primary={insights.streak ? `${insights.streak.kind}${insights.streak.count}` : '—'}
            secondary={
              insights.streak
                ? insights.streak.count === 1
                  ? 'Just the latest match'
                  : `${insights.streak.count} in a row`
                : 'Waiting on your first match'
            }
            accent={insights.streak?.kind === 'W' ? 'emerald' : insights.streak?.kind === 'L' ? 'slate-dim' : 'slate'}
            monospace
          />
        </div>
      </section>

      {/* MATCHES ── shared MatchHistory ledger with player perspective. */}
      <section>
        <SectionHeader title="Matches" count={matches.length} />
        <div className="mt-4">
          <MatchHistory
            matches={matches}
            perspective="player"
            maxHeight="640px"
            summaryStats={lifetimeSummary}
            formatTimestamp={formatTimestamp}
            emptyState={{
              icon: '🎾',
              title: 'No matches yet in this arena',
              hint: 'Your finished games here will appear in this feed.',
            }}
          />
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

/** Compact circular monogram. Smaller than the /profile variant so it doesn't
 *  compete with the arena hero rendered above this tab. Decorative — the name
 *  is rendered right next to it. */
function Monogram({ name }) {
  const initials = monogram(name);
  return (
    <div aria-hidden="true" className="relative shrink-0">
      <div className="absolute inset-0 rounded-full bg-emerald-200/40 blur-lg" />
      <div className="relative h-14 w-14 md:h-16 md:w-16 rounded-full bg-slate-900 text-white grid place-items-center ring-1 ring-slate-200 shadow-[0_6px_18px_rgba(15,23,42,0.15)]">
        <span className="font-display font-extrabold tracking-tight text-base md:text-lg">
          {initials}
        </span>
      </div>
    </div>
  );
}

const TONE_RING = {
  slate: 'border-slate-200/80 bg-white',
  emerald: 'border-emerald-200/80 bg-emerald-50/40',
  sky: 'border-sky-200/80 bg-sky-50/40',
};

const TONE_TEXT = {
  slate: 'text-slate-900',
  emerald: 'text-emerald-700',
  sky: 'text-sky-700',
};

/** Two-tile strip: current queue position + per-arena rating. Arena-specific
 *  data that doesn't live on /profile — gets prominent placement here. */
function LiveStatus({ queueLabel, queueTone, ratingLabel }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
      <StatusTile
        eyebrow="Right now"
        value={queueLabel}
        tone={queueTone}
      />
      <StatusTile
        eyebrow="This arena · DUPR"
        value={ratingLabel}
        tone="slate"
        monospace
      />
    </div>
  );
}

function StatusTile({ eyebrow, value, tone = 'slate', monospace = false }) {
  return (
    <div className={`rounded-2xl border px-4 py-3.5 md:px-5 md:py-4 shadow-sm ${TONE_RING[tone]}`}>
      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">
        {eyebrow}
      </p>
      <p
        className={[
          'font-display font-extrabold tracking-tight leading-none mt-1.5 text-lg md:text-xl truncate',
          monospace ? 'tabular-nums' : '',
          TONE_TEXT[tone],
        ].join(' ')}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

function SectionHeader({ title, count, hint }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2.5">
      <h4 className="font-display text-base md:text-lg font-extrabold tracking-tight text-slate-900 flex items-baseline gap-2">
        {title}
        {typeof count === 'number' && (
          <span className="text-xs font-bold tabular-nums text-slate-400">{count}</span>
        )}
      </h4>
      {hint && (
        <p className="text-[11px] text-slate-400 max-w-[20rem] text-right leading-snug">
          {hint}
        </p>
      )}
    </div>
  );
}

const INSIGHT_ACCENT = {
  slate: 'text-slate-900',
  'slate-dim': 'text-slate-500',
  emerald: 'text-emerald-600',
};

function InsightCard({ eyebrow, primary, secondary, accent = 'slate', monospace = false }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-5 shadow-sm">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">{eyebrow}</p>
      <p
        className={[
          'font-display font-extrabold tracking-tight leading-none mt-2 text-xl md:text-2xl truncate',
          monospace ? 'tabular-nums' : '',
          INSIGHT_ACCENT[accent],
        ].join(' ')}
        title={typeof primary === 'string' ? primary : undefined}
      >
        {primary}
      </p>
      <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{secondary}</p>
    </div>
  );
}
