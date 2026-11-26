/**
 * Pure domain helpers for the Rating Studio module:
 * Vault score calibration, same-score anchors, optional 1-5 craft breakdown,
 * watch session metadata, and backward-compatible payload assembly.
 */
import { isSameMovie } from "./movieIdentity.js";

export const CRAFT_ASPECTS = Object.freeze([
  { id: "story", label: "Story & Script" },
  { id: "direction", label: "Direction" },
  { id: "acting", label: "Performances" },
  { id: "visuals", label: "Visuals & Cinematography" },
  { id: "audio", label: "Audio & Score" },
  { id: "pacing", label: "Pacing & Editing" }
]);

const CRAFT_ASPECT_IDS = new Set(CRAFT_ASPECTS.map((a) => a.id));

export const WATCH_FORMATS = Object.freeze([
  { id: "streaming", label: "Streaming" },
  { id: "theater", label: "Theater" },
  { id: "imax", label: "IMAX / Dolby" },
  { id: "physical", label: "4K / Blu-ray" }
]);

const WATCH_FORMAT_IDS = new Set(WATCH_FORMATS.map((f) => f.id));

function parseItemTimestamp(movie = {}) {
  const ms = Date.parse(movie.updatedAt || movie.dateWatched || "");
  return Number.isFinite(ms) ? ms : 0;
}

function toCalibrationAnchor(movie) {
  return {
    imdbID: movie.imdbID || movie.id || (movie.tmdbId ? `tmdb_${movie.tmdbId}` : ""),
    tmdbId: movie.tmdbId ?? null,
    title: movie.title || movie.Title || "Untitled",
    year: movie.year || movie.Year || "",
    userRating: Math.round(Number(movie.userRating))
  };
}

function clampStarScore(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 1) return 0;
  return Math.min(10, Math.max(1, Math.round(num)));
}

/**
 * Computes deterministic 1-10 star stage wave states, synchronized rail fill percentage,
 * and WAI-ARIA roving tabIndex values for the Rating Studio Star Stage.
 */
export function computeStarStageMetrics(selectedRating = 0, hoverRating = 0) {
  const selectedScore = clampStarScore(selectedRating);
  const hoverScore = clampStarScore(hoverRating);
  const isHovering = hoverScore > 0;
  const activeScore = isHovering ? hoverScore : selectedScore;
  const fillPercent = activeScore * 10;

  const stars = Array.from({ length: 10 }, (_, idx) => {
    const score = idx + 1;
    const distance = activeScore > 0 ? Math.abs(score - activeScore) : Infinity;
    const isFilled = activeScore > 0 && score <= activeScore;
    const isSelected = selectedScore > 0 && score === selectedScore;
    const isCurrent = activeScore > 0 && score === activeScore;
    const isWaveNeighbor = activeScore > 0 && distance === 1;
    const staggerMs = isFilled ? (score - 1) * 18 : 0;
    const tabIndex = (selectedScore > 0 ? score === selectedScore : score === 1) ? 0 : -1;

    return {
      score,
      isFilled,
      isSelected,
      isCurrent,
      isWaveNeighbor,
      distance,
      staggerMs,
      tabIndex
    };
  });

  return {
    activeScore,
    selectedScore,
    hoverScore,
    isHovering,
    fillPercent,
    stars
  };
}

/**
 * Computes where a target 1-10 rating sits in the user's rated Vault
 * and returns up to 2 recent anchor films rated the same (or nearest) score.
 */
