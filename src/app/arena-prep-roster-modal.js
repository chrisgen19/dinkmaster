'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  addPlayer,
  checkInPlayer,
  checkInFromRsvp,
  checkOutPlayer,
  approveJoinRequest,
  rejectJoinRequest,
  approveLinkRequest,
  rejectLinkRequest,
} from './actions';
import { matchesNameQuery, byDisplayName } from '@/lib/player-display';
import { PlayerSearchField } from './player-search-field';
import { ArenaRequestsList } from './arena-requests-list';

// Mirror of MEMBERS_SEARCH_MIN (arena-members.js): hide the search + filter
// chips until the combined roster exceeds this — a short list needs neither.
const ROSTER_SEARCH_MIN = 5;

// Chip ids double as the filter predicate selector; labels deliberately avoid
// the bare words "In"/"Out" so they can't collide with a row's toggle button
// under an exact-name role lookup (see the e2e specs).
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'In rack' },
  { id: 'out', label: 'Not in' },
];

// Below this the visual viewport shrink is browser chrome (a collapsing URL
// bar), not a keyboard, and shifting the sheet for it would just look like jitter.
const KEYBOARD_INSET_MIN = 60;

// Shared by both walk-in name inputs so the two can't drift apart. text-base
// (16px) unless the pointer is fine: iOS Safari zooms the page in when you
// focus an input under 16px and never zooms back out. Keyed off pointer, not a
// width breakpoint — a phone in landscape is wider than `sm` but still needs 16px.
const WALK_IN_INPUT_CLASS =
  'flex-1 min-w-0 bg-white border border-slate-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10 rounded-lg px-3 py-2 text-base pointer-fine:text-sm outline-none transition text-slate-800 placeholder-slate-400';

