'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { fullName } from './paddle-rack-stack-state';

/**
 * The pin-vs-winner contest, put to the organizer.
 *
 * A deck the organizer hand-filled is authoritative: when a game finishes and
 * a real winner turns up who would otherwise be on deck, the rack does NOT
 * quietly swap them in over a hand-placed paddle. It asks here instead. That
 * is the whole point of the feature — the old behaviour silently truncated the
 * organizer's pick off the end of the deck, which read as the board overruling
 * them.
 *
 * Every finished doubles game returns TWO winners and TWO losers at once, so a
 * two-challenger prompt is the ordinary case, not an edge. The counts are
 * genuinely n-to-m (2 winners against 3 pins, say), so this cannot be a fixed
 * yes/no: the organizer has to say WHICH pins yield. Checkboxes, capped at the
 * number of challengers, with each checked pin paired to a challenger in rack
 * order. With one of each it collapses to a plain confirm.
 *
 * Both exits are real answers. There is no "not now": the prompt is derived
 * from board state, so an unanswered dismissal would simply re-fire. Esc and
 * the backdrop take the conservative one (keep every pin), since that is the
 * answer that changes nothing the organizer chose.
 *
 * @param {object} props
 * @param {'W'|'L'} props.deck - which deck is contested.
 * @param {string[]} props.challengers - player ids that belong in the deck by
 *   result but have no slot, in rack order.
 * @param {string[]} props.pins - hand-placed player ids that could yield a
 *   slot, in rack order. Never shorter than `challengers`.
 * @param {Array} props.players - All players, for name lookup.
 * @param {boolean} props.isPending - A write is in flight (locks the UI).
 * @param {(yieldIds: string[]) => void} props.onResolve - [] means keep them all.
 */
export function DeckChallengeModal({ deck, challengers, pins, players, isPending, onResolve }) {
  // Default to the straightforward trade: the earliest pins yield to the
  // waiting winners, one for one. In the common single-pin case that makes
  // "Replace" a one-tap confirm, while still showing what it will do.
  const [checked, setChecked] = useState(() => pins.slice(0, challengers.length));

  const keepAll = () => onResolve([]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !isPending) keepAll();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

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

  const nameOf = useMemo(() => {
    const byId = new Map((players ?? []).map((p) => [p.id, p]));
    return (id) => fullName(byId.get(id));
  }, [players]);

  const noun = deck === 'W' ? 'winner' : 'loser';
  const deckLabel = deck === 'W' ? 'Winners' : 'Losers';
  const verbed = deck === 'W' ? 'won' : 'lost';

  /**
   * Toggling respects the hard cap: there are only so many slots to free, and
   * offering to unpin a third paddle when two winners are waiting would
   * promise a seat that doesn't exist. Past the cap the oldest check drops.
   */
  const toggle = (id) => {
    setChecked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const next = [...prev, id];
      return next.slice(Math.max(0, next.length - challengers.length));
    });
  };

  // Pair checked pins to challengers in rack order, so the row can show the
  // actual trade rather than just "this one goes".
  const takerFor = (id) => {
    const seat = checked.indexOf(id);
    return seat === -1 ? null : challengers[seat] ?? null;
  };

  const list = (ids) => ids.map(nameOf).join(' and ');

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) keepAll();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="deck-challenge-title"
        className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-xl animate-scale-up overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 id="deck-challenge-title" className="font-extrabold text-slate-900 text-base">
            {challengers.length === 1
              ? `A ${noun} is available`
              : `${challengers.length} ${noun}s are available`}
          </h3>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            {list(challengers)} just {verbed}, so they belong in the {deckLabel} deck. It is full
            of paddles you added.
          </p>
        </div>

        <div className="px-5 py-3 border-b border-slate-100">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Replace</p>
        </div>

        <ul className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {pins.map((id) => {
            const on = checked.includes(id);
            const taker = takerFor(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  disabled={isPending}
                  aria-pressed={on}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left transition disabled:opacity-50 ${
                    on ? 'bg-emerald-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 transition ${
                      on ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300'
                    }`}
                    aria-hidden="true"
                  >
                    {on && (
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
                      {nameOf(id)}
                      <span className="ml-1.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-700">
                        added
                      </span>
                    </span>
                    {taker && (
                      <span className="block text-[11px] font-medium text-emerald-700 truncate">
                        → {nameOf(taker)} takes this slot
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="px-5 py-3 border-t border-slate-100">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Unchecked paddles keep their slot and the {noun} waits on the rack. Whoever you keep
            stays put for good — you will not be asked again when the next game ends.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={keepAll}
            disabled={isPending}
            className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-200/60 disabled:opacity-50 font-bold text-xs uppercase tracking-wide transition"
          >
            {pins.length === 1 ? `Keep ${nameOf(pins[0])}` : 'Keep my picks'}
          </button>
          <button
            type="button"
            onClick={() => onResolve(checked)}
            disabled={isPending || checked.length === 0}
            className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs uppercase tracking-wide transition shadow-sm shadow-emerald-700/20"
          >
            {checked.length > 1 ? `Replace ${checked.length}` : 'Replace'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
