import { isSameMovie } from "./movieIdentity.js";
import { compileActiveTasteRules, candidateMatchesAvoidRule } from "./tasteRulesService.js";
import { matchesWatchProviders } from "./tmdbService.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function toDisplayPct(score01) {
  return Math.max(50, Math.min(99, Math.round(50 + clamp01(score01) * 49)));
}

/**
 * Generates an unguessable 8-character uppercase alphanumeric room code (omitting O/0/I/1).
 */
export function generateRoomCode(length = 8) {
  const out = [];
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const buf = new Uint8Array(length);
    cryptoObj.getRandomValues(buf);
    for (let i = 0; i < length; i += 1) {
      out.push(ROOM_CODE_ALPHABET[buf[i] % ROOM_CODE_ALPHABET.length]);
    }
    return out.join("");
  }
  for (let i = 0; i < length; i += 1) {
    out.push(ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]);
  }
  return out.join("");
}

/**
 * Computes Nash-welfare / damped harmonic joint compatibility for two players so a film
 * both enjoy (e.g. 0.78 & 0.78) always beats one partner loving it and the other hating it.
 */
export function scoreJointCandidate(scoreA, scoreB, options = {}) {
  const a = clamp01(scoreA);
  const b = clamp01(scoreB);
  const minFloor = Number.isFinite(Number(options.minFloor)) ? Number(options.minFloor) : 0.35;
  const harmonic = a + b > 1e-6 ? (2 * a * b) / (a + b) : 0;
  const minScore = Math.min(a, b);
  const penalty = minScore < minFloor ? 0.45 : 1.0;
  const jointScore = clamp01(harmonic * penalty);

  let balanceLabel = "Balanced Pick";
  if (minScore < minFloor) {
    balanceLabel = "One-Sided";
  } else if (minScore >= 0.72) {
    balanceLabel = "Mutual Sweet Spot";
  } else if (Math.abs(a - b) <= 0.12) {
    balanceLabel = "Shared Ground";
  }

  return {
    jointScore: Number(jointScore.toFixed(4)),
    minScore: Number(minScore.toFixed(4)),
    balanceLabel
  };
}

/**
 * Computes normalized [0, 1] cosine affinity across candidate IDs from a partner's 64-D CVEM vector.
 */
export function buildPartnerScoreMapFromVector(
  partnerVector64 = null,
  embeddingIndex = null,
  candidateIds = []
) {
  const map = new Map();
  if (!Array.isArray(partnerVector64) || partnerVector64.length !== 64 || !embeddingIndex?.idToIndex) {
    return map;
  }

  const dim = Number(embeddingIndex.dim) || 64;
  if (dim !== 64 || !embeddingIndex.vectors) return map;

  let normP = 0;
  for (let d = 0; d < 64; d += 1) {
    const v = Number(partnerVector64[d]) || 0;
    normP += v * v;
  }
  if (normP <= 1e-10) return map;
  const invNormP = 1 / Math.sqrt(normP);

  const idsToScan =
    Array.isArray(candidateIds) && candidateIds.length > 0
      ? candidateIds
      : [...embeddingIndex.idToIndex.keys()];

  for (const rawId of idsToScan) {
    const tmdbId = Number(rawId);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
    const idx = embeddingIndex.idToIndex.get(tmdbId);
    if (idx === undefined) continue;

    const base = idx * 64;
    let dot = 0;
    let normC = 0;
    for (let d = 0; d < 64; d += 1) {
      const c = embeddingIndex.vectors[base + d];
      dot += c * (Number(partnerVector64[d]) || 0);
      normC += c * c;
    }
    if (normC <= 1e-10) continue;
    const cos = Math.max(-1, Math.min(1, (dot * invNormP) / Math.sqrt(normC)));
    // Map cosine [-1, 1] -> [0, 1] centered at 0.5
    map.set(tmdbId, clamp01(0.5 + cos * 0.5));
  }
  return map;
}

/**
 * Normalizes a raw score Map<tmdbId, number> to [0, 1] using rank-percentile / max scaling
 * so EASE+SVD scores and 64-D vector scores combine cleanly on a comparable scale.
 */
