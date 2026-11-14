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
    if (!CORE_SQL_FIELDS.has(k) && v !== undefined) {
      metadata[k] = v;
    }
  }

  const parsedRating = Number(movie.userRating);
  const userRating = Number.isFinite(parsedRating) && parsedRating >= 0 && parsedRating <= 10
    ? Math.round(parsedRating)
    : (status === "watched" ? 0 : null);

  const parsedImdbRating = Number(movie.imdbRating);
  const imdbRating = Number.isFinite(parsedImdbRating) && parsedImdbRating > 0
    ? Number(parsedImdbRating.toFixed(1))
    : null;

  return {
    ...(userId ? { user_id: userId } : {}),
    movie_key: movieKey,
    status: status === "watchlist" ? "watchlist" : "watched",
    tmdb_id: Number(movie.tmdbId) || null,
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
    date_watched: movie.dateWatched || null,
    is_bulk_imported: Boolean(movie.isBulkImported),
    metadata,
    updated_at: movie.updatedAt || nowIso
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
 * - Never discards local-only guest ratings
 * - Always grants "watched" precedence over "watchlist"
 * - Uses updatedAt / updated_at timestamps for watched conflict resolution
 */
export function mergeLocalAndCloudVault({
  localWatched = [],
  localWatchlist = [],
  cloudRows = [],
  userId = "",
  nowIso = new Date().toISOString()
} = {}) {
  const cloudByKey = new Map();
  for (const row of cloudRows || []) {
    if (row?.movie_key) cloudByKey.set(row.movie_key, row);
  }

  const resolvedWatchedMap = new Map();
  const resolvedWatchlistMap = new Map();
  const toUpsertMap = new Map();

  for (const localMovie of localWatched || []) {
    const key = getCanonicalMovieKey(localMovie);
    if (!key) continue;
    const cloudRow = cloudByKey.get(key);

    if (!cloudRow) {
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

    const localMs = parseTimestampMs(localMovie.updatedAt || localMovie.dateWatched);
    const cloudMs = parseTimestampMs(cloudRow.updated_at);
    const localHasNewerRating = localMs > cloudMs;

    if (localHasNewerRating) {
      const enrichedLocal = { ...mapDbRowToLocalMovie(cloudRow), ...localMovie };
      resolvedWatchedMap.set(key, enrichedLocal);
      toUpsertMap.set(key, mapLocalMovieToDbRow(enrichedLocal, "watched", userId, nowIso));
    } else {
      resolvedWatchedMap.set(key, mapDbRowToLocalMovie(cloudRow));
    }
  }

  for (const row of cloudRows || []) {
    if (!row?.movie_key || row.status !== "watched") continue;
    if (!resolvedWatchedMap.has(row.movie_key)) {
      resolvedWatchedMap.set(row.movie_key, mapDbRowToLocalMovie(row));
    }
  }

  for (const localSaved of localWatchlist || []) {
    const key = getCanonicalMovieKey(localSaved);
    if (!key || resolvedWatchedMap.has(key)) continue;

    const cloudRow = cloudByKey.get(key);
    if (!cloudRow) {
      resolvedWatchlistMap.set(key, localSaved);
      toUpsertMap.set(key, mapLocalMovieToDbRow(localSaved, "watchlist", userId, nowIso));
    } else if (cloudRow.status === "watchlist") {
      resolvedWatchlistMap.set(key, mapDbRowToLocalMovie(cloudRow));
    }
  }

  for (const row of cloudRows || []) {
    if (!row?.movie_key || row.status !== "watchlist") continue;
    if (resolvedWatchedMap.has(row.movie_key)) continue;
    if (!resolvedWatchlistMap.has(row.movie_key)) {
      resolvedWatchlistMap.set(row.movie_key, mapDbRowToLocalMovie(row));
    }
  }

  return {
    mergedWatched: [...resolvedWatchedMap.values()],
    mergedWatchlist: [...resolvedWatchlistMap.values()],
    toUpsertCloud: [...toUpsertMap.values()]
  };
}
