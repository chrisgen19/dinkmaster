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
  /** @type {import('pg').Client | null} */
  let client = null;
  /** @type {Promise<void> | null} in-flight connect, so concurrent subscribers share one attempt */
  let connecting = null;
  let reconnectTimer = null;

  async function handleNotification(msg) {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    const arenaId = msg.payload;
    const subs = subscribers.get(arenaId);
    if (!subs || subs.size === 0) return;
    let state;
    try {
      // One read per notification, shared across this arena's subscribers.
      state = await getState(arenaId);
    } catch {
      // Arena vanished or a transient read failure — skip this tick; the next
      // change (or the SSE client's reconnect re-sync) will catch things up.
      return;
    }
    for (const cb of subs) {
      try {
        cb(state);
      } catch {
        // A broken stream must not abort delivery to the others.
      }
    }
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

  function dropClient() {
    if (client) {
      try {
        client.removeAllListeners();
        client.end().catch(() => {});
      } catch {
        // already torn down
      }
    }
    client = null;
    connecting = null;
    scheduleReconnect();
  }

  async function ensureConnected() {
    if (client) return;
    if (connecting) return connecting;
    connecting = (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      c.on('notification', handleNotification);
      c.on('error', dropClient);
      c.on('end', dropClient);
      await c.connect();
      // CHANNEL is a fixed identifier (never user input), so this is safe.
      await c.query(`LISTEN ${CHANNEL}`);
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
      // (fired by dropClient) will re-establish LISTEN and resume delivery.
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
