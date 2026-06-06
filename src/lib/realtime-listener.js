import { Client } from 'pg';
import { getState } from '@/lib/data';

/**
 * Realtime fan-out hub for live arena updates.
 *
 * A single long-lived `pg` client per Node process holds `LISTEN arena_events`
 * (the channel the DB triggers in `20260606120000_add_realtime_notify_triggers`
 * signal on). When a notification arrives for an arena that has open SSE
 * subscribers, we read `getState(arenaId)` ONCE and push the fresh state to all
 * of that arena's subscribers — so 50 viewers of one court cost one DB read per
 * change, not 50.
 *
 * This module is server-only (it imports `pg` and `getState`). It must only be
 * imported from server code (the SSE route handler).
 *
 * Coolify runs the app as a persistent `next start` process, so this LISTEN
 * connection stays up for the life of the process. If `next start` is ever
 * clustered, each worker keeps its own LISTEN client and Postgres broadcasts
 * the NOTIFY to all of them, so every viewer still updates regardless of which
 * worker served their stream.
 */

const CHANNEL = 'arena_events';
const RECONNECT_DELAY_MS = 1000;

const globalForRealtime = globalThis;

function createHub() {
  /** @type {Map<string, Set<(state: unknown) => void>>} arenaId → subscriber callbacks */
  const subscribers = new Map();
  /** @type {import('pg').Client | null} the live LISTEN client */
  let client = null;
  /** @type {Promise<void> | null} in-flight connect, so concurrent subscribers share one attempt */
  let connecting = null;
  let reconnectTimer = null;

  // Per-arena read coalescing. Notifications for the same arena can arrive
  // faster than getState resolves; running them concurrently risks pushing an
  // older snapshot after a newer one. So while a read loop is active for an
  // arena, further notifications only mark it `dirty` and the active loop
  // re-reads once when it finishes — serial per arena, and bursts collapse to
  // a single trailing read.
  const reading = new Set(); // arenaIds with an active pump loop
  const dirty = new Set(); // arenaIds needing a (re)read
  const retryScheduled = new Set(); // arenaIds with a pending failed-read retry

  async function pumpArena(arenaId) {
    if (reading.has(arenaId)) return; // an active loop will pick up `dirty`
    reading.add(arenaId);
    try {
      while (dirty.has(arenaId)) {
        dirty.delete(arenaId);
        const subs = subscribers.get(arenaId);
        if (!subs || subs.size === 0) break;
        let state;
        try {
          state = await getState(arenaId);
        } catch {
          // Transient read failure (a deleted arena doesn't throw — getState
          // returns empty state — so this is a real DB hiccup). Don't consume
          // the notification: schedule ONE delayed retry so the update still
          // reaches subscribers once the DB recovers, without hot-looping
          // through an outage. The pump for this arena stops until then.
          if (!retryScheduled.has(arenaId)) {
            retryScheduled.add(arenaId);
            setTimeout(() => {
              retryScheduled.delete(arenaId);
              if (!subscribers.has(arenaId)) return; // everyone left meanwhile
              dirty.add(arenaId);
              pumpArena(arenaId);
            }, RECONNECT_DELAY_MS);
          }
          break;
        }
        for (const cb of subs) {
          try {
            cb(state);
          } catch {
            // A broken stream must not abort delivery to the others.
          }
        }
      }
    } finally {
      reading.delete(arenaId);
    }
  }

  function handleNotification(msg) {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    const arenaId = msg.payload;
    if (!subscribers.has(arenaId)) return;
    dirty.add(arenaId);
    pumpArena(arenaId);
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    // No point reconnecting if nobody is listening; the next subscribe() will
    // lazily reconnect instead.
    if (subscribers.size === 0) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      ensureConnected().catch(() => scheduleReconnect());
    }, RECONNECT_DELAY_MS);
  }

  // Tear down the live client — but only when the failing client is still the
  // current one, so a stale error/end event from an already-replaced client
  // can't null out a newer connection. Never touches `connecting`, so it can't
  // race an in-flight connect into spawning a parallel client.
  function onClientFailure(failed) {
    if (failed !== client) return;
    try {
      failed.removeAllListeners();
      failed.end().catch(() => {});
    } catch {
      // already torn down
    }
    client = null;
    scheduleReconnect();
  }

  async function ensureConnected() {
    if (client) return;
    if (connecting) return connecting;
    connecting = (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      c.on('notification', handleNotification);
      try {
        await c.connect();
        // CHANNEL is a fixed identifier (never user input), so this is safe.
        await c.query(`LISTEN ${CHANNEL}`);
      } catch (err) {
        // connect or LISTEN failed: close this client so the socket can't leak,
        // then surface the error to the caller (which schedules a reconnect).
        try {
          c.removeAllListeners();
          await c.end();
        } catch {
          // nothing to close
        }
        throw err;
      }
      // Live now. Bind failure handlers to THIS client so a later replacement
      // can recognize and ignore their stale events.
      c.on('error', () => onClientFailure(c));
      c.on('end', () => onClientFailure(c));
      client = c;
    })();
    try {
      await connecting;
    } finally {
      connecting = null;
    }
  }

  /**
   * Subscribe to live state for one arena.
   * @param {string} arenaId
   * @param {(state: unknown) => void} cb invoked with fresh getState() on each change
   * @returns {Promise<() => void>} unsubscribe
   */
  async function subscribe(arenaId, cb) {
    let set = subscribers.get(arenaId);
    if (!set) {
      set = new Set();
      subscribers.set(arenaId, set);
    }
    set.add(cb);
    try {
      await ensureConnected();
    } catch {
      // Connect failed; the subscriber stays registered and scheduleReconnect()
      // will re-establish LISTEN and resume delivery.
      scheduleReconnect();
    }
    return () => {
      const s = subscribers.get(arenaId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) subscribers.delete(arenaId);
    };
  }

  return { subscribe };
}

/** Reuse the hub across hot reloads in dev and any module re-evaluation. */
export const realtimeHub =
  globalForRealtime.__arenaRealtimeHub ?? (globalForRealtime.__arenaRealtimeHub = createHub());
