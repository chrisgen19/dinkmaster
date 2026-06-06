import Link from 'next/link';
import { listArenas, getUserMemberships, getUserPendingRequestArenaIds } from '@/lib/arenas';
import { partitionArenaDirectory } from '@/lib/arena-directory';
import { getCurrentUser } from '@/lib/session';
import { AuthStatus } from '../auth-status';
import { SiteHeader } from '../site-header';
import { Users, Layers, Trophy, ArrowRight, Sparkles, MapPin, Calendar } from 'lucide-react';
import { hasConfiguredSchedule, describeSchedule } from '@/lib/schedule-format';

// Always read the fresh arena list on each request.
export const dynamic = 'force-dynamic';

/** Adapt a directory row's flat `schedule*` columns to the canonical
 *  `{days, start, end, timezone}` shape the shared schedule helpers take. */
const toSchedule = (a) => ({
  days: a.scheduleDays ?? [],
  start: a.scheduleStart,
  end: a.scheduleEnd,
  timezone: a.timezone,
});

const ROLE_BADGE = {
  OWNER: 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 border border-emerald-500/20 shadow-sm shadow-emerald-500/5',
  ORGANIZER: 'bg-sky-500/10 text-sky-700 ring-sky-600/20 border border-sky-500/20 shadow-sm shadow-sky-500/5',
  MEMBER: 'bg-slate-500/10 text-slate-600 ring-slate-600/20 border border-slate-500/10 shadow-sm shadow-slate-500/5',
};

function ArenaCard({ arena, role, isPending }) {
  return (
    <Link
      href={`/arena/${arena.id}`}
      className="group relative bg-white border border-slate-200/80 rounded-2xl p-5
        shadow-[0_1px_2px_rgba(15,23,42,0.04)]
        hover:border-emerald-500/50 hover:shadow-[0_16px_32px_-12px_rgba(16,185,129,0.18),0_4px_12px_rgba(16,185,129,0.04)]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2
        transition duration-300 flex flex-col hover:-translate-y-1 overflow-hidden"
    >
      {/* Premium top gradient line */}
      <div 
        className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500 z-20" 
        aria-hidden="true" 
      />

      {/* Radial soft glow */}
      <div 
        className="absolute top-0 right-0 w-36 h-36 bg-gradient-to-br from-emerald-500/10 to-teal-500/5 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-0" 
        aria-hidden="true" 
      />

      {/* Card Header */}
      <div className="flex items-start justify-between gap-3 relative z-10">
        <div className="min-w-0">
          <h3 className="font-display text-base font-extrabold text-slate-900 group-hover:text-emerald-700 transition leading-snug truncate">
            {arena.name}
          </h3>
          <p className="text-[10px] text-slate-400 mt-0.5 truncate" title={`Organized by ${arena.ownerName}`}>
            Organized by <span className="font-semibold text-slate-600">{arena.ownerName}</span>
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-1.5 mt-0.5">
          {role ? (
            <span
              className={`text-[9px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider shrink-0 ring-1 ${ROLE_BADGE[role]}`}
            >
              {role}
            </span>
          ) : isPending ? (
            <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider shrink-0 bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20 border border-amber-500/15">
              Requested
            </span>
          ) : null}
        </div>
      </div>

      {/* Description Block */}
      {arena.description && (
        <div className="mt-3.5 flex items-start relative z-10">
          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
            {arena.description}
          </p>
        </div>
      )}

      {/* Unified Metadata & Property Panel */}
      <div className="mt-auto pt-4 border-t border-slate-100/80 relative z-10 flex flex-col gap-3 text-[11px] text-slate-500">
        {/* Play Schedule Property */}
        <div className="flex items-center gap-2 min-w-0">
          <Calendar className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition shrink-0" />
          {hasConfiguredSchedule(toSchedule(arena)) ? (
            <span className="font-medium text-slate-700 truncate" title={describeSchedule(toSchedule(arena))}>
              {describeSchedule(toSchedule(arena))}
            </span>
          ) : (
            <span className="text-slate-400 italic">Flexible play schedule</span>
          )}
        </div>

        {/* Counts & Hover Arrow Indicator */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex items-center gap-1.5 shrink-0" title={`${arena.playerCount} active players`}>
              <Users className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition shrink-0" />
              <span><strong className="text-slate-800 font-extrabold tabular-nums">{arena.playerCount}</strong> players</span>
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-200 shrink-0" aria-hidden="true" />
            <span className="flex items-center gap-1.5 shrink-0" title={`${arena.courtCount} courts`}>
              <Layers className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition shrink-0" />
              <span><strong className="text-slate-800 font-extrabold tabular-nums">{arena.courtCount}</strong> courts</span>
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-200 shrink-0" aria-hidden="true" />
            <span className="flex items-center gap-1.5 shrink-0" title={`${arena.matchCount} total matches`}>
              <Trophy className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition shrink-0" />
              <span><strong className="text-slate-800 font-extrabold tabular-nums">{arena.matchCount}</strong> matches</span>
            </span>
          </div>

          <div 
            className="w-5 h-5 rounded-full bg-slate-50 text-slate-400 group-hover:bg-emerald-50 group-hover:text-emerald-600 flex items-center justify-center transition-all duration-300 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0"
            aria-hidden="true"
          >
            <ArrowRight className="w-3 h-3" />
          </div>
        </div>
      </div>
    </Link>
  );
}

function ArenaGrid({ arenas, roleByArena, pendingArenaIds }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {arenas.map((arena) => (
        <ArenaCard
          key={arena.id}
          arena={arena}
          role={roleByArena.get(arena.id)}
          isPending={pendingArenaIds.has(arena.id)}
        />
      ))}
    </div>
  );
}

