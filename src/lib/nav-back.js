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
