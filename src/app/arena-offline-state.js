import { applyEvent } from '@/lib/board-engine';

/**
 * Pure state helpers for the arena's offline session mode (Phase 2). Kept
 * free of React and IndexedDB so the log/replay semantics are unit-testable
 * in vitest's node environment (mirrors the `paddle-rack-stack-state.js`
 * pattern). The React wiring lives in `arena-offline.js`.
 */

/** Shown when a manager taps an action that offline mode doesn't support. */
export const OFFLINE_UNAVAILABLE_MESSAGE =
  'Not available offline. Reconnect to use this.';

/**
 * Map the arena page's props onto the settings object the board engine
 * consumes. Captured ONCE at offline entry and stored on the pending log, so
 * every event in a batch is resolved and replayed under the same rules even
 * if the server-side settings change while this device is away.
 */
export function engineSettings({ matchmaking, matchDefaults }) {
  return {
    targetScore: matchDefaults.targetScore,
    starveThreshold: matchmaking.starveThreshold,
    emergencyWait: matchmaking.emergencyWait,
    skipRestoresPriority: matchmaking.skipRestoresPriority,
    skipPickReplacement: matchmaking.skipPickReplacement,
  };
}

/**
 * A fresh, empty pending log for one arena. One log per arena (the IndexedDB
 * `pending` store keys on `arenaId`); `batchId` is the idempotency key the
 * Phase 3 sync endpoint will dedupe on. `base.fetchedAt` records which server
 * snapshot the offline session forked from (Phase 3 adds a fingerprint).
 */
export function createPendingLog({ arenaId, batchId, baseFetchedAt, settings, enteredAt }) {
  return {
    arenaId,
    batchId,
    base: { fetchedAt: baseFetchedAt ?? null },
    settings,
    events: [],
    enteredAt,
  };
}

/** Append one resolved event to a pending log (immutably). */
export function appendEvent(log, event) {
  return { ...log, events: [...log.events, event] };
}

/**
 * Replay an ordered event list over a board state through the pure engine.
 * Stops at the first event that no longer applies (STATE_MISMATCH or an
 * engine error) rather than guessing past it: everything before the stop is
 * trustworthy, everything after is not.
 *
 * @returns {{state: object, appliedCount: number, stoppedAt: string|null}}
 *   `stoppedAt` is the id of the first event that failed to apply, or null
 *   when the whole log replayed.
 */
export function replayEvents(state, settings, events) {
  let current = state;
  let appliedCount = 0;
  for (const event of events ?? []) {
    const result = applyEvent(current, settings, event);
    if (result.error) return { state: current, appliedCount, stoppedAt: event.id ?? null };
    if (result.changed) current = result.state;
    appliedCount++;
  }
  return { state: current, appliedCount, stoppedAt: null };
}
