/**
 * Canonical movie identity matching across OMDb (`tt...`), TMDB (`tmdb_<id>` / numeric),
 * and title+year fallback entries.
 */

export function normalizeTitleKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeYearKey(value = "") {
  const m = String(value || "").match(/\d{4}/);
  return m ? m[0] : "";
}

/**
 * Extracts a positive integer TMDB ID from a numeric ID or `tmdb_<id>` string.
 */
export function extractTmdbNumericId(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  const prefixed = trimmed.match(/^tmdb_(\d+)$/i);
  if (prefixed) {
    const num = Number(prefixed[1]);
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isFinite(num) && num > 0 ? num : null;
  }
  return null;
}

function extractRealImdbId(target) {
  if (target === null || target === undefined) return null;
  if (typeof target === "string" || typeof target === "number") {
    const trimmed = String(target).trim();
    return /^tt\d+$/i.test(trimmed) ? trimmed.toLowerCase() : null;
  }
  if (typeof target !== "object") return null;
  for (const field of [target.imdbID, target.id, target.selectedId]) {
    if (field === null || field === undefined) continue;
    const trimmed = String(field).trim();
    if (/^tt\d+$/i.test(trimmed)) return trimmed.toLowerCase();
  }
  return null;
}

function extractObjectTmdbId(target) {
  if (target === null || target === undefined) return null;
  if (typeof target === "string" || typeof target === "number") {
    return extractTmdbNumericId(target);
  }
  if (typeof target !== "object") return null;
  return (
    extractTmdbNumericId(target.tmdbId) ??
    extractTmdbNumericId(target.imdbID) ??
    extractTmdbNumericId(target.id) ??
    extractTmdbNumericId(target.selectedId)
  );
}

/**
 * Builds all canonical lookup keys (`imdb:`, `tmdb:`, `rawid:`, `ty:`) for a movie object or ID.
 */
export function buildMovieKeys(target) {
  if (target === null || target === undefined) return [];

  if (typeof target === "string" || typeof target === "number") {
    const raw = String(target).trim();
    if (!raw) return [];
    const lower = raw.toLowerCase();
    const keys = new Set([`imdb:${lower}`, `rawid:${lower}`]);
    const tmdb = extractTmdbNumericId(raw);
    if (tmdb) {
      keys.add(`tmdb:${tmdb}`);
      keys.add(`imdb:tmdb_${tmdb}`);
      keys.add(`rawid:tmdb_${tmdb}`);
    }
    return [...keys];
  }

  if (typeof target !== "object") return [];
  const keys = new Set();

  const addIdVariants = (rawId, includeImdb = false) => {
    if (rawId === null || rawId === undefined) return;
    const trimmed = String(rawId).trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    keys.add(`rawid:${lower}`);
    if (includeImdb) keys.add(`imdb:${lower}`);
    const tmdb = extractTmdbNumericId(trimmed);
    if (tmdb) keys.add(`tmdb:${tmdb}`);
  };

  if (target.imdbID) addIdVariants(target.imdbID, true);
  if (target.id !== null && target.id !== undefined) addIdVariants(target.id, false);
  if (target.selectedId !== null && target.selectedId !== undefined) addIdVariants(target.selectedId, true);

  const tmdb = extractTmdbNumericId(target.tmdbId);
  if (tmdb) keys.add(`tmdb:${tmdb}`);

  const titleKey = normalizeTitleKey(target.title || target.Title);
  if (titleKey && titleKey !== "untitled") {
    const yearKey = normalizeYearKey(target.year || target.Year || target.release_date);
    keys.add(yearKey ? `ty:${titleKey}::${yearKey}` : `ty:${titleKey}`);
  }

  return [...keys];
}

/**
 * Compares two movie objects or IDs while preventing same-year title collisions
 * when both sides carry distinct IMDb or TMDB IDs.
 */
export function isSameMovie(a, b) {
  if (!a || !b) return false;

  const imdbA = extractRealImdbId(a);
  const imdbB = extractRealImdbId(b);
  if (imdbA && imdbB && imdbA !== imdbB) return false;

  const tmdbA = extractObjectTmdbId(a);
  const tmdbB = extractObjectTmdbId(b);
  if (tmdbA && tmdbB && tmdbA !== tmdbB) return false;

  const keysA = buildMovieKeys(a);
  if (keysA.length === 0) return false;
  const keysBSet = new Set(buildMovieKeys(b));
  return keysA.some((key) => keysBSet.has(key));
}

/**
 * Finds the first matching entry in a watched or watchlist collection.
 */
export function findMatchingMovie(list, target) {
  if (!Array.isArray(list) || !target) return null;
  return list.find((item) => isSameMovie(item, target)) || null;
}

/**
 * Replaces and deduplicates any matching entry in `list`, or appends `movie` if absent.
 */
export function upsertMovieEntry(list, movie) {
  const items = Array.isArray(list) ? list : [];
  if (!movie) return items;

  let replaced = false;
  const next = [];
  for (const item of items) {
    if (isSameMovie(item, movie)) {
      if (!replaced) {
        next.push({ ...item, ...movie });
        replaced = true;
      }
    } else {
      next.push(item);
    }
  }
  if (!replaced) next.push(movie);
  return next;
}

/**
 * Removes all entries matching `idOrMovie` and returns both the remaining and removed arrays.
 */
export function removeMovieEntries(list, idOrMovie) {
  const items = Array.isArray(list) ? list : [];
  if (!idOrMovie) return { nextList: items, removed: [] };

  const nextList = [];
  const removed = [];
  for (const item of items) {
    if (isSameMovie(item, idOrMovie)) {
      removed.push(item);
    } else {
      nextList.push(item);
    }
  }
  return { nextList, removed };
}
