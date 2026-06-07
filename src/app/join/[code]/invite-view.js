'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { redeemArenaInvite } from '../../actions';
import { INVITE_MODES } from '@/lib/invites';
import { AuthShell, AuthError, BackPill } from '../../auth-shell';

/**
 * Client view for `/join/<code>`. Renders one of three states inside the shared
 * AuthShell frame:
 *  - invalid: the code is unknown or revoked.
 *  - signed-out: a sign-up / log-in invitation that carries `next=/join/<code>`
 *    so the viewer returns here to redeem after authenticating.
 *  - signed-in: a one-tap redeem that calls {@link redeemArenaInvite}.
 *
 * @param {object} props
 * @param {string} props.code
 * @param {{arenaId:string,arenaName:string,mode:string}|null} props.invite
 * @param {boolean} props.isAuthenticated
 */
export function InviteView({ code, invite, isAuthenticated }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  // Set once an APPROVAL redeem files a pending request, so we swap the card to
  // a confirmation rather than navigating away.
  const [pendingArenaId, setPendingArenaId] = useState(null);

  // --- Invalid / revoked invite ---
  if (!invite) {
    return (
      <AuthShell
        title="Invite no longer valid"
        subtitle="This invite link has expired or been revoked. Ask the arena's organizer for a fresh one."
        footer={
          <div className="flex justify-center">
            <BackPill fallbackHref="/arenas" label="Browse arenas" />
          </div>
        }
      >
        <Link
          href="/arenas"
          className="block w-full rounded-xl bg-emerald-700 px-5 py-2.5 text-center font-display
            font-extrabold text-white shadow-lg shadow-emerald-700/25 transition hover:bg-emerald-800"
        >
          Browse arenas
        </Link>
      </AuthShell>
    );
  }

  const { arenaId, arenaName, mode } = invite;
  const isAutoJoin = mode === INVITE_MODES.AUTO_JOIN;
  const next = `/join/${code}`;
  const encodedNext = encodeURIComponent(next);

  // --- Pending-approval confirmation (after an APPROVAL redeem) ---
  if (pendingArenaId) {
    return (
      <AuthShell
        title="Request sent"
        subtitle={`Your request to join ${arenaName} is awaiting approval from an organizer.`}
        footer={
          <div className="flex justify-center">
            <BackPill fallbackHref="/arenas" label="Browse arenas" />
          </div>
        }
      >
        <Link
          href={`/arena/${pendingArenaId}`}
          className="block w-full rounded-xl bg-emerald-700 px-5 py-2.5 text-center font-display
            font-extrabold text-white shadow-lg shadow-emerald-700/25 transition hover:bg-emerald-800"
        >
          View {arenaName}
        </Link>
      </AuthShell>
    );
  }

  // --- Signed-out: invite to register / log in ---
  if (!isAuthenticated) {
    return (
      <AuthShell
        title={`You're invited to ${arenaName}`}
        subtitle={
          isAutoJoin
            ? 'Create an account to join the arena instantly.'
            : "Create an account to ask the organizers to join."
        }
        footer={
          <div className="flex justify-center">
            <BackPill fallbackHref="/arenas" label="Browse arenas" />
          </div>
        }
      >
        <div className="space-y-3">
          <Link
            href={`/register?next=${encodedNext}`}
            className="block w-full rounded-xl bg-emerald-700 px-5 py-2.5 text-center font-display
              font-extrabold text-white shadow-lg shadow-emerald-700/25 transition hover:bg-emerald-800"
          >
            Create account to join
          </Link>
          <Link
            href={`/login?next=${encodedNext}`}
            className="block w-full rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-center
              text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            I already have an account
          </Link>
        </div>
      </AuthShell>
    );
  }

  // --- Signed-in: one-tap redeem ---
  const handleRedeem = () => {
    setError('');
    startTransition(async () => {
      try {
        const result = await redeemArenaInvite(code);
        if (result?.error) {
          setError(result.error);
          return;
        }
        if (result.status === 'PENDING') {
          setPendingArenaId(result.arenaId);
          return;
        }
        // JOINED or ALREADY_MEMBER — straight into the arena.
        router.push(`/arena/${result.arenaId}`);
      } catch (err) {
        // Network / serialization failure — surface inline so the user can retry
        // instead of hitting an error boundary.
        setError(err?.message || 'Something went wrong. Please try again.');
      }
    });
  };

  return (
    <AuthShell
      title={isAutoJoin ? `Join ${arenaName}` : `Request to join ${arenaName}`}
      subtitle={
        isAutoJoin
          ? "You'll be added to the arena and dropped onto the rack."
          : "We'll send your request to the arena's organizers to approve."
      }
      footer={
        <div className="flex justify-center">
          <BackPill fallbackHref="/arenas" label="Browse arenas" />
        </div>
      }
    >
      <div className="space-y-3">
        {error && <AuthError>{error}</AuthError>}
        <button
          type="button"
          onClick={handleRedeem}
          disabled={isPending}
          className="w-full rounded-xl bg-emerald-700 px-5 py-2.5 font-display font-extrabold
            text-white shadow-lg shadow-emerald-700/25 transition duration-150
            hover:bg-emerald-800 hover:shadow-emerald-700/40
            disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {isPending
            ? isAutoJoin
              ? 'Joining…'
              : 'Sending…'
            : isAutoJoin
              ? 'Join arena'
              : 'Request to join'}
        </button>
      </div>
    </AuthShell>
  );
}
