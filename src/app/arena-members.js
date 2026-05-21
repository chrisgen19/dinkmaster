'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateMemberRole, removeMember, transferOwnership, leaveArena } from './actions';
import { ROLES } from '@/lib/roles';

const ROLE_BADGE = {
  OWNER: 'bg-emerald-50 text-emerald-700',
  ORGANIZER: 'bg-sky-50 text-sky-700',
  MEMBER: 'bg-slate-100 text-slate-600',
};

/** Members tab: roster with roles, plus owner controls and a leave action. */
export function ArenaMembers({ arenaId, members, viewerUserId, viewerRole }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

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
    </div>
  );
}
