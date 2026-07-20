'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveCommand } from '@/lib/board-engine';
import { clearPendingLog, loadArenaSnapshot, loadPendingLog, savePendingLog } from '@/lib/offline-store';
import { appendEvent, createPendingLog, engineSettings, replayEvents } from './arena-offline-state';

/**
 * Offline session mode for the arena board (Phase 2 of offline support).
 *
 * While active, a manager's board actions are resolved locally through the
 * pure board engine, appended to a per-arena pending log in IndexedDB, and
 * applied to the page's local state: the server is not called. The pending
 * log survives reloads (the page resumes the offline session on mount) and
 * is the input to the Phase 3 sync replay. Until sync ships, exiting offline
 * mode discards the pending changes (explicitly, behind a confirm).
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
  lastServerFetchedAt,
  persistSnapshot,
}) {
  const [offlineActive, setOfflineActive] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [promptVisible, setPromptVisible] = useState(false);
  const [otherTabActive, setOtherTabActive] = useState(false);

  // Ref mirror of `offlineActive` for the gates in arena.js (SSE frames,
  // action results, render-time prop resync): those run inside stable
  // callbacks/render and must read the CURRENT value, not a closed-over one.
  const offlineActiveRef = useRef(false);
  const logRef = useRef(null);
  const channelRef = useRef(null);

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
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      const log = await loadPendingLog(arenaId);
      if (!log || log.events.length === 0 || cancelled) return;
      const snapshot = await loadArenaSnapshot(arenaId);
      if (!snapshot || cancelled) return; // no base to replay over; log kept for the offline shell
      const { state } = replayEvents(snapshot.state, log.settings, log.events);
      applyLocalState(state);
      activate(log);
    })();
    return () => {
      cancelled = true;
    };
  }, [arenaId, canManage, applyLocalState, activate]);

  // Connection-loss prompt: never auto-enter, just offer. `offline` is a
  // definite signal; `online` clears a prompt that's no longer relevant.
  // Failed server actions also surface it via `notifyActionFailed`.
  useEffect(() => {
    if (!canManage) return;
    const show = () => {
      if (!offlineActiveRef.current) setPromptVisible(true);
    };
    const hide = () => setPromptVisible(false);
    window.addEventListener('offline', show);
    window.addEventListener('online', hide);
    return () => {
      window.removeEventListener('offline', show);
      window.removeEventListener('online', hide);
    };
  }, [canManage]);

  const notifyActionFailed = useCallback(() => {
    if (canManage && !offlineActiveRef.current) setPromptVisible(true);
  }, [canManage]);

  const dismissPrompt = useCallback(() => setPromptVisible(false), []);

  /** Start an offline session. Resolves false when entry isn't possible. */
  const enterOffline = useCallback(async () => {
    if (!canManage || offlineActiveRef.current || otherTabActive) return false;
    // The base snapshot must be durable BEFORE the first event: resume and
    // Phase 3 sync both replay the log over exactly this state.
    const snapshotSaved = await persistSnapshot();
    if (!snapshotSaved) return false;
    const log = createPendingLog({
      arenaId,
      batchId: crypto.randomUUID(),
      baseFetchedAt: lastServerFetchedAt,
      settings: engineSettings(settingsProps),
      enteredAt: new Date().toISOString(),
    });
    if (!(await savePendingLog(log))) return false;
    activate(log);
    return true;
  }, [arenaId, canManage, otherTabActive, persistSnapshot, settingsProps, lastServerFetchedAt, activate]);

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

  /**
   * Abandon the offline session: drop the pending log and reload so the page
   * re-renders from the server (the reload also resets the freshness guard
   * and SSE stream: the cleanest possible resync). Caller confirms first.
   */
  const exitOfflineDiscard = useCallback(async () => {
    await clearPendingLog(arenaId);
    channelRef.current?.postMessage({ kind: 'inactive' });
    window.location.reload();
  }, [arenaId]);

  return {
    offlineActive,
    offlineActiveRef,
    pendingCount,
    promptVisible,
    otherTabActive,
    enterOffline,
    exitOfflineDiscard,
    runLocal,
    notifyActionFailed,
    dismissPrompt,
  };
}
