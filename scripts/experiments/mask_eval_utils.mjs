import { extractTasteProfile } from "../../src/services/tmdbService.js";
import { buildCollabSimMapFromIndex, buildRepulsionMapFromIndex } from "../../src/services/embeddingService.js";
import { buildContentSimMap } from "../../src/services/contentSimService.js";
import { temporalHoldoutSplit } from "../../src/services/evalHarness.js";

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

export function makeMaskRng(seed = 1) {
  let s = Number(seed) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Deterministically samples a sorted item-level subset of positive numeric tmdbIds.
 * The returned Set is independent of user history so every user in a run sees the
 * same masked item set.
 */
export function selectMaskedTmdbIds(itemIds = [], maskFrac = 0, maskSeed = 1) {
  const frac = Number(maskFrac);
  if (!Number.isFinite(frac) || frac <= 0) return new Set();
  const clamped = Math.min(1, frac);

  const unique = new Set();
  for (const raw of itemIds || []) {
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0) unique.add(id);
  }
  const sorted = [...unique].sort((a, b) => a - b);
  if (sorted.length === 0) return new Set();
  if (clamped >= 1) return new Set(sorted);

  const targetCount = Math.round(clamped * sorted.length);
  if (targetCount <= 0) return new Set();

  const rng = makeMaskRng(maskSeed);
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  }
  return new Set(sorted.slice(0, targetCount));
}

/**
 * Returns a copy of `simMap` with masked candidate tmdbIds removed so masked films
 * receive collabSim === 0 / repulsion === 0 on the candidate side only.
 */
export function maskSimMapCandidates(simMap, maskedIds) {
  if (!(simMap instanceof Map)) return new Map();
  if (!(maskedIds instanceof Set) || maskedIds.size === 0) return simMap;
  const out = new Map(simMap);
  for (const rawId of maskedIds) {
    out.delete(Number(rawId));
  }
  return out;
}

/**
 * Mirrors `evaluateRanker`'s user profile + candidate exclusion setup, builds
 * `collabSimMap` and `repulsionMap` from the FULL `embeddingIndex`, and removes
 * `maskedIds` only from the candidate-facing maps.
 */
export async function buildMaskedCandidateMapsForEval({
  watched = [],
  catalog = [],
  excludeIds = [],
  holdoutSize = 10,
  minPositiveRating = 8,
  embeddingIndex = null,
  embeddingOptions = {},
  profileOptions = {},
  maskedIds = new Set()
}) {
  const split = temporalHoldoutSplit(watched, holdoutSize, minPositiveRating);
  const holdoutKeys = new Set(split.holdoutRelevance.keys());
  const excluded = new Set((excludeIds || []).map(String));
  for (const m of watched || []) {
    const key = getMovieKey(m);
    if (key && !holdoutKeys.has(key)) excluded.add(key);
  }
  const candidateIds = [];
  for (const c of catalog || []) {
    const key = getMovieKey(c);
    if (key && !excluded.has(key)) candidateIds.push(key);
  }

  if (!embeddingIndex) {
    return {
      split,
      profile: null,
      candidateIds,
      fullCollabSimMap: new Map(),
      maskedCollabSimMap: new Map(),
      fullRepulsionMap: new Map(),
      maskedRepulsionMap: new Map()
    };
  }

  const profile = await extractTasteProfile(split.trainWatched, [], {
    now: split.holdoutStartTs ?? undefined,
    anchorCutoff: Infinity,
    ...profileOptions
  });

  const fullCollabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex, embeddingOptions);
  const fullRepulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex, embeddingOptions);
  const maskedCollabSimMap = maskSimMapCandidates(fullCollabSimMap, maskedIds);
  const maskedRepulsionMap = maskSimMapCandidates(fullRepulsionMap, maskedIds);

  return {
    split,
    profile,
    candidateIds,
    fullCollabSimMap,
    maskedCollabSimMap,
    fullRepulsionMap,
    maskedRepulsionMap
  };
}

/**
 * Classifies one item ID as cold (`!inIndex || isMasked`) vs warm (`inIndex && !isMasked`).
 */
export function classifyWarmColdId(rawId, indexIdSet = new Set(), maskedIds = new Set()) {
  const tid = Number(rawId);
  const inIndex = indexIdSet instanceof Set && Number.isFinite(tid) && indexIdSet.has(tid);
  const isMasked = maskedIds instanceof Set && Number.isFinite(tid) && maskedIds.has(tid);
  return {
    inIndex,
    isMasked,
    isCold: !inIndex || isMasked,
    isWarm: inIndex && !isMasked
  };
}

