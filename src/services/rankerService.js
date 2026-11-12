import { computeBayesianScore } from "./scoringUtils.js";

/**
 * Calibrated Logistic Ranker Weights
 */
export const DEFAULT_RANKER_WEIGHTS = {
  bias: -1.1,
  collabSim: 4.8,
  contentSim: 1.4,
  genreOverlap: 1.1,
  keywordOverlap: 0.8,
  crewMatch: 0.7,
  castMatch: 0.5,
  bayesianRatingNorm: 1.2,
  noveltyBonus: 0.35,
  negativeKeywordPenalty: -0.5,
  repulsion: -1.5,
  providerMatch: 0.25
};

/**
 * Extracts normalized ranking features for a candidate movie.
 */
export function extractCandidateFeatures(candidate = {}, context = {}) {
  const {
    profile = {},
    collabSimMap = new Map(),
    contentSimMap = new Map(),
    repulsionMap = new Map(),
    anchorKeywords = [],
    userProviders = []
  } = context;

  const tmdbId = Number(candidate.tmdbId ?? candidate.id ?? 0);
  const collabSim = Number(collabSimMap?.get?.(tmdbId) ?? candidate.collabSim ?? 0);
  const contentSim = Number(contentSimMap?.get?.(tmdbId) ?? candidate.contentSim ?? 0);
  const repulsion = Number(repulsionMap?.get?.(tmdbId) ?? candidate.repulsion ?? 0);

  const lovedSet = new Set(profile.lovedGenreIds || []);
  const candGenres = candidate.tmdbGenreIds || candidate.genre_ids || [];
  let genreHits = 0;
  for (const g of candGenres) {
    if (lovedSet.has(Number(g))) genreHits++;
  }
  const genreOverlap = lovedSet.size > 0
    ? Math.min(1, genreHits / Math.min(3, lovedSet.size))
    : 0;

  const effectiveAnchorKws =
    Array.isArray(anchorKeywords) && anchorKeywords.length > 0
      ? anchorKeywords
      : (profile.lovedKeywordIds || []);
  const anchorKwSet = new Set(effectiveAnchorKws.map(Number));
  const candKeywords = candidate.tmdbKeywords || [];
  let kwHits = 0;
  for (const k of candKeywords) {
    if (anchorKwSet.has(Number(k))) kwHits++;
  }
  const keywordOverlap = kwHits > 0
    ? Math.min(1, kwHits / Math.min(3, anchorKwSet.size))
    : (candidate.sourceBucket?.includes("Bucket B") ? 0.6 : 0);

  const hatedSet = new Set(profile.hatedKeywordIds || []);
  let negHits = 0;
  for (const k of candKeywords) {
    if (hatedSet.has(Number(k))) negHits++;
  }
  const negativeKeywordPenalty = Math.min(1, negHits);

  const candCrewId = Number(candidate.crewPersonId || 0);
  const topCrewSet = new Set((profile.topCrewIds || []).map(Number));
  if (profile.topCrewMemberId) topCrewSet.add(Number(profile.topCrewMemberId));
  const crewMatch = (
    (candCrewId > 0 && topCrewSet.has(candCrewId)) ||
    candidate.sourceBucket?.includes("Bucket C")
  ) ? 1 : 0;

  const topCastSet = new Set(profile.topCastIds || []);
  const candCast = candidate.castIds || [];
  const castMatch = candCast.some(c => topCastSet.has(Number(c))) ? 1 : 0;

  const bayesian = computeBayesianScore(candidate.vote_average, candidate.vote_count, 500, 7.0);
  const bayesianRatingNorm = Math.max(0, Math.min(1, (bayesian - 5.0) / 4.5));

  const voteCount = Math.max(10, Number(candidate.vote_count || 200));
  const noveltyBonus = voteCount >= 100 && voteCount <= 4000 ? 0.5 : 0.1;

  const providerSet = new Set(userProviders || []);
  const candProviders = (candidate.streamProviders || []).map(p => p.id || p);
  const providerMatch = providerSet.size === 0
    ? 0.5
    : (candidate.providerMatchedByQuery || candProviders.some(id => providerSet.has(Number(id))) ? 1 : 0);

  return {
    collabSim,
    contentSim,
    genreOverlap,
    keywordOverlap,
    crewMatch,
    castMatch,
    bayesianRatingNorm,
    noveltyBonus,
    negativeKeywordPenalty,
    repulsion,
    providerMatch
  };
}

/**
 * Scores extracted candidate features via a calibrated logistic regression model.
 * When collaborative signal is present, genre and rating norm are damped so discrete ties
 * and mainstream popularity do not push high-confidence collaborative twins out of the top 10.
 */
export function scoreCandidate(features = {}, weights = DEFAULT_RANKER_WEIGHTS, options = {}) {
  let logit = Number(weights.bias || 0);
  const hasCollabSignal = Math.abs(Number(features.collabSim || 0)) > 0.001;
  const damping = options.metadataDampingFactor ?? 0.20;

  for (const [key, w] of Object.entries(weights)) {
    if (key === "bias") continue;
    let x = Number(features[key] || 0);
    if (Number.isFinite(x) && Number.isFinite(w)) {
      if (hasCollabSignal && (key === "genreOverlap" || key === "bayesianRatingNorm")) {
        x *= damping;
      }
      logit += w * x;
    }
  }

  const probability = 1 / (1 + Math.exp(-logit));
  const matchScore = Math.min(99, Math.max(50, Math.round(50 + 49 * probability)));

  return {
    logit,
    probability,
    matchScore
  };
}

