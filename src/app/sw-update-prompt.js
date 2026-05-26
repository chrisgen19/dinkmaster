'use client';

import { useEffect, useRef, useState } from 'react';
import { useSerwist } from '@serwist/turbopack/react';

/**
 * Service worker update notification with a manual reload.
 *
 * Because the worker uses `skipWaiting: false`, a freshly deployed worker sits
 * in "waiting" instead of taking over silently. We surface that as a banner and
 * let the user choose when to reload: clicking tells the waiting worker to
 * activate (messageSkipWaiting), and once it starts controlling the page we
 * reload so the new assets are served.
 *
 * The reload is gated on a user-initiated update (reloadingRef). The worker uses
 * `clientsClaim: true`, so the `controlling` event also fires on a visitor's
 * first load when the brand-new worker claims the page — reloading there would
 * be a spurious refresh, so we only reload when the user actually accepted an
 * update.
 */
export function SwUpdatePrompt() {
  const { serwist } = useSerwist();
  const [updateReady, setUpdateReady] = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!serwist) return;

    const onWaiting = () => setUpdateReady(true);
    const onControlling = () => {
      if (reloadingRef.current) window.location.reload();
    };

    serwist.addEventListener('waiting', onWaiting);
    serwist.addEventListener('controlling', onControlling);

    // A worker may already be waiting at page load (installed during an earlier
    // visit), in which case the 'waiting' event can fire before this listener
    // attaches. Check the current registration so the banner still shows.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => {
          if (registration?.waiting) setUpdateReady(true);
        })
        .catch(() => {});
    }

    return () => {
      serwist.removeEventListener('waiting', onWaiting);
      serwist.removeEventListener('controlling', onControlling);
    };
  }, [serwist]);

  if (!updateReady) return null;

  function handleReload() {
    // Mark this as a user-initiated update, then activate the waiting worker;
    // the `controlling` listener reloads the page once it takes over.
    reloadingRef.current = true;
    serwist?.messageSkipWaiting();
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-900 p-3.5 pl-4 text-white shadow-lg animate-fade-in"
    >
      <p className="min-w-0 flex-1 text-sm font-medium">
        A new version is available.
      </p>
      <button
        type="button"
        onClick={handleReload}
        className="shrink-0 rounded-xl bg-emerald-500 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-400"
      >
        Reload
      </button>
    </div>
  );
}
