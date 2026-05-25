import Link from 'next/link';
import { listArenas, getUserMemberships, getUserPendingRequestArenaIds } from '@/lib/arenas';
import { partitionArenaDirectory } from '@/lib/arena-directory';
import { getCurrentUser } from '@/lib/session';
import { AuthStatus } from '../auth-status';
import { SiteHeader } from '../site-header';
import { CreateArenaForm } from '../create-arena-form';

// Always read the fresh arena list on each request.
export const dynamic = 'force-dynamic';

const ROLE_BADGE = {
  OWNER: 'bg-emerald-50 text-emerald-700',
  ORGANIZER: 'bg-sky-50 text-sky-700',
  MEMBER: 'bg-slate-100 text-slate-600',
};

function ArenaCard({ arena, role, isPending }) {
  return (
    <Link
      href={`/arena/${arena.id}`}
      className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-emerald-400 hover:shadow-md transition group"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-extrabold text-slate-900 group-hover:text-emerald-700 transition">
          {arena.name}
        </h3>
        {role ? (
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 ${ROLE_BADGE[role]}`}
          >
            {role}
          </span>
        ) : isPending ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 bg-amber-50 text-amber-700">
            Requested
          </span>
        ) : null}
      </div>
      <p className="text-xs text-slate-400 mt-1">by {arena.ownerName}</p>
      {arena.description && (
        <p className="text-xs text-slate-500 mt-2 line-clamp-2">{arena.description}</p>
      )}
      <div className="flex gap-3 mt-4 text-xs text-slate-500">
        <span><strong className="text-slate-700">{arena.playerCount}</strong> players</span>
        <span><strong className="text-slate-700">{arena.courtCount}</strong> courts</span>
        <span><strong className="text-slate-700">{arena.matchCount}</strong> matches</span>
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

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 md:p-8 space-y-6">
        <section className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">
            {user ? 'Create an arena' : 'Arenas'}
          </h2>
          {user ? (
            <CreateArenaForm />
          ) : (
            <p className="text-sm text-slate-500">
              Browse any arena below.{' '}
              <Link href="/login" className="text-emerald-600 font-semibold hover:text-emerald-700">
                Sign in
              </Link>{' '}
              to create and manage your own.
            </p>
          )}
        </section>

        {user && (
          <section>
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">
              Your arenas ({yourArenas.length})
            </h2>

            {yourArenas.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center text-sm text-slate-400">
                You are not in any arenas yet. Browse other arenas below to request access.
              </div>
            ) : (
              <ArenaGrid arenas={yourArenas} roleByArena={roleByArena} pendingArenaIds={pendingArenaIds} />
            )}
          </section>
        )}

        <section>
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">
            All arenas ({publicArenas.length})
          </h2>

          {publicArenas.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center text-sm text-slate-400">
              {user
                ? 'No other arenas outside your memberships right now.'
                : 'No arenas yet. Sign in to create the first one.'}
            </div>
          ) : (
            <ArenaGrid arenas={publicArenas} roleByArena={roleByArena} pendingArenaIds={pendingArenaIds} />
          )}
        </section>
      </main>
    </div>
  );
}
