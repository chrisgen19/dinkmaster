/**
 * Minimal promise wrapper over raw IndexedDB. Deliberately not a dependency:
 * the offline store needs only open/get/put/delete/getAll on a couple of
 * object stores, and the logic worth testing lives above this layer in pure
 * modules (vitest runs in a node environment with no IndexedDB either way).
 *
 * All helpers assume the caller already checked availability via
 * {@link idbAvailable}; the store module wraps every call in try/catch so a
 * private-mode browser or quota failure degrades to "no offline data", never
 * a crash.
 */

/** Whether IndexedDB exists in this context (false during SSR/prerender). */
export function idbAvailable() {
  return typeof indexedDB !== 'undefined';
}

/** Promise wrapper for a single IDBRequest. */
function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Open (and upgrade if needed) a database.
 *
 * @param {string} name
 * @param {number} version
 * @param {(db: IDBDatabase) => void} upgrade - runs inside onupgradeneeded
 * @returns {Promise<IDBDatabase>}
 */
export function openDb(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Read one record by key. Resolves undefined when absent. */
export function idbGet(db, storeName, key) {
  return wrap(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
}

/** Read every record in a store. */
export function idbGetAll(db, storeName) {
  return wrap(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
}

/** Insert or replace one record (store must use in-line keys). */
export function idbPut(db, storeName, value) {
  return wrap(db.transaction(storeName, 'readwrite').objectStore(storeName).put(value));
}

/** Delete one record by key (resolves even when the key is absent). */
export function idbDelete(db, storeName, key) {
  return wrap(db.transaction(storeName, 'readwrite').objectStore(storeName).delete(key));
}
