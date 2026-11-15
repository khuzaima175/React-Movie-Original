import { fetchOmdbJson, hasOmdbBackend, hasTmdbBackend } from "./apiTransport.js";
import { computeUserEmbedding } from "./embeddingService.js";
import {
  extractTmdbNumericId,
  findMatchingMovie,
  isSameMovie,
  normalizeYearKey
} from "./movieIdentity.js";
import { computeZScoredWeights } from "./scoringUtils.js";
import {
  fetchTmdbMovieDetails,
  findTmdbByImdbId,
  findTmdbByTitleAndYear,
  getFallbackPoster,
  TMDB_GENRE_MAP
} from "./tmdbService.js";
import { getCanonicalMovieKey } from "./vaultSyncService.js";

export const COMPARE_MAX_ITEMS = 3;
export const COMPARE_STORAGE_KEY = "cinemavault_compare_v1";

/**
 * Normalizes any movie object into a compact session-safe Compare stub.
 */
export function toCompareStub(movie) {
  if (!movie || typeof movie !== "object") return null;

  const tmdbId = extractTmdbNumericId(
    movie.tmdbId ?? movie.id ?? movie.imdbID ?? movie.selectedId
  );
  const rawImdb = String(movie.imdbID || movie.id || "").trim();
  const imdbID = /^tt\d+$/i.test(rawImdb)
    ? rawImdb.toLowerCase()
    : tmdbId
      ? `tmdb_${tmdbId}`
      : rawImdb || null;
  const canonicalId = imdbID || (movie.id ? String(movie.id).trim() : null);
  const title = String(movie.title || movie.Title || "").trim();

  if (!canonicalId && !title) return null;

  const rawGenre = Array.isArray(movie.genres)
    ? movie.genres.filter(Boolean).join(", ")
    : movie.genre || movie.Genre || null;

  const runtimeText =
    movie.runtime && movie.runtime !== "N/A"
      ? String(movie.runtime)
      : Number(movie.runtimeMinutes) > 0
        ? `${Number(movie.runtimeMinutes)} min`
        : null;

  const yearStr = normalizeYearKey(movie.year || movie.Year || movie.release_date || "");

  return {
    id: canonicalId || title,
    imdbID: imdbID || null,
    tmdbId: tmdbId || null,
    title: title || "Untitled Film",
    year: yearStr || null,
    poster: movie.poster && movie.poster !== "N/A" ? movie.poster : null,
    imdbRating:
      movie.imdbRating !== undefined && movie.imdbRating !== null && movie.imdbRating !== "N/A"
        ? String(movie.imdbRating)
        : movie.vote_average
          ? String(Number(movie.vote_average).toFixed(1))
          : null,
    genre: rawGenre || null,
    runtime: runtimeText
  };
}

/**
 * Toggles a film in or out of the bounded Compare tray using canonical ID matching.
 * Returns `{ items, action: "added" | "removed" | "full" | "noop" }`.
 */
export function toggleCompareItem(currentList = [], movie) {
  const list = Array.isArray(currentList) ? currentList : [];
  if (!movie) return { items: list, action: "noop" };

  if (list.some((item) => isSameMovie(item, movie))) {
    return {
      items: list.filter((item) => !isSameMovie(item, movie)),
      action: "removed"
    };
  }

  if (list.length >= COMPARE_MAX_ITEMS) {
    return { items: list, action: "full" };
  }

  const stub = toCompareStub(movie);
  if (!stub) return { items: list, action: "noop" };

  return { items: [...list, stub], action: "added" };
}

/**
 * Safely parses stored sessionStorage JSON into up to 3 deduplicated Compare stubs.
 */
export function parseStoredCompareItems(rawJson) {
  if (!rawJson || typeof rawJson !== "string") return [];
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];
    let next = [];
    for (const entry of parsed) {
      const res = toggleCompareItem(next, entry);
      if (res.action === "added") {
        next = res.items;
      }
      if (next.length >= COMPARE_MAX_ITEMS) break;
    }
    return next;
  } catch {
    return [];
  }
}

/**
 * Parses currency strings like "$165,000,000" or numbers into positive USD numbers.
 */
