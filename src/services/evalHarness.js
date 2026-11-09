import { computeZScoredWeights, computeBayesianScore } from "./scoringUtils.js";

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

/**
 * Splits a user's watched history into chronological training history and the last N liked films.
 */
export function temporalHoldoutSplit(watched = [], holdoutPositiveCount = 10, minPositiveRating = 8) {
  const valid = (watched || []).filter(m => {
    const r = Number(m?.userRating ?? m?.UserRating ?? 0);
    return Number.isFinite(r) && r > 0 && getMovieKey(m);
  });

  const indexed = valid.map((m, idx) => {
    const rawDate = m.dateWatched || m.addedAt;
    const ts = rawDate ? Date.parse(rawDate) : NaN;
    return {
      movie: m,
      idx,
      ts: Number.isFinite(ts) ? ts : idx
    };
  });

  indexed.sort((a, b) => (a.ts === b.ts ? a.idx - b.idx : a.ts - b.ts));

  let positiveFound = 0;
  let splitIndex = indexed.length;
  let earliestPositiveIndex = indexed.length;

  for (let i = indexed.length - 1; i >= 0; i--) {
    const r = Number(indexed[i].movie.userRating ?? indexed[i].movie.UserRating ?? 0);
    if (r >= minPositiveRating) {
      positiveFound++;
      earliestPositiveIndex = i;
      if (positiveFound === holdoutPositiveCount) {
        splitIndex = i;
        break;
      }
    }
  }

  if (splitIndex === indexed.length && indexed.length > 1) {
    if (positiveFound > 0) {
      splitIndex = Math.max(1, earliestPositiveIndex);
    } else {
      splitIndex = Math.max(1, indexed.length - holdoutPositiveCount);
    }
  }

  const trainWatched = indexed.slice(0, splitIndex).map(x => x.movie);
  const holdoutSlice = indexed.slice(splitIndex).map(x => x.movie);

  const holdoutPositives = new Set();
  const holdoutRelevance = new Map();

  for (const m of holdoutSlice) {
    const key = getMovieKey(m);
    const r = Number(m.userRating ?? m.UserRating ?? 0);
    holdoutRelevance.set(key, r);
    if (r >= minPositiveRating) {
      holdoutPositives.add(key);
    }
  }

  return {
    trainWatched,
    holdoutPositives,
    holdoutRelevance
  };
}

/**
 * Computes Recall@K against held-out positive items.
 */
export function computeRecallAtK(recommendedIds = [], holdoutPositives = new Set(), k = 20) {
  if (!holdoutPositives || holdoutPositives.size === 0) return 0;
  const topK = (recommendedIds || []).slice(0, k).map(String);
  let hits = 0;
  for (const id of topK) {
    if (holdoutPositives.has(id)) hits++;
  }
  return hits / holdoutPositives.size;
}

/**
 * Computes Normalized Discounted Cumulative Gain (NDCG@K).
 */
export function computeNDCGAtK(recommendedIds = [], holdoutRelevance = new Map(), k = 10) {
  if (!holdoutRelevance || holdoutRelevance.size === 0) return 0;

  const gain = rel => (rel >= 8 ? Math.pow(2, rel - 7) - 1 : 0);
  const topK = (recommendedIds || []).slice(0, k).map(String);

  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const rel = holdoutRelevance.get(topK[i]) || 0;
    const g = gain(rel);
    if (g > 0) {
      dcg += g / Math.log2(i + 2);
    }
  }

  const idealGains = [...holdoutRelevance.values()]
    .map(gain)
    .filter(g => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k);

  if (idealGains.length === 0) return 0;

  let idcg = 0;
  for (let i = 0; i < idealGains.length; i++) {
    idcg += idealGains[i] / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Computes Intra-List Diversity (ILD): mean pairwise cosine distance (1 - cos(u, v)).
 */
export function computeILD(recommendedIds = [], embeddingLookup) {
  if (typeof embeddingLookup !== "function") return 0;
  const vectors = (recommendedIds || [])
    .map(id => embeddingLookup(id))
    .filter(v => v && v.length > 0);

  if (vectors.length < 2) return 0;

  let totalDist = 0;
  let pairs = 0;

  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const u = vectors[i];
      const v = vectors[j];
      const len = Math.min(u.length, v.length);
      let dot = 0;
      let normU = 0;
      let normV = 0;
      for (let d = 0; d < len; d++) {
        dot += u[d] * v[d];
        normU += u[d] * u[d];
        normV += v[d] * v[d];
      }
      const denom = Math.sqrt(normU) * Math.sqrt(normV);
      const cos = denom > 0 ? dot / denom : 0;
      totalDist += Math.max(0, 1 - cos);
      pairs++;
    }
  }

  return pairs > 0 ? totalDist / pairs : 0;
}

