'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fullName } from './paddle-rack-stack-state';
import { filterPlayersByName } from '@/lib/player-display';
import { PlayerSearchField } from './player-search-field';

/**
 * Add-to-deck picker — when a win/lose deck is short of four (a session with
 * only two recent winners, say), the organizer taps an empty slot and picks
 * anyone still racked to fill it, so a "winners" court can still go out.
 *
 * The pool is WAITING paddles only — never someone already sitting in the other
 * deck. Topping up a short deck must not break a group that was ready to play
 * to patch one that wasn't; that would just move the hole.
 *
 * The pick is written to the board, not staged locally: every manager's rack
 * assembles the same four and a reload can't quietly undo a placement. Nobody's
 * recorded result changes — a pin only decides who goes on court next. The
 * server re-validates the id against the live rack under the queue lock, and
 * the pin retires when its deck stacks or the paddle leaves the rack.
 *
 * Chrome and conventions match {@link SkipPickerModal} — portal, Esc-to-close,
 * iOS scroll lock, name search, selection held locally and confirmed by the
 * parent — since the two are the same kind of decision.
 *
 * @param {object} props
 * @param {'W'|'L'} props.deck - which deck is being topped up.
 * @param {Array} props.players - All players, for name/stat lookup.
 * @param {string[]} props.candidates - Waiting player ids eligible to add, in rack order.
 * @param {boolean} props.isPending - A write is in flight (locks the UI).
 * @param {(playerId: string) => void} props.onConfirm
 * @param {() => void} props.onClose
 */
export function DeckAddModal({ deck, players, candidates, isPending, onConfirm, onClose }) {
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');

  // Escape closes. Same in-flight guard as the other board modals — don't
  // dismiss mid-action.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPending, onClose]);

  // iOS-safe scroll lock for the modal's lifetime (see SkipPickerModal for why
  // `overflow: hidden` isn't enough in standalone PWA mode).
  useEffect(() => {
    const { style } = document.body;
    const y = window.scrollY;
    style.position = 'fixed';
    style.top = `-${y}px`;
    style.left = '0';
    style.right = '0';
    style.width = '100%';
    return () => {
      style.position = '';
      style.top = '';
      style.left = '';
      style.right = '';
      style.width = '';
      window.scrollTo(0, y);
    };
  }, []);

  const deckLabel = deck === 'W' ? 'Winners' : 'Losers';
  const pool = candidates.map((id) => players.find((p) => p.id === id)).filter(Boolean);
  const visiblePlayers = filterPlayersByName(pool, query);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deck-add-title"
        className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-xl animate-scale-up overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 id="deck-add-title" className="font-extrabold text-slate-900 text-base">
            Add to {deckLabel}
          </h3>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            Pick a waiting paddle to fill the empty slot.
          </p>
          <PlayerSearchField value={query} onChange={setQuery} disabled={isPending} />
        </div>

        {/* Two distinct empty states, as in the skip picker: the rack can drain
            to zero WHILE this is open (realtime pushes update the list live),
            which is not the same as a search with no hits. */}
        {pool.length === 0 ? (
          <div className="flex-1 px-5 py-10 text-center">
            <p className="text-sm font-bold text-slate-700">Nobody waiting</p>
            <p className="text-[11px] text-slate-500 mt-1">
              Everyone on the rack is already on deck. Add players to the rack, or wait for a game
              to finish.
            </p>
          </div>
        ) : visiblePlayers.length === 0 ? (
          <div className="flex-1 px-5 py-10 text-center">
            <p className="text-sm font-bold text-slate-700">No paddles match &ldquo;{query}&rdquo;</p>
            <p className="text-[11px] text-slate-500 mt-1">Try a shorter name, or clear the search.</p>
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {visiblePlayers.map((p) => {
              const selected = selectedId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    disabled={isPending}
                    className={`w-full flex items-center gap-3 px-5 py-3 text-left transition disabled:opacity-50 ${
                      selected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
                        selected ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300'
                      }`}
                      aria-hidden="true"
                    >
                      {selected && (
                        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                          <path
                            fillRule="evenodd"
                            d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-slate-800 truncate">
                        {fullName(p)}
                      </span>
                      <span className="block text-[11px] font-medium tabular-nums text-slate-400">
                        {p.gamesPlayed} games · {p.wins || 0}W · {p.losses || 0}L
                        {p.waitRounds > 0 ? ` · waiting ${p.waitRounds}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-200/60 disabled:opacity-50 font-bold text-xs uppercase tracking-wide transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => selectedId && onConfirm(selectedId)}
            disabled={isPending || !selectedId}
            className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs uppercase tracking-wide transition shadow-sm shadow-emerald-700/20"
          >
            Add to deck
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
