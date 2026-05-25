'use client';

import { useEffect, useState } from 'react';
import { useSerwist } from '@serwist/turbopack/react';

/**
 * Service worker update notification with a manual reload.
 *
 * Because the worker uses `skipWaiting: false`, a freshly deployed worker sits
 * in "waiting" instead of taking over silently. We surface that as a banner and
 * let the user choose when to reload: clicking tells the waiting worker to
 * activate (messageSkipWaiting), and once it starts controlling the page we
 * reload so the new assets are served.
 */
export function SwUpdatePrompt() {
  const { serwist } = useSerwist();
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!serwist) return;

    const onWaiting = () => setUpdateReady(true);
    const onControlling = () => window.location.reload();

    serwist.addEventListener('waiting', onWaiting);
    serwist.addEventListener('controlling', onControlling);

    return () => {
      serwist.removeEventListener('waiting', onWaiting);
      serwist.removeEventListener('controlling', onControlling);
    };
  }, [serwist]);

  if (!updateReady) return null;

  function handleReload() {
    // Activate the waiting worker; the `controlling` listener reloads the page.
    serwist?.messageSkipWaiting();
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-sm items-center gap-3 rounded-2xl border border-slate-200 bg-slate-900 p-3.5 pl-4 text-white shadow-lg animate-fade-in">
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