/**
 * Pixels of the layout viewport hidden behind the on-screen keyboard.
 *
 * `interactive-widget=resizes-content` (layout.js) already handles this where
 * it is honoured: Chrome/Android shrinks the LAYOUT viewport, so `innerHeight`
 * drops with it and this returns 0 — the hook costs nothing and needs no
 * browser sniffing to stand down. Safari/iOS ignores the token and shrinks only
 * the VISUAL viewport, which would strand the footer bar (search, walk-in form)
 * behind the keyboard with no scroll path to it, since the footer deliberately
 * sits outside the modal's scroll container.
 */
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = () => {
      const hidden = window.innerHeight - vv.height - vv.offsetTop;
      setInset(hidden > KEYBOARD_INSET_MIN ? Math.round(hidden) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

/**
 * Manager-only roster prep modal. Members and walk-ins share ONE list —
 * each row carries its own kind label, so finding a person never means
 * guessing which of two lists they live in. Rows are grouped by rack state
 * (in the rack, ordered by paddle position; then everyone else, alphabetical).
 * Pending join/link requests render at the top via the shared
 * `ArenaRequestsList` (also used by the Members tab, so the two never drift).
 *
 * Both inputs live in the footer bar, in the thumb zone: search is the
 * high-frequency action during a session, and adding a walk-in swaps that
 * same bar into the name form rather than claiming permanent height. On
 * phones the panel is a bottom sheet kept clear of the on-screen keyboard by
 * the app-wide `interactiveWidget: 'resizes-content'` in layout.js, with
 * `useKeyboardInset` covering the browsers that ignore that token.
 *
 * Closing the modal does NOT undo any toggles — each toggle hits a server
 * action immediately so the rack reflects state as soon as it changes.
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
 * @param {Array<{playerId:string|null,userId:string|null,status:string}>} [props.attendees] -
 *   RSVPs for the arena's open activity. Drives the "going" chip, the sort that
 *   floats them to the top, and the bulk check-in count.
 * @param {string|null} [props.activityId] - the open activity, needed by the bulk check-in action
 * @param {(state: object) => void} props.onApplyResult - parent's state-reconcile callback (same shape as run())
 * @param {(command: object) => Promise<{error?: string, noop?: boolean}>} [props.offlineRunLocal] -
 *   when set, the arena is in offline session mode: check-in/out and walk-in
 *   adds route through the local board engine instead of server actions, and
 *   request approvals (membership rows, server-only) are unavailable.
 * @param {() => void} props.onClose
 */
export function ArenaPrepRosterModal({
  arenaId,
  members,
  players,
  queue,
  pendingRequests = [],
  pendingLinkRequests = [],
  attendees = [],
  activityId = null,
  onApplyResult,
  offlineRunLocal = null,
  onClose,
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newFirst, setNewFirst] = useState('');
  const [newLast, setNewLast] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  // The footer bar is either the search row or the add-walk-in form, never
  // both — one row of thumb-zone height, whichever the manager needs.
  const [addOpen, setAddOpen] = useState(false);
  const keyboardInset = useKeyboardInset();

  // The form stays open across adds — a session usually starts with a queue of
  // people at the door — so closing it is explicit, and drops any half-typed name.
  const closeAddWalkIn = () => {
    setNewFirst('');
    setNewLast('');
    setAddOpen(false);
  };

  // Escape closes the modal — partner to the explicit Done/✕ button. The
  // backdrop is deliberately inert so a stray tap can't dismiss this
  // management workflow.
  // It backs out of the add-walk-in bar first, so a manager who opened it by
  // mistake doesn't lose the whole roster. PlayerSearchField likewise swallows
  // Escape while it holds text, clearing the query instead of closing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (addOpen) {
        closeAddWalkIn();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, addOpen]);

  // One normalized row shape for both kinds, derived from {members, players,
  // queue}: a member's linked active Player is what puts them on the rack, a
  // walk-in IS the Player. Everything downstream (search, grouping, the
  // toggle handler) works off this shape and never branches on kind again.
  const rosterRows = useMemo(() => {
    const playerByUser = new Map();
    for (const p of players) {
      if (p.userId) playerByUser.set(p.userId, p);
    }
    const rackNumberOf = new Map(queue.map((id, i) => [id, i + 1]));

    // Who said they're coming tonight. Indexed by both keys because an attendee
    // row carries a playerId when the member has played before and only a
    // userId when they haven't.
    const rsvpByPlayer = new Map();
    const rsvpByUser = new Map();
    for (const a of attendees) {
      if (a.playerId) rsvpByPlayer.set(a.playerId, a.status);
      if (a.userId) rsvpByUser.set(a.userId, a.status);
    }
    const rsvpFor = (playerId, userId) =>
      (playerId && rsvpByPlayer.get(playerId)) || (userId && rsvpByUser.get(userId)) || null;

    const memberRows = members.map((m) => {
      const player = playerByUser.get(m.userId) ?? null;
      const rackNumber = player ? (rackNumberOf.get(player.id) ?? 0) : 0;
      return {
        key: `member:${m.userId}`,
        playerId: player?.id ?? null,
        displayName: m.name,
        kind: 'member',
        label: m.role.toLowerCase(),
        checkedIn: rackNumber > 0,
        rackNumber,
        rsvp: rsvpFor(player?.id, m.userId),
      };
    });

    // Walk-ins = active Player rows with no userId.
    const walkInRows = players
      .filter((p) => !p.userId)
      .map((p) => {
        const rackNumber = rackNumberOf.get(p.id) ?? 0;
        return {
          key: `walkIn:${p.id}`,
          playerId: p.id,
          displayName: p.lastName ? `${p.firstName} ${p.lastName}` : p.firstName,
          kind: 'walkIn',
          label: 'walk-in',
          checkedIn: rackNumber > 0,
          rackNumber,
          rsvp: rsvpFor(p.id, null),
        };
      });

    return [...memberRows, ...walkInRows];
  }, [members, players, queue, attendees]);

  /** Members who said they're coming but aren't racked yet — what the bulk action would add. */
  const pendingGoing = useMemo(
    () => rosterRows.filter((r) => r.rsvp === 'GOING' && !r.checkedIn && r.playerId).length,
    [rosterRows],
  );

  // Search + chips appear once the roster is long enough to need them, gated
  // on the RAW total so the controls can't vanish mid-filter as results narrow.
  const showControls = rosterRows.length > ROSTER_SEARCH_MIN;

  // Checked-in players lead, ordered by paddle position so the group reads
  // like the rack itself; everyone else follows alphabetically, which is the
  // predictable place to look for a name that isn't playing yet.
  const { inRack, notIn, counts } = useMemo(() => {
    const inAll = rosterRows.filter((r) => r.checkedIn);
    const outAll = rosterRows.filter((r) => !r.checkedIn);
    const matches = (r) => matchesNameQuery(r.displayName, showControls ? query : '');
    return {
      counts: { all: rosterRows.length, in: inAll.length, out: outAll.length },
      inRack:
        filter === 'out' ? [] : inAll.filter(matches).sort((a, b) => a.rackNumber - b.rackNumber),
      // Anyone who said they're coming sorts above everyone else, so the names
      // the manager is about to tick are the ones already under their thumb.
      // Alphabetical within each band keeps it predictable.
      notIn:
        filter === 'in'
          ? []
          : outAll
              .filter(matches)
              .sort((a, b) => rsvpRank(a) - rsvpRank(b) || byDisplayName(a, b)),
    };
  }, [rosterRows, query, filter, showControls]);

  // Rack actions (check-in/out, add walk-in) return a fresh state envelope
  // we reconcile into the parent's local rack state via `onApplyResult` —
  // no full refetch. Request actions instead use `router.refresh()` (see
  // `handleRequest`) because they mutate membership rows that live on
  // server-rendered props. The two paths are deliberately separate; both
  // converge once arena.js re-syncs from the next server read.
  // `refresh` additionally re-fetches the server-rendered props (members /
  // walk-ins / requests). Adding or removing a walk-in changes the Members
  // tab's walk-in list, which is sourced from `viewerLinkContext` rather than
  // the local rack state `onApplyResult` reconciles — so those paths must
  // refresh or a just-added walk-in won't appear there until a reload.
  const run = (fn, { refresh = false } = {}) => {
    startTransition(async () => {
      try {
        const result = await fn();
        setError(result?.error || '');
        if (result?.state) onApplyResult(result);
        if (refresh && !result?.error) router.refresh();
      } catch {
        setError('Something went wrong. Please try again.');
      }
    });
  };

  // Offline path: the parent's runLocal applies board state itself, so this
  // only needs to surface errors inside the modal.
  const runOffline = (command) => {
    startTransition(async () => {
      const result = await offlineRunLocal(command);
      setError(result?.error || '');
    });
  };

  const handleToggle = (row) => {
    if (!row.playerId) {
      // A member without a Player row is unexpected (approveJoinRequest
      // creates one); surface a clear error rather than silently no-oping.
      setError(`${row.displayName} has no player record yet.`);
      return;
    }
    if (offlineRunLocal) {
      runOffline({ type: row.checkedIn ? 'checkOut' : 'checkIn', playerId: row.playerId });
      return;
    }
    run(() =>
      row.checkedIn
        ? checkOutPlayer(arenaId, row.playerId)
        : checkInPlayer(arenaId, row.playerId),
    );
  };

  /**
   * Rack everyone who RSVP'd going, in one tap.
   *
   * Returns a state envelope like the other rack actions (so the parent
   * reconciles without a refetch) AND needs a `router.refresh()`, because it
   * also flips those attendees to CHECKED_IN — and attendance arrives through
   * the server-rendered props, not the board state.
   */
  const handleCheckInAllGoing = () => {
    if (!activityId) return;
    run(() => checkInFromRsvp(arenaId, activityId), { refresh: true });
  };

  // Request actions don't return a fresh state envelope — they create or
  // delete ArenaMembership / JoinRequest / LinkRequest rows, which arrive
  // via the parent's server-rendered props. Router.refresh() pulls them.
  const handleRequest = (fn) => {
    if (offlineRunLocal) {
      // Approvals mutate membership rows on the server; there is no local
      // counterpart, so they wait until the arena is back online.
      setError('Requests can only be handled while online.');
      return;
    }
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

  // A just-added walk-in lands on the rack. Reset the view so the manager
  // always sees the add take effect, even if a search or the "Not in" chip
  // would otherwise hide the new row.
  const clearViewFilters = () => {
    setQuery('');
    if (filter === 'out') setFilter('all');
  };

  const handleAddWalkIn = (e) => {
    e.preventDefault();
    if (!newFirst.trim()) return;
    const first = newFirst;
    const last = newLast;
    setNewFirst('');
    setNewLast('');
    clearViewFilters();
    if (offlineRunLocal) {
      runOffline({ type: 'addPlayer', firstName: first, lastName: last });
      return;
    }
    run(() => addPlayer(arenaId, first, last), { refresh: true });
  };

  return (
    <div
      data-testid="prep-roster-backdrop"
      // Padding lifts the sheet off the keyboard; the panel's own max-height
      // gives back the same pixels so it can't grow past the top of the screen.
      // Both no-op at 0, which is every case except iOS with a keyboard up.
      style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prep-roster-title"
        style={keyboardInset ? { maxHeight: `calc(100dvh - ${keyboardInset}px)` } : undefined}
        className="bg-white rounded-t-2xl sm:rounded-2xl border border-slate-200 max-w-lg w-full max-h-[92dvh] sm:max-h-[85vh] flex flex-col shadow-2xl animate-scale-up"
      >
        {/* Header sits outside the scroll container, so the chips are pinned by
            construction. Kept deliberately short — every pixel here is a row
            the list can't show on a phone. */}
        <div className="p-6 pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 id="prep-roster-title" className="text-base font-extrabold text-slate-900">
                Prep roster
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-snug">
                Toggle players in or out of the rack. Changes apply immediately.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Done, close roster"
              className="shrink-0 grid min-h-11 place-items-center rounded-lg px-3 -my-1 -mr-2 text-sm font-bold text-slate-900 hover:bg-slate-100 transition pointer-fine:h-8 pointer-fine:min-h-0 pointer-fine:w-8 pointer-fine:px-0 pointer-fine:my-0 pointer-fine:mr-0 pointer-fine:text-slate-500"
            >
              <span className="pointer-fine:hidden">Done</span>
              <svg className="hidden w-4 h-4 pointer-fine:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {showControls && (
            <div role="group" aria-label="Filter roster" className="mt-3 flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider transition ${
                    filter === f.id
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {f.label} <span className="tabular-nums opacity-70">{counts[f.id]}</span>
                </button>
              ))}
            </div>
          )}
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

          {/* The payoff for collecting RSVPs: one tap instead of ticking
              fourteen names. Only shown when it would actually do something,
              and hidden offline since it needs the server action. */}
          {pendingGoing > 0 && activityId && !offlineRunLocal && (
            <button
              type="button"
              onClick={handleCheckInAllGoing}
              disabled={isPending}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50 disabled:active:scale-100"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Check in all going ({pendingGoing})
            </button>
          )}

          {counts.all === 0 ? (
            <p className="text-xs text-slate-400 italic">No members or walk-ins yet.</p>
          ) : (
            <>
              <RosterGroup
                title="In the rack"
                rows={inRack}
                isPending={isPending}
                onToggle={handleToggle}
              />
              <RosterGroup
                title="Not in"
                rows={notIn}
                isPending={isPending}
                onToggle={handleToggle}
              />
              {inRack.length === 0 && notIn.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-slate-500">
                  {query.trim()
                    ? `No players match “${query}”.`
                    : filter === 'in'
                      ? 'Nobody is checked in yet.'
                      : 'Everyone is checked in.'}
                </p>
              )}
            </>
          )}
        </div>

        {/* Thumb-zone bar: search by default, the walk-in name form while
            adding. One row either way, so the list keeps the height. */}
        <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-slate-100 bg-slate-50/40 rounded-b-none sm:rounded-b-2xl">
          {addOpen ? (
            <form onSubmit={handleAddWalkIn} className="flex gap-2">
              <input
                type="text"
                placeholder="First name"
                aria-label="Walk-in first name"
                value={newFirst}
                autoFocus
                onChange={(e) => setNewFirst(e.target.value)}
                className={WALK_IN_INPUT_CLASS}
              />
              <input
                type="text"
                placeholder="Last (opt.)"
                aria-label="Walk-in last name"
                value={newLast}
                onChange={(e) => setNewLast(e.target.value)}
                className={WALK_IN_INPUT_CLASS}
              />
              <button
                type="submit"
                disabled={isPending || !newFirst.trim()}
                className="shrink-0 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-extrabold px-4 py-2 rounded-lg text-sm transition"
              >
                Add
              </button>
              <button
                type="button"
                onClick={closeAddWalkIn}
                aria-label="Done adding walk-ins"
                className="shrink-0 grid place-items-center h-[38px] w-9 rounded-lg text-slate-500 hover:bg-slate-200/70 transition"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </form>
          ) : (
            <div className="flex gap-2 items-center">
              {showControls && (
                <PlayerSearchField
                  value={query}
                  onChange={setQuery}
                  disabled={isPending}
                  placeholder="Search players…"
                  className="flex-1"
                />
              )}
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className={`shrink-0 border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-extrabold px-4 py-2 rounded-lg text-sm transition ${
                  showControls ? '' : 'flex-1'
                }`}
              >
                + Walk-in
              </button>
            </div>
          )}
          {/* Touch devices keep this footer to one action row. Fine pointers
              retain the familiar footer Done affordance, where the extra
              vertical space is not scarce. */}
          <div
            className={`items-center gap-3 ${
              addOpen
                ? 'mt-2 flex'
                : 'hidden pointer-fine:mt-3 pointer-fine:flex pointer-fine:justify-end'
            }`}
          >
            {addOpen && (
              <p className="text-[10px] text-slate-400 leading-snug">
                Delete a walk-in for good in Members → Walk-ins.
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              data-testid="prep-roster-footer-done"
              className="ml-auto hidden shrink-0 rounded-lg bg-slate-900 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-800 pointer-fine:block"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One rack-state group. Renders nothing when the current view empties it. */
function RosterGroup({ title, rows, isPending, onToggle }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h4 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-400 mb-3">
        {title} ({rows.length})
      </h4>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <RosterRow key={row.key} row={row} isPending={isPending} onToggle={onToggle} />
        ))}
      </ul>
    </section>
  );
}

