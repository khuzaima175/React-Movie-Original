import { computeBayesianScore } from "./scoringUtils.js";

/**
 * Calibrated Logistic Ranker Weights
 */
export const DEFAULT_RANKER_WEIGHTS = {
  bias: -1.1,
  collabSim: 2.4,
  contentSim: 1.4,
  genreOverlap: 1.1,
  keywordOverlap: 0.8,
  crewMatch: 0.7,
  castMatch: 0.5,
  bayesianRatingNorm: 1.2,
  noveltyBonus: 0.35,
  negativeKeywordPenalty: -2.0,
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
    anchorKeywords = [],
    userProviders = []
  } = context;

  const tmdbId = Number(candidate.tmdbId ?? candidate.id ?? 0);
  const collabSim = Number(collabSimMap?.get?.(tmdbId) ?? candidate.collabSim ?? 0);
  const contentSim = Number(contentSimMap?.get?.(tmdbId) ?? candidate.contentSim ?? 0);

  const lovedSet = new Set(profile.lovedGenreIds || []);
  const candGenres = candidate.tmdbGenreIds || candidate.genre_ids || [];
  let genreHits = 0;
  for (const g of candGenres) {
    if (lovedSet.has(Number(g))) genreHits++;
  }
  const genreOverlap = lovedSet.size > 0
    ? Math.min(1, genreHits / Math.min(3, lovedSet.size))
    : 0;

  const anchorKwSet = new Set(anchorKeywords || []);
  const candKeywords = candidate.tmdbKeywords || [];
  let kwHits = 0;
  for (const k of candKeywords) {
    if (anchorKwSet.has(Number(k))) kwHits++;
  }
  const keywordOverlap = anchorKwSet.size > 0
    ? Math.min(1, kwHits / Math.min(3, anchorKwSet.size))
    : (candidate.sourceBucket?.includes("Bucket B") ? 0.6 : 0);

  const hatedSet = new Set(profile.hatedKeywordIds || []);
  let negHits = 0;
  for (const k of candKeywords) {
    if (hatedSet.has(Number(k))) negHits++;
  }
  const negativeKeywordPenalty = Math.min(1, negHits);

  const crewMatch = (
    (profile.topCrewMemberId && candidate.crewPersonId === profile.topCrewMemberId) ||
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
    providerMatch
  };
}

/**
 * Scores extracted candidate features via a calibrated logistic regression model.
 */
export function scoreCandidate(features = {}, weights = DEFAULT_RANKER_WEIGHTS) {
  let logit = Number(weights.bias || 0);
  for (const [key, w] of Object.entries(weights)) {
    if (key === "bias") continue;
    const x = Number(features[key] || 0);
    if (Number.isFinite(x) && Number.isFinite(w)) {
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
 * Ranks a large candidate pool (200-500 items) down to topK (default 30) with calibrated matchScores.
 */
export function rankCandidatePool(candidates = [], context = {}, weights = DEFAULT_RANKER_WEIGHTS, topK = 30) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const scored = candidates.map(cand => {
    const features = extractCandidateFeatures(cand, context);
    const { logit, probability, matchScore } = scoreCandidate(features, weights);
    return {
      ...cand,
      features,
      rankerLogit: logit,
      rankerProbability: probability,
      matchScore
    };
  });

  scored.sort((a, b) => b.rankerProbability - a.rankerProbability);
  return scored.slice(0, topK);
}
