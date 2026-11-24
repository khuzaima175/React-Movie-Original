import { safeSetStorageItem } from "./storageEviction.js";
import { isSameMovie } from "./movieIdentity.js";

export const VAULT_IDB_NAME = "cinemavault_vault_v1";
export const VAULT_IDB_STORE = "kv";
export const VAULT_MIGRATION_FLAG = "cinemavault_vault_idb_migrated_v1";

const memoryFallbackStore = new Map();

function resolveStorage(options = {}) {
  if ("storage" in options) return options.storage;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function resolveIndexedDb(options = {}) {
  if ("indexedDB" in options) return options.indexedDB;
  try {
    return typeof indexedDB !== "undefined" ? indexedDB : null;
  } catch {
    return null;
  }
}

function parseLegacyArray(storage, key) {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    const raw = storage.getItem(key);
    if (!raw || raw === "undefined" || raw === "null") return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function openVaultDb(idbFactory) {
  if (!idbFactory || typeof idbFactory.open !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = idbFactory.open(VAULT_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(VAULT_IDB_STORE)) {
          db.createObjectStore(VAULT_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function createNativeIdbAdapter(idbFactory) {
  if (!idbFactory || typeof idbFactory.open !== "function") return null;
  return {
    async get(key) {
      const db = await openVaultDb(idbFactory);
      if (!db) throw new Error("IndexedDB unavailable");
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(VAULT_IDB_STORE, "readonly");
          const req = tx.objectStore(VAULT_IDB_STORE).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
        });
      } finally {
        try {
          db.close?.();
        } catch {
          // ignore close errors
        }
      }
    },
    async set(key, value) {
      const db = await openVaultDb(idbFactory);
      if (!db) throw new Error("IndexedDB unavailable");
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(VAULT_IDB_STORE, "readwrite");
          tx.objectStore(VAULT_IDB_STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
          tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
        });
      } finally {
        try {
          db.close?.();
        } catch {
          // ignore close errors
        }
      }
    }
  };
}

function resolveIdbAdapter(options = {}) {
  if ("idbAdapter" in options) return options.idbAdapter;
  return createNativeIdbAdapter(resolveIndexedDb(options));
}

/**
 * Checks synchronously whether legacy `localStorage` vault arrays still exist or migration completed.
 */
export function hasPendingLegacyVault(options = {}) {
  const storage = resolveStorage(options);
  if (!storage || typeof storage.getItem !== "function") return false;
  try {
    if (storage.getItem(VAULT_MIGRATION_FLAG) === "1") return false;
    return Boolean(storage.getItem("watchedMovies") || storage.getItem("watchlist"));
  } catch {
    return false;
  }
}

/**
 * Loads `watchedMovies` and `watchlist` from IndexedDB, performing a lossless one-time
 * migration from legacy `localStorage` keys when needed.
 */
export async function loadVaultFromStorage(options = {}) {
  const storage = resolveStorage(options);
  const idb = resolveIdbAdapter(options);

  let migratedFlag = false;
  try {
    migratedFlag = storage?.getItem?.(VAULT_MIGRATION_FLAG) === "1";
  } catch {
    migratedFlag = false;
  }

  const legacyWatched = parseLegacyArray(storage, "watchedMovies");
  const legacyWatchlist = parseLegacyArray(storage, "watchlist");
  const legacyLists = parseLegacyArray(storage, "cinemavault_custom_lists_v1");

  if (migratedFlag && idb) {
    try {
      const [idbWatched, idbWatchlist, idbLists] = await Promise.all([
        idb.get("watchedMovies"),
        idb.get("watchlist"),
        idb.get("customLists")
      ]);
      return {
        watched: Array.isArray(idbWatched) ? idbWatched : [],
        watchlist: Array.isArray(idbWatchlist) ? idbWatchlist : [],
        customLists: Array.isArray(idbLists) ? idbLists : [],
        source: "idb"
      };
    } catch {
      // Fall through to memory/localStorage fallback
    }
  }

  if (!migratedFlag && idb) {
    const initialWatched = Array.isArray(legacyWatched) ? legacyWatched : [];
    const initialWatchlist = Array.isArray(legacyWatchlist) ? legacyWatchlist : [];

    try {
      const [existingIdbWatched, existingIdbWatchlist] = await Promise.all([
        idb.get("watchedMovies"),
        idb.get("watchlist")
      ]);

      const nextWatched =
        initialWatched.length > 0
          ? initialWatched
          : (Array.isArray(existingIdbWatched) ? existingIdbWatched : []);
      const nextWatchlist =
        initialWatchlist.length > 0
          ? initialWatchlist
          : (Array.isArray(existingIdbWatchlist) ? existingIdbWatchlist : []);

      await idb.set("watchedMovies", nextWatched);
      await idb.set("watchlist", nextWatchlist);

      const [verifiedWatched, verifiedWatchlist] = await Promise.all([
        idb.get("watchedMovies"),
        idb.get("watchlist")
      ]);

      const verified =
        Array.isArray(verifiedWatched) &&
        verifiedWatched.length === nextWatched.length &&
        Array.isArray(verifiedWatchlist) &&
        verifiedWatchlist.length === nextWatchlist.length;

      if (verified) {
        try {
          storage?.setItem?.(VAULT_MIGRATION_FLAG, "1");
          storage?.removeItem?.("watchedMovies");
          storage?.removeItem?.("watchlist");
        } catch {
          // Ignore storage flag errors; IDB already holds the verified data
        }
        return {
          watched: nextWatched,
          watchlist: nextWatchlist,
          customLists: Array.isArray(legacyLists) ? legacyLists : [],
          source: legacyWatched !== null || legacyWatchlist !== null ? "migrated" : "idb"
        };
      }
    } catch {
      // Migration failed mid-flight; preserve legacy localStorage untouched
    }
  }

  if (legacyWatched !== null || legacyWatchlist !== null) {
    return {
      watched: legacyWatched || [],
      watchlist: legacyWatchlist || [],
      customLists: legacyLists || [],
      source: "localStorage"
    };
  }

  const memWatched = memoryFallbackStore.get("watchedMovies");
  const memWatchlist = memoryFallbackStore.get("watchlist");
  const memLists = memoryFallbackStore.get("customLists");
  if (Array.isArray(memWatched) || Array.isArray(memWatchlist)) {
    return {
      watched: Array.isArray(memWatched) ? memWatched : [],
      watchlist: Array.isArray(memWatchlist) ? memWatchlist : [],
      customLists: Array.isArray(memLists) ? memLists : [],
      source: "memory"
    };
  }

  return {
    watched: [],
    watchlist: [],
    customLists: Array.isArray(legacyLists) ? legacyLists : [],
    source: idb ? "idb" : "localStorage"
  };
}

/**
 * Persists a full uncompacted vault slice (`watchedMovies` | `watchlist` | `customLists`) to IndexedDB,
 * falling back cleanly to `safeSetStorageItem` or in-memory storage when IDB is unavailable.
 */
export async function saveVaultSlice(key, items, options = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  memoryFallbackStore.set(key, safeItems);

  const idb = resolveIdbAdapter(options);
  if (idb) {
    try {
      await idb.set(key, safeItems);
      return { ok: true, backend: "idb" };
    } catch {
      // Fall through to localStorage/memory fallback
    }
  }

  const storage = resolveStorage(options);
  if (storage) {
    const ok = safeSetStorageItem(key, safeItems, { storage, logger: options.logger });
    if (ok) {
      return { ok: true, backend: "localStorage" };
    }
  }

  return { ok: true, backend: "memory" };
}

/**
 * Merges asynchronously hydrated IDB records with any in-memory mutations made before
 * hydration completed, keeping pre-hydration edits authoritative.
 */
export function mergeHydratedVaultSlice(
  currentItems = [],
  hydratedItems = [],
  dirtyBeforeHydration = false
) {
  const current = Array.isArray(currentItems) ? currentItems : [];
  const hydrated = Array.isArray(hydratedItems) ? hydratedItems : [];

  if (!dirtyBeforeHydration) {
    return hydrated;
  }

  const merged = [...current];
  for (const item of hydrated) {
    if (!item) continue;
    if (!merged.some((existing) => isSameMovie(existing, item))) {
      merged.push(item);
    }
  }
  return merged;
}