/**
 * A single roster row, identical for members and walk-ins. The kind reads off
 * the meta line under the name: members show their role, walk-ins get an
 * amber chip so they stay scannable in a long mixed list.
 */
/**
 * Sort weight for the "not in the rack" band: confirmed first, then waitlisted,
 * then anyone who hasn't answered, and finally the people who already said no —
 * least likely to be ticked, so least deserving of thumb space.
 */
function rsvpRank(row) {
  if (row.rsvp === 'GOING' || row.rsvp === 'CHECKED_IN') return 0;
  if (row.rsvp === 'WAITLIST') return 1;
  if (row.rsvp === 'DECLINED') return 3;
  return 2;
}

const RSVP_CHIPS = {
  GOING: { label: 'going', className: 'text-emerald-700 bg-emerald-50 ring-emerald-100' },
  CHECKED_IN: { label: 'going', className: 'text-emerald-700 bg-emerald-50 ring-emerald-100' },
  WAITLIST: { label: 'waitlist', className: 'text-amber-700 bg-amber-50 ring-amber-100' },
  DECLINED: { label: 'can’t make it', className: 'text-slate-400 bg-slate-50 ring-slate-100' },
};

function RosterRow({ row, isPending, onToggle }) {
  const chip = RSVP_CHIPS[row.rsvp] ?? null;
  return (
    <li
      className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition ${
        row.checkedIn
          ? 'border-emerald-200 bg-emerald-50/60'
          : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-800 truncate">{row.displayName}</p>
        <p className="text-[10px] mt-1 flex items-center gap-1.5 flex-wrap">
          {row.kind === 'walkIn' ? (
            <span className="font-extrabold uppercase tracking-wider text-amber-700 bg-amber-50 ring-1 ring-amber-100 rounded px-1.5 py-0.5">
              walk-in
            </span>
          ) : (
            <span className="font-semibold text-slate-500">{row.label}</span>
          )}
          {chip && (
            <span
              className={`font-extrabold uppercase tracking-wider rounded px-1.5 py-0.5 ring-1 ${chip.className}`}
            >
              {chip.label}
            </span>
          )}
          {row.checkedIn && (
            <span className="text-slate-400">· #{row.rackNumber} on rack</span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onToggle(row)}
        disabled={isPending}
        className={`shrink-0 text-xs font-extrabold uppercase tracking-wider px-3 py-1.5 rounded-lg transition disabled:opacity-50 ${
          row.checkedIn
            ? 'bg-emerald-700 text-white hover:bg-emerald-800'
            : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
        }`}
      >
        {row.checkedIn ? '✓ In' : 'Out'}
      </button>
    </li>
  );
}
