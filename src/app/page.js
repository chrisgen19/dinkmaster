import Link from 'next/link';
import { listArenas, getUserMemberships } from '@/lib/arenas';
import { getCurrentUser } from '@/lib/session';
import { AuthStatus } from './auth-status';
import { CreateArenaForm } from './create-arena-form';

// Always read the fresh arena list on each request.
export const dynamic = 'force-dynamic';

const ROLE_BADGE = {
  OWNER: 'bg-emerald-50 text-emerald-700',
  ORGANIZER: 'bg-sky-50 text-sky-700',
  MEMBER: 'bg-slate-100 text-slate-600',
};

export default async function Page() {
  const [arenas, user] = await Promise.all([listArenas(), getCurrentUser()]);
  const memberships = user ? await getUserMemberships(user.id) : [];
  const roleByArena = new Map(memberships.map((m) => [m.arenaId, m.role]));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur sticky top-0 z-50 px-4 py-4 md:px-8 flex flex-wrap justify-between items-center gap-4 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm-3 5c.83 0 1.5.67 1.5 1.5S9.83 10 9 10s-1.5-.67-1.5-1.5S8.17 7 9 7zm-2 6.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm6 5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1-5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm3.5-3.5c-.83 0-1.5-.67-1.5-1.5S16.17 7 17 7s1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm0 5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm-5-10c-.83 0-1.5-.67-1.5-1.5S12.17 3 13 3s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">DINKMASTER</h1>
            <p className="text-xs text-slate-500 font-medium">Smart Paddle Stacking & Partnership Mixing</p>
          </div>
        </div>
        <AuthStatus />
      </header>

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

        <section>
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">
            All arenas ({arenas.length})
          </h2>

          {arenas.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center text-sm text-slate-400">
              No arenas yet. {user ? 'Create the first one above.' : 'Sign in to create the first one.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {arenas.map((arena) => (
                <Link
                  key={arena.id}
                  href={`/arena/${arena.id}`}
                  className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-emerald-400 hover:shadow-md transition group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-extrabold text-slate-900 group-hover:text-emerald-700 transition">
                      {arena.name}
                    </h3>
                    {roleByArena.get(arena.id) && (
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 ${ROLE_BADGE[roleByArena.get(arena.id)]}`}
                      >
                        {roleByArena.get(arena.id)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">by {arena.ownerName}</p>
                  <div className="flex gap-3 mt-4 text-xs text-slate-500">
                    <span><strong className="text-slate-700">{arena.playerCount}</strong> players</span>
                    <span><strong className="text-slate-700">{arena.courtCount}</strong> courts</span>
                    <span><strong className="text-slate-700">{arena.matchCount}</strong> matches</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
