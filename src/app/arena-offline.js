'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveCommand } from '@/lib/board-engine';
import { boardFingerprint } from '@/lib/board-fingerprint';
import { clearPendingLog, loadArenaSnapshot, loadPendingLog, savePendingLog } from '@/lib/offline-store';
import { declareOfflineHold, releaseOfflineHold, syncOfflineEvents } from './actions';
import { appendEvent, createPendingLog, engineSettings, replayEvents } from './arena-offline-state';

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
 * Entry is never silent: the manager either taps "Run offline" on the
 * connection-lost prompt (auto-shown on `offline` events / failed actions)
 * or resumes an unfinished session on reload. A BroadcastChannel keeps two
 * tabs of the same arena from both writing the single pending log.
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
  // Latest syncNow, reachable from effects without dependency cycles.
  const syncNowRef = useRef(null);

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
  // local session stays internally consistent until Phase 3 syncs it).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!canManage) {
        setResuming(false);
        return;
      }
      try {
        const log = await loadPendingLog(arenaId);
        if (!log || log.events.length === 0 || cancelled) return;
        const snapshot = await loadArenaSnapshot(arenaId);
        if (!snapshot || cancelled) return; // no base to replay over; log kept for the offline shell
        const { state } = replayEvents(snapshot.state, log.settings, log.events);
        applyLocalState(state);
        activate(log);
        // Reloaded after the connection came back (the page itself loaded from
        // the server): push the finished session up right away.
        if (navigator.onLine) queueMicrotask(() => syncNowRef.current?.('strict'));
      } finally {
        // Snapshot writes can resume once we've decided (activated or not).
        if (!cancelled) setResuming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arenaId, canManage, applyLocalState, activate]);

  // Connection signals: `offline` offers the prompt (never auto-enters);
  // `online` clears a stale prompt and, mid-session, auto-syncs the log.
  // Failed server actions also surface the prompt via `notifyActionFailed`.
  useEffect(() => {
    if (!canManage) return;
    const onOffline = () => {
      if (!offlineActiveRef.current) setPromptVisible(true);
    };
    const onOnline = () => {
      setPromptVisible(false);
      if (offlineActiveRef.current) syncNowRef.current?.('strict');
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [canManage]);

  const notifyActionFailed = useCallback(() => {
    if (canManage && !offlineActiveRef.current) setPromptVisible(true);
  }, [canManage]);

  const dismissPrompt = useCallback(() => setPromptVisible(false), []);

  /** Start an offline session. Resolves false when entry isn't possible. */
  const enterOffline = useCallback(async () => {
    if (!canManage || offlineActiveRef.current || otherTabActive) return false;

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
    // Advisory hold, fire-and-forget: reaches the server only when it is
    // still reachable (flaky connection / preemptive entry). Other viewers
    // then see "X is running the board offline" via the SSE push. A truly
    // offline device simply can't declare, which is fine: the hold is a
    // courtesy banner, and the sync fingerprint protects correctness.
    declareOfflineHold(arenaId).catch(() => {});
    return true;
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
  ]);

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

      // Nothing recorded: no server call needed. Exit and let the reopened
      // SSE stream resync (it re-sends full state on connect).
      if (log.events.length === 0) {
        await clearPendingLog(arenaId);
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
    [arenaId, applySyncedState, deactivate, onSynced],
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
    // Best effort: fails fast while offline, in which case the hold expires
    // via its client-side TTL instead (see isHoldActive).
    try {
      await releaseOfflineHold(arenaId);
    } catch {
      // Unreachable server: nothing else to do.
    }
    channelRef.current?.postMessage({ kind: 'inactive' });
    window.location.reload();
  }, [arenaId]);

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
