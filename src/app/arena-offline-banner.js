'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Banners for the arena's offline session mode. Presentational only: all
 * state and handlers live in the `useArenaOffline` hook (arena-offline.js).
 */

// Floating wrapper: pins the banner to the bottom of the viewport so the
// offline status stays visible no matter how far the manager has scrolled.
// Sits above page content (z-40) but below modals (z-100) and the transient
// toast (z-50); lifted clear of the mobile bottom-nav pill (which floats at
// `bottom-4`), and drops to a normal bottom margin on desktop where there is
// no bottom nav. The safe-area inset keeps it above the iOS home indicator.
const floatBase =
  'fixed left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-2xl ' +
  'bottom-[calc(6rem+env(safe-area-inset-bottom))] md:bottom-6';

/**
 * One-tap offer shown when a server action fails but the browser still
 * reports itself online (an ambiguous case: could be a server error, not a
 * dropped connection). A genuine offline signal switches automatically
 * without this prompt.
 */
export function OfflinePromptBanner({ onEnter, onDismiss, blocked }) {
  return (
    <div className={floatBase}>
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-amber-900 shadow-xl shadow-amber-900/15 backdrop-blur-md animate-fade-in"
      >
        <p className="min-w-0 text-sm font-semibold leading-snug">
          {blocked
            ? 'Connection lost. Offline mode is already running in another tab of this arena.'
            : 'Connection lost. Keep running the board offline? Changes save on this device until you reconnect.'}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {!blocked && (
            <button
              type="button"
              onClick={onEnter}
              className="rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-700"
            >
              Run offline
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-3 py-2 text-sm font-bold text-amber-800/80 transition-colors hover:bg-amber-100 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Persistent banner while an offline session is running: pending change
 * count, the sync affordance, and exit (confirm + discard handled by the
 * caller). `syncError` is the transient "couldn't reach the server" note
 * after a failed attempt; syncing disables both buttons.
 */
export function OfflineActiveBanner({ pendingCount, syncing, syncError, onSync, onExit }) {
  return (
    <div className={floatBase}>
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-100/95 px-4 py-3 text-amber-950 shadow-xl shadow-amber-900/15 backdrop-blur-md animate-fade-in"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug">
            <span className="mr-2 inline-flex items-center gap-1.5 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-600" />
              Offline
            </span>
            Running the board locally
            {' · '}
            {pendingCount === 0
              ? 'no changes yet'
              : `${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} saved on this device`}
          </p>
          {syncError && (
            <p className="mt-1 text-xs font-medium text-amber-800">{syncError}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onSync}
            disabled={syncing}
            className="rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            type="button"
            onClick={onExit}
            disabled={syncing}
            className="rounded-lg border border-amber-400 px-3.5 py-2 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-200 disabled:opacity-60"
          >
            Exit offline
          </button>
        </div>
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
  return (
    <div className={floatBase}>
      <div
        role="status"
        className="flex items-center gap-2.5 rounded-2xl border border-sky-200 bg-sky-50/95 px-4 py-3 text-sky-900 shadow-xl shadow-sky-900/15 backdrop-blur-md animate-fade-in"
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-sky-500" />
        <p className="min-w-0 text-sm font-semibold leading-snug">
          {label} is running this board offline. The live view may be behind until their
          device reconnects and syncs.
        </p>
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