/**
 * Deterministically generates top 2-3 human-readable match reason badges from candidate features.
 */
export function generateMatchReasons(features = {}) {
  const reasons = [];
  const collab = Number(features.collabSim || 0);
  const crew = Number(features.crewMatch || 0);
  const cast = Number(features.castMatch || 0);
  const kw = Number(features.keywordOverlap || 0);
  const genre = Number(features.genreOverlap || 0);
  const rating = Number(features.bayesianRatingNorm || 0);
  const novelty = Number(features.noveltyBonus || 0);

  if (collab >= 0.28) {
    reasons.push("🧬 High Taste-Twin Match");
  } else if (collab >= 0.15) {
    reasons.push("🤝 Collaborative Taste Pick");
  }

  if (crew > 0) {
    reasons.push("🎬 Favorite Filmmaker");
  } else if (cast > 0) {
    reasons.push("🎭 Top Cast Match");
  }

  if (kw >= 0.33) {
    reasons.push("🎯 Core Theme Match");
  }

  if (collab >= 0.16 && novelty >= 0.35) {
    reasons.push("💎 Personal Cult Pick");
  }

  if (genre >= 0.66) {
    reasons.push("🎪 Genre Bullseye");
  }

  if (rating >= 0.72) {
    reasons.push("⭐ Critical Acclaim");
  }

  if (reasons.length === 0) {
    reasons.push(novelty >= 0.35 ? "🔍 Hidden Discovery" : "✨ Curated Selection");
  }

  return reasons.slice(0, 3);
}

/**
 * Ranks a large candidate pool (200-500 items) down to topK (default 30) with calibrated matchScores.
 * Dynamically scales positive collabSim relative to pool maximum so shrunk embeddings span [0, 1].
 */
export function rankCandidatePool(candidates = [], context = {}, weights = DEFAULT_RANKER_WEIGHTS, topK = 30, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const collabSimMap = context?.collabSimMap;
  let maxPoolCollab = 0;
  if (collabSimMap && typeof collabSimMap.get === "function") {
    for (const c of candidates) {
      const cid = Number(c?.tmdbId ?? c?.id ?? 0);
      const val = Number(collabSimMap.get(cid) ?? c?.collabSim ?? 0);
      if (val > maxPoolCollab) maxPoolCollab = val;
    }
  } else {
    for (const c of candidates) {
      const val = Number(c?.collabSim ?? 0);
      if (val > maxPoolCollab) maxPoolCollab = val;
    }
  }
  const collabScale = maxPoolCollab > 0.05 ? maxPoolCollab : 1.0;

  const scored = candidates.map(cand => {
    const features = extractCandidateFeatures(cand, context);
    features.rawCollabSim = features.collabSim;
    if (features.collabSim > 0 && maxPoolCollab > 0.05) {
      features.collabSim = Math.min(1.0, features.collabSim / collabScale);
    }
    const { logit, probability, matchScore } = scoreCandidate(features, weights, options);
    return {
      ...cand,
      features,
      rankerLogit: logit,
      rankerProbability: probability,
      matchScore,
      matchReasons: generateMatchReasons(features)
    };
  });

  scored.sort((a, b) => b.rankerProbability - a.rankerProbability);
  return scored.slice(0, topK);
}

/**
 * Fits L2-regularized pairwise logistic regression weights shrunk toward priorWeights (never toward zero).
 */
export function fitRankerWeights(
  positiveFeatures = [],
  negativeFeatures = [],
  priorWeights = DEFAULT_RANKER_WEIGHTS,
  options = {}
) {
  const {
    iterations = 40,
    learningRate = 0.15,
    l2 = 0.25,
    featureKeys = Object.keys(DEFAULT_RANKER_WEIGHTS).filter(k => k !== "bias")
  } = options;

  if (!positiveFeatures.length || !negativeFeatures.length) {
    return { ...priorWeights };
  }

  const w = { ...priorWeights };
  const pairCount = positiveFeatures.length * negativeFeatures.length;

  for (let iter = 0; iter < iterations; iter++) {
    const grad = Object.fromEntries(featureKeys.map(k => [k, 0]));

    for (const pos of positiveFeatures) {
      for (const neg of negativeFeatures) {
        let diffLogit = 0;
        for (const k of featureKeys) {
          const wk = Number(w[k] || 0);
          const dx = Number(pos[k] || 0) - Number(neg[k] || 0);
          diffLogit += wk * dx;
        }
        const prob = 1 / (1 + Math.exp(-diffLogit));
        const err = prob - 1; // gradient of -log(sigmoid(diffLogit))
        for (const k of featureKeys) {
          const dx = Number(pos[k] || 0) - Number(neg[k] || 0);
          grad[k] += err * dx;
        }
      }
    }

    for (const k of featureKeys) {
      const prior = Number(priorWeights[k] || 0);
      const regGrad = grad[k] / pairCount + l2 * (Number(w[k] || 0) - prior);
      w[k] = Number(w[k] || 0) - learningRate * regGrad;
    }
  }

  return w;
}
