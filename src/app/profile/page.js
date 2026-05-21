import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { getUserPlayerStats } from '@/lib/arenas';
import { eloToDupr } from '@/lib/rating';
import { AuthStatus } from '../auth-status';

// Always read fresh stats on each request.
export const dynamic = 'force-dynamic';

/** A labelled stat tile. */
function StatTile({ label, value, dashed = false }) {
  return (
    <div
      className={`rounded-xl px-4 py-3 text-center bg-slate-50 ${
        dashed ? 'border border-dashed border-slate-200' : 'border border-slate-200/60'
      }`}
    >
      <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <span className="block text-xl font-extrabold text-slate-800 mt-0.5">{value}</span>
    </div>
  );
}

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { totals, arenas, recentMatches } = await getUserPlayerStats(user.id);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur sticky top-0 z-50 px-4 py-4 md:px-8 flex flex-wrap justify-between items-center gap-4 shadow-sm">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm">
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <div>
            <Link
              href="/"
              className="text-[11px] text-slate-400 hover:text-emerald-600 font-semibold transition"
            >
              ← All arenas
            </Link>
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">My Profile</h1>
          </div>
        </div>
        <AuthStatus />
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto p-4 md:p-8 space-y-6">
        {/* Identity + lifetime totals */}
        <section className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-5">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">{user.name}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{user.email}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatTile label="Arenas" value={totals.arenas} />
            <StatTile label="Games" value={totals.gamesPlayed} />
            <StatTile label="Wins" value={totals.wins} />
            <StatTile label="Losses" value={totals.losses} />
            <StatTile label="Win %" value={totals.wins + totals.losses > 0 ? `${totals.winPct}%` : '—'} />
            <StatTile
              label="Rating"
              value={totals.rating !== null ? eloToDupr(totals.rating).toFixed(3) : '—'}
            />
          </div>
        </section>

        {/* Per-arena breakdown */}
        <section className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">
            By arena ({arenas.length})
          </h2>
          {arenas.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
              You&apos;re not playing in any arena yet.{' '}
              <Link href="/" className="text-emerald-600 font-semibold hover:text-emerald-700">
                Browse arenas
              </Link>{' '}
              to join one.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-500">
                    <th className="p-3 font-extrabold">Arena</th>
                    <th className="p-3 font-extrabold text-center">Games</th>
                    <th className="p-3 font-extrabold text-center">W</th>
                    <th className="p-3 font-extrabold text-center">L</th>
                    <th className="p-3 font-extrabold text-center">Rating</th>
                    <th className="p-3 font-extrabold text-center">In rack</th>
                  </tr>
                </thead>
                <tbody>
                  {arenas.map((a) => (
                    <tr key={a.arenaId} className="border-b border-slate-200/60 hover:bg-slate-50 transition">
                      <td className="p-3 font-bold text-slate-700">
                        <Link href={`/arena/${a.arenaId}`} className="hover:text-emerald-700">
                          {a.arenaName}
                        </Link>
                        {!a.active && (
                          <span className="ml-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400">
                            left
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center text-slate-600">{a.gamesPlayed}</td>
                      <td className="p-3 text-center font-bold text-emerald-700">{a.wins}</td>
                      <td className="p-3 text-center font-bold text-slate-500">{a.losses}</td>
                      <td className="p-3 text-center font-bold text-slate-700">
                        {eloToDupr(a.rating).toFixed(3)}
                      </td>
                      <td className="p-3 text-center text-slate-500">
                        {a.inQueue ? 'Yes' : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent matches across all arenas */}
        <section className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">
            Recent matches ({recentMatches.length})
          </h2>
          {recentMatches.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
              No finished matches yet.
            </div>
          ) : (
            <div className="space-y-2">
              {recentMatches.map((m) => (
                <div
                  key={m.matchId}
                  className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl bg-slate-50/50 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-700 flex items-center gap-2">
                      <span
                        className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                          m.won ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {m.won ? 'Win' : 'Loss'}
                      </span>
                      <span className="truncate">{m.arenaName}</span>
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {m.courtName} · {m.timestamp.slice(0, 10)}
                    </p>
                  </div>
                  <span className="text-sm font-extrabold text-slate-800 shrink-0">
                    {m.scoreFor}
                    <span className="text-slate-300 font-normal"> : </span>
                    {m.scoreAgainst}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
