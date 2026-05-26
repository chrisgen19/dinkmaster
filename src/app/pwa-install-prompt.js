'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';

const noop = () => () => {};

/**
 * `true` once the app is running as an installed PWA. Read via
 * useSyncExternalStore so the value is SSR-safe (server snapshot = false) and
 * stays in sync if the display mode changes.
 */
function useIsStandalone() {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia('(display-mode: standalone)');
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(display-mode: standalone)').matches,
    () => false,
  );
}

/** `true` on iOS/iPadOS Safari, which has no beforeinstallprompt event. */
function useIsIOS() {
  return useSyncExternalStore(
    noop,
    () => {
      const nav = window.navigator;
      const iPhone =
        /ipad|iphone|ipod/.test(nav.userAgent.toLowerCase()) &&
        !window.MSStream;
      // iPadOS Safari reports a desktop "Macintosh" UA, so detect it via the
      // touch-capable Mac platform (real Macs have no touchscreen).
      const iPadOS = nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
      return iPhone || iPadOS;
    },
    () => false,
  );
}

/**
 * Custom install affordance.
 *
 * - Chromium/Android fires `beforeinstallprompt`; we capture it and trigger the
 *   native prompt from our own button.
 * - iOS Safari has no such event, so we show the manual "Add to Home Screen"
 *   instructions instead.
 *
 * Renders nothing when the app is already installed (standalone display mode)
 * or when there's no way to install on the current browser.
 */
export function PwaInstallPrompt() {
  const isStandalone = useIsStandalone();
  const isIOS = useIsIOS();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    function onBeforeInstallPrompt(event) {
      // Stop Chrome's mini-infobar so we can present our own button.
      event.preventDefault();
      setDeferredPrompt(event);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () =>
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    // The event can only be used once.
    setDeferredPrompt(null);
  }

  // Already installed, dismissed, or nothing to offer.
  if (isStandalone || dismissed) return null;
  if (!deferredPrompt && !isIOS) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-lg animate-fade-in"
    >
      <div className="flex items-start gap-3">
        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl ring-1 ring-inset ring-slate-200/80">
          <Image
            src="/icons/icon-192.png"
            alt="DinkMaster logo"
            fill
            sizes="40px"
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">
            Install DinkMaster
          </p>
          {isIOS ? (
            <p className="mt-0.5 text-xs text-slate-500">
              Tap the Share button{' '}
              <span aria-label="share" role="img">
                ⎋
              </span>{' '}
              then &ldquo;Add to Home Screen&rdquo;{' '}
              <span aria-label="add" role="img">
                ➕
              </span>
              .
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-500">
              Add it to your home screen for a faster, full-screen experience.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss install prompt"
          className="-mr-1 -mt-1 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          ✕
        </button>
      </div>
      {!isIOS && (
        <button
          type="button"
          onClick={handleInstall}
          className="mt-3 w-full rounded-xl bg-emerald-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
        >
          Install app
        </button>
      )}
    </div>
  );
}
