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
// Assume online during SSR/prerender so nothing flashes on first paint.
const getServerSnapshot = () => true;

/**
 * Reactive `navigator.onLine`, hydration-safe via useSyncExternalStore.
 *
 * `false` is a reliable "definitely offline" signal; `true` is only a hint
 * (the device may still not reach the server). Consumers that need certainty
 * about reachability should rely on an actual request outcome, not this.
 */
export function useOnline() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
