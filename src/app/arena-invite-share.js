'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'react-qr-code';
import { createArenaInvite, revokeArenaInvite } from './actions';
import { INVITE_MODES, inviteModeLabel } from '@/lib/invites';

// Render an Auto-join card first (the higher-trust link), then Approval.
const MODES = [INVITE_MODES.AUTO_JOIN, INVITE_MODES.APPROVAL];

const MODE_BLURB = {
  [INVITE_MODES.AUTO_JOIN]: 'Anyone who opens this link joins instantly — no approval.',
  [INVITE_MODES.APPROVAL]: 'Opening this link sends a join request for you to approve.',
};

/**
 * Manager-only Share control in the arena hero. Mints, shares, and revokes the
 * arena's invite links (one Auto-join + one Approval). Each link renders a QR
 * code (react-qr-code) plus copy / native-share affordances, so a manager can
 * hand the arena to a new player or walk-in on the spot.
 *
 * Absolute URLs are built from `window.location.origin` after mount, so the
 * component never needs the request host on the server.
 *
 * @param {object} props
 * @param {string} props.arenaId
 * @param {string} props.arenaName
 * @param {Array<{id:string,code:string,mode:string,createdAt:string}>} [props.initialInvites]
 */
export function ArenaInviteShare({ arenaId, arenaName, initialInvites = [] }) {
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState(initialInvites);
  // Lazily read at mount (never rendered until the modal opens, so SSR's empty
  // string can't cause a hydration mismatch). Avoids a setState-in-effect.
  const [origin] = useState(() => (typeof window !== 'undefined' ? window.location.origin : ''));
  const [canNativeShare] = useState(
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  // Resync when the server hands down fresh invites after a router.refresh().
  const [lastSeed, setLastSeed] = useState(initialInvites);
  if (initialInvites !== lastSeed) {
    setLastSeed(initialInvites);
    setInvites(initialInvites);
  }

  const inviteFor = (mode) => invites.find((i) => i.mode === mode) ?? null;
  const urlFor = (code) => (origin ? `${origin}/join/${code}` : '');

  const handleCreate = (mode) =>
    startTransition(async () => {
      setError('');
      const result = await createArenaInvite(arenaId, mode);
      if (result?.error) return setError(result.error);
      setInvites((prev) => [result.invite, ...prev.filter((i) => i.id !== result.invite.id)]);
    });

  const handleRevoke = (id) =>
    startTransition(async () => {
      setError('');
      const result = await revokeArenaInvite(arenaId, id);
      if (result?.error) return setError(result.error);
      setInvites((prev) => prev.filter((i) => i.id !== id));
    });

  // Rotate a link: revoke the old code, mint a fresh one of the same mode.
  const handleRegenerate = (mode, id) =>
    startTransition(async () => {
      setError('');
      const revoked = await revokeArenaInvite(arenaId, id);
      if (revoked?.error) return setError(revoked.error);
      const created = await createArenaInvite(arenaId, mode);
      if (created?.error) return setError(created.error);
      setInvites((prev) => [
        created.invite,
        ...prev.filter((i) => i.id !== id && i.id !== created.invite.id),
      ]);
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700
          text-white text-xs md:text-sm font-extrabold px-3 py-2 md:px-3.5 md:py-2 shadow-sm transition"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
        </svg>
        Share / Invite
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="arena-invite-title"
            className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 shadow-2xl animate-scale-up max-h-[85vh] overflow-y-auto"
          >
            <div className="mb-4">
              <h3 id="arena-invite-title" className="text-base font-extrabold text-slate-900">
                Invite people to {arenaName}
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Share a link or QR code. Auto-join adds people instantly; approval
                links route them to you first.
              </p>
            </div>

            {error && <p className="text-xs font-semibold text-red-600 mb-3">{error}</p>}

            <div className="space-y-4">
              {MODES.map((mode) => (
                <InviteCard
                  key={mode}
                  mode={mode}
                  invite={inviteFor(mode)}
                  url={urlFor(inviteFor(mode)?.code)}
                  arenaName={arenaName}
                  canNativeShare={canNativeShare}
                  isPending={isPending}
                  onCreate={() => handleCreate(mode)}
                  onRevoke={(id) => handleRevoke(id)}
                  onRegenerate={(id) => handleRegenerate(mode, id)}
                />
              ))}
            </div>

            <div className="flex justify-end mt-6">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

/** One mode's section: either a "create" prompt or the live link + QR + actions. */
function InviteCard({ mode, invite, url, arenaName, canNativeShare, isPending, onCreate, onRevoke, onRegenerate }) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context / denied) — leave the URL visible to copy by hand.
    }
  };

  const handleShare = async () => {
    try {
      await navigator.share({ title: arenaName, text: `Join ${arenaName} on DinkMaster`, url });
    } catch {
      // User dismissed the share sheet, or it failed — nothing to surface.
    }
  };

  const accent =
    mode === INVITE_MODES.AUTO_JOIN
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : 'bg-sky-50 text-sky-700 ring-sky-200';

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center text-[11px] font-extrabold uppercase tracking-wide rounded-full px-2.5 py-1 ring-1 ${accent}`}>
          {inviteModeLabel(mode)}
        </span>
        {invite && (
          <button
            type="button"
            onClick={() => onRevoke(invite.id)}
            disabled={isPending}
            className="text-[11px] font-bold text-red-600 hover:text-red-700 disabled:opacity-50"
          >
            Revoke
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-1.5">{MODE_BLURB[mode]}</p>

      {!invite ? (
        <button
          type="button"
          onClick={onCreate}
          disabled={isPending}
          className="mt-3 w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-4 py-2.5 transition disabled:opacity-50"
        >
          Create {inviteModeLabel(mode).toLowerCase()} link
        </button>
      ) : (
        <div className="mt-3 space-y-3">
          {url && (
            <div className="flex justify-center rounded-xl bg-white p-3 ring-1 ring-slate-100">
              <QRCode value={url} size={148} />
            </div>
          )}
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-3 py-2">
            <span className="truncate text-xs text-slate-600">{url || `…/join/${invite.code}`}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!url}
              className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2 transition disabled:opacity-50"
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            {canNativeShare && (
              <button
                type="button"
                onClick={handleShare}
                disabled={!url}
                className="flex-1 rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold px-3 py-2 transition disabled:opacity-50"
              >
                Share…
              </button>
            )}
            <button
              type="button"
              onClick={() => onRegenerate(invite.id)}
              disabled={isPending}
              className="rounded-lg bg-white ring-1 ring-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold px-3 py-2 transition disabled:opacity-50"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