export function normalizeScoreMapToUnit(scoreMap) {
  const out = new Map();
  if (!(scoreMap instanceof Map) || scoreMap.size === 0) return out;
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const v of scoreMap.values()) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (n < minVal) minVal = n;
    if (n > maxVal) maxVal = n;
  }
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return out;
  const span = maxVal - minVal;
  for (const [k, v] of scoreMap.entries()) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (span <= 1e-8) {
      out.set(k, clamp01(n));
    } else if (minVal >= 0 && maxVal <= 1) {
      out.set(k, clamp01(n));
    } else {
      out.set(k, clamp01((n - minVal) / span));
    }
  }
  return out;
}

/**
 * Builds a deduplicated, interleaved candidate TMDB ID pool from both partners' top unseen
 * EASE+SVD / 64-D vector neighbors, falling back to `fallbackIds` only to reach `limit`.
 */
export function buildJointCandidateIdPool({
  scoresA = new Map(),
  scoresB = new Map(),
  fallbackIds = [],
  watchedA = [],
  watchedB = [],
  limit = 90
} = {}) {
  const watchedSet = new Set(
    [...(Array.isArray(watchedA) ? watchedA : []), ...(Array.isArray(watchedB) ? watchedB : [])]
      .map((m) => Number(typeof m === "object" && m !== null ? (m.tmdbId ?? m.id) : m))
      .filter((n) => Number.isSafeInteger(n) && n > 0)
  );

  const topFromMap = (scoreMap, maxCount = 60) => {
    if (!(scoreMap instanceof Map) || scoreMap.size === 0) return [];
    return [...scoreMap.entries()]
      .filter(([id, score]) => Number.isSafeInteger(Number(id)) && Number(id) > 0 && !watchedSet.has(Number(id)) && Number.isFinite(Number(score)))
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, maxCount)
      .map(([id]) => Number(id));
  };

  const listA = topFromMap(scoresA, Math.max(50, limit));
  const listB = topFromMap(scoresB, Math.max(50, limit));
  const out = [];
  const seen = new Set();

  const tryPush = (rawId) => {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0 || watchedSet.has(id) || seen.has(id)) return false;
    seen.add(id);
    out.push(id);
    return true;
  };

  const maxLen = Math.max(listA.length, listB.length);
  for (let i = 0; i < maxLen && out.length < limit; i += 1) {
    if (i < listA.length) tryPush(listA[i]);
    if (out.length >= limit) break;
    if (i < listB.length) tryPush(listB[i]);
  }

  for (const fbId of Array.isArray(fallbackIds) ? fallbackIds : []) {
    if (out.length >= limit) break;
    tryPush(fbId);
  }

  return out.slice(0, Math.max(1, limit));
}

/**
 * Ranks a candidate pool for two viewers:
 * - Excludes movies seen by EITHER partner
 * - Drops movies violating EITHER partner's active avoid Taste Rules
 * - Optionally restricts to `userProviders` when `requireSelectedProviders` is true
 * - Scores via Nash-welfare harmonic joint compatibility + quality/provider tie-breakers
 */
