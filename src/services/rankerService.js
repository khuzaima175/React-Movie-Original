import { computeBayesianScore } from "./scoringUtils.js";
import { getCollabCatalogMax, getCollabCatalogPercentile } from "./embeddingService.js";
import {
  getMoodPreset,
  normalizeMoodFilters,
  isExplicitMoodActive,
  matchesMoodCandidateGate,
  GENRE_NAME_TO_ID
} from "./moodPolicy.js";
import { matchesWatchProviders } from "./tmdbService.js";
import {
  compileActiveTasteRules,
  candidateMatchesAvoidRule,
  candidateMatchesPreferRule
} from "./tasteRulesService.js";

export const DEFAULT_METADATA_DAMPING_FACTOR = 0.35;
export const DEFAULT_DISPLAY_TEMPERATURE = 1.45;

/**
 * Calibrated Logistic Ranker Weights (v5.0 offline-optimized on 328-user cohort)
 */
export const DEFAULT_RANKER_WEIGHTS = {
  bias: -1.1,
  collabSim: 6.4,
  contentSim: 1.4,
  genreOverlap: 0.6,
  keywordOverlap: 0.45,
  crewMatch: 0.7,
  castMatch: 0.5,
  bayesianRatingNorm: 1.8,
  noveltyBonus: 0.05,
  negativeKeywordPenalty: -0.5,
  repulsion: -1.5,
  providerMatch: 0.25,
  dnaSim: 0
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
    dnaSimMap = new Map(),
    anchorKeywords = [],
    userProviders = []
  } = context;

  const tmdbId = Number(candidate.tmdbId ?? candidate.id ?? 0);
  const collabSim = Number(collabSimMap?.get?.(tmdbId) ?? candidate.collabSim ?? 0);
  const contentSim = Number(contentSimMap?.get?.(tmdbId) ?? candidate.contentSim ?? 0);
  const repulsion = Number(repulsionMap?.get?.(tmdbId) ?? candidate.repulsion ?? 0);
  const dnaSim = Number(dnaSimMap?.get?.(tmdbId) ?? candidate.dnaSim ?? 0) || 0;

  const lovedSet = new Set(profile.lovedGenreIds || []);
  const candGenres = candidate.tmdbGenreIds || candidate.genre_ids || [];
  let genreHits = 0;
  for (const g of candGenres) {
    if (lovedSet.has(Number(g))) genreHits++;
  }
  const genreOverlap = lovedSet.size > 0
    ? Math.min(1, genreHits / Math.min(3, lovedSet.size))
    : 0;

  const candKeywords = candidate.tmdbKeywords || [];
  const kwAff = profile.keywordAffinities && typeof profile.keywordAffinities === "object"
    ? profile.keywordAffinities
    : null;
  const kwAffEntries = kwAff
    ? Object.entries(kwAff).filter(([_, w]) => Number(w) > 0)
    : [];
  const profileLovedSet = new Set((profile.lovedKeywordIds || []).map(Number));
  const hasExplicitAnchorOverride = Array.isArray(anchorKeywords) &&
    anchorKeywords.length > 0 &&
    anchorKeywords.some(k => !profileLovedSet.has(Number(k)));

  let keywordOverlap = 0;
  if (kwAffEntries.length > 0 && !hasExplicitAnchorOverride) {
    let kwScoreSum = 0;
    const seenKw = new Set();
    for (const rawK of candKeywords) {
      const k = Number(rawK);
      if (seenKw.has(k)) continue;
      seenKw.add(k);
      const w = Number(kwAff[k] ?? kwAff[String(k)] ?? 0);
      if (w > 0) kwScoreSum += w;
    }
    const topWeights = kwAffEntries
      .map(([_, w]) => Number(w))
      .sort((a, b) => b - a)
      .slice(0, 3);
    const denomWeight = topWeights.reduce((a, b) => a + b, 0);
    keywordOverlap = kwScoreSum > 0 && denomWeight > 0
      ? Math.min(1, kwScoreSum / denomWeight)
      : (candidate.sourceBucket?.includes("Bucket B") ? 0.6 : 0);
  } else {
    const effectiveAnchorKws =
      Array.isArray(anchorKeywords) && anchorKeywords.length > 0
        ? anchorKeywords
        : (profile.lovedKeywordIds || []);
    const anchorKwSet = new Set(effectiveAnchorKws.map(Number));
    let kwHits = 0;
    const seenKw = new Set();
    for (const rawK of candKeywords) {
      const k = Number(rawK);
      if (seenKw.has(k)) continue;
      seenKw.add(k);
      if (anchorKwSet.has(k)) kwHits++;
    }
    keywordOverlap = kwHits > 0
      ? Math.min(1, kwHits / Math.min(3, anchorKwSet.size))
      : (candidate.sourceBucket?.includes("Bucket B") ? 0.6 : 0);
  }

  const hatedSet = new Set(profile.hatedKeywordIds || []);
  let negHits = 0;
  for (const k of candKeywords) {
    if (hatedSet.has(Number(k))) negHits++;
  }
  const negativeKeywordPenalty = Math.min(1, negHits);

  const candCrewId = Number(candidate.crewPersonId || 0);
  const crewAff = profile.crewAffinities || {};
  const crewAffEntries = Object.entries(crewAff).filter(([_, w]) => Number(w) > 0);
  let crewMatch = 0;
  if (crewAffEntries.length > 0) {
    const aff = candCrewId > 0 ? Number(crewAff[candCrewId] ?? crewAff[String(candCrewId)] ?? 0) : 0;
    if (aff > 0) {
      crewMatch = Math.min(1, aff);
    } else if (candidate.sourceBucket?.includes("Bucket C")) {
      crewMatch = 0.5;
    }
  } else {
    const topCrewSet = new Set((profile.topCrewIds || []).map(Number));
    if (profile.topCrewMemberId) topCrewSet.add(Number(profile.topCrewMemberId));
    crewMatch = (
      (candCrewId > 0 && topCrewSet.has(candCrewId)) ||
      candidate.sourceBucket?.includes("Bucket C")
    ) ? 1 : 0;
  }

  const candCast = candidate.castIds || [];
  const castAff = profile.castAffinities || {};
  const castAffEntries = Object.entries(castAff).filter(([_, w]) => Number(w) > 0);
  let castMatch = 0;
  if (castAffEntries.length > 0) {
    let castScoreSum = 0;
    const seenCast = new Set();
    candCast.forEach((rawC, idx) => {
      const cId = Number(rawC);
      if (!Number.isFinite(cId) || cId <= 0 || seenCast.has(cId)) return;
      seenCast.add(cId);
      const w = Number(castAff[cId] ?? castAff[String(cId)] ?? 0);
      if (w > 0) {
        castScoreSum += w * (1 / (1 + 0.2 * idx));
      }
    });
    castMatch = Math.min(1, castScoreSum);
  } else {
    const topCastSet = new Set(profile.topCastIds || []);
    castMatch = candCast.some(c => topCastSet.has(Number(c))) ? 1 : 0;
  }

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
    providerMatch,
    dnaSim
  };
}

