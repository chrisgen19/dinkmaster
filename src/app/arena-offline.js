'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveCommand } from '@/lib/board-engine';
import { boardFingerprint } from '@/lib/board-fingerprint';
import { clearPendingLog, loadArenaSnapshot, loadPendingLog, savePendingLog } from '@/lib/offline-store';
import { declareOfflineHold, releaseOfflineHold, syncOfflineEvents } from './actions';
import { appendEvent, createPendingLog, engineSettings, replayEvents } from './arena-offline-state';

// How long a genuine `offline` signal must persist before the board switches
// itself to offline mode. Rides out the brief offline/online flaps a phone
// throws off while roaming a venue, so a momentary blip doesn't churn the
// session (which would sync-and-exit cleanly anyway, just with a UI flash).
const OFFLINE_AUTOENTER_DELAY_MS = 800;

/**
 * Offline session mode for the arena board.
 *
 * While active, a manager's board actions are resolved locally through the
 * pure board engine, appended to a per-arena pending log in IndexedDB, and
 * applied to the page's local state: the server is not called. The pending
 * log survives reloads (the page resumes the offline session on mount) and
 * replays to the server through `syncOfflineEvents` when the connection
 * returns: automatically on the browser's `online` signal and on resume,
 * or manually via "Sync now".
 *
 * Sync outcomes: success clears the log, applies the server's authoritative
 * state (via `applySyncedState`, which advances the freshness guard BEFORE
 * the SSE gate re-opens), and exits offline mode. A `divergence` response
 * (the board changed while away) or a `blocked` one (e.g. manager role
 * revoked) parks the log untouched and surfaces a decision dialog: retry
 * best-effort, keep working offline, copy the log as JSON, or discard.
 *
 * Entry: the board switches to offline mode automatically on a genuine
 * `offline` signal (debounced), resumes an unfinished session on reload, and
 * falls back to a one-tap "Run offline" prompt only in the ambiguous case (an
 * action failed while the browser still reports itself online) or when auto
 * entry can't proceed. A BroadcastChannel keeps two tabs of the same arena
 * from both writing the single pending log.
 *
 * @param {object} args
 * @param {string} args.arenaId
 * @param {boolean} args.canManage - offline mode is manager-only
 * @param {{matchmaking: object, matchDefaults: object}} args.settingsProps -
 *   mapped via `engineSettings` and frozen onto the log at entry
 * @param {() => object} args.getBoardState - current board in getState shape
 * @param {(state: object) => void} args.applyLocalState - write engine output
 *   into the page's board state
 * @param {(state: object) => void} args.applySyncedState - write the sync
 *   response's server state into the page AND advance the freshness guard
 * @param {(summary: {appliedCount: number, skipped: Array}) => void} args.onSynced -
 *   notification hook for a completed sync
 * @param {number|null} args.lastServerFetchedAt - stamp of the last applied
 *   server snapshot (the offline session's base)
 * @param {() => Promise<boolean>} args.persistSnapshot - save the current
 *   board as the IndexedDB base snapshot (awaited before entry)
 */
