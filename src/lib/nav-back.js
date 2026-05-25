/**
 * Decide whether a "back" affordance should call `router.back()` (true) or
 * navigate to its `fallbackHref` (false). Pure so it can be unit-tested without
 * a DOM; `BackPill` feeds it the client-only signals it reads on mount.
 *
 * Rules:
 * - `forceFallback` short-circuits to false (multi-URL screens treated as one
 *   page, e.g. arena Settings).
 * - `grewInApp` (current history length > entry baseline) means we've pushed
 *   our own entries this session, so back() lands on one of our pages.
 * - A same-origin referrer also counts, BUT only when `historyLength > 1` —
 *   opening a page in a fresh tab from within the app yields a same-origin
 *   referrer with `historyLength === 1`, where back() would do nothing useful
 *   or exit the tab. The length guard sends those to the fallback instead.
 *
 * @param {object} signals
 * @param {boolean} [signals.forceFallback]
 * @param {boolean} signals.sameOriginReferrer
 * @param {number} signals.historyLength
 * @param {number} signals.baseline - `history.length` captured at app entry.
 * @returns {boolean}
 */
export function canNavigateBack({ forceFallback = false, sameOriginReferrer, historyLength, baseline }) {
  if (forceFallback) return false;
  const grewInApp = historyLength > baseline;
  return grewInApp || (sameOriginReferrer && historyLength > 1);
}

/**
 * True when `referrer` is a same-origin URL relative to `origin`. Parses with
 * the URL constructor and compares `.origin` exactly, so a lookalike host like
 * `https://example.com.evil.tld` does NOT pass when origin is
 * `https://example.com` (a prefix check would). Returns false for empty,
 * non-string, or malformed referrers.
 *
 * @param {unknown} referrer - Typically `document.referrer`.
 * @param {string} origin - Typically `window.location.origin`.
 * @returns {boolean}
 */
export function isSameOriginReferrer(referrer, origin) {
  if (typeof referrer !== 'string' || referrer.length === 0) return false;
  try {
    return new URL(referrer).origin === origin;
  } catch {
    return false;
  }
}

/**
 * Decide whether `NavTracker` should (re)write the nav baseline on mount.
 *
 * Always true on first run (no stored baseline yet). After that, true only on
 * a fresh `navigate` (typed URL, click from another site, browser-chrome nav)
 * — never on a `reload` (which preserves in-app history) or `back_forward`
 * (still inside the existing session).
 *
 * Without the reset, leaving to an external site and re-entering via a typed
 * URL in the same tab left a stale low baseline, making `history.length` look
 * "grown" and sending `router.back()` to the external page.
 *
 * `undefined` navigationType covers browsers without Navigation Timing L2
 * (none in scope today) — treated as fresh for safety.
 *
 * @param {object} signals
 * @param {string | undefined} signals.navigationType - From
 *   `performance.getEntriesByType('navigation')[0]?.type`.
 * @param {boolean} signals.hasStoredBaseline - True when a baseline already
 *   exists in sessionStorage from an earlier mount in this tab.
 * @returns {boolean}
 */
export function shouldResetNavBaseline({ navigationType, hasStoredBaseline }) {
  if (!hasStoredBaseline) return true;
  return navigationType === 'navigate' || navigationType === undefined;
}
