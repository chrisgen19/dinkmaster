import Link from 'next/link';
import { listArenas, getUserMemberships, getUserPendingRequestArenaIds } from '@/lib/arenas';
import { partitionArenaDirectory } from '@/lib/arena-directory';
import { getCurrentUser } from '@/lib/session';
import { AuthStatus } from '../auth-status';
import { SiteHeader } from '../site-header';

// Always read the fresh arena list on each request.
export const dynamic = 'force-dynamic';

const ROLE_BADGE = {
  OWNER: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ORGANIZER: 'bg-sky-50 text-sky-700 ring-sky-200',
  MEMBER: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function ArenaCard({ arena, role, isPending }) {
  return (
    <Link
      href={`/arena/${arena.id}`}
      className="group relative bg-white border border-slate-200 rounded-2xl p-5
        shadow-[0_1px_2px_rgba(15,23,42,0.04)]
        hover:border-emerald-300 hover:shadow-[0_10px_30px_-18px_rgba(16,185,129,0.55)]
        transition duration-200 flex flex-col"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-base font-extrabold text-slate-900 group-hover:text-emerald-700 transition leading-snug">
          {arena.name}
        </h3>
        {role ? (
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 ring-1 ${ROLE_BADGE[role]}`}
          >
            {role}
          </span>
        ) : isPending ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 bg-amber-50 text-amber-700 ring-1 ring-amber-200">
            Requested
          </span>
        ) : null}
      </div>

      {arena.description ? (
        <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">{arena.description}</p>
      ) : (
        <p className="text-xs text-slate-400 mt-2 italic">No description yet.</p>
      )}

      <div className="mt-auto pt-4 flex items-center gap-4 text-[11px] text-slate-500">
        <span><strong className="text-slate-800 font-extrabold">{arena.playerCount}</strong> players</span>
        <span className="w-px h-3 bg-slate-200" aria-hidden="true" />
        <span><strong className="text-slate-800 font-extrabold">{arena.courtCount}</strong> courts</span>
        <span className="w-px h-3 bg-slate-200" aria-hidden="true" />
        <span><strong className="text-slate-800 font-extrabold">{arena.matchCount}</strong> matches</span>
      </div>
    </Link>
  );
}

function ArenaGrid({ arenas, roleByArena, pendingArenaIds }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
    <div className="flex items-baseline gap-3 mb-4">
      <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700">
        {eyebrow}
      </span>
      <span className="flex-1 h-px bg-slate-200" aria-hidden="true" />
      <span className="text-[11px] text-slate-400 font-bold tabular-nums">
        {count} {title}
      </span>
    </div>
  );
}

function EmptyState({ children }) {
  return (
    <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center text-sm text-slate-400">
      {children}
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
              href="/login"
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
              <EmptyState>
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
            <EmptyState>
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