/**
 * Computes Self-Information Novelty: mean -log2(popularity_prob).
 */
export function computeNovelty(recommendedItems = [], maxPopularity = 25000) {
  if (!recommendedItems || recommendedItems.length === 0) return 0;
  const denom = Math.max(1, maxPopularity);

  let totalInfo = 0;
  for (const item of recommendedItems) {
    const popCount = Number(item?.vote_count ?? item?.popularity ?? 50);
    const prob = Math.min(0.999, Math.max(1e-4, popCount / denom));
    totalInfo += -Math.log2(prob);
  }

  return totalInfo / recommendedItems.length;
}

/**
 * Grid-searches decay rate lambda and anchor cutoffs against a temporal holdout.
 */
export function gridSearchHyperparams(watched = [], candidateCatalog = [], paramGrid = {}) {
  const {
    lambdas = [0.001, 0.002, 0.005],
    anchorCutoffs = [8, 9],
    bulkPriorDaysList = [180],
    holdoutSize = 10
  } = paramGrid;

  const { trainWatched, holdoutPositives, holdoutRelevance } = temporalHoldoutSplit(
    watched,
    holdoutSize,
    8
  );

  const trainIds = new Set(trainWatched.map(getMovieKey));
  const unseenCatalog = (candidateCatalog || []).filter(c => !trainIds.has(getMovieKey(c)));

  const leaderboard = [];

  for (const lambda of lambdas) {
    for (const anchorCutoff of anchorCutoffs) {
      for (const bulkPriorDays of bulkPriorDaysList) {
        const weighted = computeZScoredWeights(trainWatched, { lambda, bulkPriorDays });

        const genreAffinities = new Map();
        const keywordAffinities = new Map();
        for (const item of weighted) {
          const gIds = item.movie.tmdbGenreIds || item.movie.genre_ids || [];
          for (const g of gIds) {
            genreAffinities.set(g, (genreAffinities.get(g) || 0) + item.weight);
          }
          if (item.rating >= anchorCutoff && Array.isArray(item.movie.tmdbKeywords)) {
            for (const kw of item.movie.tmdbKeywords) {
              keywordAffinities.set(kw, (keywordAffinities.get(kw) || 0) + item.weight * 1.5);
            }
          }
        }

        const scored = unseenCatalog.map(cand => {
          const gIds = cand.tmdbGenreIds || cand.genre_ids || [];
          let gScore = 0;
          for (const g of gIds) {
            gScore += genreAffinities.get(g) || 0;
          }
          let kwScore = 0;
          if (Array.isArray(cand.tmdbKeywords)) {
            for (const kw of cand.tmdbKeywords) {
              kwScore += keywordAffinities.get(kw) || 0;
            }
          }
          const bayes = computeBayesianScore(cand.vote_average, cand.vote_count);
          return {
            cand,
            id: getMovieKey(cand),
            score: gScore + kwScore + bayes * 0.25
          };
        });

        scored.sort((a, b) => b.score - a.score);
        const recIds = scored.map(s => s.id);
        const top20Items = scored.slice(0, 20).map(s => s.cand);

        const metrics = {
          recallAt20: computeRecallAtK(recIds, holdoutPositives, 20),
          ndcgAt10: computeNDCGAtK(recIds, holdoutRelevance, 10),
          novelty: computeNovelty(top20Items)
        };

        leaderboard.push({
          params: { lambda, anchorCutoff, bulkPriorDays },
          metrics
        });
      }
    }
  }

  leaderboard.sort((a, b) => {
    if (b.metrics.ndcgAt10 !== a.metrics.ndcgAt10) return b.metrics.ndcgAt10 - a.metrics.ndcgAt10;
    if (b.metrics.recallAt20 !== a.metrics.recallAt20) return b.metrics.recallAt20 - a.metrics.recallAt20;
    return b.metrics.novelty - a.metrics.novelty;
  });

  return {
    bestParams: leaderboard[0]?.params || { lambda: 0.002, anchorCutoff: 9, bulkPriorDays: 180 },
    bestMetrics: leaderboard[0]?.metrics || { recallAt20: 0, ndcgAt10: 0, novelty: 0 },
    leaderboard
  };
}
