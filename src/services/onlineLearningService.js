import { DEFAULT_RANKER_WEIGHTS, fitRankerWeights } from "./rankerService.js";

const FEATURE_KEYS = Object.keys(DEFAULT_RANKER_WEIGHTS).filter(key => key !== "bias");

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Strips non-numeric or unknown fields from a ranker feature snapshot so feedback logs
 * only retain active numeric ranker features.
 */
export function sanitizeFeatureSnapshot(rawFeatures = null) {
  if (!rawFeatures || typeof rawFeatures !== "object" || Array.isArray(rawFeatures)) {
    return null;
  }

  const clean = {};
  let hasFeature = false;

  for (const key of FEATURE_KEYS) {
    const num = toFiniteNumber(rawFeatures[key]);
    if (num !== null) {
      clean[key] = num;
      hasFeature = true;
    }
  }

  return hasFeature ? clean : null;
}

function toDenseFeatureVector(features) {
  const dense = {};
  for (const key of FEATURE_KEYS) {
    dense[key] = toFiniteNumber(features?.[key]) ?? 0;
  }
  return dense;
}

function resolveLookupFeature(featureLookup, entry) {
  if (!featureLookup || typeof featureLookup.get !== "function" || !entry) {
    return null;
  }

  const tmdbId = Number(entry.tmdbId ?? entry.id ?? 0);
  if (tmdbId && featureLookup.has(tmdbId)) {
    return sanitizeFeatureSnapshot(featureLookup.get(tmdbId));
  }
  if (entry.imdbID && featureLookup.has(entry.imdbID)) {
    return sanitizeFeatureSnapshot(featureLookup.get(entry.imdbID));
  }
  const titleKey = entry.title ? String(entry.title).toLowerCase().trim() : "";
  if (titleKey && featureLookup.has(titleKey)) {
    return sanitizeFeatureSnapshot(featureLookup.get(titleKey));
  }

  return null;
}

function resolveEntryRating(entry, watchedByKey) {
  const explicitRating = toFiniteNumber(entry?.userRating);
  if (explicitRating !== null && explicitRating > 0) {
    return explicitRating;
  }

  const tmdbId = Number(entry?.tmdbId ?? entry?.id ?? 0);
  if (tmdbId && watchedByKey.byTmdbId.has(tmdbId)) {
    return watchedByKey.byTmdbId.get(tmdbId);
  }
  const imdbID = entry?.imdbID ? String(entry.imdbID).toLowerCase() : "";
  if (imdbID && watchedByKey.byImdbId.has(imdbID)) {
    return watchedByKey.byImdbId.get(imdbID);
  }
  const titleKey = entry?.title ? String(entry.title).toLowerCase().trim() : "";
  if (titleKey && watchedByKey.byTitle.has(titleKey)) {
    return watchedByKey.byTitle.get(titleKey);
  }

  return null;
}

function buildWatchedRatingIndex(watchedMovies = []) {
  const byTmdbId = new Map();
  const byImdbId = new Map();
  const byTitle = new Map();

  for (const movie of Array.isArray(watchedMovies) ? watchedMovies : []) {
    const rating = toFiniteNumber(movie?.userRating ?? movie?.UserRating);
    if (rating === null || rating <= 0) continue;

    const tmdbId = Number(movie?.tmdbId ?? movie?.id ?? 0);
    if (tmdbId) byTmdbId.set(tmdbId, rating);
    if (movie?.imdbID) byImdbId.set(String(movie.imdbID).toLowerCase(), rating);
    if (movie?.title) byTitle.set(String(movie.title).toLowerCase().trim(), rating);
  }

  return { byTmdbId, byImdbId, byTitle };
}

/**
 * Learns bounded per-user ranker weights via pairwise logistic regression on feedback
 * events while enforcing minimum sample thresholds, max weight drift, and safety floors.
 */
export function derivePersonalizedRankerWeights(
  feedbackLog = [],
  watchedMovies = [],
  priorWeights = DEFAULT_RANKER_WEIGHTS,
  options = {}
) {
  const prior = { ...DEFAULT_RANKER_WEIGHTS, ...(priorWeights || {}) };
  if (!Array.isArray(feedbackLog) || feedbackLog.length === 0) {
    return prior;
  }

  const minPositives = options.minPositives ?? 2;
  const minNegatives = options.minNegatives ?? 2;
  const maxDrift = options.maxDrift ?? 0.6;
  const watchedIndex = buildWatchedRatingIndex(watchedMovies);

  const positives = [];
  const negatives = [];

  for (const entry of feedbackLog) {
    if (!entry) continue;
    const rawFeatures =
      sanitizeFeatureSnapshot(entry.features) ||
      resolveLookupFeature(options.featureLookup, entry);
    if (!rawFeatures) continue;

    const rating = resolveEntryRating(entry, watchedIndex);
    const isPositive =
      entry.action === "added_watchlist" ||
      (rating !== null && rating >= 8);
    const isNegative =
      entry.action === "dismissed" ||
      (entry.action === "rated" && rating !== null && rating <= 4);

    if (isPositive && !isNegative) {
      positives.push(toDenseFeatureVector(rawFeatures));
    } else if (isNegative && !isPositive) {
      negatives.push(toDenseFeatureVector(rawFeatures));
    }
  }

  const recentPositives = positives.slice(-50);
  const recentNegatives = negatives.slice(-50);

  if (
    recentPositives.length < minPositives ||
    recentNegatives.length < minNegatives ||
    recentPositives.length + recentNegatives.length < 5
  ) {
    return prior;
  }

  const learned = fitRankerWeights(recentPositives, recentNegatives, prior, {
    iterations: 40,
    learningRate: 0.15,
    l2: 0.35
  });

  const bounded = { ...prior };
  for (const key of Object.keys(prior)) {
    const baseVal = Number(prior[key] ?? 0);
    const rawVal = toFiniteNumber(learned?.[key]) ?? baseVal;
    bounded[key] = Math.max(baseVal - maxDrift, Math.min(baseVal + maxDrift, rawVal));
  }

  bounded.repulsion = Math.min(-1.0, bounded.repulsion);
  bounded.negativeKeywordPenalty = Math.min(-0.35, bounded.negativeKeywordPenalty);
  bounded.collabSim = Math.max(3.5, bounded.collabSim);

  return bounded;
}
