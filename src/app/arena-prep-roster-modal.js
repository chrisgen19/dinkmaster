'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addPlayer,
  checkInPlayer,
  checkOutPlayer,
  approveJoinRequest,
  rejectJoinRequest,
  approveLinkRequest,
  rejectLinkRequest,
} from './actions';
import { ArenaRequestsList } from './arena-requests-list';

/** First name primary, last name secondary, both case-insensitive. */
function byPlayerName(a, b) {
  const af = (a.firstName ?? a.name ?? '').trim();
  const bf = (b.firstName ?? b.name ?? '').trim();
  const first = af.localeCompare(bf, undefined, { sensitivity: 'base' });
  if (first !== 0) return first;
  const al = (a.lastName ?? '').trim();
  const bl = (b.lastName ?? '').trim();
  return al.localeCompare(bl, undefined, { sensitivity: 'base' });
}

/**
 * Manager-only roster prep modal. Lists every active member with a check-in
 * toggle, walk-ins with the same toggle, an inline walk-in add form, and
 * any pending join/link requests at the top (shared `ArenaRequestsList`
 * with the Members tab so the two surfaces never drift). Closing the modal
 * does NOT undo any toggles — each toggle hits a server action immediately
 * so the rack reflects state as soon as it changes.
 *
 * Request approvals create/modify `ArenaMembership` rows which live on
 * server-side props, not in the modal's local state. Those handlers call
 * `router.refresh()` so the members + requests lists come back fresh.
 *
 * @param {object} props
 * @param {string} props.arenaId
 * @param {Array<{userId:string,name:string,role:string,hasLinkedPlayer:boolean}>} props.members
 * @param {Array<{id:string,userId:string|null,firstName:string,lastName?:string|null}>} props.players
 * @param {string[]} props.queue - ordered list of playerIds currently on the rack
 * @param {Array<{requestId:string,userId:string,name:string}>} props.pendingRequests
 * @param {Array<{requestId:string,memberName:string,playerName:string}>} props.pendingLinkRequests
 * @param {(state: object) => void} props.onApplyResult - parent's state-reconcile callback (same shape as run())
 * @param {() => void} props.onClose
 */
