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

/**
 * Members tab: pill-tabbed view of the arena's people. Three pills —
 * `members` (account holders, with role management for the owner),
 * `walkins` (orphan walk-in players, read-only for non-managers, with a
 * Link Player action for managers), and `requests` (manager-only: pending
 * join requests + pending link requests). A manager-only count banner sits
 * above the pills on non-`requests` pills so unattended approvals are
 * always visible without flooding the list view.
 */
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
  const [activePill, setActivePill] = useState('members');
  // Two independent modal slots: the member self-request picker and the
  // manager direct-link picker (keyed by the orphan player it was opened on).
  const [selfLinkOpen, setSelfLinkOpen] = useState(false);
  const [managerLinkFor, setManagerLinkFor] = useState(null);

  const isOwner = viewerRole === ROLES.OWNER;
  const isMember = !!viewerRole;
  const orphanPlayers = viewerLinkContext?.orphanPlayers ?? [];
  const claimableOrphans = viewerLinkContext?.claimableOrphans ?? [];
  const pendingTotal = pendingRequests.length + pendingLinkRequests.length;

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
  // and there's at least one *claimable* orphan (i.e. one without an open
  // request from someone else). Members with a pending request still see the
  // panel (in its "pending" state) so they can cancel.
  const showSelfLink =
    isMember &&
    !!viewerLinkContext &&
    !viewerLinkContext.hasLinkedPlayer &&
    (viewerLinkContext.pendingRequest || claimableOrphans.length > 0);

  // Pill nav. The Requests pill is manager-only — non-managers have nothing
  // actionable there. Walk-ins is always visible (read-only for non-managers).
  const pills = [
    { id: 'members', label: 'Members', count: members.length },
    { id: 'walkins', label: 'Walk-ins', count: orphanPlayers.length },
    ...(canManage ? [{ id: 'requests', label: 'Requests', count: pendingTotal }] : []),
  ];

  return (
    <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-widest text-slate-400">
            People
          </h3>
          <p className="text-xs text-slate-500 mt-1.5">
            Members have an account and a role. Walk-ins are temporary — link them to a member to keep their stats.
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

      {canManage && pendingTotal > 0 && activePill !== 'requests' && (
        <button
          type="button"
          onClick={() => setActivePill('requests')}
          className="w-full text-left rounded-xl border border-amber-200 bg-amber-50/60 hover:bg-amber-50 px-4 py-2.5 flex items-center justify-between gap-3 transition"
        >
          <span className="text-xs font-semibold text-amber-800">
            {summariseRequests(pendingRequests.length, pendingLinkRequests.length)} pending
          </span>
          <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">
            Review →
          </span>
        </button>
      )}

      <div role="tablist" aria-label="People pills" className="inline-flex gap-1 p-1 bg-slate-100 rounded-xl">
        {pills.map((p) => {
          const active = activePill === p.id;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={active}
              onClick={() => setActivePill(p.id)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {p.label}
              <span
                className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-slate-100 text-slate-600' : 'bg-slate-200/70 text-slate-500'
                }`}
              >
                {p.count}
              </span>
            </button>
          );
        })}
      </div>

      {activePill === 'members' && (
        <div className="space-y-4">
          {showSelfLink && (
            <SelfLinkPanel
              pendingRequest={viewerLinkContext.pendingRequest}
              onOpenModal={() => setSelfLinkOpen(true)}
              onCancel={cancelLink}
              disabled={isPending}
            />
          )}
          <MembersList
            members={members}
            viewerUserId={viewerUserId}
            isOwner={isOwner}
            isPending={isPending}
            onPromoteToggle={promoteToggle}
            onTransfer={transfer}
            onRemove={remove}
          />
        </div>
      )}

      {activePill === 'walkins' && (
        <WalkInsList
          orphans={orphanPlayers}
          canManage={canManage}
          isPending={isPending}
          onLink={(p) => setManagerLinkFor(p)}
        />
      )}

      {activePill === 'requests' && canManage && (
        <RequestsList
          pendingLinkRequests={pendingLinkRequests}
          pendingRequests={pendingRequests}
          isPending={isPending}
          onApproveLink={approveLink}
          onRejectLink={rejectLink}
          onApproveJoin={approve}
          onRejectJoin={reject}
        />
      )}

      {selfLinkOpen && (
        <LinkPlayerModal
          title="Request to link your account"
          description="Pick the walk-in player that's really you. An owner or organizer will approve it."
          submitLabel="Send request"
          options={claimableOrphans.map((p) => ({ value: p.id, label: p.displayName }))}
          onCancel={() => setSelfLinkOpen(false)}
          onSubmit={submitSelfLink}
          disabled={isPending}
        />
      )}

      {managerLinkFor && (
        <LinkPlayerModal
          title={`Link ${managerLinkFor.displayName} to a member`}
          description="Pick the member who's actually this walk-in. Their stats here will merge into the rack row."
          submitLabel="Link now"
          // Hide members who already have an active linked player here —
          // picking one would trigger an irreversible stat merge into the
          // wrong row. Such members can no longer be the "true identity" of
          // a walk-in by definition.
          options={members
            .filter((m) => !m.hasLinkedPlayer)
            .map((m) => ({ value: m.userId, label: m.name }))}
          onCancel={() => setManagerLinkFor(null)}
          onSubmit={(userId) => submitManagerLink(managerLinkFor.id, userId)}
          disabled={isPending}
        />
      )}
    </div>
  );
}

/** One-line summary like "2 join + 3 link requests" / "1 link request". */
function summariseRequests(joinCount, linkCount) {
  const parts = [];
  if (joinCount > 0) parts.push(`${joinCount} join`);
  if (linkCount > 0) parts.push(`${linkCount} link`);
  const total = joinCount + linkCount;
  const label = total === 1 ? 'request' : 'requests';
  return `${parts.join(' + ')} ${label}`;
}

function SelfLinkPanel({ pendingRequest, onOpenModal, onCancel, disabled }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 mb-2">
        Link your account
      </h4>
      {pendingRequest ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-600">
            Pending approval — claimed as{' '}
            <span className="font-semibold text-slate-800">{pendingRequest.playerName}</span>.
          </p>
          <button
            onClick={onCancel}
            disabled={disabled}
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
            onClick={onOpenModal}
            disabled={disabled}
            className="text-[11px] bg-sky-600 hover:bg-sky-700 text-white px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
          >
            Link Player
          </button>
        </div>
      )}
    </div>
  );
}

function MembersList({ members, viewerUserId, isOwner, isPending, onPromoteToggle, onTransfer, onRemove }) {
  if (members.length === 0) {
    return <p className="text-xs text-slate-500 py-2">No members yet.</p>;
  }
  return (
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
                  onClick={() => onPromoteToggle(m)}
                  disabled={isPending}
                  className="text-[11px] bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-100 px-2 py-1 rounded-lg font-bold transition disabled:opacity-50"
                >
                  {m.role === ROLES.ORGANIZER ? 'Demote' : 'Make organizer'}
                </button>
                <button
                  onClick={() => onTransfer(m)}
                  disabled={isPending}
                  className="text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-100 px-2 py-1 rounded-lg font-bold transition disabled:opacity-50"
                >
                  Make owner
                </button>
                <button
                  onClick={() => onRemove(m)}
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
  );
}

function WalkInsList({ orphans, canManage, isPending, onLink }) {
  if (orphans.length === 0) {
    return <p className="text-xs text-slate-500 py-2">No walk-in players right now.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {orphans.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-slate-800 truncate">{p.displayName}</span>
            <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">
              walk-in
            </span>
            {p.hasPendingRequest && (
              <span
                className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700"
                title="A member has requested to claim this walk-in. Review in the Requests pill."
              >
                claim pending
              </span>
            )}
          </div>
          {canManage && (
            <button
              onClick={() => onLink(p)}
              disabled={isPending}
              className="text-[11px] bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-100 px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
            >
              Link Player
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function RequestsList({
  pendingLinkRequests,
  pendingRequests,
  isPending,
  onApproveLink,
  onRejectLink,
  onApproveJoin,
  onRejectJoin,
}) {
  if (pendingLinkRequests.length === 0 && pendingRequests.length === 0) {
    return <p className="text-xs text-slate-500 py-2">No pending requests.</p>;
  }
  return (
    <div className="space-y-4">
      {pendingLinkRequests.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-sky-700 mb-3">
            Link requests ({pendingLinkRequests.length})
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
                    onClick={() => onApproveLink(r)}
                    disabled={isPending}
                    className="text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
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

      {pendingRequests.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-amber-700 mb-3">
            Join requests ({pendingRequests.length})
          </h4>
          <ul className="space-y-2">
            {pendingRequests.map((r) => (
              <li key={r.requestId} className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800 truncate">{r.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onApproveJoin(r)}
                    disabled={isPending}
                    className="text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg font-bold transition disabled:opacity-50"
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

/**
 * Generic single-select modal reused by both self-link and manager-link
 * flows. The initial value is intentionally blank — a stray click on the
 * pre-selected first option would otherwise link a walk-in to the wrong
 * member and merge their stats. The submit button stays disabled until the
 * user makes an explicit choice.
 */
function LinkPlayerModal({ title, description, submitLabel, options, onCancel, onSubmit, disabled }) {
  const [value, setValue] = useState('');
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
            <option value="" disabled>
              Select…
            </option>
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
