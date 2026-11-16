/**
 * Vault analytics helpers. Keeps UI components thin and allows unit testing
 * rating distributions and recommendation conversion telemetry directly without React mounts.
 */
import { findMatchingMovie } from "./movieIdentity.js";

function normalizePipelineName(rawPipeline) {
  if (typeof rawPipeline !== "string" || !rawPipeline.trim()) return null;
  const clean = rawPipeline.trim().toLowerCase();
  if (clean === "gemini" || clean === "gemini-curation" || clean === "gemini-omdb-fallback") {
    return "gemini";
  }
  if (clean === "ranker-fallback" || clean === "ranker-preliminary" || clean === "ranker") {
    return "ranker-fallback";
  }
  return clean;
}

function normalizeRecSourcePayload(raw, fallback = {}) {
  if (!raw || typeof raw !== "object") return null;
  const shownAt =
    typeof raw.shownAt === "string" && raw.shownAt.trim()
      ? raw.shownAt.trim()
      : fallback.shownAt || new Date().toISOString();
  const rawMatchScore = raw.matchScore ?? fallback.matchScore;
  const matchScore =
    rawMatchScore !== null && rawMatchScore !== undefined && Number.isFinite(Number(rawMatchScore))
      ? Number(rawMatchScore)
      : null;
  const mood =
    typeof raw.mood === "string" && raw.mood.trim()
      ? raw.mood.trim()
      : fallback.mood || "any";
  const rawRank = raw.rank ?? fallback.rank;
  const rank =
    rawRank !== null && rawRank !== undefined && Number.isFinite(Number(rawRank))
      ? Math.max(1, Math.round(Number(rawRank)))
      : null;
  const pipeline = normalizePipelineName(raw.pipeline ?? fallback.pipeline);
  return {
    shownAt,
    matchScore,
    mood,
    rank,
    ...(pipeline ? { pipeline } : {})
  };
}

/**
 * Stamps lightweight provenance onto returned AI recommendation cards before saving/caching.
 */
export function attachRecSourceToRecommendations(
  recommendations = [],
  mood = "any",
  shownAt = new Date().toISOString(),
  pipeline = null
) {
  if (!Array.isArray(recommendations)) return [];
  const cleanMood = typeof mood === "string" && mood.trim() ? mood.trim() : "any";
  const normalizedPipeline = normalizePipelineName(pipeline);
  return recommendations.map((rec, idx) => {
    if (!rec || typeof rec !== "object") return rec;
    const recPipeline = normalizePipelineName(rec.pipeline) || normalizedPipeline;
    const existing = normalizeRecSourcePayload(rec.recSource, {
      shownAt,
      matchScore: rec.matchScore,
      mood: cleanMood,
      rank: idx + 1,
      ...(recPipeline ? { pipeline: recPipeline } : {})
    });
    const recSource = existing || {
      shownAt,
      matchScore: Number.isFinite(Number(rec.matchScore)) ? Number(rec.matchScore) : null,
      mood: cleanMood,
      rank: idx + 1,
      ...(recPipeline ? { pipeline: recPipeline } : {})
    };
    return {
      ...rec,
      recSource
    };
  });
}

/**
 * Resolves `recSource` provenance for a movie entering watchlist or watched,
 * preserving existing provenance across watchlist -> watched transitions and direct ratings.
 */
