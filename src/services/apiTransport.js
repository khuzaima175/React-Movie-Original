export const USER_GEMINI_KEY_STORAGE = "cv_user_gemini_key";

function readConfiguredKey(name, envOverride = null) {
  const key = envOverride
    ? envOverride[name]
    : (import.meta.env?.[name] || globalThis.process?.env?.[name]);
  if (!key || key === "undefined" || key === "null" || String(key).trim() === "") {
    return "";
  }
  return String(key).trim();
}

function resolveBrowserStorage(storageOverride) {
  if (storageOverride !== undefined) return storageOverride;
  try {
    if (typeof globalThis.localStorage !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function getUserGeminiKey(storage = resolveBrowserStorage()) {
  if (!storage || typeof storage.getItem !== "function") return "";
  try {
    const val = storage.getItem(USER_GEMINI_KEY_STORAGE);
    return typeof val === "string" ? val.trim() : "";
  } catch {
    return "";
  }
}

export function setUserGeminiKey(key = "", storage = resolveBrowserStorage()) {
  const cleaned = typeof key === "string" ? key.trim() : "";
  if (!storage) return cleaned;
  try {
    if (cleaned) {
      storage.setItem?.(USER_GEMINI_KEY_STORAGE, cleaned);
    } else {
      storage.removeItem?.(USER_GEMINI_KEY_STORAGE);
    }
  } catch {
    // ignore storage errors
  }
  return cleaned;
}

export function hasUserGeminiKey(storage = resolveBrowserStorage()) {
  return Boolean(getUserGeminiKey(storage));
}

export function isBrowserRuntime() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function resolveTmdbKey() {
  return readConfiguredKey("VITE_TMDB_KEY");
}

export function resolveOmdbKey() {
  return readConfiguredKey("VITE_OMDB_KEY");
}

export function resolveGeminiKey(options = {}) {
  const userKey = getUserGeminiKey(options?.storage);
  if (userKey) return userKey;
  return readConfiguredKey("VITE_GEMINI_KEY", options?.env || null);
}

export function hasTmdbBackend(options = {}) {
  if (typeof options.apiKey === "string" && options.apiKey.trim()) return true;
  if (resolveTmdbKey()) return true;
  if (options.forceProxy === true) return true;
  return isBrowserRuntime() && options.forceProxy !== false;
}

export function hasOmdbBackend(options = {}) {
  if (typeof options.apiKey === "string" && options.apiKey.trim()) return true;
  if (resolveOmdbKey()) return true;
  if (options.forceProxy === true) return true;
  return isBrowserRuntime() && options.forceProxy !== false;
}

export function hasGeminiBackend(options = {}) {
  if (typeof options.apiKey === "string" && options.apiKey.trim()) return true;
  if (resolveGeminiKey()) return true;
  if (options.useProxy === true) return true;
  return isBrowserRuntime() && options.useProxy !== false;
}

function buildSearchParams(queryParams = {}, stripKeys = []) {
  const params = new URLSearchParams();
  const stripped = new Set(stripKeys);
  if (!queryParams || typeof queryParams !== "object") return params;
  for (const [k, v] of Object.entries(queryParams)) {
    if (stripped.has(k) || v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  return params;
}

/**
 * Fetch JSON from TMDB directly when a client dev key exists, or via /api/tmdb in browser production.
 */
export async function fetchTmdbJson(path, queryParams = {}, options = {}) {
  if (!path || typeof path !== "string") return null;
  const apiKey = options.apiKey !== undefined ? String(options.apiKey || "").trim() : resolveTmdbKey();
  const useProxy = !apiKey && (options.forceProxy === true || (isBrowserRuntime() && options.forceProxy !== false));
  if (!apiKey && !useProxy) {
    return null;
  }

  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : fetch;
  const params = buildSearchParams(queryParams, ["api_key", "path"]);

  let url;
  if (apiKey) {
    params.set("api_key", apiKey);
    const qs = params.toString();
    url = `https://api.themoviedb.org${path}${qs ? `?${qs}` : ""}`;
  } else {
    const proxyParams = new URLSearchParams({ path });
    for (const [k, v] of params.entries()) {
      proxyParams.set(k, v);
    }
    url = `/api/tmdb?${proxyParams.toString()}`;
  }

  const res = await fetchFn(url, {
    cache: "no-store",
    ...(options.signal ? { signal: options.signal } : {})
  });
  if (!res || !res.ok) {
    if (res && typeof options.onHttpError === "function") {
      options.onHttpError(res.status, res);
    }
    return null;
  }
  return await res.json();
}

/**
 * Fetch JSON from OMDb directly when a client dev key exists, or via /api/omdb in browser production.
 */
export async function fetchOmdbJson(queryParams = {}, options = {}) {
  const apiKey = options.apiKey !== undefined ? String(options.apiKey || "").trim() : resolveOmdbKey();
  const useProxy = !apiKey && (options.forceProxy === true || (isBrowserRuntime() && options.forceProxy !== false));
  if (!apiKey && !useProxy) {
    return null;
  }

  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : fetch;
  const params = buildSearchParams(queryParams, ["apikey"]);

  let url;
  if (apiKey) {
    params.set("apikey", apiKey);
    url = `https://www.omdbapi.com/?${params.toString()}`;
  } else {
    url = `/api/omdb?${params.toString()}`;
  }

  const res = await fetchFn(url, {
    cache: "no-store",
    ...(options.signal ? { signal: options.signal } : {})
  });
  if (!res || !res.ok) {
    if (res && typeof options.onHttpError === "function") {
      options.onHttpError(res.status, res);
    }
    return null;
  }
  return await res.json();
}

/**
 * GoogleGenAI-compatible client adapter that routes generateContent through /api/gemini.
 */
export function createProxyGeminiClient(options = {}) {
  const endpoint = options.endpoint || "/api/gemini";
  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : fetch;

  return {
    isProxy: true,
    models: {
      async generateContent({ model, contents, config } = {}) {
        const { abortSignal, ...serializableConfig } = config || {};
        const res = await fetchFn(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, contents, config: serializableConfig }),
          signal: abortSignal || options.signal
        });

        let data = null;
        try {
          data = await res.json();
        } catch (_) {
          data = null;
        }

        if (!res || !res.ok) {
          const message = data?.error?.message || data?.error || `Gemini proxy error (HTTP ${res?.status ?? 500})`;
          const rawRetryAfter =
            typeof res?.headers?.get === "function"
              ? (res.headers.get("Retry-After") ?? res.headers.get("retry-after"))
              : (res?.headers?.["Retry-After"] ?? res?.headers?.["retry-after"] ?? null);
          const retryAfter =
            rawRetryAfter !== undefined && rawRetryAfter !== null && String(rawRetryAfter).trim() !== ""
              ? String(rawRetryAfter).trim()
              : null;
          const errorCode = data?.errorCode || data?.error?.errorCode || null;
          throw Object.assign(new Error(message), {
            status: res?.status,
            error: data?.error,
            ...(errorCode ? { errorCode } : {}),
            ...(retryAfter !== null ? { retryAfter } : {})
          });
        }

        return {
          text: data?.text ?? "",
          usageMetadata: data?.usageMetadata ?? null
        };
      }
    }
  };
}

const TMDB_CACHE_DB_NAME = "cinemavault_tmdb_cache_v1";
const TMDB_CACHE_STORE = "movie_details";
export const TMDB_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TMDB_BATCH_LIMIT = 40;
const TMDB_DIRECT_CONCURRENCY = 6;
const TMDB_DETAILS_APPEND = "videos,credits,external_ids,keywords,watch/providers,release_dates";

function openTmdbCacheDb(idbFactory) {
  if (!idbFactory || typeof idbFactory.open !== "function") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = idbFactory.open(TMDB_CACHE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db && !db.objectStoreNames?.contains?.(TMDB_CACHE_STORE)) {
          db.createObjectStore(TMDB_CACHE_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

function runIdbRequest(req) {
  return new Promise((resolve) => {
    if (!req) {
      resolve(null);
      return;
    }
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

function isValidCachedRecord(record, now) {
  if (!record || typeof record !== "object") return false;
  const data = record.data;
  if (!data || typeof data !== "object" || Number(data.id) <= 0) return false;
  if (!Number.isFinite(record.cachedAt)) return false;
  return now - record.cachedAt < TMDB_CACHE_TTL_MS;
}

async function readCachedMovieDetails(ids, options = {}) {
  const hits = {};
  if (!Array.isArray(ids) || ids.length === 0 || options.bypassCache === true) {
    return hits;
  }
  const now = Number.isFinite(options.now) ? options.now : Date.now();

  if (options.cacheStore && typeof options.cacheStore.get === "function") {
    for (const id of ids) {
      try {
        const rec = await options.cacheStore.get(`tmdb:${id}`);
        if (isValidCachedRecord(rec, now)) {
          hits[id] = rec.data;
        }
      } catch (_) {
        // ignore cache read failures
      }
    }
    return hits;
  }

  const idbFactory = options.indexedDB ?? (typeof indexedDB !== "undefined" ? indexedDB : null);
  const db = await openTmdbCacheDb(idbFactory);
  if (!db) return hits;

  try {
    const tx = db.transaction(TMDB_CACHE_STORE, "readonly");
    const store = tx.objectStore(TMDB_CACHE_STORE);
    const records = await Promise.all(ids.map((id) => runIdbRequest(store.get(`tmdb:${id}`))));
    ids.forEach((id, idx) => {
      if (isValidCachedRecord(records[idx], now)) {
        hits[id] = records[idx].data;
      }
    });
  } catch (_) {
    // ignore IndexedDB runtime failures (e.g. private browsing)
  } finally {
    try {
      db.close?.();
    } catch (_) {
      // ignore
    }
  }
  return hits;
}

async function writeCachedMovieDetails(entriesById, options = {}) {
  if (!entriesById || typeof entriesById !== "object") return;
  const validEntries = Object.entries(entriesById).filter(
    ([, data]) => data && typeof data === "object" && Number(data.id) > 0
  );
  if (validEntries.length === 0) return;

  const now = Number.isFinite(options.now) ? options.now : Date.now();

  if (options.cacheStore && typeof options.cacheStore.set === "function") {
    for (const [id, data] of validEntries) {
      try {
        await options.cacheStore.set(`tmdb:${id}`, { key: `tmdb:${id}`, data, cachedAt: now });
      } catch (_) {
        // ignore cache write failures
      }
    }
    return;
  }

  const idbFactory = options.indexedDB ?? (typeof indexedDB !== "undefined" ? indexedDB : null);
  const db = await openTmdbCacheDb(idbFactory);
  if (!db) return;

  try {
    await new Promise((resolve) => {
      const tx = db.transaction(TMDB_CACHE_STORE, "readwrite");
      const store = tx.objectStore(TMDB_CACHE_STORE);
      for (const [id, data] of validEntries) {
        store.put({ key: `tmdb:${id}`, data, cachedAt: now });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch (_) {
    // ignore IndexedDB write failures
  } finally {
    try {
      db.close?.();
    } catch (_) {
      // ignore
    }
  }
}

async function mapPool(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        await worker(items[idx], idx);
      }
    })
  );
}

/**
 * Batch-fetches full TMDB movie details (append_to_response) backed by a 30-day IndexedDB cache.
 * Uses /api/tmdb-batch (40 IDs/request) in proxy mode and concurrency-6 direct fetches in dev mode.
 */
export async function getMovieDetailsBatch(ids = [], options = {}) {
  const seen = new Set();
  const normalizedIds = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = Number(raw);
    if (Number.isSafeInteger(id) && id > 0 && !seen.has(id)) {
      seen.add(id);
      normalizedIds.push(id);
    }
  }
  if (normalizedIds.length === 0) return {};

  const cachedHits = await readCachedMovieDetails(normalizedIds, options);
  const results = { ...cachedHits };
  const missingIds = normalizedIds.filter((id) => results[id] === undefined);
  if (missingIds.length === 0) return results;

  const apiKey = options.apiKey !== undefined ? String(options.apiKey || "").trim() : resolveTmdbKey();
  const useProxy = !apiKey && (options.forceProxy === true || (isBrowserRuntime() && options.forceProxy !== false));
  if (!apiKey && !useProxy) {
    return results;
  }

  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : fetch;
  const language = typeof options.language === "string" && options.language.trim() ? options.language.trim() : "en-US";
  const newlyFetched = {};

  if (apiKey) {
    const concurrency = Math.max(1, Number(options.concurrency) || TMDB_DIRECT_CONCURRENCY);
    await mapPool(missingIds, concurrency, async (id) => {
      try {
        const data = await fetchTmdbJson(
          `/3/movie/${id}`,
          { append_to_response: TMDB_DETAILS_APPEND, language },
          { ...options, apiKey, fetchFn }
        );
        if (data && typeof data === "object" && Number(data.id) > 0) {
          results[id] = data;
          newlyFetched[id] = data;
        }
      } catch (_) {
        // leave unhydrated; never cache failures
      }
    });
  } else {
    for (let i = 0; i < missingIds.length; i += TMDB_BATCH_LIMIT) {
      const chunk = missingIds.slice(i, i + TMDB_BATCH_LIMIT);
      const params = new URLSearchParams({
        ids: chunk.join(","),
        language
      });
      try {
        const res = await fetchFn(`/api/tmdb-batch?${params.toString()}`, {
          cache: "no-store",
          ...(options.signal ? { signal: options.signal } : {})
        });
        if (!res || !res.ok) {
          if (res && typeof options.onHttpError === "function") {
            options.onHttpError(res.status, res);
          }
          if (res?.status === 429) break;
          continue;
        }
        const payload = await res.json().catch(() => null);
        const batchResults = payload?.results;
        if (!batchResults || typeof batchResults !== "object") continue;
        for (const id of chunk) {
          const movieObj = batchResults[String(id)] ?? batchResults[id];
          if (movieObj && typeof movieObj === "object" && Number(movieObj.id) > 0) {
            results[id] = movieObj;
            newlyFetched[id] = movieObj;
          }
        }
      } catch (_) {
        // never cache failed batch requests
      }
    }
  }

  await writeCachedMovieDetails(newlyFetched, options);
  return results;
}
