import { getSupabaseClient } from "./supabaseClient.js";

export const EXPLORE_FOR_YOU_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDB_NAME = "cinemavault_explore_for_you_v1";
const IDB_STORE = "pools";
const MAX_CACHED_ITEMS = 120;
const MAX_LOCAL_POOLS = 5;

const memoryFallbackStore = new Map();

function compactNumericIdList(list, maxLen) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const val of list) {
    const num = Number(val);
    if (Number.isSafeInteger(num) && num > 0 && !seen.has(num)) {
      seen.add(num);
      out.push(num);
      if (out.length >= maxLen) break;
    }
  }
  return out;
}

export function compactForYouItemForCache(movie) {
  if (!movie || typeof movie !== "object") return null;
  const tmdbId = Number(movie.tmdbId || movie.id);
  return {
    id: movie.id || movie.imdbID || (Number.isFinite(tmdbId) ? `tmdb_${tmdbId}` : ""),
    imdbID: movie.imdbID || (Number.isFinite(tmdbId) ? `tmdb_${tmdbId}` : ""),
    tmdbId: Number.isFinite(tmdbId) ? tmdbId : null,
    title: movie.title || movie.Title || "Untitled",
    year: movie.year || "",
    release_date: movie.release_date || "",
    poster: movie.poster || movie.Poster || null,
    genre: movie.genre || "",
    tmdbGenreIds: Array.isArray(movie.tmdbGenreIds)
      ? movie.tmdbGenreIds.map(Number).filter(Number.isFinite)
      : [],
    imdbRating: movie.imdbRating ?? "N/A",
    vote_average: Number(movie.vote_average) || 0,
    vote_count: Number(movie.vote_count) || 0,
    popularity: Number(movie.popularity) || 0,
    runtime: Number(movie.runtime) || null,
    original_language: movie.original_language || "",
    originCountry: Array.isArray(movie.originCountry) ? movie.originCountry.slice(0, 4) : [],
    personIds: compactNumericIdList(movie.personIds, 20),
    keywordIds: compactNumericIdList(movie.keywordIds, 25),
    providerIds: compactNumericIdList(movie.providerIds, 20),
    forYouScore: Number(movie.forYouScore ?? movie.matchScore) || 72,
    matchScore: Number(movie.matchScore ?? movie.forYouScore) || 72,
    vibeTag: typeof movie.vibeTag === "string" ? movie.vibeTag.slice(0, 40) : "",
    forYouReason: typeof movie.forYouReason === "string" ? movie.forYouReason.slice(0, 140) : ""
  };
}

function openExploreDb() {
  if (typeof indexedDB === "undefined" || !indexedDB) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function pruneMemoryStore() {
  if (memoryFallbackStore.size <= MAX_LOCAL_POOLS) return;
  const entries = [...memoryFallbackStore.entries()].sort(
    (a, b) => Number(b[1]?.generatedAt || 0) - Number(a[1]?.generatedAt || 0)
  );
  memoryFallbackStore.clear();
  for (const [k, v] of entries.slice(0, MAX_LOCAL_POOLS)) {
    memoryFallbackStore.set(k, v);
  }
}

async function readLocalRecord(profileHash) {
  const db = await openExploreDb();
  if (!db) {
    return memoryFallbackStore.get(profileHash) || null;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(profileHash);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(memoryFallbackStore.get(profileHash) || null);
    } catch {
      resolve(memoryFallbackStore.get(profileHash) || null);
    }
  });
}

async function writeLocalRecord(profileHash, record) {
  memoryFallbackStore.set(profileHash, record);
  pruneMemoryStore();

  const db = await openExploreDb();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      store.put(record, profileHash);

      // Prune oldest records if store exceeds MAX_LOCAL_POOLS
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = Array.isArray(keysReq.result) ? keysReq.result : [];
        if (keys.length > MAX_LOCAL_POOLS) {
          const allReq = store.getAll();
          allReq.onsuccess = () => {
            const vals = Array.isArray(allReq.result) ? allReq.result : [];
            const pairs = keys.map((k, idx) => ({
              key: k,
              ts: Number(vals[idx]?.generatedAt || 0)
            }));
            pairs.sort((a, b) => b.ts - a.ts);
            for (const stale of pairs.slice(MAX_LOCAL_POOLS)) {
              store.delete(stale.key);
            }
          };
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearAllLocalRecords() {
  memoryFallbackStore.clear();
  const db = await openExploreDb();
  if (!db) return;
  await new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function isFreshRecord(record, profileHash, now) {
  if (!record || !Array.isArray(record.items) || record.items.length === 0) return false;
  if (record.profileHash !== profileHash) return false;
  const ts = Number(record.generatedAt) || 0;
  return ts > 0 && now - ts < EXPLORE_FOR_YOU_TTL_MS;
}

/**
 * Loads cached Explore For You pool from IndexedDB first, falling back to optional
 * Supabase cloud cache for authenticated non-sample users.
 */
export async function loadExploreForYouCache({
  profileHash,
  userId = null,
  hasSampleData = false,
  supabaseClient = undefined,
  now = Date.now()
} = {}) {
  if (!profileHash) return null;

  const local = await readLocalRecord(profileHash);
  if (isFreshRecord(local, profileHash, now)) {
    return {
      items: local.items,
      source: local.source || "local-ranker",
      modelUsed: local.modelUsed || null,
      generatedAt: local.generatedAt,
      from: "local"
    };
  }

  if (!userId || hasSampleData) return null;
  const supabase = supabaseClient !== undefined ? supabaseClient : getSupabaseClient();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("user_explore_picks")
      .select("profile_hash, source, model_used, items, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data || data.profile_hash !== profileHash || !Array.isArray(data.items) || data.items.length === 0) {
      return null;
    }

    const updatedMs = Date.parse(data.updated_at || "") || now;
    if (now - updatedMs >= EXPLORE_FOR_YOU_TTL_MS) {
      return null;
    }

    const hydrated = {
      profileHash,
      items: data.items,
      source: data.source || "local-ranker",
      modelUsed: data.model_used || null,
      generatedAt: updatedMs
    };
    await writeLocalRecord(profileHash, hydrated);
    return { ...hydrated, from: "supabase" };
  } catch {
    return null;
  }
}

/**
 * Persists a compact Explore For You pool into IndexedDB and (for authenticated
 * non-sample users) upserts it to Supabase `user_explore_picks`.
 */
export async function saveExploreForYouCache({
  profileHash,
  items = [],
  source = "local-ranker",
  modelUsed = null,
  generatedAt = Date.now(),
  userId = null,
  hasSampleData = false,
  supabaseClient = undefined
} = {}) {
  if (!profileHash || !Array.isArray(items) || items.length === 0) return;

  const compactItems = items
    .slice(0, MAX_CACHED_ITEMS)
    .map(compactForYouItemForCache)
    .filter(Boolean);

  if (compactItems.length === 0) return;

  await writeLocalRecord(profileHash, {
    profileHash,
    items: compactItems,
    source,
    modelUsed,
    generatedAt
  });

  if (!userId || hasSampleData) return;
  const supabase = supabaseClient !== undefined ? supabaseClient : getSupabaseClient();
  if (!supabase) return;

  try {
    await supabase
      .from("user_explore_picks")
      .upsert(
        {
          user_id: userId,
          profile_hash: profileHash,
          source,
          model_used: modelUsed,
          items: compactItems
        },
        { onConflict: "user_id" }
      );
  } catch {
    // Non-fatal: local IndexedDB cache still succeeds cleanly
  }
}

export async function clearExploreForYouCache() {
  await clearAllLocalRecords();
}
