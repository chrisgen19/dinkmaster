'use client';

import { useState } from 'react';
import { matchesNameQuery } from '@/lib/player-display';
import { PlayerSearchField } from './player-search-field';

// Mirror of MEMBERS_SEARCH_MIN (arena-members.js): hide the search until the
// combined request count exceeds this — a short list is trivial to scan.
const REQUESTS_SEARCH_MIN = 5;

/**
 * Pending requests panel — shared by the Members tab's Requests pill and
 * the Prep Roster modal so the two surfaces can never drift. Renders a
 * sky-tinted Link requests group and an amber-tinted Join requests group;
 * an empty-state line replaces both when nothing is pending.
 *
 * All four action callbacks are passed in (`onApproveJoin` etc.) so the
 * mount point owns whether a successful action triggers a state-reconcile,
 * a `router.refresh()`, or both — keeps this component side-effect free.
 *
 * @param {object} props
 * @param {Array<{requestId:string,memberName:string,playerName:string}>} props.pendingLinkRequests
 * @param {Array<{requestId:string,userId:string,name:string}>} props.pendingRequests
 * @param {boolean} props.isPending - disable buttons while a server action is in flight
 * @param {(r:object) => void} props.onApproveLink
 * @param {(r:object) => void} props.onRejectLink
 * @param {(r:object) => void} props.onApproveJoin
 * @param {(r:object) => void} props.onRejectJoin
 */
export function ArenaRequestsList({
  pendingLinkRequests,
  pendingRequests,
  isPending,
  onApproveLink,
  onRejectLink,
  onApproveJoin,
  onRejectJoin,
}) {
  const [query, setQuery] = useState('');

  if (pendingLinkRequests.length === 0 && pendingRequests.length === 0) {
    return <p className="text-xs text-slate-500 py-2">No pending requests.</p>;
  }

  // Search appears once the combined list is long; gate on the RAW totals so
  // the field doesn't vanish mid-filter as results narrow. Link requests
  // match on either side of "<member> claims <walk-in>".
  const showSearch = pendingLinkRequests.length + pendingRequests.length > REQUESTS_SEARCH_MIN;
  const links = showSearch
    ? pendingLinkRequests.filter((r) => matchesNameQuery(`${r.memberName} ${r.playerName}`, query))
    : pendingLinkRequests;
  const joins = showSearch
    ? pendingRequests.filter((r) => matchesNameQuery(r.name, query))
    : pendingRequests;

  return (
    <div className="space-y-4">
      {showSearch && (
        <PlayerSearchField
          value={query}
          onChange={setQuery}
          disabled={isPending}
          placeholder="Search requests…"
        />
      )}
      {showSearch && links.length === 0 && joins.length === 0 && (
        <p className="px-1 py-2 text-center text-xs text-slate-500">
          No requests match &ldquo;{query}&rdquo;.
        </p>
      )}
      {links.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-sky-700 mb-3">
            Link requests ({links.length})
          </h4>
          <ul className="space-y-2">
            {links.map((r) => (
              <li key={r.requestId} className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-800 truncate">
                  <span className="font-semibold">{r.memberName}</span>
                  <span className="text-slate-400"> claims </span>
                  <span className="font-semibold">{r.playerName}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onApproveLink(r)}
                    disabled={isPending}
                    className="text-[11px] bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onRejectLink(r)}
                    disabled={isPending}
                    className="text-[11px] bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {joins.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-amber-700 mb-3">
            Join requests ({joins.length})
          </h4>
          <ul className="space-y-2">
            {joins.map((r) => (
              <li key={r.requestId} className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800 truncate">{r.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onApproveJoin(r)}
                    disabled={isPending}
                    className="text-[11px] bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => onRejectJoin(r)}
                    disabled={isPending}
                    className="text-[11px] bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
