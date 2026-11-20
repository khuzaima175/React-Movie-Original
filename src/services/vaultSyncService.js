import { normalizeTasteRules } from "./tasteRulesService.js";

const CORE_SQL_FIELDS = new Set([
  "imdbID",
  "id",
  "tmdbId",
  "title",
  "Title",
  "year",
  "Year",
  "poster",
  "Poster",
  "genre",
  "Genre",
  "director",
  "Director",
  "runtime",
  "Runtime",
  "imdbRating",
  "userRating",
  "userNote",
  "dateWatched",
  "isBulkImported",
  "updatedAt"
]);

const TRANSIENT_API_BLOBS_TO_STRIP = new Set([
  "credits",
  "videos",
  "images",
  "release_dates",
  "external_ids",
  "watch/providers",
  "recommendations",
  "similar",
  "Awards",
  "DVD",
  "Website",
  "Production",
  "Response",
  "Ratings"
]);

const AGGRESSIVE_STORAGE_STRIP_FIELDS = new Set([
  "overview",
  "Plot",
  "plot",
  "tagline",
  "backdrop",
  "Actors",
  "Writer",
  "BoxOffice",
  "cast",
  "writers",
  "keywordItems",
  "directorDetails",
  "writerDetails",
  "cinematographerDetails",
  "composerDetails",
  "streamProviders",
  "freeProviders",
  "spokenLanguages",
  "originCountry"
]);

/**
 * Compacts a single movie record before persisting to browser `localStorage` (`watchedMovies` / `watchlist`)
 * so 2,000–3,000+ enriched vault rows stay well below the ~5 MB browser origin quota.
 * All stripped display/detail fields remain cached in IndexedDB (`tmdbCacheService.js`).
 */
export function compactVaultMovieForStorage(movie, { aggressive = false } = {}) {
  if (!movie || typeof movie !== "object") return movie;
  const out = {};

  for (const [k, v] of Object.entries(movie)) {
    if (v === undefined || v === null) continue;
    if (TRANSIENT_API_BLOBS_TO_STRIP.has(k)) continue;
    if (aggressive && AGGRESSIVE_STORAGE_STRIP_FIELDS.has(k)) continue;
    out[k] = v;
  }

  // Deduplicate casing aliases when canonical lowercase keys exist
  if (out.title && out.Title === out.title) delete out.Title;
  if (out.year && out.Year === out.year) delete out.Year;
  if (out.poster && out.Poster === out.poster) delete out.Poster;
  if (out.genre && out.Genre === out.genre) delete out.Genre;
  if (out.director && out.Director === out.director) delete out.Director;
  if (out.runtime !== undefined && out.Runtime === out.runtime) delete out.Runtime;

  if (!aggressive) {
    if (typeof out.overview === "string" && out.overview.length > 260) {
      out.overview = `${out.overview.slice(0, 257).trimEnd()}...`;
    }
    if (typeof out.Plot === "string") {
      if (out.overview) {
        delete out.Plot;
      } else if (out.Plot.length > 260) {
        out.Plot = `${out.Plot.slice(0, 257).trimEnd()}...`;
      }
    }
    if (typeof out.plot === "string" && out.overview) {
      delete out.plot;
    }
    if (Array.isArray(out.cast) && out.cast.length > 6) out.cast = out.cast.slice(0, 6);
    if (Array.isArray(out.writers) && out.writers.length > 4) out.writers = out.writers.slice(0, 4);
    if (Array.isArray(out.keywordItems) && out.keywordItems.length > 12) out.keywordItems = out.keywordItems.slice(0, 12);
    if (Array.isArray(out.streamProviders) && out.streamProviders.length > 6) {
      out.streamProviders = out.streamProviders.slice(0, 6);
    }
    if (Array.isArray(out.freeProviders) && out.freeProviders.length > 4) {
      out.freeProviders = out.freeProviders.slice(0, 4);
    }
  }

  // Always retain bounded ranker & taste-engine signal arrays
  if (Array.isArray(out.tmdbGenreIds) && out.tmdbGenreIds.length > 8) {
    out.tmdbGenreIds = out.tmdbGenreIds.slice(0, 8);
  }
  if (Array.isArray(out.tmdbKeywords) && out.tmdbKeywords.length > 20) {
    out.tmdbKeywords = out.tmdbKeywords.slice(0, 20);
  }
  if (Array.isArray(out.keywordNames) && out.keywordNames.length > 12) {
    out.keywordNames = out.keywordNames.slice(0, 12);
  }
  if (Array.isArray(out.castIds) && out.castIds.length > 10) {
    out.castIds = out.castIds.slice(0, 10);
  }

  return out;
}

