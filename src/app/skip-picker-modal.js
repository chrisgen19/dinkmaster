'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { fullName, ON_DECK_SIZE } from './paddle-rack-stack-state';
import { filterPlayersByName } from '@/lib/player-display';
import { PlayerSearchField } from './player-search-field';

/**
 * Skip + Pick Replacement modal — when a manager skips an on-deck paddle
 * (arena setting `skipPickReplacement`), this picker chooses which waiting
 * paddle fills the freed slot. Rendered via portal so no ancestor's
 * overflow/transform/filter can clip it (same PWA-safe rule as the
 * cancel-fill modal). Backdrop click and Esc dismiss while idle; both are
 * suppressed while a confirm is in flight so a "replacement no longer
 * available" race-error has context to land.
 *
 * Owns its chrome (Esc handler, iOS scroll lock) and its local selection —
 * the component only mounts while open, so selection resets for free on
 * close. The parent owns the server action and race reconciliation
 * (matching CourtEditModal's split): a raced confirm keeps this modal
 * mounted and feeds the failure back via `error`, which clears the stale
 * pick so Confirm re-disables until the manager picks again.
 *
 * @param {object} props
 * @param {string} props.skippedId - Player id being skipped (modal is open while non-null).
 * @param {Array} props.players - All players, for name/stat lookup.
 * @param {string[]} props.queue - Rack player ids in order; candidates come from past the on-deck group.
 * @param {boolean} props.isPending - A confirm is in flight (locks the UI).
 * @param {string} props.error - Race/server error to surface inside the modal.
 * @param {(replacementId: string) => void} props.onConfirm
 * @param {() => void} props.onClose
 */
export function SkipPickerModal({ skippedId, players, queue, isPending, error, onConfirm, onClose }) {
  // Local selection: null until the manager taps a row.
  const [selectedId, setSelectedId] = useState(null);
  // Name filter for the waiting list — purely visual: a selection made
  // before narrowing stays valid even while its row is filtered out.
  const [query, setQuery] = useState('');
  // Prop-driven reset (render-time sentinel, the codebase's standard
  // pattern), keyed on the CONFIRM COMPLETING rather than the error string
  // changing: a confirm that lands (isPending true→false) with a non-empty
  // `error` is a fresh race failure — drop the now-invalid selection so
  // Confirm re-disables, and un-dismiss the banner. Keying on the string
  // alone would miss back-to-back races with the identical message. Picking
  // a row dismisses the banner locally without reaching into parent state.
  const [wasPending, setWasPending] = useState(isPending);
  const [errorDismissed, setErrorDismissed] = useState(false);
  if (isPending !== wasPending) {
    setWasPending(isPending);
    if (!isPending && error) {
      setErrorDismissed(false);
      setSelectedId(null);
    }
  }
  const shownError = errorDismissed ? '' : error;

  // Escape closes the picker. Same in-flight guard as the cancel-fill modal —
  // don't dismiss mid-action so a race error has a chance to surface here.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPending, onClose]);

  // iOS-safe scroll lock for the modal's lifetime. A plain `overflow: hidden`
  // doesn't stop rubber-band scrolling in standalone PWA mode, and this modal
  // has a scrollable waiting list — so pin <body> with `position: fixed`
  // offset by the current scrollY, then restore on unmount. Mirrors the
  // lockScroll/unlockScroll pattern in ArenaMobileSheet (arena-mobile-nav.js).
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

  const skippedPlayer = players.find((p) => p.id === skippedId);
  // Waiting pool excludes the skipped paddle itself (it could in principle
  // be in waiting if a manager's UI race opens the modal for a row that
  // just shifted off-deck, though deriveRackRow's canSkip blocks that case
  // today). The parent's open-condition guarantees this list is non-empty.
  const waitingPlayers = queue
    .slice(ON_DECK_SIZE)
    .filter((id) => id !== skippedId)
    .map((id) => players.find((p) => p.id === id))
    .filter(Boolean);
  const visiblePlayers = filterPlayersByName(waitingPlayers, query);

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
        aria-labelledby="skip-pick-title"
        className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-xl animate-scale-up overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 id="skip-pick-title" className="font-extrabold text-slate-900 text-base">
            Skip {skippedPlayer ? fullName(skippedPlayer) : 'paddle'} — pick replacement
          </h3>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            Tap a waiting paddle to fill the freed on-deck slot.
          </p>
          <PlayerSearchField value={query} onChange={setQuery} disabled={isPending} />
        </div>
        {visiblePlayers.length === 0 ? (
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
                  onClick={() => {
                    setSelectedId(p.id);
                    setErrorDismissed(true);
                  }}
                  disabled={isPending}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left transition disabled:opacity-50 ${
                    selected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
                      selected
                        ? 'border-emerald-700 bg-emerald-700 text-white'
                        : 'border-slate-300'
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
        {shownError && (
          <p
            role="alert"
            className="mx-5 mt-3 rounded-lg border border-amber-200/70 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700"
          >
            {shownError}
          </p>
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
            Skip + Pick
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
