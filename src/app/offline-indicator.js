'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (callback) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};
const getSnapshot = () => navigator.onLine;
// Assume online during SSR/prerender so the badge never flashes on first paint.
const getServerSnapshot = () => true;

/**
 * Small amber "Offline" pill for the site header. Renders nothing while
 * online. `navigator.onLine === false` is a reliable "definitely offline"
 * signal (the reverse is only a hint, which is fine for an indicator);
 * rendering via useSyncExternalStore keeps it hydration-safe.
 */
export function OfflineIndicator() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (online) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1
        text-[11px] font-bold uppercase tracking-wide text-amber-900 ring-1 ring-inset ring-amber-200"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Offline
    </span>
  );
}
