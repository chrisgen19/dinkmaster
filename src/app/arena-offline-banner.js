'use client';

/**
 * Banners for the arena's offline session mode. Presentational only: all
 * state and handlers live in the `useArenaOffline` hook (arena-offline.js).
 */

const barBase =
  'mt-2 w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8';

/**
 * One-tap offer shown when the connection drops (or a server action fails)
 * for a manager who is not yet running offline. Never auto-enters.
 */
export function OfflinePromptBanner({ onEnter, onDismiss, blocked }) {
  return (
    <div className={barBase}>
      <div
        role="alert"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-amber-900 shadow-lg shadow-amber-900/10 animate-fade-in"
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
 * count plus the exit affordance (confirm + discard handled by the caller).
 */
export function OfflineActiveBanner({ pendingCount, onExit }) {
  return (
    <div className={barBase}>
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-100/95 px-4 py-3 text-amber-950 shadow-lg shadow-amber-900/10"
      >
        <p className="min-w-0 text-sm font-semibold leading-snug">
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
        <button
          type="button"
          onClick={onExit}
          className="shrink-0 rounded-lg border border-amber-400 px-3.5 py-2 text-sm font-bold text-amber-900 transition-colors hover:bg-amber-200"
        >
          Exit offline
        </button>
      </div>
    </div>
  );
}
