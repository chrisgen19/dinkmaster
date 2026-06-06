'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ChevronRight,
  Clock,
  Layers,
  Shuffle,
  Sparkles,
  TriangleAlert,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { deriveRackRow, ON_DECK_SIZE } from './paddle-rack-stack-state';

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
 * @param {Array<{id:string,userId:string|null,firstName:string,lastName:string|null,gamesPlayed:number,wins:number,losses:number,waitRounds:number,skipBoosted?:boolean}>} props.players
 * @param {boolean} props.canManage - gates the manager-only actions
 * @param {string|null} props.viewerUserId - to flag the "you" row
 * @param {boolean} props.viewerIsMember - viewer belongs to this arena; gates the name→profile link (a non-member shares no arena, so the profile would 404)
 * @param {boolean} props.autoMix - re-shuffle the rack after every finished game
 * @param {(next:boolean) => void} props.onToggleAutoMix
 * @param {() => void} props.onAddPlayers - open the Prep Roster modal
 * @param {() => void} props.onShuffle - shuffle the waiting queue
 * @param {(id:string) => void} props.onUnrackPlayer - take a player off the rack (reversible; not a delete)
 * @param {(id:string) => void} props.onSkipPlayer - send an on-deck paddle to the back of the rack
 * @param {boolean} props.isPending - disable actions during a server write
 * @param {number} props.starveThreshold - wait rounds before the amber wait badge
 * @param {number} props.emergencyWait - wait rounds before the red wait badge
 * @param {boolean} props.skipRestoresPriority - when true, Skip = "back soon, top priority on return" (drives the button label/tooltip)
 * @param {string} props.errorMsg - surfaced inline above the list
 */