/**
 * Compacts an entire watched or watchlist array for `localStorage` persistence.
 */
export function compactVaultListForStorage(list = [], options = {}) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => compactVaultMovieForStorage(item, options));
}

function normalizeDeletedKeysMap(deletedKeys) {
  const map = new Map();
  if (!deletedKeys) return map;
  if (deletedKeys instanceof Set || Array.isArray(deletedKeys)) {
    for (const entry of deletedKeys) {
      if (typeof entry === "string" && entry.trim()) {
        map.set(entry.trim(), Infinity);
      } else if (entry && typeof entry === "object" && entry.key) {
        const ts = parseTimestampMs(entry.deletedAt);
        map.set(String(entry.key).trim(), ts > 0 ? ts : Infinity);
      }
    }
    return map;
  }
  if (deletedKeys instanceof Map) {
    for (const [k, v] of deletedKeys.entries()) {
      if (!k) continue;
      const ts = typeof v === "number" ? v : parseTimestampMs(v);
      map.set(String(k).trim(), ts > 0 ? ts : Infinity);
    }
    return map;
  }
  if (typeof deletedKeys === "object") {
    for (const [k, v] of Object.entries(deletedKeys)) {
      if (!k) continue;
      const ts = typeof v === "number" ? v : parseTimestampMs(v);
      map.set(String(k).trim(), ts > 0 ? ts : Infinity);
    }
  }
  return map;
}

