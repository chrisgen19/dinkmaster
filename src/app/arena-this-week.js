'use client';

import Image from 'next/image';

/** Medal accent per podium rank (1–3); the rest fall through to slate. */
const RANK_STYLES = {
  1: 'bg-amber-100 text-amber-700 ring-amber-200',
  2: 'bg-slate-200 text-slate-600 ring-slate-300',
  3: 'bg-orange-100 text-orange-700 ring-orange-200',
};

/**
 * "This Week" / Player of the Week panel. Pure presentational — the
 * leaderboard is computed by the parent (via `computeWeeklyLeaderboard`)
 * and the schedule summary is pre-formatted so the hero and this panel
 * can share one source of truth for the label.
 *
 * @param {object} props
 * @param {{ hasData: boolean, leaders: Array<{ playerId: string, rank: number, name: string, games: number, wins: number, winPct: number }> }} props.leaderboard
 * @param {string|null} [props.myPlayerId] - viewer's player id, used to highlight their row with the "You" pill
 * @param {string|null} [props.scheduleLabel] - one-line schedule summary (e.g. "Mon, Wed, Fri · 6:00 PM–10:00 PM (Asia/Manila)") or null when no schedule is configured
 * @param {boolean} [props.canManage=false] - shows the "Edit schedule" affordance for owners/organizers
 * @param {() => void} [props.onEditSchedule] - opens the schedule editor modal (no-op when omitted)
 */
export function ArenaThisWeek({
  leaderboard,
  myPlayerId = null,
  scheduleLabel = null,
  canManage = false,
  onEditSchedule,
}) {
  return (
    <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base md:text-lg font-extrabold tracking-tight text-slate-900">
            🏆 Player of the Week
          </h3>
          <p className="text-xs text-slate-500 mt-1.5">
            {scheduleLabel ?? 'Counting every day — set a schedule to scope the week.'}
          </p>
        </div>
        {canManage && (
          <button
            onClick={onEditSchedule}
            className="shrink-0 px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:text-emerald-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
          >
            Edit schedule
          </button>
        )}
      </div>

      {!leaderboard.hasData ? (
        <div className="py-12 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/20">
          <div className="relative mx-auto mb-2 h-12 w-12 overflow-hidden rounded-xl ring-1 ring-inset ring-slate-200/80">
            <Image
              src="/icons/icon-192.png"
              alt="DinkMaster logo"
              fill
              sizes="48px"
              className="object-cover"
            />
          </div>
          <p className="text-sm font-semibold text-slate-500">No matches yet this week</p>
          <p className="text-xs mt-1">Play some games to claim the top spot!</p>
        </div>
      ) : (
        <ol className="space-y-2">
          {leaderboard.leaders.map((p) => {
            const isMe = myPlayerId === p.playerId;
            return (
              <li
                key={p.playerId}
                className={`flex items-center gap-3 rounded-xl border p-3 transition ${
                  isMe ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-100 bg-slate-50/50'
                }`}
              >
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black ring-1 shrink-0 ${
                    RANK_STYLES[p.rank] ?? 'bg-slate-100 text-slate-500 ring-slate-200'
                  }`}
                >
                  {p.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate flex items-center gap-2">
                    <span className="truncate">{p.name}</span>
                    {isMe && (
                      <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                        You
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {p.games} game{p.games !== 1 ? 's' : ''} · {p.winPct}% win rate
                  </p>
                </div>
                <span className="text-right shrink-0">
                  <span className="block text-lg font-extrabold text-emerald-700 leading-none">{p.wins}</span>
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">
                    {p.wins === 1 ? 'win' : 'wins'}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
