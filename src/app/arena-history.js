'use client';

/**
 * History tab: read-only ledger of completed matches with final scores and
 * team rosters. Names shown here are snapshots stored on the match record, so
 * they survive deletion of the originating player (see the deletion warning
 * in [[arena-members]]).
 *
 * `formatTimestamp` is injected by the parent so the SSR hydration guard
 * (`mounted` state in arena.js) stays in one place — otherwise the component
 * would need its own mount-effect and we'd have two independent guards.
 */
export function ArenaHistory({ matches, formatTimestamp }) {
  return (
    <div
      role="tabpanel"
      id="arena-panel-history"
      aria-labelledby="arena-tab-history"
      className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in"
    >
      <div>
        <h3 className="font-display text-base md:text-lg font-extrabold tracking-tight text-slate-900">
          Match History Log
        </h3>
        <p className="text-xs text-slate-500 mt-1.5">
          Complete ledger of finished matches, final scores, and team results.
        </p>
      </div>

      {matches.length === 0 ? (
        <div className="py-16 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/20">
          <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-3 text-lg">
            📊
          </div>
          <p className="text-sm font-semibold text-slate-600">No matches recorded yet</p>
          <p className="text-xs mt-1 text-slate-400">Completed game summaries will show up here.</p>
        </div>
      ) : (
        <div className="space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-2">
          {matches.map((match) => {
            const team1Won = match.score1 > match.score2;
            const team2Won = match.score2 > match.score1;

            return (
              <div key={match.id} className="border border-slate-100 rounded-xl bg-slate-50/50 p-4 hover:bg-slate-50 transition-colors">
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold mb-3">
                  <span>{match.courtName}</span>
                  <span>{formatTimestamp(match.timestamp)}</span>
                </div>

                <div className="grid grid-cols-9 items-center gap-2">
                  {/* Team A Horizontal Layout in logs */}
                  <div className={`col-span-3 p-2.5 rounded-lg text-center border ${
                    team1Won ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white border-slate-100'
                  }`}>
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Team A</div>
                    <div className="text-xs font-semibold text-slate-700 truncate">
                      {match.team1.map(p => p.firstName).join(' & ')}
                    </div>
                    {team1Won && <span className="inline-block mt-1.5 text-[8px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">Win</span>}
                  </div>

                  <div className="col-span-3 flex flex-col items-center justify-center">
                    <div className="flex items-center space-x-3 text-lg font-extrabold text-slate-800">
                      <span className={team1Won ? 'text-emerald-600 font-black' : ''}>{match.score1}</span>
                      <span className="text-slate-300 font-normal">:</span>
                      <span className={team2Won ? 'text-emerald-600 font-black' : ''}>{match.score2}</span>
                    </div>
                  </div>

                  {/* Team B Horizontal Layout in logs */}
                  <div className={`col-span-3 p-2.5 rounded-lg text-center border ${
                    team2Won ? 'bg-emerald-50/60 border-emerald-100' : 'bg-white border-slate-100'
                  }`}>
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mb-1.5">Team B</div>
                    <div className="text-xs font-semibold text-slate-700 truncate">
                      {match.team2.map(p => p.firstName).join(' & ')}
                    </div>
                    {team2Won && <span className="inline-block mt-1.5 text-[8px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded uppercase">Win</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
