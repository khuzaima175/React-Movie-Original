/**
 * Statistical Rating Normalization, Time-Decay, and Bayesian Shrinkage Utilities
 */

export function computeUserRatingStats(watched = []) {
  const ratings = (watched || [])
    .map(m => Number(m?.userRating ?? m?.UserRating ?? 0))
    .filter(r => Number.isFinite(r) && r > 0);

  const count = ratings.length;
  if (count === 0) {
    return { mean: 6.5, std: 1.5, rawStd: 0, count: 0 };
  }

  const mean = ratings.reduce((sum, r) => sum + r, 0) / count;
  const variance = ratings.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / count;
  const rawStd = Math.sqrt(variance);

  return {
    mean,
    std: Math.max(rawStd, 0.5),
    rawStd,
    count
  };
}

export const DEFAULT_DECAY_TIER_FLOORS = Object.freeze({
  masterpiece: 0.45, // >= 9.5★ or (rewatchCount >= 2 && rating >= 8)
  exceptional: 0.30, // >= 9★
  great: 0.20,       // >= 8★
  disliked: 0.25,    // <= 4★
  neutral: 0.10      // 4.5★ .. 7.5★
});

/**
 * Resolves the asymptotic recency decay floor in [0, 1] for a rated film.
 * Tiered mode (default) preserves all-time masterpieces, rewatches, and strong
 * dislikes while allowing casual mid-tier watches to fade over time.
 * Legacy mode returns 0 (pure exponential decay to zero).
 * Uniform mode returns the configured `decayFloor`.
 */
export function resolveDecayFloor(movie = {}, rating = 0, options = {}) {
  const mode = options.decayMode ?? "tiered";
  if (mode === "legacy" || options.dualClock) return 0;

  if (mode === "uniform") {
    const f = Number(options.decayFloor ?? 0);
    return Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0;
  }

  if (mode === "tiered") {
    const tiers = { ...DEFAULT_DECAY_TIER_FLOORS, ...(options.tierFloors || {}) };
    const r = Number(rating);
    const rewatchCount = Number(movie?.watchMeta?.rewatchCount ?? movie?.rewatchCount ?? 0);
    let rawFloor = tiers.neutral;
    if ((Number.isFinite(r) && r >= 9.5) || (Number.isFinite(rewatchCount) && rewatchCount >= 2 && Number.isFinite(r) && r >= 8)) {
      rawFloor = tiers.masterpiece;
    } else if (Number.isFinite(r) && r >= 9) {
      rawFloor = tiers.exceptional;
    } else if (Number.isFinite(r) && r >= 8) {
      rawFloor = tiers.great;
    } else if (Number.isFinite(r) && r <= 4) {
      rawFloor = tiers.disliked;
    }
    const f = Number(rawFloor);
    return Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0;
  }

  return 0;
}

/**
 * Computes recency time-decay in (0, 1], smoothly interpolating from 1.0 at day 0
 * toward `floor` as daysSince increases: floor + (1 - floor) * exp(-lambda * daysSince).
 */
export function computeTimeDecay(daysSince, options = {}) {
  const {
    lambda = 0.002,
    dualClock = false,
    lambdaSlow = 0.0008,
    lambdaFast = 0.07,
    slowShare = 0.70,
    floor = 0
  } = options;

  if (dualClock) {
    return slowShare * Math.exp(-lambdaSlow * daysSince) + (1 - slowShare) * Math.exp(-lambdaFast * daysSince);
  }

  const clampedFloor = Math.max(0, Math.min(1, Number(floor) || 0));
  const expDecay = Math.exp(-lambda * daysSince);
  return clampedFloor + (1 - clampedFloor) * expDecay;
}

/**
 * Computes per-user z-scored rating weights with bulk-import-safe exponential time decay.
 */
export function computeZScoredWeights(watched = [], options = {}) {
  const {
    lambda = 0.002,
    dualClock = false,
    lambdaSlow = 0.0008,
    lambdaFast = 0.07,
    slowShare = 0.70,
    now = Date.now(),
    minStd = 0.5,
    bulkPriorDays = 180
  } = options;

  const valid = (watched || []).filter(m => {
    const r = Number(m?.userRating ?? m?.UserRating ?? 0);
    return Number.isFinite(r) && r > 0;
  });

  if (valid.length === 0) return [];

  const stats = computeUserRatingStats(valid);
  const effStd = Math.max(stats.rawStd, minStd);

  return valid.map(movie => {
    const rating = Number(movie.userRating ?? movie.UserRating ?? 0);

    let zScore;
    if (stats.count < 3) {
      zScore = (rating - 5.5) / 2.0;
    } else if (stats.rawStd === 0) {
      zScore = rating >= 7 ? 0.5 : rating <= 4 ? -0.5 : 0;
    } else {
      zScore = (rating - stats.mean) / effStd;
    }

    let daysSince = bulkPriorDays;
    if (!movie.isBulkImported && movie.dateWatched) {
      const parsedMs = Date.parse(movie.dateWatched);
      if (Number.isFinite(parsedMs)) {
        daysSince = Math.max(0, (now - parsedMs) / 86400000);
      }
    }

    const floor = resolveDecayFloor(movie, rating, options);
    const timeDecay = computeTimeDecay(daysSince, {
      lambda,
      dualClock,
      lambdaSlow,
      lambdaFast,
      slowShare,
      floor
    });
    const weight = zScore * timeDecay;

    return {
      movie,
      rating,
      zScore,
      daysSince,
      timeDecay,
      weight
    };
  });
}

/**
 * Computes IMDB/TMDB Bayesian Shrinkage Rating
 */
export function computeBayesianScore(voteAverage, voteCount, m = 500, C = 7.0) {
  const v = Math.max(0, Number(voteCount) || 0);
  const R = Number(voteAverage) || C;
  return (v / (v + m)) * R + (m / (v + m)) * C;
}