export function parseCurrencyUsd(raw) {
  if (raw === null || raw === undefined || raw === "" || raw === "N/A") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const cleaned = String(raw).replace(/[$,\s]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Formats USD values into scannable shorthand like "$165.0M" or "$1.2B".
 */
export function formatCompactUsd(amount) {
  const num = parseCurrencyUsd(amount);
  if (num === null) return "—";
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${Math.round(num / 1_000)}K`;
  return `$${Math.round(num).toLocaleString()}`;
}

/**
 * Parses runtime strings like "169 min" or numeric minute values into positive integers.
 */
export function parseRuntimeMins(raw) {
  if (raw === null || raw === undefined || raw === "" || raw === "N/A") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  }
  const match = String(raw).trim().match(/^(\d+)(?:\s*min(?:utes?)?)?$/i);
  if (!match) return null;
  const mins = Number(match[1]);
  return Number.isFinite(mins) && mins > 0 ? mins : null;
}

function normalizeUrlMovieToken(rawToken) {
  const trimmed = String(rawToken || "").trim();
  if (!trimmed) return null;
  if (/^tt\d+$/i.test(trimmed)) return trimmed.toLowerCase();
  const tmdbMatch = trimmed.match(/^tmdb_(\d+)$/i);
  if (tmdbMatch && Number(tmdbMatch[1]) > 0) return `tmdb_${Number(tmdbMatch[1])}`;
  if (/^\d+$/.test(trimmed) && Number(trimmed) > 0) return `tmdb_${Number(trimmed)}`;
  return null;
}

/**
 * Serializes up to 3 docked compare movies into a shareable `/compare?ids=...` route.
 */
export function buildCompareUrl(items = []) {
  const list = Array.isArray(items) ? items : [];
  const tokens = [];
  const seen = new Set();

  for (const item of list) {
    const rawKey = typeof item === "string" || typeof item === "number"
      ? String(item)
      : getCanonicalMovieKey(item) ||
        (extractTmdbNumericId(item?.tmdbId) ? `tmdb_${extractTmdbNumericId(item.tmdbId)}` : "");
    const token = normalizeUrlMovieToken(rawKey);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
    if (tokens.length >= COMPARE_MAX_ITEMS) break;
  }

  if (tokens.length === 0) return "/compare";
  const sp = new URLSearchParams();
  sp.set("ids", tokens.join(","));
  return `/compare?${sp.toString()}`;
}

/**
 * Parses and validates up to 3 canonical movie IDs from a `/compare?ids=...` query string.
 */
export function parseCompareUrlIds(searchString = "") {
  const sp = searchString instanceof URLSearchParams
    ? searchString
    : new URLSearchParams(String(searchString || "").replace(/^\?/, ""));
  const raw = sp.get("ids") || "";
  if (!raw.trim()) return [];

  const result = [];
  const seen = new Set();
  for (const part of raw.split(",")) {
    const token = normalizeUrlMovieToken(part);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    result.push(token);
    if (result.length >= COMPARE_MAX_ITEMS) break;
  }
  return result;
}

function getNormalizedEmbeddingSlice(tmdbId, index) {
  const numId = extractTmdbNumericId(tmdbId);
  if (!numId || !index?.idToIndex || !index?.vectors || !index?.dim) return null;
  const rowIdx = index.idToIndex.get(numId);
  if (rowIdx === undefined) return null;

  const dim = index.dim;
  const base = rowIdx * dim;
  let normSq = 0;
  for (let d = 0; d < dim; d++) {
    const v = index.vectors[base + d];
    normSq += v * v;
  }
  if (normSq <= 1e-12) return null;
  return { base, norm: Math.sqrt(normSq), dim, vectors: index.vectors };
}

function cosineBetweenSlices(sliceA, sliceB) {
  if (!sliceA || !sliceB || sliceA.dim !== sliceB.dim) return null;
  let dot = 0;
  for (let d = 0; d < sliceA.dim; d++) {
    dot += sliceA.vectors[sliceA.base + d] * sliceB.vectors[sliceB.base + d];
  }
  return dot / (sliceA.norm * sliceB.norm);
}

function parseNumericScore(raw, { stripPercent = false, max = 100 } = {}) {
  if (raw === null || raw === undefined || raw === "" || raw === "N/A") return null;
  const text = stripPercent ? String(raw).replace(/%/g, "").trim() : String(raw).trim();
  if (!text) return null;
  const val = Number(text);
  if (!Number.isFinite(val) || val <= 0 || val > max) return null;
  return val;
}

function extractGenreTokens(movie = {}) {
  if (Array.isArray(movie.genres) && movie.genres.length > 0) {
    return movie.genres.map((g) => String(g).trim()).filter(Boolean);
  }
  if (typeof movie.genre === "string" && movie.genre.trim() && movie.genre !== "N/A") {
    return movie.genre.split(",").map((g) => g.trim()).filter(Boolean);
  }
  return [];
}

function extractKeywordTokens(movie = {}) {
  const out = [];
  const seen = new Set();
  const pushKw = (id, name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const numId = Number(id);
    out.push({ id: Number.isSafeInteger(numId) && numId > 0 ? numId : null, name: clean });
  };

  if (Array.isArray(movie.keywordItems)) {
    for (const kw of movie.keywordItems) pushKw(kw?.id, kw?.name);
  }
  if (Array.isArray(movie.keywordNames)) {
    for (const name of movie.keywordNames) pushKw(null, name);
  }
  if (Array.isArray(movie.keywords)) {
    for (const kw of movie.keywords) {
      if (typeof kw === "string") pushKw(null, kw);
      else if (kw && typeof kw === "object") pushKw(kw.id, kw.name);
    }
  }
  return out;
}

const CREW_ARRAY_ROLES = [
  ["directorDetails", "Director"],
  ["writerDetails", "Writer"],
  ["cinematographerDetails", "Cinematography"],
  ["composerDetails", "Score"]
];

function collectPersonOverlap(movies, extractEntriesForMovie) {
  const byPerson = new Map();

  movies.forEach((movie, idx) => {
    const movieTitle = movie?.title || `Film ${idx + 1}`;
    const movieKey = getCanonicalMovieKey(movie) || String(idx);
    const entries = extractEntriesForMovie(movie);

    // Aggregate roles per person within a single film before recording cross-film presence
    const filmPersonRoles = new Map();
    for (const entry of entries) {
      const personId = Number(entry?.id);
      const name = String(entry?.name || "").trim();
      if (!name) continue;
      const mapKey = Number.isSafeInteger(personId) && personId > 0
        ? `id:${personId}`
        : `name:${name.toLowerCase()}`;
      if (!filmPersonRoles.has(mapKey)) {
        filmPersonRoles.set(mapKey, {
          id: Number.isSafeInteger(personId) && personId > 0 ? personId : null,
          name,
          roles: []
        });
      }
      const cleanRole = String(entry?.role || "").trim();
      const rec = filmPersonRoles.get(mapKey);
      if (cleanRole && !rec.roles.includes(cleanRole)) rec.roles.push(cleanRole);
    }

    for (const [mapKey, rec] of filmPersonRoles.entries()) {
      if (!byPerson.has(mapKey)) {
        byPerson.set(mapKey, {
          id: rec.id,
          name: rec.name,
          rolesByMovie: []
        });
      }
      const target = byPerson.get(mapKey);
      if (!target.id && rec.id) target.id = rec.id;
      target.rolesByMovie.push({
        movieKey,
        movieTitle,
        role: rec.roles.join(", ")
      });
    }
  });

  return [...byPerson.values()]
    .filter((entry) => entry.rolesByMovie.length >= 2)
    .sort((a, b) => b.rolesByMovie.length - a.rolesByMovie.length || a.name.localeCompare(b.name));
}

/**
 * Computes shared actors, crew (with TMDB personIds), genres, motifs, and pairwise 64-D similarities.
 */
export function computeCompareOverlap(hydratedMovies = [], embeddingIndex = null) {
  const movies = Array.isArray(hydratedMovies) ? hydratedMovies.filter(Boolean) : [];
  if (movies.length < 2) {
    return {
      sharedActors: [],
      sharedCrew: [],
      sharedGenres: [],
      sharedKeywords: [],
      pairVectorSims: []
    };
  }

  const sharedActors = collectPersonOverlap(movies, (movie) =>
    (Array.isArray(movie.castDetails) ? movie.castDetails : []).map((c) => ({
      id: c?.id,
      name: c?.name,
      role: c?.character || "Cast"
    }))
  );

  const sharedCrew = collectPersonOverlap(movies, (movie) => {
    const out = [];
    for (const [field, roleLabel] of CREW_ARRAY_ROLES) {
      for (const person of Array.isArray(movie?.[field]) ? movie[field] : []) {
        out.push({ id: person?.id, name: person?.name, role: roleLabel });
      }
    }
    return out;
  });

  // Shared Genres (appearing in >= 2 movies)
  const genreCounts = new Map();
  movies.forEach((movie, idx) => {
    const seenInMovie = new Set();
    for (const g of extractGenreTokens(movie)) {
      const low = g.toLowerCase();
      if (seenInMovie.has(low)) continue;
      seenInMovie.add(low);
      if (!genreCounts.has(low)) genreCounts.set(low, { name: g, movies: new Set() });
      genreCounts.get(low).movies.add(idx);
    }
  });
  const sharedGenres = [...genreCounts.values()]
    .filter((g) => g.movies.size >= 2)
    .sort((a, b) => b.movies.size - a.movies.size || a.name.localeCompare(b.name))
    .map((g) => g.name);

  // Shared Motifs / Keywords (appearing in >= 2 movies, preserving keyword IDs where available)
  const kwCounts = new Map();
  movies.forEach((movie, idx) => {
    for (const kw of extractKeywordTokens(movie)) {
      const low = kw.name.toLowerCase();
      if (!kwCounts.has(low)) {
        kwCounts.set(low, { id: kw.id || null, name: kw.name, movies: new Set() });
      }
      const existing = kwCounts.get(low);
      if (!existing.id && kw.id) existing.id = kw.id;
      existing.movies.add(idx);
    }
  });
  const sharedKeywords = [...kwCounts.values()]
    .filter((k) => k.movies.size >= 2)
    .sort((a, b) => b.movies.size - a.movies.size || a.name.localeCompare(b.name))
    .map(({ id, name }) => (id ? { id, name } : { name }));

  // Pairwise 64-D CVEM similarity
  const pairVectorSims = [];
  if (embeddingIndex) {
    const slices = movies.map((m) => getNormalizedEmbeddingSlice(m?.tmdbId, embeddingIndex));
    for (let i = 0; i < movies.length; i++) {
      for (let j = i + 1; j < movies.length; j++) {
        const cos = cosineBetweenSlices(slices[i], slices[j]);
        if (cos === null || !Number.isFinite(cos)) continue;
        pairVectorSims.push({
          aIndex: i,
          bIndex: j,
          aId: getCanonicalMovieKey(movies[i]),
          bId: getCanonicalMovieKey(movies[j]),
          aTitle: movies[i]?.title || `Film ${i + 1}`,
          bTitle: movies[j]?.title || `Film ${j + 1}`,
          similarityPct: Math.round(Math.max(0, Math.min(100, cos * 100)))
        });
      }
    }
  }

  return {
    sharedActors,
    sharedCrew,
    sharedGenres,
    sharedKeywords,
    pairVectorSims
  };
}

function pickLeaderIndices(values = [], mode = "max") {
  const valid = values
    .map((value, idx) => ({ value, idx }))
    .filter((entry) => typeof entry.value === "number" && Number.isFinite(entry.value));
  if (valid.length < 2) return [];

  const bestVal = valid.reduce(
    (best, cur) => (mode === "min" ? Math.min(best, cur.value) : Math.max(best, cur.value)),
    valid[0].value
  );
  return valid.filter((entry) => Math.abs(entry.value - bestVal) < 1e-6).map((entry) => entry.idx);
}

/**
 * Builds column metrics, tied/single winners, Vault status & Taste Resonance, and DNA overlap.
 */
export function buildCompareMatrix(
  hydratedMovies = [],
  { watched = [], watchlist = [], embeddingIndex = null } = {}
) {
  const movies = Array.isArray(hydratedMovies) ? hydratedMovies.filter(Boolean) : [];
  const weightedRatings =
    embeddingIndex && Array.isArray(watched) && watched.length > 0
      ? computeZScoredWeights(watched)
      : [];
  const userVec =
    embeddingIndex && weightedRatings.length > 0
      ? computeUserEmbedding(weightedRatings, embeddingIndex)
      : null;

  const annotatedItems = movies.map((movie) => {
    const watchedEntry = findMatchingMovie(watched, movie);
    const watchlistEntry = findMatchingMovie(watchlist, movie);

    const imdbVal = parseNumericScore(movie.imdbRating, { max: 10 });
    const rtVal = parseNumericScore(movie.rottenTomatoes, { stripPercent: true, max: 100 });
    const metascoreVal = parseNumericScore(movie.metascore, { max: 100 });
    const tmdbVal = parseNumericScore(movie.tmdbRating ?? movie.vote_average, { max: 10 });
    const runtimeMins = parseRuntimeMins(movie.runtimeMinutes ?? movie.runtime);
    const budgetUsd = parseCurrencyUsd(movie.budget);
    const revenueUsd = parseCurrencyUsd(movie.revenue);

    let roiMultiple = null;
    let roiLabel = "—";
    if (budgetUsd && revenueUsd) {
      roiMultiple = revenueUsd / budgetUsd;
      roiLabel = roiMultiple >= 10 ? `${roiMultiple.toFixed(0)}×` : `${roiMultiple.toFixed(1)}×`;
    }

    const rawVaultRating = Number(watchedEntry?.userRating ?? watchedEntry?.UserRating);
    const vaultRating =
      Number.isFinite(rawVaultRating) && rawVaultRating > 0 ? rawVaultRating : null;
    const vaultNote = String(watchedEntry?.userNote || "").trim() || null;

    let vaultMatchPct = null;
    if (userVec && embeddingIndex) {
      const slice = getNormalizedEmbeddingSlice(movie.tmdbId, embeddingIndex);
      if (slice) {
        let dot = 0;
        for (let d = 0; d < slice.dim; d++) {
          dot += userVec[d] * slice.vectors[slice.base + d];
        }
        const cos = dot / slice.norm;
        if (Number.isFinite(cos)) {
          vaultMatchPct = Math.round(Math.max(0, Math.min(99, ((cos + 0.2) / 1.05) * 99)));
        }
      }
    }

    return {
      ...movie,
      canonicalId: getCanonicalMovieKey(movie) || movie.imdbID || movie.id || `tmdb_${movie.tmdbId}`,
      genres: extractGenreTokens(movie),
      imdbVal,
      rtVal,
      metascoreVal,
      tmdbVal,
      runtimeMins,
      budgetUsd,
      budgetLabel: formatCompactUsd(budgetUsd),
      revenueUsd,
      revenueLabel: formatCompactUsd(revenueUsd),
      roiMultiple,
      roiLabel,
      isWatched: Boolean(watchedEntry),
      inWatchlist: Boolean(!watchedEntry && watchlistEntry),
      vaultRating,
      vaultNote,
      vaultMatchPct
    };
  });

  const rows = {
    imdb: annotatedItems.map((m) => (m.imdbVal !== null ? `${m.imdbVal.toFixed(1)}/10` : "—")),
    rt: annotatedItems.map((m) => (m.rtVal !== null ? `${Math.round(m.rtVal)}%` : "—")),
    metascore: annotatedItems.map((m) => (m.metascoreVal !== null ? `${Math.round(m.metascoreVal)}` : "—")),
    tmdb: annotatedItems.map((m) => (m.tmdbVal !== null ? `${m.tmdbVal.toFixed(1)}/10` : "—")),
    runtime: annotatedItems.map((m) => (m.runtimeMins !== null ? `${m.runtimeMins} min` : "—")),
    budget: annotatedItems.map((m) => m.budgetLabel),
    revenue: annotatedItems.map((m) => m.revenueLabel),
    roi: annotatedItems.map((m) => m.roiLabel),
    vaultScore: annotatedItems.map((m) => (m.vaultRating !== null ? `${m.vaultRating}/10` : m.inWatchlist ? "Watchlist" : "Unlogged")),
    vaultMatchPct: annotatedItems.map((m) => (m.vaultMatchPct !== null ? `${m.vaultMatchPct}%` : "—")),
    streamProviders: annotatedItems.map((m) => Array.isArray(m.streamProviders) ? m.streamProviders : [])
  };

  const leaders = {
    imdb: pickLeaderIndices(annotatedItems.map((m) => m.imdbVal), "max"),
    rt: pickLeaderIndices(annotatedItems.map((m) => m.rtVal), "max"),
    metascore: pickLeaderIndices(annotatedItems.map((m) => m.metascoreVal), "max"),
    tmdb: pickLeaderIndices(annotatedItems.map((m) => m.tmdbVal), "max"),
    runtimeShortest: pickLeaderIndices(annotatedItems.map((m) => m.runtimeMins), "min"),
    revenue: pickLeaderIndices(annotatedItems.map((m) => m.revenueUsd), "max"),
    roi: pickLeaderIndices(annotatedItems.map((m) => m.roiMultiple), "max"),
    vaultMatch: pickLeaderIndices(annotatedItems.map((m) => m.vaultMatchPct), "max")
  };

  const overlap = computeCompareOverlap(annotatedItems, embeddingIndex);

  return {
    items: annotatedItems,
    rows,
    leaders,
    overlap
  };
}

/**
 * Resolves a human-readable genre name (e.g. "Sci-Fi") to its TMDB numeric genre ID.
 */
export function resolveExploreGenreId(genreName = "") {
  const key = String(genreName || "").trim().toLowerCase();
  return key && TMDB_GENRE_MAP[key] ? TMDB_GENRE_MAP[key] : null;
}

/**
 * Concurrently hydrates a Compare slot (bare ID string or lightweight card stub)
 * from TMDB + OMDb while preserving core identity fields cleanly.
 */
export async function hydrateCompareMovieSlot(rawIdOrStub, options = {}) {
  if (!rawIdOrStub) return null;

  const {
    userRegion = "US",
    signal,
    fetchTmdbDetails = hasTmdbBackend() ? fetchTmdbMovieDetails : null,
    findByImdb = hasTmdbBackend() ? findTmdbByImdbId : null,
    findByTitleYear = hasTmdbBackend() ? findTmdbByTitleAndYear : null,
    fetchOmdb = hasOmdbBackend() ? fetchOmdbJson : null
  } = options;

  const isObj = typeof rawIdOrStub === "object";
  const stub = isObj ? rawIdOrStub : null;
  const rawIdStr = String(
    isObj ? (rawIdOrStub.imdbID || rawIdOrStub.id || (rawIdOrStub.tmdbId ? `tmdb_${rawIdOrStub.tmdbId}` : "")) : rawIdOrStub
  ).trim();
  const isImdb = /^tt\d+$/i.test(rawIdStr);
  const imdbIdCandidate = isImdb
    ? rawIdStr.toLowerCase()
    : (stub?.imdbID && /^tt\d+$/i.test(stub.imdbID) ? String(stub.imdbID).toLowerCase() : null);
  const tmdbNum = isObj
    ? extractTmdbNumericId(stub.tmdbId ?? stub.id ?? stub.imdbID)
    : extractTmdbNumericId(rawIdStr);

  const safeCall = async (fn, ...args) => {
    if (typeof fn !== "function") return null;
    try {
      return await fn(...args);
    } catch (err) {
      if (err?.name === "AbortError" || signal?.aborted) throw err;
      return null;
    }
  };

  let tmdbData = null;
  let omdbData = null;

  if (tmdbNum) {
    const tmdbPromise = safeCall(fetchTmdbDetails, tmdbNum, userRegion);
    const omdbEarlyPromise = imdbIdCandidate
      ? safeCall(fetchOmdb, { i: imdbIdCandidate }, { signal })
      : Promise.resolve(null);
    const [tmdbRes, omdbEarly] = await Promise.all([tmdbPromise, omdbEarlyPromise]);
    tmdbData = tmdbRes;
    omdbData = omdbEarly && omdbEarly.Response === "True" ? omdbEarly : null;

    if (!omdbData && tmdbData?.imdbID) {
      const lateOmdb = await safeCall(fetchOmdb, { i: tmdbData.imdbID }, { signal });
      if (lateOmdb?.Response === "True") omdbData = lateOmdb;
    }
  } else if (imdbIdCandidate) {
    const omdbPromise = safeCall(fetchOmdb, { i: imdbIdCandidate }, { signal });
    const tmdbPromise = (async () => {
      const found = await safeCall(findByImdb, imdbIdCandidate, { signal });
      if (found?.tmdbId) return safeCall(fetchTmdbDetails, found.tmdbId, userRegion);
      return null;
    })();
    const [omdbRes, tmdbRes] = await Promise.all([omdbPromise, tmdbPromise]);
    omdbData = omdbRes && omdbRes.Response === "True" ? omdbRes : null;
    tmdbData = tmdbRes;

    if (!tmdbData && omdbData?.Title && findByTitleYear) {
      const fallbackFound = await safeCall(findByTitleYear, omdbData.Title, omdbData.Year, { strict: true });
      if (fallbackFound?.tmdbId) {
        tmdbData = await safeCall(fetchTmdbDetails, fallbackFound.tmdbId, userRegion);
      }
    }
  }

  if (!tmdbData && !omdbData) {
    if (stub?.title) {
      return { ...stub, _partial: true };
    }
    return { id: rawIdStr, _notFound: true };
  }

  const title = tmdbData?.title || omdbData?.Title || stub?.title || "Untitled Film";
  const year =
    tmdbData?.year && tmdbData.year !== "N/A"
      ? tmdbData.year
      : normalizeYearKey(omdbData?.Year || stub?.year || "") || "N/A";
  const poster =
    tmdbData?.poster ||
    (omdbData?.Poster && omdbData.Poster !== "N/A" ? omdbData.Poster : null) ||
    stub?.poster ||
    getFallbackPoster(title);

  const rawGenre = tmdbData?.genre || (omdbData?.Genre && omdbData.Genre !== "N/A" ? omdbData.Genre : null) || stub?.genre || "";
  const imdbRating =
    omdbData?.imdbRating && omdbData.imdbRating !== "N/A"
      ? omdbData.imdbRating
      : tmdbData?.vote_average
        ? String(tmdbData.vote_average)
        : stub?.imdbRating || null;
  const imdbVotes = omdbData?.imdbVotes && omdbData.imdbVotes !== "N/A" ? omdbData.imdbVotes : null;
  const tmdbRating = tmdbData?.vote_average ?? null;
  const tmdbVotes = tmdbData?.vote_count || null;
  const metascore = omdbData?.Metascore && omdbData.Metascore !== "N/A" ? omdbData.Metascore : null;
  const rottenTomatoes =
    omdbData?.Ratings?.find((r) => r.Source === "Rotten Tomatoes")?.Value || null;

  const fallbackActors = !tmdbData?.castDetails?.length && omdbData?.Actors && omdbData.Actors !== "N/A"
    ? omdbData.Actors.split(",").map((name) => ({ id: null, name: name.trim(), character: "Starring", profile: null }))
    : [];

  return {
    ...(stub || {}),
    id: omdbData?.imdbID || tmdbData?.imdbID || stub?.id || rawIdStr,
    imdbID: omdbData?.imdbID || tmdbData?.imdbID || imdbIdCandidate || stub?.imdbID || (tmdbData?.tmdbId ? `tmdb_${tmdbData.tmdbId}` : null),
    tmdbId: tmdbData?.tmdbId || tmdbNum || stub?.tmdbId || null,
    title,
    year,
    poster,
    backdrop: tmdbData?.backdrop || stub?.backdrop || null,
    genre: rawGenre,
    runtime: tmdbData?.runtime && tmdbData.runtime !== "N/A" ? tmdbData.runtime : (omdbData?.Runtime || stub?.runtime || "N/A"),
    runtimeMinutes: tmdbData?.runtimeMinutes || parseRuntimeMins(omdbData?.Runtime || stub?.runtime) || null,
    rated: tmdbData?.mpaaRating || (omdbData?.Rated && omdbData.Rated !== "N/A" ? omdbData.Rated : null),
    imdbRating,
    imdbVotes,
    tmdbRating,
    tmdbVotes,
    metascore,
    rottenTomatoes,
    budget: tmdbData?.budget || null,
    revenue: tmdbData?.revenue || (omdbData?.BoxOffice && omdbData.BoxOffice !== "N/A" ? omdbData.BoxOffice : null),
    originCountry: tmdbData?.originCountry || (omdbData?.Country && omdbData.Country !== "N/A" ? omdbData.Country : null),
    spokenLanguages: tmdbData?.spokenLanguages || (omdbData?.Language && omdbData.Language !== "N/A" ? omdbData.Language : null),
    directorDetails: tmdbData?.directorDetails || [],
    writerDetails: tmdbData?.writerDetails || [],
    cinematographerDetails: tmdbData?.cinematographerDetails || [],
    composerDetails: tmdbData?.composerDetails || [],
    castDetails: tmdbData?.castDetails?.length ? tmdbData.castDetails : fallbackActors,
    keywordItems: tmdbData?.keywordItems || [],
    keywordNames: tmdbData?.keywordNames || [],
    streamProviders: tmdbData?.streamProviders || [],
    buyRentProviders: tmdbData?.buyRentProviders || [],
    freeProviders: tmdbData?.freeProviders || []
  };
}
