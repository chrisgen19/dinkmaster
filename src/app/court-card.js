'use client';

import { formatShortName } from '@/lib/player-display';

/**
 * One court tile: header (court number + name + live/open status), body
 * (Team A | VS | Team B when playing, or an "open" placeholder), and a
 * primary action button.
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
 * @param {(court: object) => void} props.onCancel - Cancel this fill and send the four back to the rack.
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
  onCancel,
  onFill,
  onRemove,
}) {
  const isPlaying = court.status === 'playing';

  // Pull a short label out of the court name for the header tile, e.g.
  // "Court 1" -> "1". Falls back to the first character if no digits.
  const courtBadge = court.name?.match(/\d+/)?.[0] ?? court.name?.charAt(0) ?? '?';

  /** Resolve a slot id to a short display name and the full name for tooltips. */
  const resolvePlayer = (id) => formatShortName(players.find((x) => x.id === id));

  // Stacked name list, left- or right-aligned, with per-row truncation so each
  // name ellipsizes independently and both teams render at the same height.
  const renderNames = (slots, align) => (
    <ul className={`space-y-1 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {slots.map((id) => {
        const p = resolvePlayer(id);
        return (
          <li
            key={id}
            className="text-sm font-bold text-slate-800 truncate leading-tight"
            title={p.full}
          >
            {p.display}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="group bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col shadow-sm transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
      {/* Header — court tile, name, live/open chip, optional close button */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3 bg-gradient-to-r from-slate-50/80 to-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            aria-hidden="true"
            className="shrink-0 w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-extrabold text-sm shadow-sm"
          >
            {courtBadge}
          </div>
          <h4 className="font-extrabold text-slate-900 text-sm truncate">{court.name}</h4>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isPlaying ? (
            <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.16em] text-sky-700 bg-sky-50 ring-1 ring-sky-200/70 rounded-full px-2 py-0.5">
              <span className="relative inline-flex w-1.5 h-1.5" aria-hidden="true">
                <span className="absolute inline-flex w-full h-full rounded-full bg-sky-400 opacity-75 animate-ping" />
                <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-sky-500" />
              </span>
              Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.16em] text-slate-500 bg-slate-100 ring-1 ring-slate-200/70 rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300" aria-hidden="true" />
              Open
            </span>
          )}
          {!isPlaying && canManage && (
            <button
              onClick={() => onRemove(court.id)}
              disabled={isPending}
              aria-label="Close court"
              title="Close court"
              className="w-7 h-7 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Body — Team A | VS | Team B on every viewport. Names stack vertically
          inside each side, outward-aligned (left for A, right for B). */}
      <div className="px-4 py-4 flex-1 flex flex-col justify-center">
        {isPlaying ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="min-w-0">
              <div className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-emerald-600 mb-1.5">
                Team A
              </div>
              {renderNames(court.team1, 'left')}
            </div>

            <span
              aria-hidden="true"
              className="shrink-0 inline-flex w-9 h-9 rounded-full bg-slate-100 text-slate-500 items-center justify-center text-[10px] font-black tracking-[0.18em]"
            >
              VS
            </span>

            <div className="min-w-0">
              <div className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-sky-600 mb-1.5 text-right">
                Team B
              </div>
              {renderNames(court.team2, 'right')}
            </div>
          </div>
        ) : (
          <div className="py-6 px-4 text-center border border-dashed border-emerald-200/70 bg-emerald-50/30 rounded-xl">
            <p className="text-slate-700 font-bold text-sm">Court is open</p>
            <p className="text-[11px] text-slate-500 mt-1">Stack 4 paddles to start a match.</p>
          </div>
        )}
      </div>

      {/* Footer — primary action */}
      <div className="px-3 py-3 border-t border-slate-100 bg-slate-50/40">
        {isPlaying ? (
          <div className="space-y-2">
            <button
              onClick={() => onFinish(court)}
              disabled={isPending || !canManage}
              className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-[11px] uppercase tracking-[0.14em] transition shadow-sm shadow-red-600/20"
            >
              Finish Game & Record Score
            </button>
            {canManage && (
              <button
                onClick={() => onCancel(court)}
                disabled={isPending}
                title="Send these four back to the rack without recording a game"
                className="w-full py-2 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-[10px] uppercase tracking-[0.14em] transition"
              >
                Cancel & Return to Deck
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => onFill(court.id)}
            disabled={queueLength < 4 || isPending || !canManage}
            className={`w-full py-2.5 rounded-xl font-extrabold text-[11px] uppercase tracking-[0.14em] transition ${
              queueLength >= 4 && canManage
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            {!canManage
              ? 'View only'
              : queueLength >= 4
                ? 'Stack Next 4 Paddles'
                : 'Need 4 Players in Rack'}
          </button>
        )}
      </div>
    </div>
  );
}