export function PaddleRackStack({
  queue,
  players,
  canManage,
  viewerUserId,
  viewerIsMember = false,
  autoMix,
  onToggleAutoMix,
  onAddPlayers,
  onShuffle,
  onUnrackPlayer,
  onSkipPlayer,
  isPending,
  starveThreshold,
  emergencyWait,
  skipRestoresPriority = true,
  errorMsg,
  // Distinguishes the DOM ids of multiple mounted instances (e.g. the
  // desktop sidebar vs. the mobile block) so they don't collide.
  idPrefix = 'rack',
}) {
  // Which row's action panel is open. Only one open at a time; `null` = all collapsed.
  const [expandedPlayerId, setExpandedPlayerId] = useState(null);

  // React 19 "adjust state during render" pattern: when the expanded player leaves
  // the queue (matched into a court, unracked elsewhere) clear the state so the
  // panel doesn't reopen if that player is later checked back into the rack.
  // Safe from loops because the next render sees `null` and skips this branch.
  if (expandedPlayerId !== null && !queue.includes(expandedPlayerId)) {
    setExpandedPlayerId(null);
  }

  // Move keyboard focus to the first action button when a panel opens so users
  // can act without re-tabbing. The toggle button itself remains the back-out
  // target via Shift+Tab.
  const firstPanelButtonRef = useRef(null);
  useEffect(() => {
    if (expandedPlayerId !== null) {
      firstPanelButtonRef.current?.focus();
    }
  }, [expandedPlayerId]);

  const handleToggleRow = (playerId) => {
    setExpandedPlayerId((prev) => (prev === playerId ? null : playerId));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-slate-100 bg-slate-50/60 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <Layers className="h-5 w-5" />
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
                <UserPlus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add</span>
              </button>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
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
            <Shuffle className="h-3.5 w-3.5" />
            Mix queue
          </button>
        </div>
      </div>

      {/* List */}
      <div className="custom-scrollbar space-y-2 bg-slate-50/30 p-3 sm:max-h-[500px] sm:overflow-y-auto sm:p-4">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-white py-14 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-50 text-slate-300">
              <Users className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold text-slate-600">The rack is empty</p>
            <p className="text-xs text-slate-400">Add players to stack their paddles for the next court.</p>
          </div>
        ) : (
          queue.map((playerId, index) => {
            const player = players.find((p) => p.id === playerId);
            if (!player) return null;

            const { rank, isOnDeck, isYou, isWalkIn, badge, waitRounds, name, initials, canSkip, profileHref } = deriveRackRow(
              player,
              index,
              { viewerUserId, viewerIsMember, starveThreshold, emergencyWait, canManage, queueLength: queue.length },
            );
            const nextLine = badge === 'next-line';
            const starving = badge !== 'none' && !nextLine;
            const emergency = badge === 'emergency';
            const hasActions = canSkip || canManage;
            const isExpanded = expandedPlayerId === player.id;
            const panelId = `${idPrefix}-row-panel-${player.id}`;

            return (
              <Fragment key={playerId}>
                {index === 0 && <GroupLabel accent>On deck · next court</GroupLabel>}
                {index === ON_DECK_SIZE && (
                  <GroupLabel className="pt-2">Waiting · {queue.length - ON_DECK_SIZE}</GroupLabel>
                )}

                <div
                  className={`group relative rounded-xl border transition ${
                    isOnDeck
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  {isOnDeck && (
                    <span
                      className="absolute inset-y-2 left-0 w-1 rounded-full bg-emerald-500"
                      aria-hidden="true"
                    />
                  )}

                  <div
                    className={`flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 ${
                      isOnDeck ? 'pl-3 sm:pl-4' : ''
                    }`}
                  >
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
                      className={`hidden sm:grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold ${
                        isOnDeck ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      } ${isYou ? 'ring-2 ring-emerald-400' : isOnDeck ? 'ring-1 ring-emerald-200' : 'ring-1 ring-slate-200'}`}
                      aria-hidden="true"
                    >
                      {initials}
                    </span>

                    {/* Identity */}
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-semibold text-slate-800 sm:flex-nowrap">
                        {profileHref ? (
                          <Link
                            href={profileHref}
                            className="w-full min-w-0 truncate rounded sm:w-auto sm:max-w-full hover:text-emerald-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                            title={`View ${name}’s profile`}
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="w-full min-w-0 truncate sm:w-auto sm:max-w-full">{name}</span>
                        )}
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
                        {nextLine && (
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700"
                            title="Next in Line — top priority on the next auto-mix (returning from a skip)"
                          >
                            <Sparkles className="h-3 w-3" />
                            Next
                          </span>
                        )}
                        {starving && (
                          <span
                            className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                              emergency ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }`}
                            title={`Waiting ${waitRounds} rounds`}
                          >
                            <Clock className="h-3 w-3" />
                            {waitRounds}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium tabular-nums text-slate-400">
                        {player.gamesPlayed} games · {player.wins || 0}W · {player.losses || 0}L
                      </p>
                    </div>

                    {/* Toggle */}
                    {hasActions && (
                      <button
                        type="button"
                        onClick={() => handleToggleRow(player.id)}
                        disabled={isPending}
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        aria-label={isExpanded ? `Hide actions for ${name}` : `Show actions for ${name}`}
                        title={isExpanded ? 'Hide actions' : 'Show actions'}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 active:scale-95 disabled:opacity-40"
                      >
                        <ChevronRight
                          className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                    )}
                  </div>

                  {/* Action panel */}
                  {hasActions && isExpanded && (
                    <div
                      id={panelId}
                      role="region"
                      aria-label={`Actions for ${name}`}
                      className={`flex gap-2 border-t px-2.5 pb-2.5 pt-2 sm:px-3 sm:pb-3 ${
                        isOnDeck ? 'border-emerald-200/70' : 'border-slate-200/70'
                      }`}
                    >
                      {canSkip && (
                        <button
                          ref={firstPanelButtonRef}
                          type="button"
                          onClick={() => {
                            setExpandedPlayerId(null);
                            onSkipPlayer(player.id);
                          }}
                          disabled={isPending}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
                          title={
                            skipRestoresPriority
                              ? isYou
                                ? 'Step away — you keep top priority on the next mix'
                                : 'Skip — they step away, top priority on the next mix'
                              : isYou
                                ? 'Take a rest — send your paddle to the back of the rack'
                                : 'Skip — send to the back of the rack'
                          }
                          aria-label={
                            skipRestoresPriority
                              ? `Step ${name} away — top priority on the next mix`
                              : `Skip ${name} to the back of the rack`
                          }
                        >
                          <ArrowDownToLine className="h-3.5 w-3.5" />
                          <span>
                            {isYou ? (skipRestoresPriority ? 'Step away' : 'Rest') : 'Skip'}
                          </span>
                        </button>
                      )}
                      {canManage && (
                        <button
                          ref={canSkip ? undefined : firstPanelButtonRef}
                          type="button"
                          onClick={() => onUnrackPlayer(player.id)}
                          disabled={isPending}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
                          title="Take off the rack (re-add from the roster). Delete permanently in the Members tab."
                          aria-label={`Take ${name} off the rack`}
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>Off rack</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </Fragment>
            );
          })
        )}
      </div>
    </section>
  );
}
