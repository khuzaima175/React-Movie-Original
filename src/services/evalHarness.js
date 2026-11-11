import { computeZScoredWeights, computeBayesianScore } from "./scoringUtils.js";
import { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } from "./rankerService.js";
import { extractTasteProfile } from "./tmdbService.js";
import { buildCollabSimMapFromIndex, buildRepulsionMapFromIndex } from "./embeddingService.js";

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

/**
 * Orders rated films chronologically (by dateWatched/addedAt, falling back to insertion order).
 */
function chronologicalIndex(watched = []) {
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
      dated: Number.isFinite(ts),
      ts: Number.isFinite(ts) ? ts : idx
    };
  });

  indexed.sort((a, b) => (a.ts === b.ts ? a.idx - b.idx : a.ts - b.ts));
  return indexed;
}

/**
 * Splits a user's watched history into chronological training history and the last N liked films.
 */
export function temporalHoldoutSplit(watched = [], holdoutPositiveCount = 10, minPositiveRating = 8) {
  const indexed = chronologicalIndex(watched);

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
  const firstHoldout = indexed[splitIndex];
  const holdoutStartTs = firstHoldout && firstHoldout.dated ? firstHoldout.ts : null;

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
    holdoutRelevance,
    holdoutStartTs
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
    holdoutSize = 10,
    now
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
        const weighted = computeZScoredWeights(trainWatched, { lambda, bulkPriorDays, now });

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

/* ------------------------------------------------------------------------------------------
 * Ranker evaluation (Phase 1): scores the REAL logistic ranker against fixed baselines
 * ---------------------------------------------------------------------------------------- */

export const EVAL_STRATEGIES = ["ranker", "popularity", "toy", "random"];

function seededRandom(seed = 1) {
  let a = Number(seed) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(list, seed) {
  const out = [...list];
  const rng = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map(v => (v - m) ** 2)));
}

/**
 * Evaluates one strategy on one temporal holdout of a single vault.
 *
 * Strategies: "ranker" (the real rankCandidatePool), "popularity" (Bayesian rating only),
 * "toy" (the legacy genre + keyword + rating formula), "random" (seeded shuffle).
 *
 * Mirrors the live call: no anchorKeywords and no user providers are passed to the ranker, and
 * candidates carry whatever sourceBucket the catalog snapshot recorded.
 * Returns { status: "insufficient_data", reason } instead of a number when the vault is too small.
 */
export async function evaluateRanker(options = {}) {
  const {
    watched = [],
    catalog = [],
    strategy = "ranker",
    weights,
    collabSimMap,
    contentSimMap,
    repulsionMap,
    embeddingIndex,
    embeddingOptions = {},
    rankerOptions = {},
    holdoutSize = 10,
    minPositiveRating = 8,
    minTrain = 10,
    minHoldoutPositives = 3,
    excludeIds = [],
    seed = 1,
    embeddingLookup,
    profileOptions = {}
  } = options;

  if (!EVAL_STRATEGIES.includes(strategy)) {
    throw new Error(`Unknown strategy: ${strategy}`);
  }

  const split = temporalHoldoutSplit(watched, holdoutSize, minPositiveRating);
  const counts = {
    train: split.trainWatched.length,
    holdoutPositives: split.holdoutPositives.size
  };

  if (counts.train < minTrain) {
    return {
      status: "insufficient_data",
      strategy,
      counts,
      reason: `needs at least ${minTrain} training ratings, found ${counts.train}`
    };
  }
  if (counts.holdoutPositives < minHoldoutPositives) {
    return {
      status: "insufficient_data",
      strategy,
      counts,
      reason: `needs at least ${minHoldoutPositives} held-out positives, found ${counts.holdoutPositives}`
    };
  }

  const holdoutKeys = new Set(split.holdoutRelevance.keys());
  const excluded = new Set((excludeIds || []).map(String));
  for (const m of watched || []) {
    const key = getMovieKey(m);
    if (key && !holdoutKeys.has(key)) excluded.add(key);
  }

  const candidates = (catalog || []).filter(c => {
    const key = getMovieKey(c);
    return key && !excluded.has(key);
  });

  counts.candidates = candidates.length;
  counts.holdoutInCandidates = candidates.filter(c => split.holdoutPositives.has(getMovieKey(c))).length;

  if (candidates.length === 0) {
    return { status: "insufficient_data", strategy, counts, reason: "no candidates left after exclusions" };
  }

  if (strategy === "toy") {
    const toy = gridSearchHyperparams(watched, candidates, {
      lambdas: [0.002],
      anchorCutoffs: [9],
      bulkPriorDaysList: [180],
      holdoutSize,
      now: split.holdoutStartTs ?? undefined
    });
    return { status: "ok", strategy, counts, metrics: toy.bestMetrics };
  }

  let ranked;
  let coverage;
  if (embeddingIndex && embeddingIndex.idToIndex) {
    const hasVec = m => {
      const tid = Number(m?.tmdbId ?? m?.id ?? 0);
      return tid > 0 && embeddingIndex.idToIndex.has(tid);
    };
    coverage = {
      vaultCovered: (watched || []).filter(hasVec).length,
      vaultTotal: (watched || []).length,
      catalogCovered: candidates.filter(hasVec).length,
      catalogTotal: candidates.length
    };
  }

  if (strategy === "ranker") {
    // anchorCutoff: Infinity disables the anchor lookup so offline evaluation never hits the network.
    const profile = await extractTasteProfile(split.trainWatched, [], {
      now: split.holdoutStartTs ?? undefined,
      anchorCutoff: Infinity,
      ...profileOptions
    });
    const effectiveCollabSimMap =
      collabSimMap ??
      (embeddingIndex ? buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex, embeddingOptions) : new Map());
    const effectiveRepulsionMap =
      repulsionMap ??
      (embeddingIndex ? buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex, embeddingOptions) : new Map());
    ranked = rankCandidatePool(
      candidates,
      {
        profile,
        collabSimMap: effectiveCollabSimMap,
        contentSimMap: contentSimMap ?? new Map(),
        repulsionMap: effectiveRepulsionMap,
        anchorKeywords: profile.lovedKeywordIds || [],
        userProviders: []
      },
      weights ?? DEFAULT_RANKER_WEIGHTS,
      candidates.length,
      rankerOptions
    );
  } else if (strategy === "popularity") {
    ranked = candidates
      .map(c => ({ item: c, score: computeBayesianScore(c.vote_average, c.vote_count) }))
      .sort((a, b) => b.score - a.score || getMovieKey(a.item).localeCompare(getMovieKey(b.item)))
      .map(x => x.item);
  } else {
    ranked = seededShuffle(candidates, seed);
  }

  const ids = ranked.map(getMovieKey);
  const metrics = {
    recallAt20: computeRecallAtK(ids, split.holdoutPositives, 20),
    ndcgAt10: computeNDCGAtK(ids, split.holdoutRelevance, 10),
    novelty: computeNovelty(ranked.slice(0, 20))
  };
  if (typeof embeddingLookup === "function") {
    metrics.ild = computeILD(ids.slice(0, 10), embeddingLookup);
  }

  const out = { status: "ok", strategy, counts, metrics };
  if (coverage) out.coverage = coverage;
  return out;
}

