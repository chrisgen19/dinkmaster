import Link from 'next/link';
import { eloToDupr } from '@/lib/rating';
import { monogram } from '@/lib/user-insights';
import { toMatch } from '@/lib/match-history';
import { AuthStatus } from '../auth-status';
import { SiteHeader } from '../site-header';
import { BackPill } from '../back-pill';
import { MatchHistory } from '../match-history';

/**
 * Shared profile layout, rendered for both the viewer's own `/profile` and
 * another user's `/u/[userId]`. Pure presentation — the caller fetches and
 * passes the stats bundle. The email line renders only when `email` is given,
 * which is the single difference between own (with email) and others (without).
 *
 * @param {object} props
 * @param {string} props.name
 * @param {string} [props.email] - omit to hide the email line (other users)
 * @param {{
 *   totals: object,
 *   arenas: Array<object>,
 *   recentMatches: Array<object>,
 *   insights: { bestPartner: object|null, favoriteCourt: object|null, streak: object|null },
 * }} props.stats
 * @param {string} [props.backHref]
 * @param {string} [props.badge] - small chip by the name (e.g. "Walk-in")
 * @param {boolean} [props.isSelf] - the viewer's own profile; selects first-person empty-state copy
 */
export function ProfileView({ name, email = null, stats, backHref = '/arenas', badge = null, isSelf = false }) {
  const { totals, arenas, recentMatches, insights } = stats;
  const hasGames = totals.gamesPlayed > 0;
  const decided = totals.wins + totals.losses;
  // Normalise on the server so the client component never branches on shape.
  const matches = recentMatches.map((m) => toMatch({ ...m, id: m.matchId }));
  // Lifetime stats fed into MatchHistory's SummaryRow so the strip reads as
  // a career summary instead of being scoped to the visible 20-match slice.
  // Streak comes from `insights.streak` (computed over up to 500 matches) so
  // it agrees with the Insights card by construction — no scope mismatch.
  const lifetimeSummary = {
    total: totals.gamesPlayed,
    wins: totals.wins,
    losses: totals.losses,
    winPct: decided > 0 ? totals.winPct : null,
    streak: insights.streak,
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <SiteHeader variant="home">
        <AuthStatus />
      </SiteHeader>

      {/* Soft brand wash, kept faint so the page reads editorial, not flashy. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden">
        <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-emerald-200/25 blur-3xl" />
        <div className="absolute -top-24 right-0 h-80 w-80 rounded-full bg-sky-200/25 blur-3xl" />
      </div>

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-12 space-y-10">
        <BackPill fallbackHref={backHref} label="All arenas" />

        {/* IDENTITY ── monogram tile + name (+ email for self), with the rating
            reading big to the right on desktop so the page opens on a strong note. */}
        <header className="animate-fade-in [animation-delay:40ms] flex flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-8">
          <div className="flex items-center gap-4 md:gap-5 min-w-0">
            <Monogram name={name} />
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400 mb-1">
                Player profile
              </p>
              <h1 className="font-display font-extrabold tracking-tight text-slate-900 leading-[1.05] text-3xl md:text-4xl lg:text-[44px] truncate">
                {name}
              </h1>
              {badge && (
                <span className="mt-1.5 inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  {badge}
                </span>
              )}
              {email && <p className="text-sm text-slate-500 mt-1 truncate">{email}</p>}
            </div>
          </div>

          <RatingDisplay rating={totals.rating} isSelf={isSelf} />
        </header>

        {/* THIS WEEK ── small accent strip; hidden if nothing happened. */}
        {(totals.weeklyWins > 0 || totals.weeklyArenasLed > 0) && (
          <section className="animate-fade-in [animation-delay:180ms]">
            <WeeklyStrip wins={totals.weeklyWins} arenasLed={totals.weeklyArenasLed} />
          </section>
        )}

        {/* INSIGHTS ── three cards: best partner / favorite court / streak. */}
        <section className="animate-fade-in [animation-delay:240ms]">
          <SectionHeader
            title="Insights"
            hint={
              hasGames
                ? null
                : isSelf
                  ? 'Play a few matches and we’ll start showing patterns.'
                  : 'A few matches in, patterns start to show.'
            }
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
              accent={insights.bestPartner && insights.bestPartner.winPct > 50 ? 'emerald' : 'slate'}
            />
            <InsightCard
              eyebrow="Favorite court"
              primary={insights.favoriteCourt?.name ?? '—'}
              secondary={
                insights.favoriteCourt
                  ? `${insights.favoriteCourt.games} ${insights.favoriteCourt.games === 1 ? 'match' : 'matches'}`
                  : 'No matches yet'
              }
            />
            <InsightCard
              eyebrow={insights.streak ? `${insights.streak.kind === 'W' ? 'Win' : 'Loss'} streak` : 'Streak'}
              primary={
                insights.streak
                  ? `${insights.streak.kind}${insights.streak.count}`
                  : '—'
              }
              secondary={
                insights.streak
                  ? insights.streak.count === 1
                    ? 'Just the latest match'
                    : `${insights.streak.count} in a row`
                  : hasGames
                    ? 'No active streak'
                    : isSelf
                      ? 'Waiting on your first match'
                      : 'No matches played yet'
              }
              accent={insights.streak?.kind === 'W' ? 'emerald' : insights.streak?.kind === 'L' ? 'slate-dim' : 'slate'}
              monospace
            />
          </div>
        </section>

        {/* ARENAS ── card grid replaces the dense table. */}
        <section className="animate-fade-in [animation-delay:300ms]">
          <SectionHeader title={isSelf ? 'My arenas' : 'Arenas'} count={arenas.length} />
          {arenas.length === 0 ? (
            <EmptyArenas isSelf={isSelf} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mt-4">
              {arenas.map((a) => (
                <ArenaCard key={a.arenaId} arena={a} />
              ))}
            </div>
          )}
        </section>

        {/* RECENT MATCHES ── delegated to the shared MatchHistory ledger. */}
        <section className="animate-fade-in [animation-delay:360ms]">
          <SectionHeader title="Recent matches" count={recentMatches.length} />
          <div className="mt-4">
            <MatchHistory
              matches={matches}
              perspective="player"
              // On another player's profile the subject's side reads as their
              // first name instead of "You"; own profile keeps "You".
              subjectName={isSelf ? null : name.split(' ')[0]}
              maxHeight="640px"
              // SummaryRow is the page's primary stats display now that the
              // hero ramp is gone. Pass lifetime totals so the strip isn't
              // scoped to the visible 20-match slice; streak comes from the
              // 500-match insights so it matches the Insights card.
              summaryStats={lifetimeSummary}
              emptyState={{
                icon: '🎾',
                title: 'No matches yet',
                hint: isSelf
                  ? 'Your finished games will appear here as you play.'
                  : 'Finished games will appear here as they play.',
              }}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Identity + chrome */

/** Big circular monogram tile in slate-900 with white initials. Subtle ring
 *  highlight + cross-hatched corner accents to keep it from feeling flat. */
function Monogram({ name }) {
  const initials = monogram(name);
  // Whole tile is decorative — the user's full name is rendered right next to
  // it, so announcing "CD" would just add noise for screen readers.
  return (
    <div aria-hidden="true" className="relative shrink-0">
      <div className="absolute inset-0 rounded-full bg-emerald-200/50 blur-xl" />
      <div className="relative h-20 w-20 md:h-24 md:w-24 rounded-full bg-slate-900 text-white grid place-items-center ring-1 ring-slate-200 shadow-[0_8px_24px_rgba(15,23,42,0.18)]">
        <span className="font-display font-extrabold tracking-tight text-2xl md:text-3xl">
          {initials}
        </span>
      </div>
    </div>
  );
}

/** Right-aligned rating block on the identity row. Shows '—' when unrated so
 *  the rhythm of the row stays intact for brand-new accounts. */
function RatingDisplay({ rating, isSelf = false }) {
  const dupr = rating !== null ? eloToDupr(rating).toFixed(3) : null;
  const unrated = isSelf ? 'Play a match to seed your rating' : 'No rating yet — needs a match';
  return (
    <div className="md:text-right shrink-0">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400">
        Rating
      </p>
      <p className="font-display font-extrabold tracking-tight tabular-nums text-slate-900 leading-none mt-1 text-4xl md:text-5xl">
        {dupr ?? '—'}
      </p>
      <p className="text-xs text-slate-400 mt-1">{dupr ? 'DUPR-style' : unrated}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Weekly callout */

function WeeklyStrip({ wins, arenasLed }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-2 rounded-full border border-emerald-200/70 bg-emerald-50/60 pl-2 pr-4 py-1.5 ring-1 ring-emerald-100/60">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 text-white text-[10px] font-black uppercase tracking-widest px-2.5 py-1">
        <Spark /> This week
      </span>
      {wins > 0 && (
        <span className="text-xs font-bold text-emerald-800 tabular-nums">
          {wins} {wins === 1 ? 'win' : 'wins'}
        </span>
      )}
      {arenasLed > 0 && (
        <span className="text-xs font-bold text-emerald-800 tabular-nums">
          🏆 leading {arenasLed} {arenasLed === 1 ? 'arena' : 'arenas'}
        </span>
      )}
    </div>
  );
}

function Spark() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2 14.39 8.26 21 9l-5 4.87L17.18 22 12 18.27 6.82 22 8 13.87 3 9l6.61-.74L12 2z" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Section header */

function SectionHeader({ title, count, hint }) {
  return (
    <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2.5">
      <h2 className="font-display text-base md:text-lg font-extrabold tracking-tight text-slate-900 flex items-baseline gap-2">
        {title}
        {typeof count === 'number' && (
          <span className="text-xs font-bold tabular-nums text-slate-400">{count}</span>
        )}
      </h2>
      {hint && <p className="text-[11px] text-slate-400 max-w-[20rem] text-right leading-snug">{hint}</p>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Insights */

const INSIGHT_ACCENT = {
  slate: 'text-slate-900',
  'slate-dim': 'text-slate-500',
  emerald: 'text-emerald-700',
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

/* ─────────────────────────────────────────────────────────────────────────── */
/* Arena card grid */

function ArenaCard({ arena }) {
  const rating = arena.gamesPlayed > 0 ? eloToDupr(arena.rating).toFixed(3) : '—';
  return (
    <Link
      href={`/arena/${arena.arenaId}`}
      className="group relative block bg-white border border-slate-200 rounded-2xl p-4 md:p-5 shadow-sm hover:border-slate-300 hover:shadow-md transition"
    >
      {/* Decorative top-edge accent — emerald when leading, slate otherwise. */}
      <span
        aria-hidden="true"
        className={`absolute top-0 left-5 right-5 h-px ${
          arena.weeklyRank === 1 ? 'bg-emerald-500' : 'bg-slate-200'
        }`}
      />

      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display font-extrabold tracking-tight text-slate-900 text-base md:text-lg leading-tight group-hover:text-emerald-700 transition-colors">
          {arena.arenaName}
        </h3>
        {!arena.active && (
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400">
            Left
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">Rating</p>
          <p className="font-display font-extrabold tracking-tight tabular-nums text-slate-900 leading-none mt-1 text-xl md:text-2xl">
            {rating}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">Record</p>
          <p className="font-display font-extrabold tracking-tight tabular-nums leading-none mt-1 text-xl md:text-2xl">
            <span className="text-emerald-700 font-bold">{arena.wins}</span>
            <span className="text-slate-300 font-normal mx-1">–</span>
            <span className="text-slate-500">{arena.losses}</span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {arena.weeklyWins > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 bg-emerald-50 ring-1 ring-emerald-100 rounded-full px-2 py-0.5 tabular-nums">
            {arena.weeklyWins}W this wk
            {arena.weeklyRank === 1 && <span aria-hidden="true">🏆</span>}
            {arena.weeklyRank && arena.weeklyRank > 1 && <span className="text-emerald-700 font-bold">#{arena.weeklyRank}</span>}
          </span>
        )}
        {arena.inQueue && (
          <span className="inline-flex items-center text-[10px] font-extrabold uppercase tracking-widest text-sky-700 bg-sky-50 ring-1 ring-sky-100 rounded-full px-2 py-0.5">
            In rack
          </span>
        )}
        <span
          aria-hidden="true"
          className="ml-auto text-[10px] font-bold uppercase tracking-widest text-slate-300 group-hover:text-emerald-700 transition-colors"
        >
          Open →
        </span>
      </div>
    </Link>
  );
}

// Empty arenas state. Normally only the viewer's own profile reaches this (a
// shared-arena viewer's target has play records), but access is gated on
// membership rather than Player rows, so don't assume self — branch the copy so
// another member with no records never reads the first-person line.
function EmptyArenas({ isSelf = false }) {
  if (!isSelf) {
    return (
      <div className="mt-4 py-12 text-center text-sm text-slate-500 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/40">
        <p className="font-semibold text-slate-600">No arena records yet.</p>
      </div>
    );
  }
  return (
    <div className="mt-4 py-12 text-center text-sm text-slate-500 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/40">
      <p className="font-semibold text-slate-600">You haven&apos;t joined an arena yet.</p>
      <p className="text-xs mt-1">
        <Link href="/arenas" className="text-emerald-700 font-semibold hover:text-emerald-800">
          Browse arenas
        </Link>{' '}
        to start playing.
      </p>
    </div>
  );
}
