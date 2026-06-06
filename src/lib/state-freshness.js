/**
 * Freshness ordering for arena state snapshots.
 *
 * Concurrent `getState` reads exist by design (SSE initial snapshot vs. hub
 * pump vs. action responses vs. `router.refresh` props), so every consumer of
 * a snapshot needs the same two pieces:
 *
 * - `nextStateStamp` (server): issues the `fetchedAt` value at read START.
 * - `createStateFreshnessGuard` (client): decides whether an arriving
 *   snapshot may be applied, per arena, monotonically.
 *
 * Why a strictly increasing stamp and not bare `Date.now()`: millisecond
 * resolution lets two reads straddling a commit start in the same millisecond
 * and carry EQUAL stamps — the guard accepts equals, letting the stale read
 * overwrite the fresh frame (and rejecting equals would just drop the fresh
 * frame instead; same-ms reads are simply unorderable by wall clock).
 * `max(now, last + 1)` keeps stamps wall-clock anchored while guaranteeing
 * uniqueness and read-START order within the process.
 *
 * Why read-START order matters: every board commit fires a NOTIFY trigger,
 * the resulting pump read starts after the commit (so it sees it — READ
 * COMMITTED) and carries a strictly higher stamp than any pre-commit read, so
 * the fresh frame always wins the guard and a stale late-finisher is
 * discarded.
 */

/**
 * Issue a strictly increasing read-start stamp. The counter lives on
 * `globalThis` (like the realtime hub and the Prisma client) because Next.js
 * can give route handlers, server actions, and the hub separate module
 * instances — a module-local counter would not be shared across those bundles.
 *
 * @returns {number} unique, strictly increasing, roughly-wall-clock stamp
 */
export const nextStateStamp = () => {
  const g = globalThis;
  const stamp = Math.max(Date.now(), (g.__dinkStateStampLast ?? 0) + 1);
  g.__dinkStateStampLast = stamp;
  return stamp;
};

/**
 * Create a per-key monotonic apply-guard for state snapshots.
 *
 * The returned function answers "may this snapshot be applied for this key?":
 * - a snapshot OLDER than one already applied is rejected (a slow action
 *   response must not clobber a newer SSE push, and vice-versa);
 * - an EQUAL stamp applies — with unique issuance an equal stamp can only be
 *   a duplicate of the same frame, which is safe to re-apply (reconnect and
 *   duplicate-delivery paths rely on this being idempotent, not dropped);
 * - a snapshot WITHOUT a stamp (older payload shape) always applies, so a
 *   rolling deploy can't strand clients.
 *
 * @returns {(key: string, state: { fetchedAt?: number }) => boolean}
 */
export const createStateFreshnessGuard = () => {
  const lastApplied = new Map();
  return (key, state) => {
    const at = state?.fetchedAt ?? 0;
    const prev = lastApplied.get(key) ?? 0;
    if (at && at < prev) return false;
    if (at > prev) lastApplied.set(key, at);
    return true;
  };
};