/**
 * Rolling-origin evaluation: fold 0 holds out the most recent liked films; fold i drops the last
 * i * holdoutSize liked films (and everything after them) and holds out the window before that.
 * Every fold trains only on data older than its own holdout. Reports mean and spread per metric.
 */
export async function evaluateRankerRolling(options = {}) {
  const {
    watched = [],
    folds = 3,
    holdoutSize = 10,
    minPositiveRating = 8,
    strategies = EVAL_STRATEGIES,
    ...rest
  } = options;

  const indexed = chronologicalIndex(watched);
  const positivePositions = [];
  indexed.forEach((entry, pos) => {
    const r = Number(entry.movie.userRating ?? entry.movie.UserRating ?? 0);
    if (r >= minPositiveRating) positivePositions.push(pos);
  });

  const foldInputs = [];
  for (let i = 0; i < folds; i++) {
    const dropCount = i * holdoutSize;
    let cut = indexed.length;
    if (dropCount > 0) {
      if (positivePositions.length - dropCount < holdoutSize) break;
      cut = positivePositions[positivePositions.length - dropCount];
    }
    foldInputs.push({
      watched: indexed.slice(0, cut).map(x => x.movie),
      excludeIds: indexed.slice(cut).map(x => getMovieKey(x.movie))
    });
  }

  const result = { requestedFolds: folds, strategies: {} };

  for (const strategy of strategies) {
    const foldResults = [];
    for (const input of foldInputs) {
      foldResults.push(
        await evaluateRanker({
          ...rest,
          watched: input.watched,
          excludeIds: input.excludeIds,
          strategy,
          holdoutSize,
          minPositiveRating
        })
      );
    }

    const ok = foldResults.filter(f => f.status === "ok");
    if (ok.length === 0) {
      result.strategies[strategy] = {
        status: "insufficient_data",
        reason: foldResults[0]?.reason || "no usable folds",
        folds: foldResults,
        foldsUsed: 0
      };
      continue;
    }

    const keys = Object.keys(ok[0].metrics);
    const meanMetrics = {};
    const stdMetrics = {};
    for (const key of keys) {
      const values = ok.map(f => f.metrics[key]);
      meanMetrics[key] = mean(values);
      stdMetrics[key] = stdDev(values);
    }

    result.strategies[strategy] = {
      status: "ok",
      folds: foldResults,
      foldsUsed: ok.length,
      mean: meanMetrics,
      std: stdMetrics
    };
  }

  return result;
}

/**
 * Renders rolling evaluation results as a plain-text comparison table.
 */
export function formatEvalReport(rolling = {}) {
  const entries = Object.entries(rolling.strategies || {});
  const metricKeys = [];
  for (const [, res] of entries) {
    for (const key of Object.keys(res.mean || {})) {
      if (!metricKeys.includes(key)) metricKeys.push(key);
    }
  }

  const lines = [["strategy", "folds", ...metricKeys].join(" | ")];
  for (const [name, res] of entries) {
    if (res.status !== "ok") {
      lines.push(`${name} | 0/${rolling.requestedFolds ?? "?"} | insufficient data: ${res.reason}`);
      continue;
    }
    const cells = metricKeys.map(key =>
      res.mean[key] === undefined ? "-" : `${res.mean[key].toFixed(3)} +/- ${res.std[key].toFixed(3)}`
    );
    lines.push([name, `${res.foldsUsed}/${rolling.requestedFolds ?? res.foldsUsed}`, ...cells].join(" | "));
  }
  return lines.join("\n");
}
