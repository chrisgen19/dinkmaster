'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  updateMemberRole,
  removeMember,
  removePlayer,
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
import { monogram } from '@/lib/user-insights';
import { ArenaRequestsList } from './arena-requests-list';

/** Locale-aware case-insensitive name compare for sorting people lists. */
const byDisplayName = (a, b) =>
  (a.name ?? a.displayName ?? '').localeCompare(
    b.name ?? b.displayName ?? '',
    undefined,
    { sensitivity: 'base' },
  );

const ROLE_BADGE = {
  OWNER: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100',
  ORGANIZER: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100',
  MEMBER: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200',
};

// Shared button vocabulary — keeps every action row in lockstep without
// hoisting a Tailwind plugin or a new component. Focus rings are explicit
// so keyboard navigation stays visible across all four button flavours.
const BTN_BASE =
  'text-[11px] font-bold px-2.5 py-1 rounded-lg transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1';
const BTN = {
  neutral: `${BTN_BASE} bg-slate-50 hover:bg-slate-100 text-slate-700 ring-1 ring-slate-200 focus-visible:ring-slate-300`,
  danger: `${BTN_BASE} bg-white hover:bg-red-50 hover:text-red-600 text-slate-600 ring-1 ring-slate-200 focus-visible:ring-red-300`,
  primary: `${BTN_BASE} bg-sky-600 hover:bg-sky-700 text-white focus-visible:ring-sky-300`,
  promote: `${BTN_BASE} bg-sky-50 hover:bg-sky-100 text-sky-700 ring-1 ring-sky-100 focus-visible:ring-sky-300`,
  accent: `${BTN_BASE} bg-emerald-50 hover:bg-emerald-100 text-emerald-700 ring-1 ring-emerald-100 focus-visible:ring-emerald-300`,
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
  const claimableOrphans = viewerLinkContext?.claimableOrphans ?? [];
  const pendingTotal = pendingRequests.length + pendingLinkRequests.length;

  // Sort the visible people lists by name so a manager scanning a long
  // arena can find someone predictably. Sorting at the render boundary
  // keeps the underlying props stable (the parent still uses creation
  // order elsewhere for `oldest first` semantics, e.g. role transfer).
  // Reading `viewerLinkContext?.orphanPlayers` inside the memo (instead of
  // through a hoisted `orphanPlayers = … ?? []` const) avoids the `?? []`
  // fallback creating a fresh array each render and busting the dep check.
  const sortedMembers = useMemo(() => [...members].sort(byDisplayName), [members]);
  const sortedOrphans = useMemo(
    () => [...(viewerLinkContext?.orphanPlayers ?? [])].sort(byDisplayName),
    [viewerLinkContext?.orphanPlayers],
  );

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
  const removeWalkIn = (p) => {
    if (window.confirm(
      `Delete ${p.displayName}?\n\nThis removes their stats and partnership counts. Past match history snapshots in the Match Log are kept (names there are stored separately and survive the delete).`,
    )) {
      act(() => removePlayer(arenaId, p.id));
    }
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

  // Self-link is offered to non-manager members as long as there's a
  // claimable orphan (one without an open request from someone else) or
  // they already have a pending request to cancel. Managers (owner /
  // organizer) are excluded: they can merge any walk-in directly via the
  // Walk-ins pill's Link action, so the self-*request* flow would just be
  // a request they'd approve themselves. We deliberately do NOT gate on
  // `!hasLinkedPlayer`: `approveJoinRequest` auto-creates a fresh Player on
  // join, so every member arrives with `hasLinkedPlayer = true`. Gating on
  // that would make the canonical "claim my historical walk-in" flow
  // unreachable — the backend's merge path in `applyLinkPlayerToMember`
  // handles it correctly.
  const showSelfLink =
    isMember &&
    !canManage &&
    !!viewerLinkContext &&
    (viewerLinkContext.pendingRequest || claimableOrphans.length > 0);

  // Pill nav. The Requests pill is manager-only — non-managers have nothing
  // actionable there. Walk-ins is always visible (read-only for non-managers).
  const pills = [
    { id: 'members', label: 'Members', count: sortedMembers.length },
    { id: 'walkins', label: 'Walk-ins', count: sortedOrphans.length },
    ...(canManage ? [{ id: 'requests', label: 'Requests', count: pendingTotal }] : []),
  ];

  return (
    <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-6 animate-fade-in">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">
            People
          </p>
          <h3 className="font-display text-xl font-semibold text-slate-900 mt-0.5">
            Who&apos;s in this arena
          </h3>
          <p className="text-xs text-slate-500 mt-1.5 max-w-md">
            Members have an account and a role. Walk-ins are temporary — link them to a member to keep their stats.
          </p>
        </div>
        {isMember && !isOwner && (
          <button
            onClick={leave}
            disabled={isPending}
            className={`${BTN.danger} shrink-0`}
          >
            Leave arena
          </button>
        )}
      </header>

      {error && (
        <div
          role="alert"
          className="px-3 py-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2"
        >
          <span aria-hidden className="mt-0.5 inline-block h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {canManage && pendingTotal > 0 && activePill !== 'requests' && (
        <button
          type="button"
          onClick={() => setActivePill('requests')}
          className="group w-full text-left rounded-xl border border-amber-200/80 bg-amber-50/50 hover:bg-amber-50 hover:border-amber-300 pl-3 pr-4 py-2.5 flex items-center justify-between gap-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <span aria-hidden className="h-6 w-1 rounded-full bg-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-amber-900 truncate">
              {summariseRequests(pendingRequests.length, pendingLinkRequests.length)} pending
            </span>
          </span>
          <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider shrink-0 transition group-hover:translate-x-0.5">
            Review →
          </span>
        </button>
      )}

      <div
        role="tablist"
        aria-label="People pills"
        className="inline-flex gap-1 p-1 bg-slate-50 ring-1 ring-slate-200/70 rounded-xl"
      >
        {pills.map((p) => {
          const active = activePill === p.id;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={active}
              onClick={() => setActivePill(p.id)}
              className={`text-xs font-bold px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
                active
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/60'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {p.label}
              <span
                className={`text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-full ${
                  active ? 'bg-slate-100 text-slate-700' : 'bg-slate-200/70 text-slate-500'
                }`}
              >
                {p.count}
              </span>
            </button>
          );
        })}
      </div>

      {activePill === 'members' && (
        <div className="space-y-4 animate-fade-in">
          {showSelfLink && (
            <SelfLinkPanel
              pendingRequest={viewerLinkContext.pendingRequest}
              onOpenModal={() => setSelfLinkOpen(true)}
              onCancel={cancelLink}
              disabled={isPending}
            />
          )}
          <MembersList
            members={sortedMembers}
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
        <div className="animate-fade-in">
          <WalkInsList
            orphans={sortedOrphans}
            canManage={canManage}
            isPending={isPending}
            onLink={(p) => setManagerLinkFor(p)}
            onRemove={removeWalkIn}
          />
        </div>
      )}

      {activePill === 'requests' && canManage && (
        <div className="animate-fade-in">
          <ArenaRequestsList
            pendingLinkRequests={pendingLinkRequests}
            pendingRequests={pendingRequests}
            isPending={isPending}
            onApproveLink={approveLink}
            onRejectLink={rejectLink}
            onApproveJoin={approve}
            onRejectJoin={reject}
          />
        </div>
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
          // Show every member, including those with an existing linked
          // Player — that's the canonical "merge historical walk-in into
          // the member's account" case. A `· existing player` suffix
          // makes the merge intent visible so an accidental pick is hard
          // to miss, while the blank default still forces an explicit
          // selection.
          options={members.map((m) => ({
            value: m.userId,
            label: m.hasLinkedPlayer ? `${m.name} · existing player` : m.name,
          }))}
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

function Avatar({ name, tone = 'slate' }) {
  const palette = {
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
    sky: 'bg-sky-50 text-sky-700 ring-sky-100',
  }[tone];
  return (
    <span
      aria-hidden
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-black tracking-wide ring-1 shrink-0 ${palette}`}
    >
      {monogram(name)}
    </span>
  );
}

function SelfLinkPanel({ pendingRequest, onOpenModal, onCancel, disabled }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50/80 to-white p-4">
      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500 mb-2">
        Link your account
      </p>
      {pendingRequest ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-600">
            Pending approval — claimed as{' '}
            <span className="font-semibold text-slate-900">{pendingRequest.playerName}</span>.
          </p>
          <button onClick={onCancel} disabled={disabled} className={BTN.danger}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-600 max-w-sm leading-relaxed">
            If a walk-in row in the rack is really you, request to claim it so your stats carry over.
          </p>
          <button onClick={onOpenModal} disabled={disabled} className={BTN.primary}>
            Link Player
          </button>
        </div>
      )}
    </div>
  );
}

function MembersList({ members, viewerUserId, isOwner, isPending, onPromoteToggle, onTransfer, onRemove }) {
  if (members.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
        <p className="text-xs text-slate-500">No members yet.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {members.map((m) => {
        const isViewer = m.userId === viewerUserId;
        return (
          <li
            key={m.membershipId}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={m.name} tone={isViewer ? 'sky' : 'slate'} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {m.name}
                  {isViewer && <span className="text-slate-400 font-normal"> (you)</span>}
                </p>
                <span
                  className={`inline-flex mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${ROLE_BADGE[m.role]}`}
                >
                  {m.role}
                </span>
              </div>
            </div>
            {isOwner && m.role !== ROLES.OWNER && (
              <div className="flex items-center gap-1.5 shrink-0 sm:pl-3">
                <button onClick={() => onPromoteToggle(m)} disabled={isPending} className={BTN.promote}>
                  {m.role === ROLES.ORGANIZER ? 'Demote' : 'Make organizer'}
                </button>
                <button onClick={() => onTransfer(m)} disabled={isPending} className={BTN.accent}>
                  Make owner
                </button>
                <button onClick={() => onRemove(m)} disabled={isPending} className={BTN.danger}>
                  Remove
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function WalkInsList({ orphans, canManage, isPending, onLink, onRemove }) {
  if (orphans.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center">
        <p className="text-xs text-slate-500">No walk-in players right now.</p>
        {canManage && (
          <p className="text-[11px] text-slate-400 mt-1">
            Walk-ins appear here when a manager adds an unlinked player to the rack.
          </p>
        )}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {orphans.map((p) => (
        <li
          key={p.id}
          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 py-2.5"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={p.displayName} />
            <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-slate-900 truncate">{p.displayName}</span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 ring-1 ring-slate-200">
                walk-in
              </span>
              {p.hasPendingRequest && (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 ring-1 ring-sky-100"
                  title="A member has requested to claim this walk-in. Review in the Requests pill."
                >
                  claim pending
                </span>
              )}
            </div>
          </div>
          {canManage && (
            <div className="flex items-center gap-1.5 shrink-0 sm:pl-3">
              <button onClick={() => onLink(p)} disabled={isPending} className={BTN.promote}>
                Link Player
              </button>
              <button
                onClick={() => onRemove(p)}
                disabled={isPending}
                className={BTN.danger}
                title="Delete this walk-in permanently"
              >
                Delete
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
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
  // Portal-gate so we only render on the client. `document.body` doesn't
  // exist during SSR, and the sticky SiteHeader (z-50) sits above any
  // inline overlay — mirroring the cancel-fill / prep-roster modals in
  // arena.js, we mount through a portal at z-[100] so the backdrop covers
  // the header and any ancestor overflow/transform/filter can't clip us.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag so the portal only attaches on the client
  useEffect(() => setMounted(true), []);
  // Escape-to-close. Backdrop-click is handled inline below; full focus
  // trap + body scroll lock are out of scope for this iteration (the modal
  // is small and short-lived; no other dialog component in the app uses
  // them either).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !disabled) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, onCancel]);
  if (!mounted) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !disabled) onCancel();
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl ring-1 ring-slate-200 w-full max-w-sm p-6 space-y-4 animate-scale-up">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-400">
            Link player
          </p>
          <h3 className="font-display text-lg font-semibold text-slate-900 mt-0.5 leading-snug">
            {title}
          </h3>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">{description}</p>
        </div>
        {options.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center">
            <p className="text-xs text-slate-500">No options available.</p>
          </div>
        ) : (
          <select
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-sky-300 focus:border-sky-300 transition"
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
        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onCancel} disabled={disabled} className={BTN.neutral}>
            Cancel
          </button>
          <button
            onClick={() => canSubmit && onSubmit(value)}
            disabled={!canSubmit}
            className={BTN.primary}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
