'use client';

/**
 * One court tile: a header (name + live/vacant status dot), a body (the two
 * teams when playing, or a vacant placeholder), and the action button
 * ("Finish Game" when live, "Stack Next 4 Paddles" when vacant).
 *
 * Pure presentation — all data and behaviour arrive via props.
 *
 * @param {object} props
 * @param {{id: string, name: string, status: string, team1: string[], team2: string[]}} props.court - The court row.
 * @param {Array} props.players - All players, used to resolve slot ids to first names.
 * @param {boolean} props.canManage - Whether the viewer may act on the court.
 * @param {boolean} props.isPending - A mutation is in flight (disables the actions).
 * @param {number} props.queueLength - Rack size; gates the "stack 4" button.
 * @param {(court: object) => void} props.onFinish - Open the score modal for this court.
 * @param {(courtId: string) => void} props.onFill - Stack the next four paddles onto this court.
 * @param {(courtId: string) => void} props.onRemove - Close this (vacant) court.
 */
export function CourtCard({
  court,
  players,
  canManage,
  isPending,
  queueLength,
  onFinish,
  onFill,
  onRemove,
}) {
  const isPlaying = court.status === 'playing';

  /** Render a team's players as "First & First" using the live player list. */
  const renderTeam = (slots) =>
    slots.map((id, idx) => {
      const p = players.find((x) => x.id === id);
      return (
        <span key={id} className="truncate">
          {p ? p.firstName : 'Unknown'}
          {idx < slots.length - 1 ? ' &' : ''}
        </span>
      );
    });

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col justify-between shadow-sm relative transition-all duration-300 hover:shadow-md">
      <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
        <div>
          <h4 className="font-extrabold text-slate-900 text-sm md:text-base">{court.name}</h4>
          <div className="flex items-center mt-0.5">
            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
              isPlaying ? 'bg-sky-500 animate-pulse' : 'bg-slate-300'
            }`}></span>
            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
              {isPlaying ? 'Live Match' : 'Vacant'}
            </span>
          </div>
        </div>

        {!isPlaying && canManage && (
          <button
            onClick={() => onRemove(court.id)}
            disabled={isPending}
            aria-label="Close court"
            className="text-slate-400 hover:text-red-500 text-sm transition-all p-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Close Court"
          >
            ✕
          </button>
        )}
      </div>

      <div className="p-5 flex-1 flex flex-col justify-center bg-white">
        {isPlaying ? (
          <div className="grid grid-cols-9 items-center gap-2 py-4">

            {/* Team A Horizontal layout */}
            <div className="col-span-4 bg-slate-50 border border-slate-100 p-3.5 rounded-xl text-center">
              <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider mb-2.5">TEAM A</div>
              <div className="text-xs font-semibold text-slate-800 flex flex-wrap items-center justify-center gap-1">
                {renderTeam(court.team1)}
              </div>
            </div>

            <div className="col-span-1 flex justify-center">
              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 py-1 rounded">
                VS
              </span>
            </div>

            {/* Team B Horizontal layout */}
            <div className="col-span-4 bg-slate-50 border border-slate-100 p-3.5 rounded-xl text-center">
              <div className="text-[10px] text-sky-600 font-bold uppercase tracking-wider mb-2.5">TEAM B</div>
              <div className="text-xs font-semibold text-slate-800 flex flex-wrap items-center justify-center gap-1">
                {renderTeam(court.team2)}
              </div>
            </div>

          </div>
        ) : (
          <div className="py-10 text-center border border-dashed border-slate-200 bg-slate-50/50 rounded-xl flex flex-col items-center justify-center">
            <p className="text-slate-700 font-semibold text-xs">Court is Vacant</p>
            <p className="text-[11px] text-slate-400 mt-1">Requires 4 players in the queue to start.</p>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-slate-100 bg-slate-50/30">
        {isPlaying ? (
          <button
            onClick={() => onFinish(court)}
            disabled={isPending || !canManage}
            className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs uppercase tracking-widest transition-all shadow-sm"
          >
            Finish Game & Record Score
          </button>
        ) : (
          <button
            onClick={() => onFill(court.id)}
            disabled={queueLength < 4 || isPending || !canManage}
            className={`w-full py-3 rounded-xl font-extrabold text-xs uppercase tracking-widest transition-all shadow-sm ${
              queueLength >= 4 && canManage
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200/50'
            }`}
          >
            {!canManage
              ? 'View Only'
              : queueLength >= 4
                ? 'Stack Next 4 Paddles'
                : 'Need 4 Players in Rack'}
          </button>
        )}
      </div>
    </div>
  );
}
