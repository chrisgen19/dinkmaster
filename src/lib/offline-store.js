import { idbAvailable, idbDelete, idbGet, idbGetAll, idbPut, openDb } from '@/lib/idb';

/**
 * Client-side offline storage for arena boards, backing the read-only offline
 * board (Tier 1) and, later, the offline session event log (Phase 2/3).
 *
 * DB `dinkmaster-offline`, version 1:
 *   - `snapshots` (key `arenaId`): the last server board state a device saw,
 *     plus the display/role metadata the offline shell needs to render it.
 *   - `pending`   (key `arenaId`): ONE record per arena holding the ordered
 *     offline event log (batchId, base fingerprint, events[]). Rewritten
 *     atomically on every offline mutation. Created here so Phase 2 needs no
 *     schema bump.
 *   - `meta`      (key `name`): device-level values (e.g. a stable deviceId).
 *
 * Every function degrades silently (null / false / no-op) when IndexedDB is
 * unavailable or errors: offline storage is an enhancement, and a private-mode
 * browser must never break the live board.
 *
 * PRIVACY NOTE: snapshots hold only board data that is already publicly
 * readable via the arena page and its SSE stream, plus the viewer's own
 * role flags. No credentials or session tokens are ever stored.
 */

const DB_NAME = 'dinkmaster-offline';
const DB_VERSION = 1;
const SNAPSHOTS = 'snapshots';
const PENDING = 'pending';
const META = 'meta';

// Cap the match history persisted per snapshot: the offline board shows
// recent results and session stats only look back to the last session reset,
// so the full all-time history would be dead weight in IndexedDB.
const SNAPSHOT_MATCH_HISTORY_LIMIT = 100;

let dbPromise = null;

function db() {
  if (!idbAvailable()) return null;
  dbPromise ??= openDb(DB_NAME, DB_VERSION, (database) => {
    database.createObjectStore(SNAPSHOTS, { keyPath: 'arenaId' });
    database.createObjectStore(PENDING, { keyPath: 'arenaId' });
    database.createObjectStore(META, { keyPath: 'name' });
  }).catch(() => null);
  return dbPromise;
}

/**
 * Persist the latest known board snapshot for an arena.
 *
 * @param {object} snapshot - { arenaId, arenaName, savedAt, canManage,
 *   viewerRole, viewerUserId, matchmaking, matchDefaults, state } where
 *   `state` is the getState shape.
 * @returns {Promise<boolean>} whether the write succeeded
 */
export async function saveArenaSnapshot(snapshot) {
  try {
    const database = await db();
    if (!database) return false;
    const state = snapshot.state;
    await idbPut(database, SNAPSHOTS, {
      ...snapshot,
      state: {
        ...state,
        matchHistory: (state.matchHistory ?? []).slice(0, SNAPSHOT_MATCH_HISTORY_LIMIT),
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Load the saved snapshot for one arena, or null. */
export async function loadArenaSnapshot(arenaId) {
  try {
    const database = await db();
    if (!database) return null;
    return (await idbGet(database, SNAPSHOTS, arenaId)) ?? null;
  } catch {
    return null;
  }
}

/**
 * List every saved snapshot's directory info (no board payloads), newest
 * first. Used by the offline shell when it can't infer an arena from the URL.
 */
export async function listArenaSnapshots() {
  try {
    const database = await db();
    if (!database) return [];
    const all = await idbGetAll(database, SNAPSHOTS);
    return all
      .map(({ arenaId, arenaName, savedAt }) => ({ arenaId, arenaName, savedAt }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** Load the pending offline event log for an arena, or null when none. */
export async function loadPendingLog(arenaId) {
  try {
    const database = await db();
    if (!database) return null;
    return (await idbGet(database, PENDING, arenaId)) ?? null;
  } catch {
    return null;
  }
}

/** Persist (replace) the pending offline event log for an arena. */
export async function savePendingLog(log) {
  try {
    const database = await db();
    if (!database) return false;
    await idbPut(database, PENDING, log);
    return true;
  } catch {
    return false;
  }
}

/** Drop an arena's pending offline event log (after a successful sync/discard). */
export async function clearPendingLog(arenaId) {
  try {
    const database = await db();
    if (!database) return false;
    await idbDelete(database, PENDING, arenaId);
    return true;
  } catch {
    return false;
  }
}