export function computeVaultCalibration(watched = [], targetRating = 0, excludeMovie = null) {
  const peers = (Array.isArray(watched) ? watched : []).filter((m) => {
    if (!m || typeof m !== "object") return false;
    const score = Number(m.userRating);
    if (!Number.isFinite(score) || score < 1 || score > 10) return false;
    if (excludeMovie && isSameMovie(m, excludeMovie)) return false;
    return true;
  });

  const ratedCount = peers.length;
  const cleanTarget = Number.isFinite(Number(targetRating)) && Number(targetRating) >= 1
    ? Math.min(10, Math.max(1, Math.round(Number(targetRating))))
    : 0;

  if (ratedCount === 0) {
    return {
      ratedCount: 0,
      sameScoreCount: 0,
      topPercentile: null,
      anchorMovies: [],
      summaryText: cleanTarget > 0
        ? `This will be your first rated benchmark at ${cleanTarget}/10.`
        : "Pick 1–10 to start calibrating your Vault scale."
    };
  }

  if (cleanTarget === 0) {
    return {
      ratedCount,
      sameScoreCount: 0,
      topPercentile: null,
      anchorMovies: [],
      summaryText: `Compare against ${ratedCount} rated ${ratedCount === 1 ? "film" : "films"} in your Vault.`
    };
  }

  const exactMatches = peers
    .filter((m) => Math.round(Number(m.userRating)) === cleanTarget)
    .sort((a, b) => parseItemTimestamp(b) - parseItemTimestamp(a));

  const sameScoreCount = exactMatches.length;

  let anchorSource = exactMatches;
  if (anchorSource.length === 0) {
    anchorSource = [...peers].sort((a, b) => {
      const diffA = Math.abs(Math.round(Number(a.userRating)) - cleanTarget);
      const diffB = Math.abs(Math.round(Number(b.userRating)) - cleanTarget);
      if (diffA !== diffB) return diffA - diffB;
      const timeDiff = parseItemTimestamp(b) - parseItemTimestamp(a);
      if (timeDiff !== 0) return timeDiff;
      return Number(b.userRating) - Number(a.userRating);
    });
  }

  const anchorMovies = anchorSource.slice(0, 2).map(toCalibrationAnchor);

  const peersAtOrAbove = peers.filter((m) => Math.round(Number(m.userRating)) >= cleanTarget).length;
  const topPercentile = Math.max(1, Math.min(100, Math.round(((peersAtOrAbove + 1) / (ratedCount + 1)) * 100)));

  const summaryText = sameScoreCount > 0
    ? `Top ${topPercentile}% of your Vault · ${sameScoreCount} other ${sameScoreCount === 1 ? "film" : "films"} at ${cleanTarget}/10`
    : `Top ${topPercentile}% of your Vault · Nearest benchmark in your log`;

  return {
    ratedCount,
    sameScoreCount,
    topPercentile,
    anchorMovies,
    summaryText
  };
}

/**
 * Sanitizes craft aspect ratings (1-5 integers); returns null when none are set.
 */
export function normalizeRatingBreakdown(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const clean = {};
  let hasAny = false;
  for (const [key, val] of Object.entries(raw)) {
    if (!CRAFT_ASPECT_IDS.has(key)) continue;
    const num = Number(val);
    if (!Number.isFinite(num) || num <= 0) continue;
    clean[key] = Math.min(5, Math.max(1, Math.round(num)));
    hasAny = true;
  }
  return hasAny ? clean : null;
}

/**
 * Computes 1-decimal arithmetic mean across populated craft aspects, or null if empty.
 */
export function computeCraftAverage(breakdown) {
  const clean = normalizeRatingBreakdown(breakdown);
  if (!clean) return null;
  const values = Object.values(clean);
  if (values.length === 0) return null;
  const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
  return Number(avg.toFixed(1));
}

/**
 * Normalizes optional watch session metadata; returns null when all values are default/empty.
 */
