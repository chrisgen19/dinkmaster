'use client';

import { useOnline } from './use-online';

/**
 * Small amber "Offline" pill for the site header. Renders nothing while
 * online. Shows the device's connectivity; the arena banner separately shows
 * the local-session status (see arena-offline-banner.js).
 */
export function OfflineIndicator() {
  const online = useOnline();
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