export function resolveMovieRecSource(
  movie,
  aiRecommendations = [],
  fallbackSources = [],
  nowIso = new Date().toISOString()
) {
  if (!movie || typeof movie !== "object") return null;
  if (movie.recSource && typeof movie.recSource === "object") {
    return normalizeRecSourcePayload(movie.recSource, { shownAt: nowIso });
  }

  for (const src of Array.isArray(fallbackSources) ? fallbackSources : []) {
    if (src?.recSource && typeof src.recSource === "object") {
      return normalizeRecSourcePayload(src.recSource, { shownAt: nowIso });
    }
  }

  const recs = Array.isArray(aiRecommendations) ? aiRecommendations : [];
  const matchedRec = findMatchingMovie(recs, movie);
  if (!matchedRec) return null;

  const matchedIndex = recs.indexOf(matchedRec);
  const rank = matchedIndex >= 0 ? matchedIndex + 1 : null;
  if (matchedRec.recSource && typeof matchedRec.recSource === "object") {
    return normalizeRecSourcePayload(matchedRec.recSource, {
      shownAt: nowIso,
      matchScore: matchedRec.matchScore,
      mood: "any",
      rank
    });
  }

  return normalizeRecSourcePayload(
    {
      shownAt: nowIso,
      matchScore: matchedRec.matchScore ?? null,
      mood: "any",
      rank
    },
    { shownAt: nowIso }
  );
}

function computeHitRateSlice(items = []) {
  const totalRatedFromRecs = items.length;
  if (totalRatedFromRecs === 0) {
    return {
      totalRatedFromRecs: 0,
      count8Plus: 0,
      count9Plus: 0,
      hitRate8Plus: 0,
      hitRate9Plus: 0,
      meanRating: 0
    };
  }

  let count8Plus = 0;
  let count9Plus = 0;
  let ratingSum = 0;
  for (const movie of items) {
    const rating = Number(movie.userRating);
    ratingSum += rating;
    if (rating >= 8) count8Plus += 1;
    if (rating >= 9) count9Plus += 1;
  }

  return {
    totalRatedFromRecs,
    count8Plus,
    count9Plus,
    hitRate8Plus: count8Plus / totalRatedFromRecs,
    hitRate9Plus: count9Plus / totalRatedFromRecs,
    meanRating: ratingSum / totalRatedFromRecs
  };
}

/**
 * Computes real-world conversion hit rates on watched films that originated from AI recommendations,
 * both overall and split by pipeline (`gemini` vs `rankerFallback`).
 */
export function computeRecommendationHitRate(watched = []) {
  const fromRecs = (Array.isArray(watched) ? watched : []).filter(
    (movie) =>
      movie &&
      typeof movie === "object" &&
      movie.recSource &&
      typeof movie.recSource === "object" &&
      Number.isFinite(Number(movie.userRating)) &&
      Number(movie.userRating) > 0
  );

  const overall = computeHitRateSlice(fromRecs);
  const geminiItems = [];
  const rankerFallbackItems = [];

  for (const movie of fromRecs) {
    const p = normalizePipelineName(movie.recSource?.pipeline || movie.pipeline);
    if (p === "ranker-fallback") {
      rankerFallbackItems.push(movie);
    } else if (p === "gemini") {
      geminiItems.push(movie);
    }
  }

  return {
    ...overall,
    byPipeline: {
      gemini: computeHitRateSlice(geminiItems),
      rankerFallback: computeHitRateSlice(rankerFallbackItems)
    }
  };
}

export function buildRatingHistogramBins(watched = []) {
  const counts = new Map();
  for (let score = 10; score >= 1; score -= 1) {
    counts.set(score, 0);
  }

  for (const movie of Array.isArray(watched) ? watched : []) {
    if (!movie || typeof movie !== "object") continue;
    const rawUser = Number(movie.userRating);
    const rawImdb = Number(movie.imdbRating);
    const numericRating =
      Number.isFinite(rawUser) && rawUser > 0
        ? rawUser
        : Number.isFinite(rawImdb) && rawImdb > 0
          ? rawImdb
          : null;

    if (numericRating === null) continue;
    const rounded = Math.min(10, Math.max(1, Math.round(numericRating)));
    counts.set(rounded, (counts.get(rounded) || 0) + 1);
  }

  let maxCount = 1;
  for (const count of counts.values()) {
    if (count > maxCount) maxCount = count;
  }

  const bins = [];
  for (let score = 10; score >= 1; score -= 1) {
    const count = counts.get(score) || 0;
    bins.push({
      score,
      label: `${score}★`,
      count,
      heightPct: count > 0 ? Math.round((count / maxCount) * 100) : 0
    });
  }

  return { bins, maxCount };
}