function SectionHeading({ eyebrow, title, count }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" aria-hidden="true" />
        <span className="font-display text-xs font-bold uppercase tracking-wider text-slate-950">
          {eyebrow}
        </span>
      </div>
      <span className="flex-1 h-px bg-slate-200/80" aria-hidden="true" />
      <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded-md tabular-nums border border-slate-200/50">
        {count} {title}
      </span>
    </div>
  );
}

function EmptyState({ children, icon: Icon = Sparkles }) {
  return (
    <div className="bg-white border border-dashed border-slate-300/80 rounded-2xl p-10 flex flex-col items-center justify-center text-center shadow-[0_1px_2px_rgba(15,23,42,0.02)] max-w-md mx-auto my-4">
      <div className="w-11 h-11 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3.5 ring-6 ring-emerald-500/5">
        <Icon className="w-5.5 h-5.5" />
      </div>
      <div className="text-sm text-slate-500 leading-relaxed max-w-xs">
        {children}
      </div>
    </div>
  );
}

export default async function Page() {
  const [arenas, user] = await Promise.all([listArenas(), getCurrentUser()]);
  const [memberships, pendingArenaIds] = user
    ? await Promise.all([getUserMemberships(user.id), getUserPendingRequestArenaIds(user.id)])
    : [[], new Set()];
  const roleByArena = new Map(memberships.map((m) => [m.arenaId, m.role]));
  const { yourArenas, publicArenas } = partitionArenaDirectory(arenas, {
    userId: user?.id,
    memberArenaIds: roleByArena.keys(),
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <SiteHeader variant="home">
        <AuthStatus />
      </SiteHeader>

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-8 space-y-10">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700">
              Directory
            </span>
            <h1 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 mt-1">
              Arenas
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Browse open arenas, or jump back into one you’re already in.
            </p>
          </div>

          {user ? (
            <Link
              href="/arenas/new"
              className="inline-flex items-center justify-center gap-2 self-start sm:self-auto
                bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm
                px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/35
                transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New arena
            </Link>
          ) : (
            <Link
              href="/login?next=/arenas/new"
              className="inline-flex items-center justify-center gap-2 self-start sm:self-auto
                bg-white text-slate-700 hover:text-emerald-700 ring-1 ring-slate-200 hover:ring-emerald-300
                font-extrabold text-sm px-5 py-2.5 rounded-xl transition"
            >
              Sign in to create
            </Link>
          )}
        </div>

        {/* Your arenas */}
        {user && (
          <section>
            <SectionHeading eyebrow="Your arenas" title="joined" count={yourArenas.length} />
            {yourArenas.length === 0 ? (
              <EmptyState icon={Sparkles}>
                You haven’t joined any arenas yet. Browse below, or{' '}
                <Link href="/arenas/new" className="text-emerald-600 font-semibold hover:text-emerald-700">
                  start your own
                </Link>
                .
              </EmptyState>
            ) : (
              <ArenaGrid arenas={yourArenas} roleByArena={roleByArena} pendingArenaIds={pendingArenaIds} />
            )}
          </section>
        )}

        {/* All arenas */}
        <section>
          <SectionHeading
            eyebrow={user ? 'Open to join' : 'All arenas'}
            title="listed"
            count={publicArenas.length}
          />
          {publicArenas.length === 0 ? (
            <EmptyState icon={MapPin}>
              {user
                ? 'No other arenas outside your memberships right now.'
                : 'No arenas yet. Sign in to create the first one.'}
            </EmptyState>
          ) : (
            <ArenaGrid arenas={publicArenas} roleByArena={roleByArena} pendingArenaIds={pendingArenaIds} />
          )}
        </section>
      </main>
    </div>
  );
}
