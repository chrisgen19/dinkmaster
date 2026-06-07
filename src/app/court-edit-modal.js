'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Reorder, useDragControls } from 'motion/react';
import { GripVertical, Repeat2 } from 'lucide-react';
import { formatShortName } from '@/lib/player-display';

/** Full display name; mirrors the helper used by the rack/skip-pick UI. */
const fullName = (p) => (p?.lastName ? `${p.firstName} ${p.lastName}` : p?.firstName ?? 'Unknown');

/**
 * Manual team editor for a live court. The four on-court paddles are shown as a
 * draggable, snap-to-position list (top two = Team A, bottom two = Team B);
 * dragging reorders the partition so any of the three pairings is reachable.
 * Each chip's "replace" action opens a picker (deck + waiting paddles) to
 * substitute that player. Nothing hits the server until **Save Lineup**, which
 * commits the final desired four via the `editCourtLineup` action.
 *
 * Pure-ish: all data and the save/close handlers arrive via props (the parent
 * owns the server action + state reconciliation, matching the skip-pick modal).
 *
 * @param {object} props
 * @param {{id:string,name:string,team1:string[],team2:string[]}} props.court
 * @param {Array} props.players - All players, for name/stat lookup.
 * @param {string[]} props.queue - Rack player ids in order (substitute candidates).
 * @param {boolean} props.isPending - A save is in flight (locks the UI).
 * @param {string} props.error - Server error to surface inside the modal.
 * @param {(team1Ids:string[], team2Ids:string[]) => void} props.onSave
 * @param {() => void} props.onClose
 */