export function ArenaPrepRosterModal({
  arenaId,
  members,
  players,
  queue,
  pendingRequests = [],
  pendingLinkRequests = [],
  onApplyResult,
  onClose,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newFirst, setNewFirst] = useState('');
  const [newLast, setNewLast] = useState('');
  const [error, setError] = useState('');

  // Escape closes the modal — partner to the backdrop click and the ✕ button.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Member rows derived from {members, players, queue}: each member's linked
  // active Player tells us whether they're currently in the rack. Sorted
  // alphabetically by display name so finding someone in a long list is
  // predictable; the rack position is shown inline for already-checked-in
  // members, so sort order doesn't need to mirror queue order.
  const memberRows = useMemo(() => {
    const playerByUser = new Map();
    for (const p of players) {
      if (p.userId) playerByUser.set(p.userId, p);
    }
    const queueSet = new Set(queue);
    return members
      .map((m) => {
        const player = playerByUser.get(m.userId) ?? null;
        const checkedIn = !!player && queueSet.has(player.id);
        return { ...m, player, checkedIn };
      })
      .sort(byPlayerName);
  }, [members, players, queue]);

  // Walk-ins = active Player rows with no userId. Also alphabetized; the
  // Prep Roster modal is a discovery surface, not a play surface.
  const walkInRows = useMemo(() => {
    const queueSet = new Set(queue);
    return players
      .filter((p) => !p.userId)
      .map((p) => ({ ...p, checkedIn: queueSet.has(p.id) }))
      .sort(byPlayerName);
  }, [players, queue]);

  // Rack actions (check-in/out, add walk-in) return a fresh state envelope
  // we reconcile into the parent's local rack state via `onApplyResult` —
  // no full refetch. Request actions instead use `router.refresh()` (see
  // `handleRequest`) because they mutate membership rows that live on
  // server-rendered props. The two paths are deliberately separate; both
  // converge once arena.js re-syncs from the next server read.
  const run = (fn) => {
    startTransition(async () => {
      try {
        const result = await fn();
        setError(result?.error || '');
        if (result?.state) onApplyResult(result);
      } catch {
        setError('Something went wrong. Please try again.');
      }
    });
  };

  const handleToggleMember = (row) => {
    if (!row.player) {
      // A member without a Player row is unexpected (approveJoinRequest
      // creates one); surface a clear error rather than silently no-oping.
      setError(`${row.name} has no player record yet.`);
      return;
    }
    run(() =>
      row.checkedIn
        ? checkOutPlayer(arenaId, row.player.id)
        : checkInPlayer(arenaId, row.player.id),
    );
  };

  const handleToggleWalkIn = (row) => {
    run(() =>
      row.checkedIn ? checkOutPlayer(arenaId, row.id) : checkInPlayer(arenaId, row.id),
    );
  };

  // Request actions don't return a fresh state envelope — they create or
  // delete ArenaMembership / JoinRequest / LinkRequest rows, which arrive
  // via the parent's server-rendered props. Router.refresh() pulls them.
  const handleRequest = (fn) => {
    setError('');
    startTransition(async () => {
      try {
        const result = await fn();
        if (result?.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch {
        setError('Something went wrong. Please try again.');
      }
    });
  };
  const onApproveJoin = (r) => handleRequest(() => approveJoinRequest(arenaId, r.userId));
  const onRejectJoin = (r) => handleRequest(() => rejectJoinRequest(arenaId, r.userId));
  const onApproveLink = (r) => handleRequest(() => approveLinkRequest(arenaId, r.requestId));
  const onRejectLink = (r) => handleRequest(() => rejectLinkRequest(arenaId, r.requestId));

  const hasRequests = pendingRequests.length > 0 || pendingLinkRequests.length > 0;

  const handleAddWalkIn = (e) => {
    e.preventDefault();
    if (!newFirst.trim()) return;
    const first = newFirst;
    const last = newLast;
    setNewFirst('');
    setNewLast('');
    run(() => addPlayer(arenaId, first, last));
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prep-roster-title"
        className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl animate-scale-up"
      >
        <div className="p-6 pb-4 flex items-start justify-between gap-4 border-b border-slate-100">
          <div className="min-w-0">
            <h3 id="prep-roster-title" className="text-base font-extrabold text-slate-900">
              Prep roster
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-snug">
              Toggle members and walk-ins in or out of the rack and add new walk-ins for the next session.
              Changes apply immediately. To permanently delete a walk-in, go to Members → Walk-ins.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close roster"
            className="shrink-0 grid place-items-center h-8 w-8 rounded-lg text-slate-500 hover:bg-slate-100 transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {hasRequests && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                  Pending requests ({pendingRequests.length + pendingLinkRequests.length})
                </h4>
              </div>
              <ArenaRequestsList
                pendingLinkRequests={pendingLinkRequests}
                pendingRequests={pendingRequests}
                isPending={isPending}
                onApproveLink={onApproveLink}
                onRejectLink={onRejectLink}
                onApproveJoin={onApproveJoin}
                onRejectJoin={onRejectJoin}
              />
            </section>
          )}

          <section>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                Members ({memberRows.length})
              </h4>
              <span className="text-[10px] text-slate-400">
                {memberRows.filter((m) => m.checkedIn).length} checked in
              </span>
            </div>
            {memberRows.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No members yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {memberRows.map((row) => (
                  <li
                    key={row.userId}
                    className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition ${
                      row.checkedIn
                        ? 'border-emerald-200 bg-emerald-50/60'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{row.name}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {row.role.toLowerCase()}
                        {row.checkedIn && row.player ? ` · #${queue.indexOf(row.player.id) + 1} on rack` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleMember(row)}
                      disabled={isPending}
                      className={`shrink-0 text-xs font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-lg transition disabled:opacity-50 ${
                        row.checkedIn
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                      }`}
                    >
                      {row.checkedIn ? '✓ In' : 'Out'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                Walk-ins ({walkInRows.length})
              </h4>
              <span className="text-[10px] text-slate-400">
                {walkInRows.filter((w) => w.checkedIn).length} checked in
              </span>
            </div>
            <form onSubmit={handleAddWalkIn} className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="First name"
                value={newFirst}
                onChange={(e) => setNewFirst(e.target.value)}
                className="flex-1 min-w-0 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 rounded-lg px-3 py-2 text-sm outline-none transition text-slate-800 placeholder-slate-400"
              />
              <input
                type="text"
                placeholder="Last (opt.)"
                value={newLast}
                onChange={(e) => setNewLast(e.target.value)}
                className="flex-1 min-w-0 bg-slate-50 border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 rounded-lg px-3 py-2 text-sm outline-none transition text-slate-800 placeholder-slate-400"
              />
              <button
                type="submit"
                disabled={isPending || !newFirst.trim()}
                className="shrink-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold px-4 py-2 rounded-lg text-sm transition"
              >
                Add
              </button>
            </form>
            {walkInRows.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No walk-ins yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {walkInRows.map((row) => (
                  <li
                    key={row.id}
                    className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition ${
                      row.checkedIn
                        ? 'border-emerald-200 bg-emerald-50/60'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">
                        {row.lastName ? `${row.firstName} ${row.lastName}` : row.firstName}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        walk-in
                        {row.checkedIn ? ` · #${queue.indexOf(row.id) + 1} on rack` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleWalkIn(row)}
                      disabled={isPending}
                      className={`shrink-0 text-xs font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-lg transition disabled:opacity-50 ${
                        row.checkedIn
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                      }`}
                    >
                      {row.checkedIn ? '✓ In' : 'Out'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50/40 rounded-b-2xl flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm bg-slate-900 hover:bg-slate-800 text-white font-bold px-5 py-2 rounded-lg transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
