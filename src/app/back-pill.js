'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Shared back-navigation pill — the small chevron + uppercase-label affordance
 * that lives at the top of arena pages, profile, auth pages, and so on. One
 * component so the design can't drift across surfaces.
 *
 * Navigation behavior: prefer `router.back()` when there is real in-app
 * history, otherwise navigate to `fallbackHref`. "Real in-app history" means
 * either:
 *
 *   - The page was reached from a same-origin referrer (a click within the
 *     app), OR
 *   - The user has done at least one client-side navigation in this tab since
 *     entering the app (so `history.length > 1`).
 *
 * Why both conditions? A direct entry (deep link, bookmark, search result)
 * gives an empty/external referrer AND `history.length === 1`, so we fall
 * through to `fallbackHref`. A SPA-internal navigation keeps the original
 * referrer but increments history; that's still "in-app" and worth using
 * `back()` for. Same-origin referrer alone covers the standard "clicked a
 * link inside the app" case where history may not yet be > 1.
 *
 * @param {object} props
 * @param {string} props.fallbackHref - Where to go when there's no in-app history.
 * @param {string} props.label - Visible button label (kept short; rendered uppercase).
 * @param {string} [props.className] - Optional extra classes appended after the base.
 */
export function BackPill({ fallbackHref, label, className = '' }) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const origin = window.location.origin;
    const sameOriginReferrer =
      typeof document.referrer === 'string' &&
      document.referrer.length > 0 &&
      document.referrer.startsWith(origin);
    const hasClientHistory = window.history.length > 1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading document.referrer / window.history (client-only) on mount; unknowable during SSR
    setCanGoBack(sameOriginReferrer || hasClientHistory);
  }, []);

  const handleClick = (e) => {
    if (canGoBack) {
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
