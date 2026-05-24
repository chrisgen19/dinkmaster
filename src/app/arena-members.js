'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  updateMemberRole,
  removeMember,
  transferOwnership,
  leaveArena,
  approveJoinRequest,
  rejectJoinRequest,
  requestLinkPlayer,
  approveLinkRequest,
  rejectLinkRequest,
  cancelLinkRequest,
  linkPlayerToMember,
} from './actions';
import { ROLES } from '@/lib/roles';

const ROLE_BADGE = {
  OWNER: 'bg-emerald-50 text-emerald-700',
  ORGANIZER: 'bg-sky-50 text-sky-700',
  MEMBER: 'bg-slate-100 text-slate-600',
};

/** Members tab: roster with roles, owner controls, pending requests, and leave. */
export function ArenaMembers({
  arenaId,
  members,
  viewerUserId,
  viewerRole,
  canManage = false,
  pendingRequests = [],
  pendingLinkRequests = [],
  viewerLinkContext = null,
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  // Two independent modal slots: the member self-request picker and the
  // manager direct-link picker (keyed by the orphan player it was opened on).
  const [selfLinkOpen, setSelfLinkOpen] = useState(false);
  const [managerLinkFor, setManagerLinkFor] = useState(null);

  const isOwner = viewerRole === ROLES.OWNER;
  const isMember = !!viewerRole;

  const act = (fn) => {
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

  const promoteToggle = (m) =>
    act(() =>
      updateMemberRole(arenaId, m.userId, m.role === ROLES.ORGANIZER ? ROLES.MEMBER : ROLES.ORGANIZER),
    );
  const remove = (m) => {
    if (window.confirm(`Remove ${m.name} from this arena?`)) act(() => removeMember(arenaId, m.userId));
  };
  const transfer = (m) => {
    if (window.confirm(`Transfer ownership to ${m.name}? You will become an organizer.`)) {
      act(() => transferOwnership(arenaId, m.userId));
    }
  };
  const leave = () => {
    if (window.confirm('Leave this arena?')) act(() => leaveArena(arenaId));
  };
  const approve = (r) => act(() => approveJoinRequest(arenaId, r.userId));
  const reject = (r) => act(() => rejectJoinRequest(arenaId, r.userId));

  const approveLink = (r) => act(() => approveLinkRequest(arenaId, r.requestId));
  const rejectLink = (r) => act(() => rejectLinkRequest(arenaId, r.requestId));
  const cancelLink = () => act(() => cancelLinkRequest(arenaId));
  const submitSelfLink = (playerId) => {
    setSelfLinkOpen(false);
    act(() => requestLinkPlayer(arenaId, playerId));
  };
  const submitManagerLink = (playerId, userId) => {
    setManagerLinkFor(null);
    act(() => linkPlayerToMember(arenaId, playerId, userId));
  };

  // Self-link is offered when: a signed-in member has no linked Player here,
  // and there's at least one orphan walk-in to claim. Members with a pending
  // request still see the section (in its "pending" state) so they can cancel.
  const showSelfLink =
    isMember &&
    !!viewerLinkContext &&
    !viewerLinkContext.hasLinkedPlayer &&
    (viewerLinkContext.pendingRequest || viewerLinkContext.orphanPlayers.length > 0);

  // Manager direct-link is offered when there are orphan walk-ins to act on.
  // Reuse the viewer's orphan list when present (same query result); managers
  // who already have a linked player still need this list, so fall back to
  // collecting orphans from pendingLinkRequests is not enough — but every
  // signed-in viewer gets a `viewerLinkContext` so this is reliable for
  // managers, who are signed in by definition of `canManage`.
  const orphanPlayers = viewerLinkContext?.orphanPlayers ?? [];

  return (
    <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">
            Members ({members.length})
          </h3>
          <p className="text-xs text-slate-500 mt-1.5">
            Owners and organizers can run the session; members can view it.
          </p>
        </div>
        {isMember && !isOwner && (
          <button
            onClick={leave}
            disabled={isPending}
            className="text-xs bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg font-bold transition disabled:opacity-50"
          >
            Leave arena
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
          {error}
        </div>
      )}

      {canManage && pendingLinkRequests.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-sky-700 mb-3">
            Pending link requests ({pendingLinkRequests.length})
          </h4>
          <ul className="space-y-2">
            {pendingLinkRequests.map((r) => (
              <li key={r.requestId} className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-800 truncate">
                  <span className="font-semibold">{r.memberName}</span>
                  <span className="text-slate-400"> claims </span>
                  <span className="font-semibold">{r.playerName}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => approveLink(r)}
                    disabled={isPending}
                    className="text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => rejectLink(r)}
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

      {canManage && pendingRequests.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-amber-700 mb-3">
            Pending join requests ({pendingRequests.length})
          </h4>
          <ul className="space-y-2">
            {pendingRequests.map((r) => (
              <li key={r.requestId} className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800 truncate">{r.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => approve(r)}
                    disabled={isPending}
                    className="text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => reject(r)}
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

      {showSelfLink && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 mb-2">
            Link your account
          </h4>
          {viewerLinkContext.pendingRequest ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                Pending approval — claimed as{' '}
                <span className="font-semibold text-slate-800">
                  {viewerLinkContext.pendingRequest.playerName}
                </span>
                .
              </p>
              <button
                onClick={cancelLink}
                disabled={isPending}
                className="text-[11px] bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">
                If a walk-in row in the rack is really you, request to claim it so your stats carry over.
              </p>
              <button
                onClick={() => setSelfLinkOpen(true)}
                disabled={isPending}
                className="text-[11px] bg-sky-600 hover:bg-sky-700 text-white px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
              >
                Link Player
              </button>
            </div>
          )}
        </div>
      )}

      {canManage && orphanPlayers.length > 0 && (
        <div className="rounded-xl border border-slate-200 p-4">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 mb-3">
            Walk-in players ({orphanPlayers.length})
          </h4>
          <p className="text-xs text-slate-500 mb-3">
            Walk-ins have no account. Link one to a member to merge their stats.
          </p>
          <ul className="divide-y divide-slate-100">
            {orphanPlayers.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-sm font-semibold text-slate-800 truncate">{p.displayName}</span>
                <button
                  onClick={() => setManagerLinkFor(p)}
                  disabled={isPending}
                  className="text-[11px] bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-100 px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
                >
                  Link Player
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="divide-y divide-slate-100">
        {members.map((m) => (
          <li key={m.membershipId} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {m.name}
                {m.userId === viewerUserId && <span className="text-slate-400 font-normal"> (you)</span>}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${ROLE_BADGE[m.role]}`}
              >
                {m.role}
              </span>
              {isOwner && m.role !== ROLES.OWNER && (
                <>
                  <button
                    onClick={() => promoteToggle(m)}
                    disabled={isPending}
                    className="text-[11px] bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-100 px-2 py-1 rounded-lg font-bold transition disabled:opacity-50"
                  >
                    {m.role === ROLES.ORGANIZER ? 'Demote' : 'Make organizer'}
                  </button>
                  <button
                    onClick={() => transfer(m)}
                    disabled={isPending}
                    className="text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-100 px-2 py-1 rounded-lg font-bold transition disabled:opacity-50"
                  >
                    Make owner
                  </button>
                  <button
                    onClick={() => remove(m)}
                    disabled={isPending}
                    className="text-[11px] bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 px-2 py-1 rounded-lg font-bold transition disabled:opacity-50"
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {selfLinkOpen && (
        <LinkPlayerModal
          title="Request to link your account"
          description="Pick the walk-in player that's really you. An owner or organizer will approve it."
          submitLabel="Send request"
          options={(viewerLinkContext?.orphanPlayers ?? []).map((p) => ({
            value: p.id,
            label: p.displayName,
          }))}
          onCancel={() => setSelfLinkOpen(false)}
          onSubmit={(playerId) => submitSelfLink(playerId)}
          disabled={isPending}
        />
      )}

      {managerLinkFor && (
        <LinkPlayerModal
          title={`Link ${managerLinkFor.displayName} to a member`}
          description="Pick the member who's actually this walk-in. Their stats here will merge into the rack row."
          submitLabel="Link now"
          options={members.map((m) => ({ value: m.userId, label: m.name }))}
          onCancel={() => setManagerLinkFor(null)}
          onSubmit={(userId) => submitManagerLink(managerLinkFor.id, userId)}
          disabled={isPending}
        />
      )}
    </div>
  );
}

/** Generic single-select modal reused by both self-link and manager-link flows. */
function LinkPlayerModal({ title, description, submitLabel, options, onCancel, onSubmit, disabled }) {
  const [value, setValue] = useState(options[0]?.value ?? '');
  const canSubmit = !!value && !disabled;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !disabled) onCancel();
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div>
          <h3 className="text-base font-extrabold text-slate-800">{title}</h3>
          <p className="text-xs text-slate-500 mt-1.5">{description}</p>
        </div>
        {options.length === 0 ? (
          <p className="text-xs text-slate-500">No options available.</p>
        ) : (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-sky-200"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={disabled}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg font-bold transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => canSubmit && onSubmit(value)}
            disabled={!canSubmit}
            className="text-xs bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded-lg font-bold transition disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
