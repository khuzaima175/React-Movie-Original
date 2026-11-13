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

function parseUtcDateStart(val) {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (val instanceof Date) return Number.isFinite(val.getTime()) ? val.getTime() : null;
  const match = String(val).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isReleasedOnOrAfter(candidate, minReleaseDate) {
  const minTs = parseUtcDateStart(minReleaseDate);
  if (minTs === null) return true;
  const candTs = parseUtcDateStart(candidate?.release_date);
  if (candTs !== null) return candTs >= minTs;
  const yearNum = Number(candidate?.year);
  if (Number.isFinite(yearNum) && yearNum > 1800) {
    const minYear = new Date(minTs).getUTCFullYear();
    if (yearNum > minYear) return true;
    if (yearNum < minYear) return false;
  }
  return false;
}

function computeProbabilityPercentile(sortedDesc, percentile) {
  const n = sortedDesc.length;
  if (n === 0) return 0;
  const p = Math.min(1, Math.max(0, Number(percentile ?? 0)));
  const descPos = (1 - p) * (n - 1);
  const lo = Math.floor(descPos);
  const hi = Math.ceil(descPos);
  const probLo = sortedDesc[lo].rankerProbability;
  const probHi = sortedDesc[hi].rankerProbability;
  return probLo + (descPos - lo) * (probHi - probLo);
}

function computeReserveQualityScore(candidate, weights = DEFAULT_RANKER_WEIGHTS) {
  const f = candidate?.features || {};
  const w = weights || DEFAULT_RANKER_WEIGHTS;
  const bayWeight = 2.5 * Number(w.bayesianRatingNorm ?? 1.2);
  const genreWeight = 0.35 * Number(w.genreOverlap ?? 1.1);

  // Neutralize noveltyBonus in cold-start recent selection so >4000-vote hits are not penalized
  return (
    Number(w.collabSim ?? 4.8) * Number(f.collabSim || 0) +
    Number(w.contentSim ?? 1.4) * Number(f.contentSim || 0) +
    Number(w.crewMatch ?? 0.7) * Number(f.crewMatch || 0) +
    Number(w.castMatch ?? 0.5) * Number(f.castMatch || 0) +
    Number(w.keywordOverlap ?? 0.8) * Number(f.keywordOverlap || 0) +
    Number(w.negativeKeywordPenalty ?? -0.5) * Number(f.negativeKeywordPenalty || 0) +
    Number(w.repulsion ?? -1.5) * Number(f.repulsion || 0) +
    Number(w.providerMatch ?? 0.25) * Number(f.providerMatch || 0) +
    bayWeight * Number(f.bayesianRatingNorm || 0) +
    genreWeight * Number(f.genreOverlap || 0)
  );
}

function selectWithReserve(scoredDesc, topK, reserve, context = {}, weights = DEFAULT_RANKER_WEIGHTS) {
  const limit = Math.min(Math.max(0, Math.floor(Number(topK) || 0)), scoredDesc.length);
  if (limit === 0) return [];
  const rawCount = Math.floor(Number(reserve?.count) || 0);
  if (!reserve || rawCount <= 0) {
    return scoredDesc.slice(0, limit);
  }

  const reserveCount = Math.min(limit, rawCount);
  const headCount = Math.max(0, limit - reserveCount);

  const nonCollabDesc = scoredDesc.filter(c => Number(c.features?.collabSim || 0) <= 0);
  const percentileBasis = nonCollabDesc.length > 0 ? nonCollabDesc : scoredDesc;
  const percentileFloor = computeProbabilityPercentile(percentileBasis, reserve.minProbabilityPercentile ?? 0);
  const absMinProbability = Number(reserve.minProbability ?? 0.54);
  const probFloor = Math.max(percentileFloor, absMinProbability);

  const selected = [];
  const chosenIndices = new Set();
  const chosenIds = new Set();

  const trySelect = (idx) => {
    if (chosenIndices.has(idx)) return false;
    const item = scoredDesc[idx];
    const id = Number(item?.tmdbId ?? item?.id ?? 0);
    if (id > 0 && chosenIds.has(id)) return false;
    chosenIndices.add(idx);
    if (id > 0) chosenIds.add(id);
    selected.push(item);
    return true;
  };

  for (let i = 0; i < headCount && i < scoredDesc.length; i++) {
    trySelect(i);
  }

  const baseQualifying = [];
  for (let i = 0; i < scoredDesc.length; i++) {
    if (chosenIndices.has(i)) continue;
    const cand = scoredDesc[i];
    const id = Number(cand?.tmdbId ?? cand?.id ?? 0);
    if (id > 0 && chosenIds.has(id)) continue;
    if (cand.rankerProbability < probFloor) continue;
    if (!isReleasedOnOrAfter(cand, reserve.minReleaseDate)) continue;
    baseQualifying.push({ idx: i, cand });
  }

  const hasLovedGenres = Array.isArray(context?.profile?.lovedGenreIds) && context.profile.lovedGenreIds.length > 0;
  let reserveCandidates = baseQualifying;
  if (hasLovedGenres) {
    const genreMatched = baseQualifying.filter(entry => Number(entry.cand.features?.genreOverlap || 0) > 0);
    if (genreMatched.length > 0) {
      reserveCandidates = genreMatched;
    }
  }

  reserveCandidates = reserveCandidates
    .map(entry => ({
      ...entry,
      coldStartScore: computeReserveQualityScore(entry.cand, weights)
    }))
    .sort((a, b) => {
      if (b.coldStartScore !== a.coldStartScore) return b.coldStartScore - a.coldStartScore;
      if (b.cand.rankerProbability !== a.cand.rankerProbability) {
        return b.cand.rankerProbability - a.cand.rankerProbability;
      }
      return a.idx - b.idx;
    });

  let reservedAdded = 0;
  for (let i = 0; i < reserveCandidates.length && selected.length < limit && reservedAdded < reserveCount; i++) {
    if (trySelect(reserveCandidates[i].idx)) reservedAdded++;
  }

  for (let i = 0; i < scoredDesc.length && selected.length < limit; i++) {
    trySelect(i);
  }

  selected.sort((a, b) => b.rankerProbability - a.rankerProbability);
  return selected;
}

/**
 * Ranks a large candidate pool (200-500 items) down to topK (default 30) with calibrated matchScores.
 * Dynamically scales positive collabSim relative to pool maximum so shrunk embeddings span [0, 1].
 */
export function rankCandidatePool(candidates = [], context = {}, weights = DEFAULT_RANKER_WEIGHTS, topK = 30, options = {}, reserve = undefined) {
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
  const activeReserve = reserve !== undefined ? reserve : (options?.reserve ?? null);
  return activeReserve ? selectWithReserve(scored, topK, activeReserve, context, weights) : scored.slice(0, topK);
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