function parseRuntimeMinutes(rawRuntime) {
  if (rawRuntime === null || rawRuntime === undefined || rawRuntime === "N/A") return null;
  if (typeof rawRuntime === "number") return Number.isFinite(rawRuntime) && rawRuntime > 0 ? Math.round(rawRuntime) : null;
  const match = String(rawRuntime).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function parseTimestampMs(rawIso) {
  if (!rawIso) return 0;
  const ms = Date.parse(rawIso);
  return Number.isFinite(ms) ? ms : 0;
}

function sanitizeIsoTimestamp(rawIso, fallback = null) {
  if (!rawIso || typeof rawIso !== "string") return fallback;
  const trimmed = rawIso.trim();
  if (!trimmed) return fallback;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function sanitizePositiveInt(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;
  const num = Number(rawValue);
  return Number.isInteger(num) && num > 0 ? num : null;
}

/**
 * Derives the deterministic cross-device key for a movie record.
 */
export function getCanonicalMovieKey(movie = {}) {
  const imdb = String(movie.imdbID || "").trim();
  if (imdb) return imdb;
  const tmdb = Number(movie.tmdbId);
  if (Number.isFinite(tmdb) && tmdb > 0) return `tmdb_${tmdb}`;
  const fallbackId = String(movie.id || "").trim();
  if (fallbackId) return fallbackId;
  const title = String(movie.title || movie.Title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  const year = String(movie.year || movie.Year || "").replace(/\D/g, "").slice(0, 4);
  return title ? `local_${title}${year ? `_${year}` : ""}` : "";
}

/**
 * Maps a local watched or watchlist movie object into a Postgres public.user_vault_items row.
 */
export function mapLocalMovieToDbRow(
  movie = {},
  status = "watched",
  userId = "",
  nowIso = new Date().toISOString()
) {
  const movieKey = getCanonicalMovieKey(movie);
  const metadata = {};
  for (const [k, v] of Object.entries(movie)) {
    if (!CORE_SQL_FIELDS.has(k) && v !== undefined && v !== null) {
      metadata[k] = v;
    }
  }

  const parsedRating = Number(movie.userRating);
  const userRating = Number.isFinite(parsedRating) && parsedRating >= 0 && parsedRating <= 10
    ? Math.round(parsedRating)
    : (status === "watched" ? 0 : null);

  const parsedImdbRating = Number(movie.imdbRating);
  const imdbRating = Number.isFinite(parsedImdbRating) && parsedImdbRating > 0 && parsedImdbRating <= 99.9
    ? Number(parsedImdbRating.toFixed(1))
    : null;

  const safeUpdatedAt = sanitizeIsoTimestamp(
    movie.updatedAt,
    sanitizeIsoTimestamp(nowIso, new Date().toISOString())
  );

  return {
    ...(userId ? { user_id: userId } : {}),
    movie_key: movieKey,
    status: status === "watchlist" ? "watchlist" : "watched",
    tmdb_id: sanitizePositiveInt(movie.tmdbId),
    imdb_id: movie.imdbID || (/^tt\d+$/i.test(movieKey) ? movieKey : null),
    title: movie.title || movie.Title || "Untitled",
    year: String(movie.year || movie.Year || ""),
    poster: movie.poster || movie.Poster || null,
    genre: movie.genre || movie.Genre || null,
    director: movie.director || movie.Director || null,
    runtime: parseRuntimeMinutes(movie.runtime ?? movie.Runtime),
    imdb_rating: imdbRating,
    user_rating: userRating,
    user_note: movie.userNote || null,
    date_watched: sanitizeIsoTimestamp(movie.dateWatched, null),
    is_bulk_imported: Boolean(movie.isBulkImported),
    metadata,
    updated_at: safeUpdatedAt
  };
}

/**
 * Converts a Postgres user_vault_items row back into the local CinemaVault object format.
 */
export function mapDbRowToLocalMovie(row = {}) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const imdbID = row.imdb_id || row.movie_key;

  return {
    ...meta,
    imdbID,
    id: imdbID,
    ...(row.tmdb_id ? { tmdbId: row.tmdb_id } : {}),
    title: row.title || "Untitled",
    year: row.year || "",
    poster: row.poster || "N/A",
    ...(row.genre ? { genre: row.genre } : {}),
    ...(row.director ? { director: row.director } : {}),
    ...(row.runtime != null ? { runtime: row.runtime } : {}),
    ...(row.imdb_rating != null ? { imdbRating: Number(row.imdb_rating) } : {}),
    userRating: row.user_rating != null ? Number(row.user_rating) : 0,
    ...(row.user_note ? { userNote: row.user_note } : {}),
    ...(row.date_watched ? { dateWatched: row.date_watched } : {}),
    ...(row.is_bulk_imported ? { isBulkImported: true } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {})
  };
}

/**
 * Losslessly merges local guest lists with cloud rows:
 * - Never discards local-only guest ratings (unless deleted on another device after `lastSyncedAt`
 *   or recorded in `deletedKeys` tombstones)
 * - Always grants "watched" precedence over "watchlist"
 * - Uses updatedAt / updated_at timestamps for watched conflict resolution
 */
export function mergeLocalAndCloudVault({
  localWatched = [],
  localWatchlist = [],
  cloudRows = [],
  userId = "",
  nowIso = new Date().toISOString(),
  deletedKeys = null,
  lastSyncedAt = null
} = {}) {
  const deletedMap = normalizeDeletedKeysMap(deletedKeys);
  const lastSyncedMs = parseTimestampMs(lastSyncedAt);
  const toDeleteCloudSet = new Set();

  const cloudByKey = new Map();
  for (const row of cloudRows || []) {
    if (!row?.movie_key) continue;
    const delMs = deletedMap.get(row.movie_key);
    const cloudMs = parseTimestampMs(row.updated_at);
    if (delMs !== undefined && (delMs === Infinity || delMs >= cloudMs)) {
      toDeleteCloudSet.add(row.movie_key);
      continue;
    }
    cloudByKey.set(row.movie_key, row);
  }

  const resolvedWatchedMap = new Map();
  const resolvedWatchlistMap = new Map();
  const toUpsertMap = new Map();

  for (const localMovie of localWatched || []) {
    if (localMovie?.isSample) continue;
    const key = getCanonicalMovieKey(localMovie);
    if (!key) continue;
    const localMs = parseTimestampMs(localMovie.updatedAt || localMovie.dateWatched || localMovie.dateAdded);
    const delMs = deletedMap.get(key);
    if (delMs !== undefined && (delMs === Infinity || delMs >= localMs)) {
      continue;
    }

    const cloudRow = cloudByKey.get(key);

    if (!cloudRow) {
      // If this device previously synced at `lastSyncedAt` and this local item is older than or
      // equal to `lastSyncedAt`, its absence from `cloudRows` means another device deleted it.
      const wasDeletedRemotely =
        lastSyncedMs > 0 &&
        ((localMs > 0 && localMs <= lastSyncedMs) || Boolean(localMovie.isSyncedToCloud));
      if (wasDeletedRemotely) {
        continue;
      }
      resolvedWatchedMap.set(key, localMovie);
      toUpsertMap.set(key, mapLocalMovieToDbRow(localMovie, "watched", userId, nowIso));
      continue;
    }

    if (cloudRow.status !== "watched") {
      // Local watched overrides cloud watchlist
      resolvedWatchedMap.set(key, localMovie);
      toUpsertMap.set(key, mapLocalMovieToDbRow(localMovie, "watched", userId, nowIso));
      continue;
    }

    const cloudMs = parseTimestampMs(cloudRow.updated_at);
    const localRating = Number(localMovie.userRating) || 0;
    const cloudRating = Number(cloudRow.user_rating) || 0;
    const localHasNewerRating =
      localMs > cloudMs ||
      (localMs === 0 && localRating > 0 && (cloudRating === 0 || localRating !== cloudRating));

    if (localHasNewerRating) {
      const cloudBase = mapDbRowToLocalMovie(cloudRow);
      delete cloudBase.ratingBreakdown;
      delete cloudBase.watchMeta;
      delete cloudBase.userNote;
      const enrichedLocal = { ...cloudBase, ...localMovie };
      resolvedWatchedMap.set(key, enrichedLocal);
      toUpsertMap.set(key, mapLocalMovieToDbRow(enrichedLocal, "watched", userId, nowIso));
    } else {
      const cloudLocal = mapDbRowToLocalMovie(cloudRow);
      if (localMovie.userNote && !cloudLocal.userNote) {
        cloudLocal.userNote = localMovie.userNote;
      }
      if (localMovie.recSource && !cloudLocal.recSource) {
        cloudLocal.recSource = localMovie.recSource;
      }
      resolvedWatchedMap.set(key, cloudLocal);
    }
  }

  for (const row of cloudByKey.values()) {
    if (!row?.movie_key || row.status !== "watched") continue;
    if (!resolvedWatchedMap.has(row.movie_key)) {
      resolvedWatchedMap.set(row.movie_key, mapDbRowToLocalMovie(row));
    }
  }

  for (const localSaved of localWatchlist || []) {
    if (localSaved?.isSample) continue;
    const key = getCanonicalMovieKey(localSaved);
    if (!key || resolvedWatchedMap.has(key)) continue;
    const localMs = parseTimestampMs(localSaved.updatedAt || localSaved.dateAdded || localSaved.dateWatched);
    const delMs = deletedMap.get(key);
    if (delMs !== undefined && (delMs === Infinity || delMs >= localMs)) {
      continue;
    }

    const cloudRow = cloudByKey.get(key);
    if (!cloudRow) {
      const wasDeletedRemotely =
        lastSyncedMs > 0 &&
        ((localMs > 0 && localMs <= lastSyncedMs) || Boolean(localSaved.isSyncedToCloud));
      if (wasDeletedRemotely) {
        continue;
      }
      resolvedWatchlistMap.set(key, localSaved);
      toUpsertMap.set(key, mapLocalMovieToDbRow(localSaved, "watchlist", userId, nowIso));
    } else if (cloudRow.status === "watchlist") {
      const cloudLocal = mapDbRowToLocalMovie(cloudRow);
      if (localSaved.recSource && !cloudLocal.recSource) {
        cloudLocal.recSource = localSaved.recSource;
      }
      resolvedWatchlistMap.set(key, cloudLocal);
    }
  }

  for (const row of cloudByKey.values()) {
    if (!row?.movie_key || row.status !== "watchlist") continue;
    if (resolvedWatchedMap.has(row.movie_key)) continue;
    if (!resolvedWatchlistMap.has(row.movie_key)) {
      resolvedWatchlistMap.set(row.movie_key, mapDbRowToLocalMovie(row));
    }
  }

  return {
    mergedWatched: [...resolvedWatchedMap.values()],
    mergedWatchlist: [...resolvedWatchlistMap.values()],
    toUpsertCloud: [...toUpsertMap.values()],
    ...(toDeleteCloudSet.size > 0 ? { toDeleteCloud: [...toDeleteCloudSet] } : {})
  };
}

/**
 * Fetches all cloud vault rows for the user via keyset pagination on `id`
 * until an empty page is returned. Throws immediately if any page errors so
 * callers skip merging and upserting on partial pulls.
 */
export async function fetchAllVaultRows(client, userIdOrOptions = null, maybeOptions = {}) {
  if (!client || typeof client.from !== "function") {
    throw new Error("Invalid Supabase client provided to fetchAllVaultRows.");
  }

  const opts =
    userIdOrOptions && typeof userIdOrOptions === "object"
      ? userIdOrOptions
      : maybeOptions || {};
  const userId =
    typeof userIdOrOptions === "string" || typeof userIdOrOptions === "number"
      ? userIdOrOptions
      : opts.userId ?? null;
  const pageSize = Math.max(1, Number(opts.pageSize) || 1000);

  const rows = [];
  let lastId = 0;

  while (true) {
    let query = client.from("user_vault_items").select("*");
    if (userId !== null && userId !== undefined && userId !== "") {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query
      .order("id", { ascending: true })
      .gt("id", lastId)
      .limit(pageSize);

    if (error) {
      throw error instanceof Error
        ? error
        : new Error(error?.message || "Failed to fetch cloud vault rows.");
    }

    if (!Array.isArray(data) || data.length === 0) {
      break;
    }

    rows.push(...data);
    const tailId = data[data.length - 1]?.id;
    if (tailId === undefined || tailId === null || tailId <= lastId) {
      break;
    }
    lastId = tailId;
  }

  return rows;
}

/**
 * Pulls all cloud vault rows via keyset pagination, merges with local state, and
 * upserts dirty local entries. Any page error aborts before merging or upserting.
 */
export async function pullAndSyncCloudVault(
  client,
  {
    userId,
    localWatched = [],
    localWatchlist = [],
    nowIso = new Date().toISOString(),
    deletedKeys = null,
    lastSyncedAt = null,
    pageSize = 1000,
    mergeFn = mergeLocalAndCloudVault,
    onMerged = null
  } = {}
) {
  const cloudRows = await fetchAllVaultRows(client, userId, { pageSize });

  const merged = mergeFn({
    localWatched,
    localWatchlist,
    cloudRows,
    userId,
    nowIso,
    deletedKeys,
    lastSyncedAt
  });

  if (typeof onMerged === "function") {
    onMerged(merged);
  }

  const toDeleteCloud = Array.isArray(merged?.toDeleteCloud) ? merged.toDeleteCloud : [];
  if (toDeleteCloud.length > 0 && userId) {
    for (let i = 0; i < toDeleteCloud.length; i += 100) {
      const chunk = toDeleteCloud.slice(i, i + 100);
      const { error: deleteError } = await client
        .from("user_vault_items")
        .delete()
        .eq("user_id", userId)
        .in("movie_key", chunk);
      if (deleteError) throw deleteError;
    }
  }

  const toUpsertCloud = Array.isArray(merged?.toUpsertCloud) ? merged.toUpsertCloud : [];
  for (let i = 0; i < toUpsertCloud.length; i += 100) {
    const chunk = toUpsertCloud.slice(i, i + 100);
    const { error: upsertError } = await client
      .from("user_vault_items")
      .upsert(chunk, { onConflict: "user_id,movie_key" });
    if (upsertError) throw upsertError;
  }

  return merged;
}

function sanitizeProvidersArray(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const num = Number(item);
    if (Number.isSafeInteger(num) && num > 0 && !seen.has(num)) {
      seen.add(num);
      out.push(num);
    }
  }
  return out;
}

function sanitizeTasteRulesArray(list) {
  return normalizeTasteRules(Array.isArray(list) ? list : []);
}

/**
 * Merges local guest/device preferences with a cloud `public.profiles` row.
 * - Preserves non-default local guest preferences on first sign-in while adopting
 *   cloud preferences on fresh devices.
 * - When `localPrefsUpdatedAt` is newer than `cloud.updated_at` (e.g., user intentionally
 *   cleared streaming providers/taste rules or switched back to `GLOBAL` while signed in),
 *   local state wins cleanly without resurrecting cleared cloud fields.
 */
export function mergeProfilePreferences({
  local = {},
  cloud = null,
  lastSyncedAt = null,
  localPrefsUpdatedAt = null
} = {}) {
  const localDisplay = String(local?.displayName || "").trim();
  const localRegion = String(local?.userRegion || "GLOBAL").trim().toUpperCase() || "GLOBAL";
  const localProviders = sanitizeProvidersArray(local?.userWatchProviders);
  const localRules = sanitizeTasteRulesArray(local?.tasteRules);

  if (!cloud || typeof cloud !== "object") {
    return {
      displayName: localDisplay,
      userRegion: localRegion,
      userWatchProviders: localProviders,
      tasteRules: localRules,
      shouldUpsertCloud: true
    };
  }

  const cloudDisplay = String(cloud.display_name || "").trim();
  const cloudRegion = String(cloud.user_region || "GLOBAL").trim().toUpperCase() || "GLOBAL";
  const cloudProviders = sanitizeProvidersArray(cloud.preferred_providers);
  const cloudRules = sanitizeTasteRulesArray(cloud.taste_rules);

  const cloudUpdatedMs = Date.parse(cloud.updated_at || "");
  const lastSyncMs = Date.parse(lastSyncedAt || "");
  const localUpdatedMs = Date.parse(localPrefsUpdatedAt || "");
  const localEditedAfterCloud =
    Number.isFinite(localUpdatedMs) &&
    (!Number.isFinite(cloudUpdatedMs) || localUpdatedMs > cloudUpdatedMs);
  const cloudNewerThanSync =
    Number.isFinite(cloudUpdatedMs) && Number.isFinite(lastSyncMs) && cloudUpdatedMs > lastSyncMs;

  let displayName = cloudDisplay || localDisplay;
  let userRegion = cloudRegion;
  let userWatchProviders = cloudProviders;
  let tasteRules = cloudRules;

  if (localEditedAfterCloud) {
    // Explicit local preference mutation newer than cloud row (including intentional clears to [] / GLOBAL)
    userRegion = localRegion;
    userWatchProviders = localProviders;
    tasteRules = localRules;
    if (localDisplay && !cloudDisplay) {
      displayName = localDisplay;
    }
  } else if (!cloudNewerThanSync) {
    if (localRegion !== "GLOBAL" && cloudRegion === "GLOBAL") {
      userRegion = localRegion;
    } else if (localRegion !== "GLOBAL" && lastSyncedAt) {
      userRegion = localRegion;
    }

    if (localProviders.length > 0 && cloudProviders.length === 0) {
      userWatchProviders = localProviders;
    } else if (localProviders.length > 0 && lastSyncedAt) {
      userWatchProviders = localProviders;
    }

    if (localRules.length > 0 && cloudRules.length === 0) {
      tasteRules = localRules;
    } else if (localRules.length > 0 && lastSyncedAt) {
      tasteRules = localRules;
    }

    if (localDisplay && !cloudDisplay) {
      displayName = localDisplay;
    }
  }

  const shouldUpsertCloud =
    displayName !== cloudDisplay ||
    userRegion !== cloudRegion ||
    JSON.stringify(userWatchProviders) !== JSON.stringify(cloudProviders) ||
    JSON.stringify(tasteRules) !== JSON.stringify(cloudRules);

  return {
    displayName,
    userRegion,
    userWatchProviders,
    tasteRules,
    shouldUpsertCloud
  };
}

/**
 * Pulls `public.profiles` for `userId`, merges with local preferences, and upserts back
 * if the profile row is missing or local preferences are richer/newer.
 */
export async function pullAndSyncProfilePreferences(
  client,
  { userId, localPrefs = {}, lastSyncedAt = null, localPrefsUpdatedAt = null } = {}
) {
  if (!client || !userId) {
    return mergeProfilePreferences({ local: localPrefs, cloud: null, lastSyncedAt, localPrefsUpdatedAt });
  }

  const { data: cloudRow, error: selectError } = await client
    .from("profiles")
    .select("id, display_name, user_region, preferred_providers, taste_rules, updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (selectError) {
    throw selectError instanceof Error
      ? selectError
      : new Error(selectError?.message || "Failed to load cloud profile.");
  }

  const merged = mergeProfilePreferences({
    local: localPrefs,
    cloud: cloudRow || null,
    lastSyncedAt,
    localPrefsUpdatedAt
  });

  if (!cloudRow || merged.shouldUpsertCloud) {
    const { error: upsertError } = await client
      .from("profiles")
      .upsert(
        {
          id: userId,
          display_name: merged.displayName || null,
          user_region: merged.userRegion,
          preferred_providers: merged.userWatchProviders,
          taste_rules: merged.tasteRules
        },
        { onConflict: "id" }
      );
    if (upsertError) {
      throw upsertError instanceof Error
        ? upsertError
        : new Error(upsertError?.message || "Failed to save cloud profile.");
    }
  }

  return merged;
}
