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

/**
 * Computes per-user z-scored rating weights with bulk-import-safe exponential time decay.
 */
export function computeZScoredWeights(watched = [], options = {}) {
  const {
    lambda = 0.002,
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

    const timeDecay = Math.exp(-lambda * daysSince);
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