export function rankWatchTogetherCandidates({
  candidates = [],
  scoresA = new Map(),
  scoresB = new Map(),
  watchedA = [],
  watchedB = [],
  tasteRulesA = [],
  tasteRulesB = [],
  userProviders = [],
  requireSelectedProviders = false,
  limit = 20
} = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const combinedWatched = [
    ...(Array.isArray(watchedA) ? watchedA : []),
    ...(Array.isArray(watchedB) ? watchedB : [])
  ];
  const watchedTmdbSet = new Set(
    combinedWatched
      .map((m) => Number(typeof m === "object" && m !== null ? (m.tmdbId ?? m.id) : m))
      .filter((n) => Number.isSafeInteger(n) && n > 0)
  );

  const avoidRules = [
    ...compileActiveTasteRules(Array.isArray(tasteRulesA) ? tasteRulesA : []).avoidRules,
    ...compileActiveTasteRules(Array.isArray(tasteRulesB) ? tasteRulesB : []).avoidRules
  ];

  const normA = normalizeScoreMapToUnit(scoresA);
  const normB = normalizeScoreMapToUnit(scoresB);
  const hasProviderPref = Array.isArray(userProviders) && userProviders.length > 0;

  const scored = [];
  const seenCandidateIds = new Set();

  for (const cand of candidates) {
    if (!cand || typeof cand !== "object") continue;
    const tmdbId = Number(cand.tmdbId ?? cand.id ?? 0);
    if (tmdbId > 0) {
      if (seenCandidateIds.has(tmdbId) || watchedTmdbSet.has(tmdbId)) continue;
      seenCandidateIds.add(tmdbId);
    }
    if (combinedWatched.some((w) => typeof w === "object" && w !== null && isSameMovie(w, cand))) {
      continue;
    }
    if (avoidRules.length > 0 && candidateMatchesAvoidRule(cand, avoidRules).matched) {
      continue;
    }
    if (requireSelectedProviders && hasProviderPref && !matchesWatchProviders(cand, userProviders)) {
      continue;
    }

    const sA = normA.has(tmdbId) ? normA.get(tmdbId) : clamp01(cand.scoreA ?? 0.5);
    const sB = normB.has(tmdbId) ? normB.get(tmdbId) : clamp01(cand.scoreB ?? 0.5);
    const joint = scoreJointCandidate(sA, sB);

    const voteAvg = Number(cand.vote_average ?? cand.imdbRating ?? 0);
    const qualityBoost = Number.isFinite(voteAvg) && voteAvg > 0 ? clamp01((voteAvg - 5.5) / 3.5) * 0.08 : 0;
    const providerBoost =
      hasProviderPref && matchesWatchProviders(cand, userProviders) ? 0.06 : 0;

    const finalScore = clamp01(joint.jointScore + qualityBoost + providerBoost);

    scored.push({
      ...cand,
      tmdbId: tmdbId || cand.tmdbId || null,
      scoreA: Number(sA.toFixed(4)),
      scoreB: Number(sB.toFixed(4)),
      matchPctA: toDisplayPct(sA),
      matchPctB: toDisplayPct(sB),
      jointScore: Number(finalScore.toFixed(4)),
      jointMatchPct: toDisplayPct(joint.jointScore),
      balanceLabel: joint.balanceLabel
    });
  }

  scored.sort((a, b) => b.jointScore - a.jointScore || (Number(b.vote_average) || 0) - (Number(a.vote_average) || 0));
  return scored.slice(0, Math.max(1, limit));
}

/**
 * Evaluates swipe votes from Host (A) and Guest (B) to surface mutual "yes" matches
 * or top-3 fallback compromises if the deck finishes with zero mutual likes.
 */
export function evaluateSwipeRound({ deck = [], votesA = {}, votesB = {} } = {}) {
  const safeDeck = Array.isArray(deck) ? deck : [];
  const safeA = votesA && typeof votesA === "object" ? votesA : {};
  const safeB = votesB && typeof votesB === "object" ? votesB : {};

  const mutualMatches = [];
  const hostLikes = [];
  const guestLikes = [];

  for (const item of safeDeck) {
    const key = String(item?.tmdbId ?? item?.id ?? "");
    if (!key) continue;
    const vA = safeA[key];
    const vB = safeB[key];
    if (vA === "yes") hostLikes.push(item);
    if (vB === "yes") guestLikes.push(item);
    if (vA === "yes" && vB === "yes") {
      mutualMatches.push(item);
    }
  }

  mutualMatches.sort((a, b) => Number(b.jointScore || 0) - Number(a.jointScore || 0));
  const fallbackCompromises =
    mutualMatches.length === 0
      ? [...safeDeck].sort((a, b) => Number(b.jointScore || 0) - Number(a.jointScore || 0)).slice(0, 3)
      : [];

  return {
    mutualMatches,
    hostLikes,
    guestLikes,
    fallbackCompromises
  };
}