/**
 * Computes per-evaluation warm vs. cold Recall@20 and Top-20 / pool / holdout cold shares.
 */
export function computeWarmColdBreakdown({
  rankedIds = [],
  candidateIds = [],
  holdoutPositives = new Set(),
  indexIdSet = new Set(),
  maskedIds = new Set()
}) {
  const top20 = (rankedIds || []).slice(0, 20).map(String);
  const top20Set = new Set(top20);

  let top20ColdCount = 0;
  let top20MaskedCount = 0;
  for (const id of top20) {
    const cls = classifyWarmColdId(id, indexIdSet, maskedIds);
    if (cls.isCold) top20ColdCount++;
    if (cls.isMasked) top20MaskedCount++;
  }

  let poolColdCount = 0;
  let poolMaskedCount = 0;
  for (const id of candidateIds || []) {
    const cls = classifyWarmColdId(id, indexIdSet, maskedIds);
    if (cls.isCold) poolColdCount++;
    if (cls.isMasked) poolMaskedCount++;
  }

  let posColdCount = 0;
  let posColdHits = 0;
  let posMaskedCount = 0;
  let posMaskedHits = 0;
  let posWarmCount = 0;
  let posWarmHits = 0;

  for (const rawPosId of holdoutPositives || []) {
    const posId = String(rawPosId);
    const cls = classifyWarmColdId(posId, indexIdSet, maskedIds);
    const hit = top20Set.has(posId);
    if (cls.isCold) {
      posColdCount++;
      if (hit) posColdHits++;
      if (cls.inIndex && cls.isMasked) {
        posMaskedCount++;
        if (hit) posMaskedHits++;
      }
    } else {
      posWarmCount++;
      if (hit) posWarmHits++;
    }
  }

  const posTotalCount = holdoutPositives?.size ?? 0;
  return {
    top20Count: top20.length,
    top20ColdCount,
    top20MaskedCount,
    top20ColdShare: top20.length > 0 ? top20ColdCount / top20.length : 0,
    top20MaskedShare: top20.length > 0 ? top20MaskedCount / top20.length : 0,
    poolCount: (candidateIds || []).length,
    poolColdCount,
    poolMaskedCount,
    poolColdShare: (candidateIds || []).length > 0 ? poolColdCount / candidateIds.length : 0,
    poolMaskedShare: (candidateIds || []).length > 0 ? poolMaskedCount / candidateIds.length : 0,
    posTotalCount,
    holdoutColdShare: posTotalCount > 0 ? posColdCount / posTotalCount : 0,
    holdoutMaskedShare: posTotalCount > 0 ? posMaskedCount / posTotalCount : 0,
    posColdCount,
    posColdHits,
    posMaskedCount,
    posMaskedHits,
    posWarmCount,
    posWarmHits,
    coldRecall20: posColdCount > 0 ? posColdHits / posColdCount : null,
    maskedRecall20: posMaskedCount > 0 ? posMaskedHits / posMaskedCount : null,
    warmRecall20: posWarmCount > 0 ? posWarmHits / posWarmCount : null
  };
}

/**
 * Aggregates per-user warm/cold breakdowns into macro user means and micro pooled ratios.
 */