export function useArenaOffline({
  arenaId,
  canManage,
  offlineBoot = false,
  settingsProps,
  getBoardState,
  applyLocalState,
  applySyncedState,
  onSynced,
  lastServerFetchedAt,
  persistSnapshot,
}) {
  const [offlineActive, setOfflineActive] = useState(false);
  // True from mount until the resume effect has decided whether to re-enter an
  // unfinished session. arena.js pauses base-snapshot writes while this is set
  // so an idle persist can't overwrite the replay base before resume reads it.
  const [resuming, setResuming] = useState(canManage);
  const [pendingCount, setPendingCount] = useState(0);
  const [promptVisible, setPromptVisible] = useState(false);
  const [otherTabActive, setOtherTabActive] = useState(false);
  // status: 'idle' | 'syncing' | 'divergence' | 'blocked'. `error` carries a
  // transient failure message ('idle' + error = network sync attempt failed).
  const [syncState, setSyncState] = useState({ status: 'idle', error: '' });

  // Ref mirror of `offlineActive` for the gates in arena.js (SSE frames,
  // action results, render-time prop resync): those run inside stable
  // callbacks/render and must read the CURRENT value, not a closed-over one.
  const offlineActiveRef = useRef(false);
  const logRef = useRef(null);
  const channelRef = useRef(null);
  const syncingRef = useRef(false);
  // Guards against two entry attempts racing (the debounced `offline` event
  // and a failed action can both fire): held from the start of enterOffline
  // until it activates or bails.
  const enteringRef = useRef(false);
  // Latest syncNow / autoEnter, reachable from effects without dep cycles.
  const syncNowRef = useRef(null);
  const autoEnterRef = useRef(null);

  const activate = useCallback((log) => {
    logRef.current = log;
    offlineActiveRef.current = true;
    setOfflineActive(true);
    setPendingCount(log.events.length);
    setPromptVisible(false);
    channelRef.current?.postMessage({ kind: 'active' });
    // Ask the browser not to evict our IndexedDB data mid-session. Best
    // effort: a denied request changes nothing about behavior.
    try {
      navigator.storage?.persist?.();
    } catch {
      // Storage API unavailable: nothing to do.
    }
  }, []);

  // Cross-tab single-writer guard. The pending log is one record per arena;
  // two tabs appending concurrently would drop each other's events. The tab
  // that enters offline mode broadcasts `active`; other tabs disable entry
  // and surface a notice instead.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`dinkmaster-offline:${arenaId}`);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const kind = event.data?.kind;
      if (kind === 'query' && offlineActiveRef.current) channel.postMessage({ kind: 'active' });
      if (kind === 'active') setOtherTabActive(true);
      if (kind === 'inactive') setOtherTabActive(false);
    };
    channel.postMessage({ kind: 'query' });
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [arenaId]);

  // Resume an unfinished offline session after a reload: pending events are
  // replayed over the saved base snapshot (NOT the fresh server props: the
  // local session stays internally consistent until it syncs).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!canManage) {
        setResuming(false);
        return;
      }
      try {
        const log = await loadPendingLog(arenaId);
        if (cancelled) return;
        if (log && log.events.length > 0) {
          const snapshot = await loadArenaSnapshot(arenaId);
          if (!snapshot || cancelled) return; // no base to replay over; log kept for the offline shell
          const { state } = replayEvents(snapshot.state, log.settings, log.events);
          applyLocalState(state);
          activate(log);
          // Reloaded after the connection came back (the page itself loaded
          // from the server): push the finished session up right away.
          if (navigator.onLine) queueMicrotask(() => syncNowRef.current?.('strict'));
          return;
        }
        // No pending session. On a COLD OFFLINE BOOT (the offline shell mounted
        // this board from a snapshot while the device is offline), no `offline`
        // event will fire to trigger auto-entry, so start a fresh local session
        // here. The ref is already assigned by now: this runs after an `await`,
        // by which point the synchronous mount effects (including the one that
        // sets autoEnterRef) have all run.
        if (offlineBoot && !navigator.onLine) autoEnterRef.current?.();
      } finally {
        // Snapshot writes can resume once we've decided (activated or not).
        if (!cancelled) setResuming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arenaId, canManage, offlineBoot, applyLocalState, activate]);

  // Connection signals. A genuine `offline` event (navigator.onLine went
  // false) switches the board to offline mode AUTOMATICALLY after a short
  // debounce: the manager shouldn't have to tap "Run offline" when the
  // device is plainly offline. `online` cancels a pending switch, clears a
  // stale prompt, and (mid-session) auto-syncs the log.
  useEffect(() => {
    if (!canManage) return;
    let enterTimer = null;
    const onOffline = () => {
      if (offlineActiveRef.current) return;
      clearTimeout(enterTimer);
      enterTimer = setTimeout(() => autoEnterRef.current?.(), OFFLINE_AUTOENTER_DELAY_MS);
    };
    const onOnline = () => {
      clearTimeout(enterTimer);
      setPromptVisible(false);
      if (offlineActiveRef.current) syncNowRef.current?.('strict');
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      clearTimeout(enterTimer);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [canManage]);

  // A server action failed. If the browser also reports itself offline, that
  // is a definite drop, so switch automatically (same as the `offline`
  // event). If it still reports ONLINE, the failure is ambiguous (it could
  // be a server error, not a lost connection), so offer the choice instead
  // of wrongly forcing the board offline.
  const notifyActionFailed = useCallback(() => {
    if (!canManage || offlineActiveRef.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      autoEnterRef.current?.();
    } else {
      setPromptVisible(true);
    }
  }, [canManage]);

  /**
   * Advisory hold, fire-and-forget: reaches the server only when it is still
   * reachable (flaky connection / preemptive entry). Other viewers then see
   * "X is running the board offline" via the SSE push. A truly offline device
   * simply can't declare, which is fine: the hold is a courtesy banner, and
   * the sync fingerprint is what protects correctness.
   */
  const declareHold = useCallback(() => {
    declareOfflineHold(arenaId).catch(() => {});
  }, [arenaId]);

  /**
   * Clear the advisory hold. Awaited (unlike declare) so the caller can
   * finish tearing the session down after the banner is gone. Best effort:
   * while unreachable the hold expires via its client-side TTL instead.
   */
  const releaseHold = useCallback(async () => {
    try {
      await releaseOfflineHold(arenaId);
    } catch {
      // Unreachable server: the TTL takes over.
    }
  }, [arenaId]);

  const dismissPrompt = useCallback(() => setPromptVisible(false), []);

  /** Start an offline session. Resolves false when entry isn't possible. */
  const enterOffline = useCallback(async () => {
    if (!canManage || offlineActiveRef.current || otherTabActive || enteringRef.current) {
      return false;
    }
    enteringRef.current = true;
    try {
      // Never silently discard unsynced events. A non-empty log can still be
      // parked in IndexedDB when the resume effect didn't activate (missing
      // snapshot, empty-tab race, or the connection returned before sync).
      // Adopt that log instead of overwriting it with a fresh empty one.
      const existing = await loadPendingLog(arenaId);
      if (existing && existing.events.length > 0) {
        const snapshot = await loadArenaSnapshot(arenaId);
        if (!snapshot) return false; // no base to replay over; keep the log intact
        const { state } = replayEvents(snapshot.state, existing.settings, existing.events);
        applyLocalState(state);
        activate(existing);
        // Adopting a parked log starts a session just like a fresh entry, so
        // it needs the same advisory hold.
        declareHold();
        return true;
      }

      // The base snapshot must be durable BEFORE the first event: resume and
      // sync both replay the log over exactly this state.
      const snapshotSaved = await persistSnapshot();
      if (!snapshotSaved) return false;
      const settings = engineSettings(settingsProps);
      const log = createPendingLog({
        arenaId,
        batchId: crypto.randomUUID(),
        baseFetchedAt: lastServerFetchedAt,
        // Fingerprint of the state this session forks from; the sync replay
        // recomputes it server-side to detect divergence before applying.
        baseFingerprint: boardFingerprint(getBoardState(), settings),
        settings,
        enteredAt: new Date().toISOString(),
      });
      if (!(await savePendingLog(log))) return false;
      activate(log);
      declareHold();
      return true;
    } finally {
      enteringRef.current = false;
    }
  }, [
    arenaId,
    canManage,
    otherTabActive,
    persistSnapshot,
    settingsProps,
    lastServerFetchedAt,
    getBoardState,
    activate,
    applyLocalState,
    declareHold,
  ]);

  // Automatic entry from a connection signal. Falls back to the manual prompt
  // only when entry can't proceed (another tab already owns the offline
  // session, or device storage is unavailable), so the manager is never left
  // with a dead board and no affordance. Kept in a ref so the connection
  // effect can call the latest without a dependency cycle.
  const autoEnter = useCallback(async () => {
    let entered = false;
    try {
      entered = await enterOffline();
    } catch {
      // enterOffline's IndexedDB helpers return false rather than throw, but
      // this runs from a setTimeout callback where a rejection would be
      // swallowed silently, so catch it so the fallback prompt below still
      // shows and the "never stuck" guarantee holds.
    }
    if (!entered && !offlineActiveRef.current) setPromptVisible(true);
  }, [enterOffline]);
  useEffect(() => {
    autoEnterRef.current = autoEnter;
  }, [autoEnter]);

  /**
   * Run one board command locally: resolve -> persist the event -> apply.
   * Persist BEFORE apply so the UI never shows a change that isn't durable.
   *
   * @returns {Promise<{error?: string, notification?: string, noop?: boolean}>}
   */
  const runLocal = useCallback(
    async (command) => {
      const log = logRef.current;
      if (!offlineActiveRef.current || !log) return { error: 'Offline mode is not active.' };
      const result = resolveCommand(getBoardState(), log.settings, command);
      if (result.error) return { error: result.error };
      if (!result.event) return { noop: true };
      const nextLog = appendEvent(log, result.event);
      if (!(await savePendingLog(nextLog))) {
        return { error: 'Could not save this change on the device. Nothing was applied.' };
      }
      logRef.current = nextLog;
      setPendingCount(nextLog.events.length);
      applyLocalState(result.state);
      return { notification: result.notification || '' };
    },
    [getBoardState, applyLocalState],
  );

  /** Leave offline mode without a reload (used after a successful sync). */
  const deactivate = useCallback(() => {
    logRef.current = null;
    offlineActiveRef.current = false;
    setOfflineActive(false);
    setPendingCount(0);
    channelRef.current?.postMessage({ kind: 'inactive' });
  }, []);

  /**
   * Replay the pending log to the server. `mode` is 'strict' on every
   * automatic/first attempt; 'best-effort' only when the manager picked
   * "Apply anyway" on the divergence dialog.
   *
   * Ordering contract on success: apply the returned server state (which
   * advances the freshness guard) BEFORE deactivating: once the SSE gate
   * re-opens, any stale pre-sync frame loses to the just-advanced stamp.
   */
  const syncNow = useCallback(
    async (mode = 'strict') => {
      const log = logRef.current;
      if (!offlineActiveRef.current || !log || syncingRef.current) return;

      // Nothing recorded: no batch to replay, so skip the sync endpoint and
      // let the reopened SSE stream resync (it re-sends full state on
      // connect). The advisory hold still has to be released explicitly:
      // `syncOfflineEvents` is what clears it on the normal path, and
      // without this other viewers would keep the "running the board
      // offline" banner until its client-side TTL expired.
      if (log.events.length === 0) {
        await clearPendingLog(arenaId);
        await releaseHold();
        deactivate();
        setSyncState({ status: 'idle', error: '' });
        return;
      }

      syncingRef.current = true;
      setSyncState({ status: 'syncing', error: '' });
      let result;
      try {
        result = await syncOfflineEvents(arenaId, {
          batchId: log.batchId,
          base: log.base,
          settings: log.settings,
          events: log.events,
          enteredAt: log.enteredAt,
          mode,
        });
      } catch {
        // Transport failure: still (or again) offline. Keep everything.
        syncingRef.current = false;
        setSyncState({
          status: 'idle',
          error: 'Could not reach the server. Your changes are still saved on this device.',
        });
        return;
      }
      syncingRef.current = false;

      if (result?.divergence) {
        setSyncState({ status: 'divergence', error: '' });
        return;
      }
      if (result?.error) {
        // Authorization or validation refusal. The log stays parked; the
        // dialog offers copy-as-JSON / discard / keep-offline.
        setSyncState({ status: 'blocked', error: result.error });
        return;
      }

      await clearPendingLog(arenaId);
      applySyncedState(result.state);
      deactivate();
      setSyncState({ status: 'idle', error: '' });
      onSynced?.({ appliedCount: result.appliedIds?.length ?? 0, skipped: result.skipped ?? [] });
    },
    [arenaId, applySyncedState, deactivate, onSynced, releaseHold],
  );
  // Ref assignment kept out of render for react-hooks/refs.
  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  /** Copy the pending log to the clipboard (escape hatch when sync is blocked). */
  const copyLogJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(logRef.current, null, 2));
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Close a sync dialog and keep working offline (log untouched). */
  const dismissSyncState = useCallback(() => setSyncState({ status: 'idle', error: '' }), []);

  /**
   * Abandon the offline session: drop the pending log and reload so the page
   * re-renders from the server (the reload also resets the freshness guard
   * and SSE stream: the cleanest possible resync). Caller confirms first.
   */
  const exitOfflineDiscard = useCallback(async () => {
    await clearPendingLog(arenaId);
    await releaseHold();
    channelRef.current?.postMessage({ kind: 'inactive' });
    window.location.reload();
  }, [arenaId, releaseHold]);

  return {
    offlineActive,
    offlineActiveRef,
    resuming,
    pendingCount,
    promptVisible,
    otherTabActive,
    syncState,
    enterOffline,
    exitOfflineDiscard,
    runLocal,
    syncNow,
    copyLogJson,
    dismissSyncState,
    notifyActionFailed,
    dismissPrompt,
  };
}
