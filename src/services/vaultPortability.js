import { buildWatchedRecordFromImport } from "./csvImport.js";

function normalizeIdentityKey(item = {}) {
  const imdb = String(item.imdbID || "").trim().toLowerCase();
  if (imdb) return `imdb:${imdb}`;
  const tmdb = Number(item.tmdbId ?? item.id);
  if (Number.isFinite(tmdb) && tmdb > 0) return `tmdb:${tmdb}`;
  const title = String(item.title || item.Title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const year = String(item.year || item.Year || "").replace(/\D/g, "").slice(0, 4);
  return title ? `ty:${title}::${year}` : "";
}

function escapeCsvCell(value = "") {
  const str = String(value ?? "");
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return `"${str}"`;
}

/**
 * Builds CinemaVault schema v2 JSON backup payload with vault lists and user preferences.
 */
export function buildBackupJsonPayload({
  watched = [],
  watchlist = [],
  userRegion = "US",
  userWatchProviders = [],
  now = Date.now()
} = {}) {
  return {
    schemaVersion: 2,
    app: "CinemaVault",
    exportedAt: new Date(now).toISOString(),
    watched: Array.isArray(watched) ? watched : [],
    watchlist: Array.isArray(watchlist) ? watchlist : [],
    preferences: {
      userRegion,
      userWatchProviders: Array.isArray(userWatchProviders) ? userWatchProviders : []
    }
  };
}

/**
 * Serializes watched and watchlist entries into CinemaVault full CSV or Letterboxd ratings CSV.
 */
export function buildRatingsCsv({
  watched = [],
  watchlist = [],
  format = "cinemavault"
} = {}) {
  if (format === "letterboxd") {
    const header = "Title,Year,Rating10,WatchedDate,Review";
    const ratedLines = (watched || [])
      .filter((movie) => Number(movie?.userRating) > 0)
      .map((movie) => {
        const watchedDay = movie.dateWatched
          ? String(movie.dateWatched).slice(0, 10)
          : "";
        return [
          escapeCsvCell(movie.title || movie.Title || ""),
          escapeCsvCell(movie.year || movie.Year || ""),
          Number(movie.userRating),
          escapeCsvCell(watchedDay),
          escapeCsvCell(movie.userNote || "")
        ].join(",");
      });
    return [header, ...ratedLines].join("\n");
  }

  const header =
    "Title,Year,Type,UserRating,Note,IMDb ID,TMDB ID,Watched Date,Director,Genres,Runtime,IMDb Rating,Poster";

  const formatFullRow = (movie, listType) => {
    const watchedDate = movie.dateWatched ? String(movie.dateWatched).slice(0, 10) : "";
    return [
      escapeCsvCell(movie.title || movie.Title || ""),
      escapeCsvCell(movie.year || movie.Year || ""),
      escapeCsvCell(listType),
      movie.userRating != null ? Number(movie.userRating) : 0,
      escapeCsvCell(movie.userNote || ""),
      escapeCsvCell(movie.imdbID || ""),
      escapeCsvCell(movie.tmdbId || ""),
      escapeCsvCell(watchedDate),
      escapeCsvCell(movie.director || ""),
      escapeCsvCell(movie.genre || ""),
      escapeCsvCell(movie.runtime || ""),
      escapeCsvCell(movie.imdbRating ?? ""),
      escapeCsvCell(movie.poster || movie.Poster || "")
    ].join(",");
  };

  const rows = [
    ...(watched || []).map((movie) => formatFullRow(movie, "Watched")),
    ...(watchlist || []).map((movie) => formatFullRow(movie, "Watchlist"))
  ];
  return [header, ...rows].join("\n");
}

/**
 * Parses v1/v2 backup objects or bare movie rating arrays into normalized lists.
 */
export function parseJsonBackupContent(content = "") {
  const parsed = typeof content === "string" ? JSON.parse(content) : content;

  if (Array.isArray(parsed)) {
    const normalizedWatched = parsed
      .filter((item) => item && (item.title || item.Title))
      .map((item) => ({
        ...item,
        title: item.title || item.Title,
        imdbID: item.imdbID || item.id || (item.tmdbId ? `tmdb_${item.tmdbId}` : `imp_${normalizeIdentityKey(item)}`),
        userRating: Number(item.userRating || item.rating || 0)
      }));
    return { watched: normalizedWatched, watchlist: [] };
  }

  if (parsed && typeof parsed === "object" && (Array.isArray(parsed.watched) || Array.isArray(parsed.watchlist))) {
    return {
      watched: Array.isArray(parsed.watched) ? parsed.watched : [],
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      ...(parsed.preferences && typeof parsed.preferences === "object"
        ? { preferences: parsed.preferences }
        : {})
    };
  }

  throw new Error("Invalid backup JSON schema: expected a ratings array or { watched, watchlist } object.");
}

/**
 * Computes a deterministic pre-commit diff and merged result arrays across import modes.
 */
export function summarizeImportDiff({
  existingWatched = [],
  existingWatchlist = [],
  incomingWatched = [],
  incomingWatchlist = [],
  mode = "merge_update"
} = {}) {
  if (mode === "replace") {
    const watchedMap = new Map();
    for (const item of incomingWatched || []) {
      const key = normalizeIdentityKey(item);
      if (key) watchedMap.set(key, item);
    }
    const mergedWatched = [...watchedMap.values()];
    const mergedWatchlist = [];
    const watchlistSeen = new Set(watchedMap.keys());
    for (const item of incomingWatchlist || []) {
      const key = normalizeIdentityKey(item);
      if (!key || watchlistSeen.has(key)) continue;
      watchlistSeen.add(key);
      mergedWatchlist.push(item);
    }
    return {
      newWatchedCount: mergedWatched.length,
      updatedRatingCount: 0,
      newWatchlistCount: mergedWatchlist.length,
      duplicatesSkipped: 0,
      mergedWatched,
      mergedWatchlist
    };
  }

  const mergedWatched = [...(existingWatched || [])];
  const watchedIndexByKey = new Map();
  mergedWatched.forEach((item, idx) => {
    const key = normalizeIdentityKey(item);
    if (key) watchedIndexByKey.set(key, idx);
  });

  let newWatchedCount = 0;
  let updatedRatingCount = 0;
  let duplicatesSkipped = 0;

  for (const incoming of incomingWatched || []) {
    const key = normalizeIdentityKey(incoming);
    if (!key) continue;

    if (watchedIndexByKey.has(key)) {
      const existingIdx = watchedIndexByKey.get(key);
      const current = mergedWatched[existingIdx];
      const nextRating = Number(incoming.userRating ?? 0);
      const prevRating = Number(current.userRating ?? 0);

      if (mode === "merge_update" && nextRating > 0 && nextRating !== prevRating) {
        mergedWatched[existingIdx] = {
          ...current,
          ...incoming,
          userRating: nextRating,
          userNote: incoming.userNote || current.userNote,
          dateWatched: incoming.dateWatched || current.dateWatched
        };
        updatedRatingCount += 1;
      } else {
        duplicatesSkipped += 1;
      }
      continue;
    }

    watchedIndexByKey.set(key, mergedWatched.length);
    mergedWatched.push(incoming);
    newWatchedCount += 1;
  }

  const mergedWatchlist = (existingWatchlist || []).filter(
    (item) => !watchedIndexByKey.has(normalizeIdentityKey(item))
  );
  const watchlistSeen = new Set(
    mergedWatchlist.map((item) => normalizeIdentityKey(item)).filter(Boolean)
  );

  let newWatchlistCount = 0;
  for (const incoming of incomingWatchlist || []) {
    const key = normalizeIdentityKey(incoming);
    if (!key || watchedIndexByKey.has(key) || watchlistSeen.has(key)) {
      if (key) duplicatesSkipped += 1;
      continue;
    }
    watchlistSeen.add(key);
    mergedWatchlist.push(incoming);
    newWatchlistCount += 1;
  }

  return {
    newWatchedCount,
    updatedRatingCount,
    newWatchlistCount,
    duplicatesSkipped,
    mergedWatched,
    mergedWatchlist
  };
}

/**
 * Converts a parsed CSV row without fabricating default 5 or 7 star ratings when unrated.
 */
export function resolveCsvRowFallbackRecord(row = {}) {
  const numericRating = row.rating !== null && row.rating !== undefined ? Number(row.rating) : 0;
  const hasExplicitRating = Number.isFinite(numericRating) && numericRating > 0;
  const normalizedType = String(row.type || "").trim().toLowerCase();
  const isWatchlistType = normalizedType.includes("watch") && normalizedType.includes("list");
  const isExplicitWatched = normalizedType === "watched" || normalizedType.includes("history");

  const resolvedId =
    row.imdbId
    || row.imdbID
    || (row.tmdbId ? `tmdb_${row.tmdbId}` : `csv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

  const baseFields = {
    imdbID: resolvedId,
    ...(row.tmdbId ? { tmdbId: row.tmdbId } : {}),
    title: row.title || "Movie",
    year: row.year || "",
    poster: row.poster || "N/A",
    director: row.director || "Imported",
    genre: row.genre || "Drama",
    runtime: row.runtime || "N/A",
    imdbRating: row.imdbRating ?? null
  };

  if (isWatchlistType || (!hasExplicitRating && !isExplicitWatched)) {
    return {
      status: "watchlist",
      record: {
        ...baseFields,
        userRating: 0,
        ...(row.note ? { userNote: row.note } : {})
      }
    };
  }

  const watchedRecord = buildWatchedRecordFromImport(baseFields, {
    ...row,
    rating: hasExplicitRating ? numericRating : 0
  });
  watchedRecord.userRating = hasExplicitRating ? numericRating : 0;

  return {
    status: "watched",
    record: watchedRecord
  };
}