export function aggregateWarmColdBreakdowns(entries = []) {
  const meanOf = vals => (vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null);
  const top20ColdShares = [];
  const top20MaskedShares = [];
  const poolColdShares = [];
  const poolMaskedShares = [];
  const holdoutColdShares = [];
  const holdoutMaskedShares = [];
  const coldRecs = [];
  const maskedRecs = [];
  const warmRecs = [];

  let totalColdPos = 0;
  let totalColdHits = 0;
  let totalMaskedPos = 0;
  let totalMaskedHits = 0;
  let totalWarmPos = 0;
  let totalWarmHits = 0;

  for (const e of entries || []) {
    if (!e) continue;
    top20ColdShares.push(e.top20ColdShare);
    top20MaskedShares.push(e.top20MaskedShare);
    poolColdShares.push(e.poolColdShare);
    poolMaskedShares.push(e.poolMaskedShare);
    holdoutColdShares.push(e.holdoutColdShare);
    holdoutMaskedShares.push(e.holdoutMaskedShare);
    if (e.coldRecall20 !== null) coldRecs.push(e.coldRecall20);
    if (e.maskedRecall20 !== null) maskedRecs.push(e.maskedRecall20);
    if (e.warmRecall20 !== null) warmRecs.push(e.warmRecall20);

    totalColdPos += e.posColdCount;
    totalColdHits += e.posColdHits;
    totalMaskedPos += e.posMaskedCount;
    totalMaskedHits += e.posMaskedHits;
    totalWarmPos += e.posWarmCount;
    totalWarmHits += e.posWarmHits;
  }

  const top20ColdShare = meanOf(top20ColdShares) ?? 0;
  const poolColdShare = meanOf(poolColdShares) ?? 0;
  const holdoutColdShare = meanOf(holdoutColdShares) ?? 0;

  return {
    nUsers: (entries || []).length,
    nUsersWithColdPos: coldRecs.length,
    nUsersWithMaskedPos: maskedRecs.length,
    nUsersWithWarmPos: warmRecs.length,
    macroColdRecall20: meanOf(coldRecs),
    macroMaskedRecall20: meanOf(maskedRecs),
    macroWarmRecall20: meanOf(warmRecs),
    totalColdPos,
    totalColdHits,
    microColdRecall20: totalColdPos > 0 ? totalColdHits / totalColdPos : null,
    totalMaskedPos,
    totalMaskedHits,
    microMaskedRecall20: totalMaskedPos > 0 ? totalMaskedHits / totalMaskedPos : null,
    totalWarmPos,
    totalWarmHits,
    microWarmRecall20: totalWarmPos > 0 ? totalWarmHits / totalWarmPos : null,
    top20ColdShare,
    top20MaskedShare: meanOf(top20MaskedShares) ?? 0,
    poolColdShare,
    poolMaskedShare: meanOf(poolMaskedShares) ?? 0,
    holdoutColdShare,
    holdoutMaskedShare: meanOf(holdoutMaskedShares) ?? 0,
    top20MinusPoolColdShare: top20ColdShare - poolColdShare
  };
}

/**
 * Mirrors `evalHarness.js`'s `chronologicalIndex` and `evaluateRankerRolling` fold-slicing logic
 * so per-fold user taste vectors can be built on the full index before candidate-side masking.
 */
export function buildRollingFoldInputs(watched = [], folds = 3, holdoutSize = 10, minPositiveRating = 8) {
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
  return foldInputs;
}

/**
 * Verifies that masked candidates actually lose collaborative coverage and enter the
 * `coldOnly: true` structured content fallback path (`contentSim > 0`).
 */
export async function verifyColdFallbackPath({
  watched = [],
  catalog = [],
  embeddingIndex = null,
  embeddingOptions = {},
  profileOptions = {},
  maskedIds = new Set(),
  holdoutSize = 10,
  minPositiveRating = 8
}) {
  if (!embeddingIndex || !watched?.length || !catalog?.length) {
    return { verified: false, reason: "missing inputs" };
  }
  const prep = await buildMaskedCandidateMapsForEval({
    watched,
    catalog,
    holdoutSize,
    minPositiveRating,
    embeddingIndex,
    embeddingOptions,
    profileOptions,
    maskedIds
  });

  const holdoutKeys = new Set(prep.split.holdoutRelevance.keys());
  const excluded = new Set();
  for (const m of watched) {
    const k = getMovieKey(m);
    if (k && !holdoutKeys.has(k)) excluded.add(k);
  }
  const candidates = catalog.filter(c => {
    const k = getMovieKey(c);
    return k && !excluded.has(k);
  });

  const contentMap = buildContentSimMap(prep.profile.weightedRatings, null, candidates, {
    collabIndex: embeddingIndex,
    collabSimMap: prep.maskedCollabSimMap,
    enableStructuredFallback: true,
    coldOnly: true
  });

  let maskedCandCount = 0;
  let maskedCollabZeroCount = 0;
  let maskedContentNonZeroCount = 0;
  let warmCandCount = 0;
  let warmColdLeakCount = 0;

  for (const c of candidates) {
    const tid = Number(c?.tmdbId ?? c?.id ?? 0);
    if (!tid) continue;
    if (maskedIds.has(tid)) {
      maskedCandCount++;
      const collabVal = Number(prep.maskedCollabSimMap.get(tid) ?? 0);
      if (collabVal === 0) maskedCollabZeroCount++;
      if ((contentMap.get(tid) ?? 0) > 0) maskedContentNonZeroCount++;
    } else if (Math.abs(Number(prep.maskedCollabSimMap.get(tid) ?? 0)) > 0.001) {
      warmCandCount++;
      if ((contentMap.get(tid) ?? 0) > 0) warmColdLeakCount++;
    }
  }

  return {
    verified:
      maskedCandCount === maskedCollabZeroCount &&
      maskedContentNonZeroCount > 0 &&
      warmColdLeakCount === 0,
    candidatesCount: candidates.length,
    maskedCandCount,
    maskedCollabZeroCount,
    maskedContentNonZeroCount,
    warmCandCount,
    warmColdLeakCount
  };
}
