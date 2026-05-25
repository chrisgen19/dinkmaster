'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NAV_BASELINE_KEY } from './nav-tracker';

/**
 * Shared back-navigation pill — the small chevron + uppercase-label affordance
 * that lives at the top of arena pages, profile, auth pages, and so on. One
 * component so the design can't drift across surfaces.
 *
 * Navigation behavior: prefer `router.back()` when going back provably stays
 * inside the app, otherwise navigate to `fallbackHref`. "Stays inside the app"
 * means either:
 *
 *   - The page was reached from a same-origin referrer (a full-page click
 *     within the app), OR
 *   - We've pushed history entries since entering the app this tab — i.e.
 *     `history.length` has grown past the baseline `NavTracker` captured at
 *     entry. This catches SPA navigations (whose `document.referrer` stays
 *     stale at the original entry page).
 *
 * Why not `history.length > 1`? That's true even when the previous entry is an
 * external site (search result, shared link), so `router.back()` would leave
 * the app. Comparing against the entry-time baseline only returns true when the
 * back target is one of *our* pushed entries.
 *
 * @param {object} props
 * @param {string} props.fallbackHref - Where to go when there's no in-app history.
 * @param {string} props.label - Visible button label (kept short; rendered uppercase).
 * @param {string} [props.className] - Optional extra classes appended after the base.
 * @param {boolean} [props.forceFallback] - Always navigate to `fallbackHref`, never
 *   `router.back()`. Use on multi-URL screens that the user perceives as a single
 *   page (e.g. arena Settings, whose sections each push a history entry) so back
 *   leaves the screen instead of stepping through its internal tabs.
 */
export function BackPill({ fallbackHref, label, className = '', forceFallback = false }) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    if (forceFallback || typeof window === 'undefined') return;
    const origin = window.location.origin;
    const sameOriginReferrer =
      typeof document.referrer === 'string' &&
      document.referrer.length > 0 &&
      document.referrer.startsWith(origin);
    // history.length at app entry, recorded by NavTracker. If we've pushed
    // entries since (current > baseline), back() lands on one of our pages.
    const rawBaseline = sessionStorage.getItem(NAV_BASELINE_KEY);
    const baseline = rawBaseline === null ? window.history.length : Number(rawBaseline);
    const grewInApp = window.history.length > baseline;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading document.referrer / window.history / sessionStorage (client-only) on mount; unknowable during SSR
    setCanGoBack(sameOriginReferrer || grewInApp);
  }, [forceFallback]);

  const handleClick = (e) => {
    if (!forceFallback && canGoBack) {
      e.preventDefault();
      router.back();
    }
    // else: let the <Link> navigate to fallbackHref naturally.
  };

  return (
    <Link
      href={fallbackHref}
      onClick={handleClick}
      className={`inline-flex items-center gap-1.5 rounded-full bg-white/80 backdrop-blur
        ring-1 ring-slate-200 hover:ring-emerald-300 hover:text-emerald-700
        text-slate-600 text-[11px] md:text-xs font-bold uppercase tracking-wide
        pl-1.5 pr-3 py-1 transition-colors ${className}`}
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </Link>
  );
}