export function CourtEditModal({ court, players, queue, isPending, error, onSave, onClose }) {
  // Working order: index 0,1 = Team A, 2,3 = Team B. Seeded from the court.
  const [order, setOrder] = useState(() => [...court.team1, ...court.team2]);
  // Index currently being substituted (null = lineup view, not picker view).
  const [replacingPos, setReplacingPos] = useState(null);

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const original = useMemo(() => [...court.team1, ...court.team2], [court.team1, court.team2]);

  // iOS-safe scroll lock: this modal only mounts while open, so pin <body>
  // with position:fixed offset by the current scrollY for its lifetime, then
  // restore on unmount. A plain overflow:hidden doesn't stop rubber-band
  // scrolling in standalone PWA mode, and both lists here scroll. Mirrors the
  // skip-picker lock in arena.js / ArenaMobileSheet.
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

  // Esc closes while idle; suppressed mid-save so a race-error has context.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || isPending) return;
      if (replacingPos !== null) setReplacingPos(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPending, replacingPos, onClose]);

  // The four originally on this court when the editor opened — used both to
  // detect changes and to let a subbed-out paddle be picked back this session.
  const originalSet = useMemo(() => new Set(original), [original]);

  // Substitute candidates, none already in the working lineup: rack paddles
  // (deck + waiting) PLUS any originally-on-court paddle that's been subbed out,
  // so a substitution can be reverted without cancelling the whole edit. Rack
  // paddles first, then the off-court originals. Resolved through `players` so
  // the list matches what renders.
  const candidates = useMemo(() => {
    const inLineup = new Set(order);
    const pool = [...new Set([...queue, ...original])];
    return pool.filter((id) => !inLineup.has(id)).map((id) => playerById.get(id)).filter(Boolean);
  }, [queue, original, order, playerById]);

  // Lineup is "changed" if the partition into teams differs from the original.
  // A within-team reorder (same two players, swapped order) is NOT a change.
  const changed = useMemo(() => {
    const sameTeam = (a, b) => a[0] === b[0] && a[1] === b[1];
    const norm = (pair) => [...pair].sort();
    return !(
      sameTeam(norm(order.slice(0, 2)), norm(original.slice(0, 2))) &&
      sameTeam(norm(order.slice(2, 4)), norm(original.slice(2, 4)))
    );
  }, [order, original]);

  const handleSave = () => {
    if (!changed || isPending) return;
    onSave(order.slice(0, 2), order.slice(2, 4));
  };

  const handlePick = (id) => {
    setOrder((prev) => prev.map((cur, i) => (i === replacingPos ? id : cur)));
    setReplacingPos(null);
  };

  const replacingPlayer = replacingPos !== null ? playerById.get(order[replacingPos]) : null;

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
        aria-labelledby="court-edit-title"
        className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-xl animate-scale-up overflow-hidden flex flex-col max-h-[85vh]"
      >
        {replacingPos === null ? (
          <>
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 id="court-edit-title" className="font-extrabold text-slate-900 text-base">
                Edit teams — {court.name}
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Drag to swap partners — top two are{' '}
                <span className="font-bold text-emerald-700">Team A</span>, bottom two are{' '}
                <span className="font-bold text-sky-600">Team B</span>. Tap{' '}
                <span className="inline-flex align-middle"><Repeat2 className="h-3.5 w-3.5" aria-hidden="true" /></span>{' '}
                to substitute a paddle.
              </p>
            </div>

            {/* Draggable lineup */}
            <Reorder.Group
              axis="y"
              values={order}
              onReorder={setOrder}
              as="ul"
              className="flex-1 overflow-y-auto p-3 space-y-2"
            >
              {order.map((id, index) => (
                <LineupRow
                  key={id}
                  player={playerById.get(id)}
                  id={id}
                  team={index < 2 ? 'A' : 'B'}
                  disabled={isPending}
                  onReplace={() => setReplacingPos(index)}
                />
              ))}
            </Reorder.Group>

            {error && (
              <p
                role="alert"
                className="mx-5 mt-1 mb-2 rounded-lg border border-amber-200/70 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700"
              >
                {error}
              </p>
            )}

            {/* Footer */}
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
                onClick={handleSave}
                disabled={isPending || !changed}
                className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-extrabold text-xs uppercase tracking-wide transition shadow-sm shadow-emerald-700/20"
              >
                Save Lineup
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Substitute picker — same visual language as the skip-pick modal. */}
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-extrabold text-slate-900 text-base">
                Replace {replacingPlayer ? fullName(replacingPlayer) : 'paddle'}
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Tap a paddle to take this spot on {court.name}.
              </p>
            </div>
            {candidates.length === 0 ? (
              <div className="flex-1 px-5 py-10 text-center">
                <p className="text-sm font-bold text-slate-700">No paddles available</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Everyone is on a court. Add or check in a paddle first.
                </p>
              </div>
            ) : (
              <ul className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {candidates.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => handlePick(p.id)}
                      disabled={isPending}
                      className="w-full flex items-center gap-3 px-5 py-3 text-left transition disabled:opacity-50 hover:bg-slate-50"
                    >
                      <span
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-slate-300 transition"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-slate-800 truncate">
                            {fullName(p)}
                          </span>
                          {originalSet.has(p.id) && (
                            <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.12em] text-amber-700 bg-amber-50 ring-1 ring-amber-200/70 rounded-full px-1.5 py-0.5">
                              Just removed
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] font-medium tabular-nums text-slate-400">
                          {p.gamesPlayed} games · {p.wins || 0}W · {p.losses || 0}L
                          {p.waitRounds > 0 ? ` · waiting ${p.waitRounds}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setReplacingPos(null)}
                disabled={isPending}
                className="px-4 py-2.5 rounded-xl text-slate-600 hover:bg-slate-200/60 disabled:opacity-50 font-bold text-xs uppercase tracking-wide transition"
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * One draggable paddle row inside the lineup. A dedicated grip handle owns the
 * drag (via `useDragControls` + `dragListener={false}`) so the Replace button
 * stays tappable — the same handle pattern used in `arena-mobile-nav.js`.
 */
function LineupRow({ player, id, team, disabled, onReplace }) {
  const controls = useDragControls();
  const accent = team === 'A' ? 'bg-emerald-500' : 'bg-sky-500';
  const badge =
    team === 'A'
      ? 'text-emerald-700 bg-emerald-50 ring-emerald-200/70'
      : 'text-sky-700 bg-sky-50 ring-sky-200/70';
  const short = formatShortName(player);

  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.02, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }}
      className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2.5 select-none"
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        onPointerDown={(e) => !disabled && controls.start(e)}
        disabled={disabled}
        className="shrink-0 cursor-grab active:cursor-grabbing touch-none text-slate-300 hover:text-slate-500 disabled:opacity-40 transition"
      >
        <GripVertical className="h-5 w-5" aria-hidden="true" />
      </button>
      <span className={`shrink-0 w-1.5 self-stretch rounded-full ${accent}`} aria-hidden="true" />
      <span
        className={`shrink-0 text-[9px] font-black uppercase tracking-[0.16em] rounded-full px-2 py-0.5 ring-1 ${badge}`}
      >
        {team}
      </span>
      <span className="min-w-0 flex-1" title={short.full}>
        <span className="block text-sm font-bold text-slate-800 truncate">{short.full}</span>
        {player && (
          <span className="block text-[11px] font-medium tabular-nums text-slate-400">
            {player.gamesPlayed} games · {player.wins || 0}W · {player.losses || 0}L
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onReplace}
        disabled={disabled}
        aria-label={`Replace ${short.full}`}
        title="Substitute this paddle"
        className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
      >
        <Repeat2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </Reorder.Item>
  );
}
