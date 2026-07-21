'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useOnline } from './use-online';

/**
 * Banners for the arena's offline session mode. Presentational only: session
 * state and handlers come from the `useArenaOffline` hook (arena-offline.js);
 * connectivity is read locally via `useOnline` since it is purely a display
 * concern (which state to show, whether a manual sync is even possible).
 *
 * Design: compact floating pills, not full-width cards. The happy path needs
 * NO buttons: entry is automatic, and sync fires on reconnect. Manual
 * controls appear only when they can do something the automatic path can't
 * (retry a failed/missed sync; discard the session). The device's raw
 * offline state lives in the header pill (OfflineIndicator); these banners
 * carry the local-SESSION status.
 */

// Floating wrapper: a bottom-centered pill that hugs its content and stays
// visible however far the manager has scrolled. Above page content (z-40),
// below modals (z-100) and the toast (z-50); lifted clear of the mobile
// bottom-nav pill (`bottom-4`) and the iOS home indicator (safe-area inset),
// dropping to a normal margin on desktop where there is no bottom nav.
const floatBase =
  'fixed left-1/2 -translate-x-1/2 z-40 w-auto max-w-[calc(100%-1.5rem)] ' +
  'bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6';

// Per-tone class sets (Tailwind can't build class names dynamically, so each
// combination is spelled out): amber = local/pending, sky = syncing, red =
// sync failed.
const TONES = {
  amber: {
    pill: 'border-amber-300/80 bg-amber-100/95 text-amber-950',
    dot: 'bg-amber-500',
    primary: 'bg-amber-600 text-white hover:bg-amber-700',
    ghost: 'text-amber-900/70 hover:bg-amber-200/70 hover:text-amber-950',
  },
  sky: {
    pill: 'border-sky-300/80 bg-sky-100/95 text-sky-950',
    dot: 'bg-sky-500',
    primary: 'bg-sky-600 text-white hover:bg-sky-700',
    ghost: 'text-sky-900/70 hover:bg-sky-200/70 hover:text-sky-950',
  },
  red: {
    pill: 'border-red-300/80 bg-red-100/95 text-red-950',
    dot: 'bg-red-500',
    primary: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-red-900/70 hover:bg-red-200/70 hover:text-red-950',
  },
};

const pillBase =
  'flex items-center gap-2.5 rounded-2xl border px-4 py-2 shadow-lg backdrop-blur-md animate-fade-in';

/**
 * One-tap offer shown when a server action fails but the browser still
 * reports itself online (an ambiguous case: could be a server error, not a
 * dropped connection). A genuine offline signal switches automatically
 * without this prompt.
 */
