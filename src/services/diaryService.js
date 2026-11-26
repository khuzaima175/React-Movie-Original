export const YEARLY_GOAL_STORAGE_KEY = "cinemavault_yearly_goal_v1";

function toIsoDateString(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return `${str}T12:00:00.000Z`;
  }
  const ms = Date.parse(str);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Normalizes a watched movie's chronological watch entries, safely deriving a single
 * backward-compatible entry from legacy `dateWatched` when `watchHistory` is absent.
 */
export function normalizeWatchHistory(movie = {}) {
  if (!movie || typeof movie !== "object") return [];

  if (Array.isArray(movie.watchHistory) && movie.watchHistory.length > 0) {
    return movie.watchHistory
      .filter((entry) => entry && entry.watchedAt)
      .map((entry, idx) => ({
        id: entry.id || `wh_${idx}_${String(entry.watchedAt).slice(0, 10)}`,
        watchedAt: toIsoDateString(entry.watchedAt) || String(entry.watchedAt),
        format: entry.format || movie.watchMeta?.format || "streaming",
        rating: Number(entry.rating) > 0 ? Number(entry.rating) : (Number(movie.userRating) > 0 ? Number(movie.userRating) : null),
        note: String(entry.note || ""),
        isRewatch: Boolean(entry.isRewatch)
      }))
      .sort((a, b) => (Date.parse(b.watchedAt) || 0) - (Date.parse(a.watchedAt) || 0));
  }

  const fallbackIso = toIsoDateString(movie.dateWatched);
  if (!fallbackIso) return [];

  return [
    {
      id: `wh_legacy_${fallbackIso.slice(0, 10)}`,
      watchedAt: fallbackIso,
      format: movie.watchMeta?.format || "streaming",
      rating: Number(movie.userRating) > 0 ? Number(movie.userRating) : null,
      note: String(movie.userNote || ""),
      isRewatch: Number(movie.watchMeta?.rewatchCount) >= 2
    }
  ];
}

/**
 * Appends a new watch / rewatch entry onto a movie record, keeping `dateWatched`,
 * `watchMeta.rewatchCount`, and optional rating/note synchronized.
 */
export function appendWatchHistoryEntry(
  movie = {},
  { date = new Date().toISOString().slice(0, 10), format = "streaming", rating = null, note = "", isRewatch = true } = {}
) {
  const existing = normalizeWatchHistory(movie);
  const watchedAt = toIsoDateString(date) || new Date().toISOString();
  const cleanRating = Number(rating);
  const resolvedRating = Number.isFinite(cleanRating) && cleanRating >= 1 && cleanRating <= 10
    ? Math.round(cleanRating)
    : (Number(movie.userRating) > 0 ? Number(movie.userRating) : null);

  const newEntry = {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    watchedAt,
    format: format || movie.watchMeta?.format || "streaming",
    rating: resolvedRating,
    note: String(note || "").trim().slice(0, 200),
    isRewatch: Boolean(isRewatch || existing.length > 0)
  };

  const watchHistory = [newEntry, ...existing].sort(
    (a, b) => (Date.parse(b.watchedAt) || 0) - (Date.parse(a.watchedAt) || 0)
  );
  const rewatchCount = Math.max(
    Number(movie.watchMeta?.rewatchCount) || 0,
    watchHistory.length
  );

  return {
    ...movie,
    dateWatched: watchHistory[0].watchedAt,
    ...(resolvedRating ? { userRating: resolvedRating } : {}),
    ...(newEntry.note ? { userNote: newEntry.note } : {}),
    watchMeta: {
      ...(movie.watchMeta || {}),
      format: newEntry.format,
      rewatchCount
    },
    watchHistory,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Groups chronological watch diary entries by YYYY-MM descending, optionally filtered by year.
 */
export function buildMonthlyDiaryGroups(watched = [], { year = null } = {}) {
  const targetYear = year != null ? String(year) : null;
  const flatEntries = [];

  for (const movie of Array.isArray(watched) ? watched : []) {
    if (!movie || typeof movie !== "object") continue;
    const history = normalizeWatchHistory(movie);
    for (const entry of history) {
      const iso = String(entry.watchedAt || "");
      if (iso.length < 7) continue;
      if (targetYear && !iso.startsWith(`${targetYear}-`)) continue;
      flatEntries.push({
        ...entry,
        movieId: movie.imdbID || movie.id || (movie.tmdbId ? `tmdb_${movie.tmdbId}` : ""),
        tmdbId: movie.tmdbId || null,
        title: movie.title || movie.Title || "Untitled",
        year: movie.year || movie.Year || "",
        poster: movie.poster || movie.Poster || null,
        runtime: movie.runtime || "120 min",
        genre: movie.genre || movie.Genre || ""
      });
    }
  }

  flatEntries.sort((a, b) => (Date.parse(b.watchedAt) || 0) - (Date.parse(a.watchedAt) || 0));

  const groupsMap = new Map();
  for (const item of flatEntries) {
    const monthKey = item.watchedAt.slice(0, 7);
    if (!groupsMap.has(monthKey)) {
      const [y, m] = monthKey.split("-").map(Number);
      const dt = new Date(Date.UTC(y, (m || 1) - 1, 1));
      const monthLabel = dt.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      groupsMap.set(monthKey, { monthKey, monthLabel, entries: [] });
    }
    groupsMap.get(monthKey).entries.push(item);
  }

  return [...groupsMap.values()];
}

/**
 * Computes annual watch diary metrics (total entries, rewatches, runtime minutes, average score, top genre).
 */
export function computeYearlyDiaryStats(watched = [], year = new Date().getFullYear()) {
  const groups = buildMonthlyDiaryGroups(watched, { year });
  const entries = groups.flatMap((g) => g.entries);

  let totalMinutes = 0;
  let rewatchCount = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  const genreCounts = new Map();
  const monthlyCounts = new Array(12).fill(0);

  for (const entry of entries) {
    const mins = parseInt(entry.runtime, 10);
    totalMinutes += Number.isFinite(mins) && mins > 0 ? mins : 120;
    if (entry.isRewatch) rewatchCount += 1;
    if (Number(entry.rating) > 0) {
      ratingSum += Number(entry.rating);
      ratingCount += 1;
    }
    const monthIdx = Number(entry.watchedAt.slice(5, 7)) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      monthlyCounts[monthIdx] += 1;
    }
    if (entry.genre) {
      for (const g of String(entry.genre).split(",").map((s) => s.trim()).filter(Boolean)) {
        genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
      }
    }
  }

  const topGenre = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  return {
    year: Number(year),
    count: entries.length,
    rewatchCount,
    totalMinutes,
    avgRating: ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(1)) : null,
    topGenre,
    monthlyCounts
  };
}