export function normalizeWatchMeta(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  if (typeof raw.format === "string" && WATCH_FORMAT_IDS.has(raw.format.trim())) {
    out.format = raw.format.trim();
  }
  const rewatch = Number(raw.rewatchCount);
  if (Number.isFinite(rewatch) && rewatch >= 1) {
    out.rewatchCount = Math.min(999, Math.round(rewatch));
  }
  if (raw.containsSpoilers === true) {
    out.containsSpoilers = true;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Builds the canonical Vault watched payload while stripping cleared optional sub-objects.
 */
export function buildWatchedRatingPayload({
  movie,
  baseWatchedItem = null,
  userRating,
  userNote = "",
  ratingBreakdown,
  watchMeta,
  customDateWatched = null,
  markCleared = false,
  nowIso = new Date().toISOString()
} = {}) {
  const numericRating = Number(userRating);
  if (!movie || !Number.isFinite(numericRating) || numericRating < 1) return null;

  const shortPlot = movie.plot ? `${String(movie.plot).split(/\s+/).slice(0, 18).join(" ")}...` : (baseWatchedItem?.shortPlot || "");
  const rawImdb = Number(movie.imdbRating) || Number(movie.tmdbRating) || Number(baseWatchedItem?.imdbRating);
  const resolvedRuntime =
    Number(movie.runtimeMinutes) ||
    (typeof movie.runtime === "string" ? parseInt(movie.runtime, 10) : Number(movie.runtime)) ||
    Number(baseWatchedItem?.runtime) ||
    120;

  const resolvedDateWatched =
    (typeof customDateWatched === "string" && customDateWatched.trim())
      ? customDateWatched.trim()
      : (baseWatchedItem?.dateWatched || nowIso);

  const payload = {
    ...(baseWatchedItem && typeof baseWatchedItem === "object" ? baseWatchedItem : {}),
    imdbID: movie.imdbID || baseWatchedItem?.imdbID || (movie.tmdbId ? `tmdb_${movie.tmdbId}` : ""),
    tmdbId: movie.tmdbId ?? baseWatchedItem?.tmdbId ?? null,
    ...((movie.Type || baseWatchedItem?.Type) ? { Type: movie.Type || baseWatchedItem.Type } : {}),
    title: movie.title || movie.Title || baseWatchedItem?.title || "Movie",
    year: movie.year || movie.Year || baseWatchedItem?.year || "",
    poster: movie.poster || movie.Poster || baseWatchedItem?.poster || null,
    backdrop: movie.backdrop || baseWatchedItem?.backdrop || null,
    imdbRating: Number.isFinite(rawImdb) && rawImdb > 0 ? rawImdb : null,
    runtime: Number.isFinite(resolvedRuntime) && resolvedRuntime > 0 ? Math.round(resolvedRuntime) : 120,
    userRating: Math.min(10, Math.max(1, Math.round(numericRating))),
    userNote: typeof userNote === "string" ? userNote.trim() : "",
    director: movie.director || baseWatchedItem?.director || "",
    cinematographer: movie.cinematographer ?? baseWatchedItem?.cinematographer ?? null,
    composer: movie.composer ?? baseWatchedItem?.composer ?? null,
    writers: movie.writers ?? baseWatchedItem?.writers ?? null,
    genre: Array.isArray(movie.genres) ? movie.genres.join(", ") : (movie.genre || baseWatchedItem?.genre || "Cinema"),
    shortPlot,
    castIds: movie.castIds || baseWatchedItem?.castIds || [],
    crewPersonId: movie.crewPersonId ?? baseWatchedItem?.crewPersonId ?? null,
    tmdbKeywords: movie.tmdbKeywords || baseWatchedItem?.tmdbKeywords || [],
    tmdbGenreIds: movie.tmdbGenreIds || baseWatchedItem?.tmdbGenreIds || [],
    ...(movie.collectionId != null ? { collectionId: movie.collectionId } : {}),
    ...(movie.collectionName ? { collectionName: movie.collectionName } : {}),
    trailerKey: movie.trailerKey || baseWatchedItem?.trailerKey || null,
    streamProviders: movie.streamProviders || baseWatchedItem?.streamProviders || [],
    dateWatched: resolvedDateWatched,
    updatedAt: nowIso
  };

  const nextBreakdown = ratingBreakdown === undefined
    ? normalizeRatingBreakdown(baseWatchedItem?.ratingBreakdown)
    : normalizeRatingBreakdown(ratingBreakdown);
  if (nextBreakdown) {
    payload.ratingBreakdown = nextBreakdown;
  } else if (markCleared && ratingBreakdown !== undefined) {
    payload.ratingBreakdown = null;
  } else {
    delete payload.ratingBreakdown;
  }

  const nextWatchMeta = watchMeta === undefined
    ? normalizeWatchMeta(baseWatchedItem?.watchMeta)
    : normalizeWatchMeta(watchMeta);
  if (nextWatchMeta) {
    payload.watchMeta = nextWatchMeta;
  } else if (markCleared && watchMeta !== undefined) {
    payload.watchMeta = null;
  } else {
    delete payload.watchMeta;
  }

  return payload;
}