export function OfflinePromptBanner({ onEnter, onDismiss, blocked }) {
  const t = TONES.amber;
  return (
    <div className={floatBase}>
      <div role="alert" className={`${pillBase} ${t.pill}`}>
        <span className="text-[13px] font-semibold">
          {blocked ? 'Offline in another tab' : "That change didn't save. Work offline?"}
        </span>
        {!blocked && (
          <button
            type="button"
            onClick={onEnter}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${t.primary}`}
          >
            Run offline
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold transition-colors ${t.ghost}`}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * Status pill while an offline session is running. Connectivity-aware:
 *  - offline: pure status ("Running locally · N saved"), no sync button (the
 *    server is unreachable);
 *  - online, pending: same status plus a "Sync now" fallback (auto-sync fires
 *    on reconnect, so this only shows if that hasn't happened yet);
 *  - syncing: "Syncing…", no controls;
 *  - sync failed: "Sync failed" plus "Retry".
 * Discard is always present but visually demoted: it's the escape hatch to
 * abandon the session, not a routine control.
 */
export function OfflineActiveBanner({ pendingCount, syncing, syncError, onSync, onDiscard }) {
  const online = useOnline();
  // Kept short so the pill stays one line on a phone: "· N saved" only when
  // there's something saved.
  const saved = pendingCount === 0 ? '' : ` · ${pendingCount} saved`;

  let tone;
  let text;
  let showSync = false;
  if (syncing) {
    tone = 'sky';
    text = 'Syncing…';
  } else if (syncError) {
    tone = 'red';
    text = `Sync failed${saved}`;
    showSync = online;
  } else {
    tone = 'amber';
    text = `Running locally${saved}`;
    showSync = online;
  }
  const t = TONES[tone];

  return (
    <div className={floatBase}>
      <div role="status" className={`${pillBase} ${t.pill}`}>
        <span className="flex items-center gap-2 whitespace-nowrap text-[13px] font-semibold">
          {syncing ? (
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-sky-600 border-t-transparent"
            />
          ) : (
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${t.dot} ${online ? '' : 'animate-pulse'}`}
            />
          )}
          {text}
        </span>
        {showSync && (
          <button
            type="button"
            onClick={onSync}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold transition-colors ${t.primary}`}
          >
            {syncError ? 'Retry' : 'Sync now'}
          </button>
        )}
        <button
          type="button"
          onClick={onDiscard}
          disabled={syncing}
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-40 ${t.ghost}`}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

/**
 * Soft advisory shown to OTHER viewers while a manager runs the board
 * offline: live updates will lag until that device syncs. Informational
 * only; nothing is disabled (the sync fingerprint check protects
 * correctness if someone mutates anyway).
 */
export function OfflineHoldNotice({ label }) {
  const t = TONES.sky;
  return (
    <div className={floatBase}>
      <div role="status" className={`${pillBase} ${t.pill}`}>
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`} />
        <span className="text-[13px] font-semibold">
          {label} is running this board offline
        </span>
      </div>
    </div>
  );
}

/** Shared modal chrome for the two sync-outcome dialogs below. */
function SyncDialogShell({ title, children }) {
  // iOS-safe scroll lock + portal to <body>, matching the app's other modals
  // (skip-picker-modal.js, court-edit-modal.js). A plain `overflow: hidden`
  // doesn't stop rubber-band scrolling in standalone PWA mode, and rendering
  // inline lets an ancestor's overflow/transform/filter clip the overlay: pin
  // <body> with `position: fixed` offset by the current scrollY, restore on
  // unmount, and portal out of the arena tree.
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

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-2xl animate-scale-up p-6 space-y-4"
      >
        <h3 className="font-display text-base font-extrabold text-slate-900">{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const dialogButton =
  'w-full rounded-xl px-4 py-2.5 text-sm font-bold transition-colors';

/**
 * Divergence decision: the board changed while this device was away (or an
 * event no longer applied in strict mode). The pending log is untouched
 * until the manager picks a path.
 */
export function OfflineDivergenceDialog({ pendingCount, syncing, onBestEffort, onDiscard, onKeepOffline }) {
  return (
    <SyncDialogShell title="The arena changed while you were offline">
      <p className="text-sm text-slate-600">
        Your {pendingCount} offline {pendingCount === 1 ? 'change' : 'changes'} no longer
        match the live board exactly, so nothing was applied yet. Apply what still
        fits (recorded match scores almost always survive), or discard the offline
        session.
      </p>
      <div className="space-y-2">
        <button
          type="button"
          onClick={onBestEffort}
          disabled={syncing}
          className={`${dialogButton} bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60`}
        >
          {syncing ? 'Applying…' : 'Apply what still fits'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={syncing}
          className={`${dialogButton} border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60`}
        >
          Discard my offline changes
        </button>
        <button
          type="button"
          onClick={onKeepOffline}
          disabled={syncing}
          className={`${dialogButton} text-slate-600 hover:bg-slate-100 disabled:opacity-60`}
        >
          Decide later (stay offline)
        </button>
      </div>
    </SyncDialogShell>
  );
}

/**
 * Sync refused outright (e.g. manager access was revoked while offline).
 * The log is never silently dropped: the manager can copy it as JSON for
 * hand-off before discarding.
 */
export function OfflineBlockedDialog({ error, copied, onCopy, onDiscard, onClose }) {
  return (
    <SyncDialogShell title="These changes can't sync">
      <p className="text-sm text-slate-600">{error}</p>
      <div className="space-y-2">
        <button
          type="button"
          onClick={onCopy}
          className={`${dialogButton} border border-slate-300 text-slate-800 hover:bg-slate-100`}
        >
          {copied ? 'Copied!' : 'Copy changes as JSON'}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className={`${dialogButton} border border-red-200 text-red-700 hover:bg-red-50`}
        >
          Discard my offline changes
        </button>
        <button
          type="button"
          onClick={onClose}
          className={`${dialogButton} text-slate-600 hover:bg-slate-100`}
        >
          Close
        </button>
      </div>
    </SyncDialogShell>
  );
}
