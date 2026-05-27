'use client';

import { Fragment } from 'react';
import { deriveRackRow, ON_DECK_SIZE } from './paddle-rack-stack-state';

// --- Inline Lucide icons -------------------------------------------------
// Hand-inlined Lucide path data (matching the app's inline-SVG convention, so
// no new dependency). All share the stroke style; `className` sizes them.
const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

const IconLayers = ({ className }) => (
  <svg className={className} {...stroke}>
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </svg>
);
const IconUserPlus = ({ className }) => (
  <svg className={className} {...stroke}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <line x1="19" x2="19" y1="8" y2="14" />
    <line x1="22" x2="16" y1="11" y2="11" />
  </svg>
);
const IconShuffle = ({ className }) => (
  <svg className={className} {...stroke}>
    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
    <path d="m18 2 4 4-4 4" />
    <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
    <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
    <path d="m18 14 4 4-4 4" />
  </svg>
);
const IconClock = ({ className }) => (
  <svg className={className} {...stroke}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);
const IconX = ({ className }) => (
  <svg className={className} {...stroke}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);
const IconAlert = ({ className }) => (
  <svg className={className} {...stroke}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);
const IconUsers = ({ className }) => (
  <svg className={className} {...stroke}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IconArrowDownToLine = ({ className }) => (
  <svg className={className} {...stroke}>
    <path d="M12 17V3" />
    <path d="m6 11 6 6 6-6" />
    <path d="M19 21H5" />
  </svg>
);

/** Subtle labeled divider between the on-deck and waiting groups. */
function GroupLabel({ children, accent = false, className = '' }) {
  return (
    <div className={`flex items-center gap-2 px-1 ${className}`}>
      <span className={`text-[10px] font-bold uppercase tracking-wider ${accent ? 'text-emerald-600' : 'text-slate-400'}`}>
        {children}
      </span>
      <span className={`h-px flex-1 ${accent ? 'bg-emerald-200/70' : 'bg-slate-200'}`} />
    </div>
  );
}

/**
 * The waiting-paddle queue ("rack"). The top 4 ("on deck") stack onto the next
 * open court; everyone else waits. Presentation only — all mutations route
 * through the handlers passed from the arena page.
 *
 * @param {object} props
 * @param {string[]} props.queue - ordered player ids (index 0 = front of rack)
 * @param {Array<{id:string,userId:string|null,firstName:string,lastName:string|null,gamesPlayed:number,wins:number,losses:number,waitRounds:number}>} props.players
 * @param {boolean} props.canManage - gates the manager-only actions
 * @param {string|null} props.viewerUserId - to flag the "you" row
 * @param {boolean} props.autoMix - re-shuffle the rack after every finished game
 * @param {(next:boolean) => void} props.onToggleAutoMix
 * @param {() => void} props.onAddPlayers - open the Prep Roster modal
 * @param {() => void} props.onShuffle - shuffle the waiting queue
 * @param {(id:string) => void} props.onUnrackPlayer - take a player off the rack (reversible; not a delete)
 * @param {(id:string) => void} props.onSkipPlayer - send an on-deck paddle to the back of the rack
 * @param {boolean} props.isPending - disable actions during a server write
 * @param {number} props.starveThreshold - wait rounds before the amber wait badge
 * @param {number} props.emergencyWait - wait rounds before the red wait badge
 * @param {string} props.errorMsg - surfaced inline above the list
 */
export function PaddleRackStack({
  queue,
  players,
  canManage,
  viewerUserId,
  autoMix,
  onToggleAutoMix,
  onAddPlayers,
  onShuffle,
  onUnrackPlayer,
  onSkipPlayer,
  isPending,
  starveThreshold,
  emergencyWait,
  errorMsg,
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-slate-100 bg-slate-50/60 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <IconLayers className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-800">Paddle Rack Stack</h3>
              <p className="truncate text-xs text-slate-500">Top 4 stack onto the next open court</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold tabular-nums text-emerald-700 ring-1 ring-inset ring-emerald-200">
              {queue.length} in rack
            </span>
            {canManage && (
              <button
                type="button"
                onClick={onAddPlayers}
                className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
                title="Open the Prep Roster modal to check in members and add walk-ins"
              >
                <IconUserPlus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add</span>
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Controls */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/70 pt-3">
          <button
            type="button"
            role="switch"
            aria-checked={autoMix}
            onClick={() => onToggleAutoMix(!autoMix)}
            className="group inline-flex items-center gap-2 rounded-md text-xs font-semibold text-slate-600 transition-colors hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2"
          >
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out ${
                autoMix ? 'bg-emerald-500' : 'bg-slate-300 group-hover:bg-slate-400'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-in-out ${
                  autoMix ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
              />
            </span>
            Auto-mix after each game
          </button>

          <button
            type="button"
            onClick={onShuffle}
            disabled={queue.length < 2 || isPending || !canManage}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            title="Shuffle everyone currently waiting to break court locking"
          >
            <IconShuffle className="h-3.5 w-3.5" />
            Mix queue
          </button>
        </div>
      </div>

      {/* List */}
      <div className="custom-scrollbar max-h-[500px] space-y-2 overflow-y-auto bg-slate-50/30 p-3 sm:p-4">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-white py-14 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-50 text-slate-300">
              <IconUsers className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold text-slate-600">The rack is empty</p>
            <p className="text-xs text-slate-400">Add players to stack their paddles for the next court.</p>
          </div>
        ) : (
          queue.map((playerId, index) => {
            const player = players.find((p) => p.id === playerId);
            if (!player) return null;

            const { rank, isOnDeck, isYou, isWalkIn, badge, waitRounds, name, initials, canSkip } = deriveRackRow(
              player,
              index,
              { viewerUserId, starveThreshold, emergencyWait, canManage, queueLength: queue.length },
            );
            const starving = badge !== 'none';
            const emergency = badge === 'emergency';

            return (
              <Fragment key={playerId}>
                {index === 0 && <GroupLabel accent>On deck · next court</GroupLabel>}
                {index === ON_DECK_SIZE && (
                  <GroupLabel className="pt-2">Waiting · {queue.length - ON_DECK_SIZE}</GroupLabel>
                )}

                <div
                  className={`group relative flex items-center gap-3 rounded-xl border p-3 transition ${
                    isOnDeck
                      ? 'border-emerald-200 bg-emerald-50/50 pl-4'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  {isOnDeck && <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-emerald-500" aria-hidden="true" />}

                  {/* Rank */}
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold tabular-nums ${
                      isOnDeck ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {rank}
                  </span>

                  {/* Avatar */}
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      isOnDeck ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    } ${isYou ? 'ring-2 ring-emerald-400' : isOnDeck ? 'ring-1 ring-emerald-200' : 'ring-1 ring-slate-200'}`}
                    aria-hidden="true"
                  >
                    {initials}
                  </span>

                  {/* Identity */}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-800">
                      <span className="truncate">{name}</span>
                      {isYou && (
                        <span className="shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                          You
                        </span>
                      )}
                      {isWalkIn && (
                        <span
                          className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500"
                          title="Walk-in player — no linked account. Link them from the Members tab."
                        >
                          Walk-in
                        </span>
                      )}
                      {starving && (
                        <span
                          className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                            emergency ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                          }`}
                          title={`Waiting ${waitRounds} rounds`}
                        >
                          <IconClock className="h-3 w-3" />
                          {waitRounds}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium tabular-nums text-slate-400">
                      {player.gamesPlayed} games · {player.wins || 0}W · {player.losses || 0}L
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    {canSkip && (
                      <button
                        type="button"
                        onClick={() => onSkipPlayer(player.id)}
                        disabled={isPending}
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-700 active:scale-95 disabled:opacity-40"
                        title={isYou ? 'Take a rest — send your paddle to the back of the rack' : 'Skip — send to the back of the rack'}
                        aria-label={`Skip ${name} to the back of the rack`}
                      >
                        <IconArrowDownToLine className="h-4 w-4" />
                      </button>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => onUnrackPlayer(player.id)}
                        disabled={isPending}
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 opacity-100 transition hover:bg-red-50 hover:text-red-600 active:scale-95 disabled:pointer-events-none disabled:opacity-40 lg:opacity-0 lg:group-hover:opacity-100"
                        title="Take off the rack (re-add from the roster). Delete permanently in the Members tab."
                        aria-label={`Take ${name} off the rack`}
                      >
                        <IconX className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })
        )}
      </div>
    </section>
  );
}
