/**
 * Service-worker runtime-caching predicates, extracted as pure functions so the
 * routing intent can be unit-tested without instantiating the worker.
 *
 * Each receives the object Serwist passes to a `matcher`:
 *   { url: URL, request: Request, sameOrigin: boolean }
 *
 * Order matters in `src/app/sw.js`: the API rule must be evaluated before the
 * image rule, otherwise an `<img src="/api/...">` (destination "image") would be
 * cached instead of going network-only.
 */

/** Any /api/* request (auth/session and everything else) — never cached. */
export function isApiRequest({ url }) {
  return url.pathname.startsWith("/api/");
}

/** Hashed, immutable build assets under /_next/static. */
export function isStaticAsset({ url }) {
  return url.pathname.startsWith("/_next/static/");
}

/** Same-origin image requests only — avoids caching cross-origin or API images. */
export function isImageRequest({ request, sameOrigin }) {
  return sameOrigin && request.destination === "image";
}

/** Font requests. */
export function isFontRequest({ request }) {
  return request.destination === "font";
}

/** Static, non-personalized page navigations safe to cache (/login, /register). */
export function isPublicNavigation({ request, url }) {
  return (
    request.mode === "navigate" &&
    (url.pathname === "/login" || url.pathname === "/register")
  );
}

/** Any page navigation (used as the catch-all network-only rule). */
export function isNavigation({ request }) {
  return request.mode === "navigate";
}

/**
 * Whether a pathname is an arena BOARD page (`/arena/<id>`, optionally with a
 * trailing slash). Deliberately excludes deeper arena routes like
 * `/arena/<id>/settings/...`: only the board has an offline shell
 * (/offline-board renders the IndexedDB snapshot); everything else falls back
 * to the generic offline page. Takes a plain pathname (not the matcher param
 * object) because the service worker's fallback matcher only receives the
 * failed Request and must parse the URL itself.
 */
export function isArenaPathname(pathname) {
  return /^\/arena\/[^/]+\/?$/.test(pathname);
}

/**
 * The arena directory (`/arenas`), which is the PWA's `start_url`. When the
 * app is launched offline it lands here, so this route is served the offline
 * board shell too. The shell renders a list of arenas saved in IndexedDB
 * when it can't parse an arena id from the URL, giving the manager a way to
 * pick a saved arena instead of the dead-end generic offline page.
 */
export function isArenaDirectoryPath(pathname) {
  return pathname === '/arenas' || pathname === '/arenas/';
}
