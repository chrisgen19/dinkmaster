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
