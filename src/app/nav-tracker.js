'use client';

import { useEffect } from 'react';

/** sessionStorage key holding `history.length` at the moment we entered the app. */
export const NAV_BASELINE_KEY = 'app:navBaseline';

/**
 * Records `window.history.length` once per tab session, the first time the app
 * mounts. `BackPill` compares the current length against this baseline to tell
 * whether `router.back()` would stay inside the app (length grew since entry)
 * versus leave it (we're still at the entry point, so the previous entry is an
 * external site or there is none).
 *
 * Mounted in the root layout, which React does not remount across client
 * navigations — so the effect runs exactly once, capturing the true entry
 * point before any in-app navigation has pushed new entries.
 *
 * Renders nothing.
 */
export function NavTracker() {
  useEffect(() => {
    if (sessionStorage.getItem(NAV_BASELINE_KEY) === null) {
      sessionStorage.setItem(NAV_BASELINE_KEY, String(window.history.length));
    }
  }, []);
  return null;
}
