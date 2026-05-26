'use client';

import { CourtCard } from './court-card';

/**
 * The "Courts" tab: a header (court counts + Create Court action) above a
 * responsive grid of {@link CourtCard} tiles. The live-court count is derived
 * here from `courts` so callers pass only the raw list.
 *
 * @param {object} props
 * @param {Array} props.courts - The arena's courts (each with status/team slots).
 * @param {Array} props.players - All players, forwarded to each card for name lookup.
 * @param {boolean} props.canManage - Whether the viewer may manage courts.
 * @param {boolean} props.isPending - A mutation is in flight (disables actions).
 * @param {number} props.queueLength - Rack size; gates each card's "stack 4" button.
 * @param {() => void} props.onAddCourt - Create a new court.
 * @param {(court: object) => void} props.onFinishCourt - Open the score modal for a court.
 * @param {(court: object) => void} props.onCancelCourt - Cancel a fill and return its four to the rack.
 * @param {(courtId: string) => void} props.onFillCourt - Stack the next four onto a court.
 * @param {(courtId: string) => void} props.onRemoveCourt - Close a vacant court.
 */
export function ArenaCourtsPanel({
  courts,
  players,
  canManage,
  isPending,
  queueLength,
  onAddCourt,
  onFinishCourt,
  onCancelCourt,
  onFillCourt,
  onRemoveCourt,
}) {
  const liveCourtCount = courts.filter((c) => c.status === 'playing').length;

  return (
    <div
      role="tabpanel"
      id="arena-panel-courts"
      aria-labelledby="arena-tab-courts"
      className="space-y-5 animate-fade-in"
    >
      {/* Header — court counts + the Create Court action */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">
            Active Courts
          </h3>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            {courts.length} {courts.length === 1 ? 'court' : 'courts'}
            <span className="text-slate-300 mx-1.5">·</span>
            <span className="text-sky-600 font-bold">
              {liveCourtCount} live
            </span>
          </p>
        </div>
        {canManage && (
          <button
            onClick={onAddCourt}
            disabled={isPending}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl
              text-xs font-extrabold uppercase tracking-wide text-white
              bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700
              shadow-sm shadow-emerald-600/30 active:scale-[0.98]
              disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
              transition-all"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Create Court
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {courts.map((court) => (
          <CourtCard
            key={court.id}
            court={court}
            players={players}
            canManage={canManage}
            isPending={isPending}
            queueLength={queueLength}
            onFinish={onFinishCourt}
            onCancel={onCancelCourt}
            onFill={onFillCourt}
            onRemove={onRemoveCourt}
          />
        ))}
      </div>
    </div>
  );
}