/**
 * Maps internal ranker logit to a calibrated display percentage in [50, 99] using a
 * display temperature tau so top picks spread cleanly without altering ranking order.
 */
export function computeDisplayMatchScore(logit = 0, temperature = DEFAULT_DISPLAY_TEMPERATURE) {
  const tau = Number.isFinite(Number(temperature)) && Number(temperature) > 0
    ? Number(temperature)
    : 1.0;
  const displayProbability = 1 / (1 + Math.exp(-(Number(logit) || 0) / tau));
  return Math.min(99, Math.max(50, Math.round(50 + 49 * displayProbability)));
}

/**
 * Scores extracted candidate features via a calibrated logistic regression model.
 * When collaborative signal is present, genre and rating norm are damped so discrete ties
 * and mainstream popularity do not push high-confidence collaborative twins out of the top 10.
 */
export function scoreCandidate(features = {}, weights = DEFAULT_RANKER_WEIGHTS, options = {}) {
  let logit = Number(weights.bias || 0);
  const damping = options.metadataDampingFactor ?? DEFAULT_METADATA_DAMPING_FACTOR;
  const smoothDamping = options.smoothDamping !== false;
  let effectiveDamping = 1.0;
  if (smoothDamping) {
    const rawCollabMag = Math.abs(Number(features.rawCollabSim ?? features.collabSim ?? 0));
    const rampMax = Number(options.dampingRampMax ?? 0.02);
    const t = rampMax > 0 ? Math.min(1, rawCollabMag / rampMax) : (rawCollabMag > 0.001 ? 1 : 0);
    const smoothT = t * t * (3 - 2 * t);
    effectiveDamping = 1.0 + smoothT * (damping - 1.0);
  } else if (Math.abs(Number(features.collabSim || 0)) > 0.001) {
    effectiveDamping = damping;
  }

  for (const [key, w] of Object.entries(weights)) {
    if (key === "bias") continue;
    let x = Number(features[key] || 0);
    if (Number.isFinite(x) && Number.isFinite(w)) {
      if (key === "genreOverlap" || key === "bayesianRatingNorm") {
        x *= effectiveDamping;
      }
      logit += w * x;
    }
  }

  const probability = 1 / (1 + Math.exp(-logit));
  const matchScore = computeDisplayMatchScore(logit, options.displayTemperature);

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

/**
 * Cold-start recent-release reserve scorer keeping all weights identical to rankerProbability
 * while neutralizing noveltyBonus (0) so >4,000-vote acclaimed hits are not penalized.
 */
export function computeReserveQualityScore(candidate, weights = DEFAULT_RANKER_WEIGHTS, options = {}) {
  const f = candidate?.features || {};
  return scoreCandidate({ ...f, noveltyBonus: 0 }, weights || DEFAULT_RANKER_WEIGHTS, options).logit;
}

function selectWithReserve(scoredDesc, topK, reserve, context = {}, weights = DEFAULT_RANKER_WEIGHTS, options = {}) {
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
      coldStartScore: computeReserveQualityScore(entry.cand, weights, options)
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
 * Extracts numeric TMDB genre IDs from a candidate's array fields or genre string.
 */
function extractCandidateGenreIds(candidate = {}) {
  const ids = new Set();
  for (const g of [...(candidate.tmdbGenreIds || []), ...(candidate.genre_ids || [])]) {
    const num = Number(g);
    if (Number.isFinite(num) && num > 0) ids.add(num);
  }
  if (ids.size === 0 && typeof candidate.genre === "string" && candidate.genre.trim()) {
    for (const part of candidate.genre.split(",")) {
      const id = GENRE_NAME_TO_ID[part.trim().toLowerCase()];
      if (id) ids.add(id);
    }
  }
  return Array.from(ids);
}

/**
 * Computes an additive mood/filter logit adjustment. Strictly returns 0 in unconstrained
 * "any" mode so offline baseline benchmarks remain identical.
 */
export function computeMoodScoreAdjustment(candidate = {}, mood = "any", moodFilters = null) {
  const normalizedFilters = normalizeMoodFilters(moodFilters);
  const rawMood = typeof mood === "string" ? mood.trim().toLowerCase() : "any";
  const effectiveMood =
    normalizedFilters?.moodId && normalizedFilters.moodId !== "any" && rawMood === "any"
      ? normalizedFilters.moodId
      : rawMood;

  if (!isExplicitMoodActive(effectiveMood, normalizedFilters)) {
    return 0;
  }

  const preset = getMoodPreset(effectiveMood);
  const candGenres = extractCandidateGenreIds(candidate);
  const candGenreSet = new Set(candGenres);
  let delta = 0;

  const preferredIds =
    normalizedFilters?.withGenreIds?.length > 0
      ? normalizedFilters.withGenreIds
      : preset.preferredGenreIds || [];

  if (preferredIds.length > 0 && candGenres.length > 0) {
    const hits = preferredIds.filter(id => candGenreSet.has(id)).length;
    delta += hits > 0 ? Math.min(2.4, 1.6 + 0.5 * (hits - 1)) : -1.4;
  }

  if (preset.discouragedGenreIds?.length > 0 && candGenres.length > 0) {
    let penalty = 0;
    for (const badId of preset.discouragedGenreIds) {
      if (!candGenreSet.has(badId)) continue;
      penalty += badId === 27 ? 2.2 : 1.1;
    }
    delta -= Math.min(2.6, penalty);
  }

  if (preset.id === "hidden-gem") {
    const votes = Number(candidate.vote_count ?? candidate.voteCount ?? 0);
    const rating = Number(candidate.vote_average ?? candidate.imdbRating ?? 0);
    if (votes >= 50 && votes <= 1200 && rating >= 7.2) {
      delta += 2.6;
    } else if (votes >= 50 && votes <= 2000) {
      delta += 2.0;
    } else if (votes > 2000) {
      delta -= 3.5;
    }
  }

  if (candGenres.length > 0) {
    if (preset.id === "mind-bending") {
      if ((candGenreSet.has(9648) || candGenreSet.has(878)) && !candGenreSet.has(28) && !candGenreSet.has(12)) {
        delta += 0.65;
      }
      if ((candGenreSet.has(28) || candGenreSet.has(12)) && !candGenreSet.has(9648)) {
        delta -= 0.85;
      }
    } else if (preset.id === "dark-thriller") {
      if ((candGenreSet.has(80) || candGenreSet.has(53)) && (candGenreSet.has(18) || candGenreSet.has(9648))) {
        delta += 0.65;
      }
      if (candGenreSet.has(878) || candGenreSet.has(14) || candGenreSet.has(12)) {
        delta -= 0.9;
      }
    } else if (preset.id === "fun-popcorn") {
      if (candGenreSet.has(12) || candGenreSet.has(35) || (candGenreSet.has(28) && candGenreSet.has(878))) {
        delta += 0.65;
      }
      if (candGenreSet.has(18) && candGenreSet.has(9648) && !candGenreSet.has(28) && !candGenreSet.has(12) && !candGenreSet.has(35)) {
        delta -= 0.85;
      }
    }
  }

  if (normalizedFilters) {
    const yearMatch = String(candidate.release_date || candidate.year || "").match(/\d{4}/);
    const yr = yearMatch ? Number(yearMatch[0]) : null;
    if (yr !== null) {
      if (normalizedFilters.minYear && yr < normalizedFilters.minYear) delta -= 3.0;
      if (normalizedFilters.maxYear && yr > normalizedFilters.maxYear) delta -= 3.0;
    }
    if (normalizedFilters.withoutKeywords?.length > 0) {
      const haystack = [
        candidate.title,
        candidate.overview,
        candidate.genre,
        ...(Array.isArray(candidate.genre_names) ? candidate.genre_names : [])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      for (const kw of normalizedFilters.withoutKeywords) {
        if (haystack.includes(kw)) {
          delta -= 2.5;
        }
      }
    }
  }

  return delta;
}

/**
 * Ranks a large candidate pool (200-500 items) down to topK (default 30) with calibrated matchScores.
 * Dynamically scales positive collabSim relative to pool maximum so shrunk embeddings span [0, 1].
 */
export function rankCandidatePool(candidates = [], context = {}, weights = DEFAULT_RANKER_WEIGHTS, topK = 30, options = {}, reserve = undefined) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const rawExcludes = context?.excludeIds ?? options?.excludeIds;
  const excludeSet = Array.isArray(rawExcludes) && rawExcludes.length > 0
    ? new Set(rawExcludes.map(id => String(id).trim()).filter(Boolean))
    : null;

  const pool = excludeSet
    ? candidates.filter(c => {
        const ids = [c?.tmdbId, c?.id, c?.imdbID].filter(v => v !== undefined && v !== null && v !== "");
        return !ids.some(v => excludeSet.has(String(v)));
      })
    : candidates;

  if (pool.length === 0) return [];

  const rawMood = context?.mood ?? options?.mood ?? "any";
  const normalizedFilters = normalizeMoodFilters(context?.moodFilters ?? options?.moodFilters ?? null);
  const explicitMood = isExplicitMoodActive(rawMood, normalizedFilters);
  const effectiveMood =
    normalizedFilters?.moodId && normalizedFilters.moodId !== "any" && (!rawMood || rawMood === "any")
      ? normalizedFilters.moodId
      : rawMood;
  const userProviders = context?.userProviders ?? options?.userProviders ?? [];
  const hasProviderFilter = Array.isArray(userProviders) && userProviders.length > 0;

  const rawTasteRules = context?.tasteRules ?? options?.tasteRules;
  const compiledRules = Array.isArray(rawTasteRules) && rawTasteRules.length > 0
    ? compileActiveTasteRules(rawTasteRules)
    : null;
  const avoidRules = compiledRules?.avoidRules || [];
  const preferRules = compiledRules?.preferRules || [];

  let workingPool = pool;
  if (hasProviderFilter) {
    const providerVerified = workingPool.filter(c => matchesWatchProviders(c, userProviders));
    if (providerVerified.length >= Math.min(6, topK)) {
      workingPool = providerVerified;
    } else if (providerVerified.length > 0) {
      const verifiedKeys = new Set(providerVerified.map(c => String(c?.tmdbId ?? c?.id ?? c?.imdbID ?? "")));
      workingPool = [
        ...providerVerified,
        ...workingPool.filter(c => !verifiedKeys.has(String(c?.tmdbId ?? c?.id ?? c?.imdbID ?? "")) && c?.providerMatchedByQuery)
      ];
    }
  }

  const collabSimMap = context?.collabSimMap;
  let maxPoolCollab = 0;
  if (collabSimMap && typeof collabSimMap.get === "function") {
    for (const c of workingPool) {
      const cid = Number(c?.tmdbId ?? c?.id ?? 0);
      const val = Number(collabSimMap.get(cid) ?? c?.collabSim ?? 0);
      if (val > maxPoolCollab) maxPoolCollab = val;
    }
  } else {
    for (const c of workingPool) {
      const val = Number(c?.collabSim ?? 0);
      if (val > maxPoolCollab) maxPoolCollab = val;
    }
  }
  const collabScale = maxPoolCollab > 0.05 ? maxPoolCollab : 1.0;

  const effectiveWeights = explicitMood
    ? { ...weights, collabSim: Number(weights.collabSim ?? DEFAULT_RANKER_WEIGHTS.collabSim) * 0.35 }
    : weights;
  const effectiveOptions = explicitMood
    ? { ...options, metadataDampingFactor: 1.0 }
    : options;

  const normMode = options.collabNormalization ?? "catalog-max";
  const overrideCatalogMax = Number(options?.collabCatalogMax);
  const catalogMax = normMode === "catalog-max"
    ? (Number.isFinite(overrideCatalogMax) && overrideCatalogMax > 0
        ? overrideCatalogMax
        : getCollabCatalogMax(collabSimMap))
    : null;
  const scored = workingPool.map(cand => {
    const features = extractCandidateFeatures(cand, context);
    features.rawCollabSim = features.collabSim;
    if (features.collabSim > 0) {
      if (normMode === "catalog-max" && catalogMax !== null) {
        features.collabSim = Math.min(1.0, features.collabSim / Math.max(0.05, catalogMax));
      } else {
        const catalogPct = normMode === "percentile"
          ? getCollabCatalogPercentile(collabSimMap, features.rawCollabSim, options)
          : null;
        if (catalogPct !== null) {
          features.collabSim = catalogPct;
        } else if (maxPoolCollab > 0.05) {
          features.collabSim = Math.min(1.0, features.collabSim / collabScale);
        }
      }
    }
    const base = scoreCandidate(features, effectiveWeights, effectiveOptions);
    const moodAdj = explicitMood ? computeMoodScoreAdjustment(cand, effectiveMood, normalizedFilters) : 0;
    let ruleAdj = 0;
    if (avoidRules.length > 0 && candidateMatchesAvoidRule(cand, avoidRules).matched) {
      ruleAdj = -3.5;
    } else if (preferRules.length > 0 && candidateMatchesPreferRule(cand, preferRules).matched) {
      ruleAdj = 0.6;
    }
    const adjusted = explicitMood || ruleAdj !== 0;
    const logit = adjusted ? base.logit + moodAdj + ruleAdj : base.logit;
    const probability = adjusted ? 1 / (1 + Math.exp(-logit)) : base.probability;
    const matchScore = adjusted ? computeDisplayMatchScore(logit, effectiveOptions.displayTemperature) : base.matchScore;

    const reasons = generateMatchReasons(features);
    if (explicitMood && moodAdj >= 1.2 && effectiveMood && effectiveMood !== "any") {
      const preset = getMoodPreset(effectiveMood);
      if (preset?.label && reasons.length < 3) {
        reasons.unshift(`🎭 ${preset.label} Fit`);
      }
    }

    const isHydrated =
      cand.hydrated ??
      cand.features?.hydrated ??
      (Array.isArray(cand.tmdbKeywords) && Array.isArray(cand.castIds));
    return {
      ...cand,
      hydrated: Boolean(isHydrated),
      features: {
        ...features,
        hydrated: Boolean(isHydrated)
      },
      rankerLogit: logit,
      rankerProbability: probability,
      moodAdjustment: moodAdj,
      matchScore,
      matchReasons: reasons.slice(0, 3)
    };
  });

  let ordered;
  if (explicitMood) {
    const gatePassed = [];
    const gateRejected = [];
    for (const item of scored) {
      const passesAvoid = avoidRules.length === 0 || !candidateMatchesAvoidRule(item, avoidRules).matched;
      if (passesAvoid && matchesMoodCandidateGate(item, effectiveMood, normalizedFilters)) {
        gatePassed.push(item);
      } else {
        gateRejected.push(item);
      }
    }
    gatePassed.sort((a, b) => b.rankerProbability - a.rankerProbability);
    ordered = gatePassed;
    if (typeof options?.onDiagnostics === "function") {
      options.onDiagnostics({
        explicitMood: true,
        gatePassedCount: gatePassed.length,
        gateRejectedCount: gateRejected.length,
        targetCount: topK,
        moodShortfall: gatePassed.length < topK ? { requested: topK, available: gatePassed.length } : null
      });
    }
  } else {
    scored.sort((a, b) => b.rankerProbability - a.rankerProbability);
    ordered = scored;
  }

  const activeReserve = reserve !== undefined ? reserve : (options?.reserve ?? null);
  return activeReserve ? selectWithReserve(ordered, topK, activeReserve, context, weights, options) : ordered.slice(0, topK);
}

export const DEFAULT_SHORTLIST_DIVERSITY_CONFIG = {
  coreLimit: 25,
  coldLimit: 8,
  outlierLimit: 6,
  shortlistLimit: 39,
  coldMinYear: 2024,
  coldMaxYear: 2026,
  minColdVoteAverage: 6.4,
  minColdVoteCount: 40
};

function extractCandidateYear(candidate = {}) {
  const match = String(candidate?.release_date || candidate?.year || candidate?.Year || "").match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function normalizeDirectorToken(candidate = {}) {
  const raw = String(candidate?.director || "").trim().toLowerCase();
  if (!raw || raw === "unknown" || raw === "n/a") return "";
  return raw;
}

function extractShortlistGenreKeys(candidate = {}) {
  const ids = extractCandidateGenreIds(candidate);
  if (ids.length > 0) return ids.map((id) => `id:${id}`);
  if (typeof candidate?.genre === "string" && candidate.genre.trim()) {
    return candidate.genre
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s !== "n/a")
      .map((s) => `name:${s}`);
  }
  return [];
}

function getShortlistCandidateKey(candidate = {}) {
  const primary = candidate?.tmdbId ?? candidate?.id ?? candidate?.imdbID;
  if (primary !== undefined && primary !== null && String(primary).trim() !== "") {
    return String(primary).trim();
  }
  return `${String(candidate?.title || "").trim().toLowerCase()}::${extractCandidateYear(candidate) ?? ""}`;
}

/**
 * Builds a stratified shortlist (~39 picks: core top-25 + quality cold 2024-2026 + diverse outliers)
 * for Gemini curation while preserving pure math ordering in rankCandidatePool for offline evals.
 */
export function buildDiversifiedGeminiShortlist(
  candidates = [],
  context = {},
  weights = DEFAULT_RANKER_WEIGHTS,
  options = {},
  reserve = undefined
) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const cfg = { ...DEFAULT_SHORTLIST_DIVERSITY_CONFIG, ...(options || {}) };
  const rawShortlistLimit = Number(options?.shortlistLimit ?? options?.topK ?? cfg.shortlistLimit);
  const shortlistLimit = Number.isFinite(rawShortlistLimit) && rawShortlistLimit > 0
    ? Math.floor(rawShortlistLimit)
    : cfg.shortlistLimit;
  const coreLimit = Math.min(Math.max(1, Number(cfg.coreLimit) || 25), shortlistLimit);
  const coldLimit = Math.max(0, Number(cfg.coldLimit));
  const outlierLimit = Math.max(0, Number(cfg.outlierLimit));
  const coldMinYear = Number(cfg.coldMinYear);
  const coldMaxYear = Number(cfg.coldMaxYear);
  const minColdVoteAverage = Number(cfg.minColdVoteAverage);
  const minColdVoteCount = Number(cfg.minColdVoteCount);

  const coreRanked = rankCandidatePool(candidates, context, weights, coreLimit, options, reserve);
  // Strip onDiagnostics on fullRanked so explicit mood shortfall diagnostics never fire twice.
  const fullRanked = rankCandidatePool(
    candidates,
    context,
    weights,
    candidates.length,
    { ...(options || {}), onDiagnostics: undefined },
    null
  );

  if (fullRanked.length === 0) return [];

  const selected = [...coreRanked];
  const selectedKeys = new Set(selected.map(getShortlistCandidateKey));

  const isCold = (c) => Number(c?.features?.rawCollabSim ?? c?.collabSim ?? 0) === 0;
  const passesQuality = (c, minRating = minColdVoteAverage) => {
    const rawRating = c?.vote_average ?? c?.imdbRating;
    if (rawRating !== null && rawRating !== undefined && rawRating !== "" && rawRating !== "N/A") {
      const ratingNum = Number(rawRating);
      if (Number.isFinite(ratingNum) && ratingNum < minRating) return false;
    }
    const rawVotes = Number(c?.vote_count ?? c?.voteCount ?? 0);
    if (Number.isFinite(rawVotes) && rawVotes > 0 && rawVotes < minColdVoteCount) {
      return false;
    }
    return true;
  };

  const rawShortlistRules = context?.tasteRules ?? options?.tasteRules;
  const shortlistAvoidRules = Array.isArray(rawShortlistRules) && rawShortlistRules.length > 0
    ? compileActiveTasteRules(rawShortlistRules).avoidRules
    : [];
  const passesTasteAvoidGuard = (c) => (
    shortlistAvoidRules.length === 0 || !candidateMatchesAvoidRule(c, shortlistAvoidRules).matched
  );

  // Slice 2: Quality Cold 2024-2026 picks (falling back to older cold picks only if < coldLimit recent cold exist)
  const coldCap = Math.min(coldLimit, Math.max(0, shortlistLimit - selected.length));
  if (coldCap > 0) {
    const remainingCold = fullRanked.filter(
      (c) => !selectedKeys.has(getShortlistCandidateKey(c)) && isCold(c) && passesQuality(c, minColdVoteAverage) && passesTasteAvoidGuard(c)
    );
    const recentCold = [];
    const olderCold = [];
    for (const c of remainingCold) {
      const yr = extractCandidateYear(c);
      if (yr !== null && yr >= coldMinYear && yr <= coldMaxYear) {
        recentCold.push(c);
      } else {
        olderCold.push(c);
      }
    }
    for (const pick of [...recentCold, ...olderCold].slice(0, coldCap)) {
      selected.push(pick);
      selectedKeys.add(getShortlistCandidateKey(pick));
    }
  }

  // Slice 3: Diverse Outliers (greedy unseen director +2.0, underrepresented genre +1.0, underrepresented decade +0.8)
  const outlierCap = Math.min(outlierLimit, Math.max(0, shortlistLimit - selected.length));
  if (outlierCap > 0) {
    const seenDirectors = new Set();
    const seenGenres = new Set();
    const seenDecades = new Set();
    for (const item of selected) {
      const d = normalizeDirectorToken(item);
      if (d) seenDirectors.add(d);
      for (const g of extractShortlistGenreKeys(item)) seenGenres.add(g);
      const yr = extractCandidateYear(item);
      if (yr !== null) seenDecades.add(Math.floor(yr / 10) * 10);
    }

    const candidateOutliers = fullRanked.filter((c) => {
      if (selectedKeys.has(getShortlistCandidateKey(c))) return false;
      if (!passesTasteAvoidGuard(c)) return false;
      const rawRating = c?.vote_average ?? c?.imdbRating;
      if (rawRating !== null && rawRating !== undefined && rawRating !== "" && rawRating !== "N/A") {
        const ratingNum = Number(rawRating);
        if (Number.isFinite(ratingNum) && ratingNum < 6.5) return false;
      }
      if (isCold(c) && !passesQuality(c, 6.5)) return false;
      return true;
    });

    const chosenIndices = new Set();
    for (let step = 0; step < outlierCap; step++) {
      let bestIdx = -1;
      let bestBonus = -1;
      let bestProb = -Infinity;
      for (let i = 0; i < candidateOutliers.length; i++) {
        if (chosenIndices.has(i)) continue;
        const c = candidateOutliers[i];
        const d = normalizeDirectorToken(c);
        const genres = extractShortlistGenreKeys(c);
        const yr = extractCandidateYear(c);
        const decade = yr !== null ? Math.floor(yr / 10) * 10 : null;

        let bonus = 0;
        if (d && !seenDirectors.has(d)) bonus += 2.0;
        if (genres.some((g) => !seenGenres.has(g))) bonus += 1.0;
        if (decade !== null && !seenDecades.has(decade)) bonus += 0.8;

        const prob = Number(c?.rankerProbability ?? -Infinity);
        if (bonus > bestBonus || (bonus === bestBonus && prob > bestProb)) {
          bestIdx = i;
          bestBonus = bonus;
          bestProb = prob;
        }
      }
      if (bestIdx === -1) break;
      chosenIndices.add(bestIdx);
      const winner = candidateOutliers[bestIdx];
      selected.push(winner);
      selectedKeys.add(getShortlistCandidateKey(winner));
      const d = normalizeDirectorToken(winner);
      if (d) seenDirectors.add(d);
      for (const g of extractShortlistGenreKeys(winner)) seenGenres.add(g);
      const yr = extractCandidateYear(winner);
      if (yr !== null) seenDecades.add(Math.floor(yr / 10) * 10);
    }
  }

  // Top up any remaining slots below shortlistLimit from fullRanked in rankerProbability order (skipping avoid matches)
  if (selected.length < Math.min(shortlistLimit, fullRanked.length)) {
    for (const c of fullRanked) {
      const k = getShortlistCandidateKey(c);
      if (selectedKeys.has(k) || !passesTasteAvoidGuard(c)) continue;
      selected.push(c);
      selectedKeys.add(k);
      if (selected.length >= shortlistLimit) break;
    }
  }

  return selected.slice(0, shortlistLimit);
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
