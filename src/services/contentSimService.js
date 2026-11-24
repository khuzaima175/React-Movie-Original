import {
  createSessionBinaryIndexLoader,
  getRelativeWeightCutoff,
  l2NormalizeInPlace
} from "./embeddingService.js";
import { GENERIC_META_KEYWORD_IDS } from "./tmdbService.js";

const OVERVIEW_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "onto", "over",
  "under", "after", "before", "about", "while", "during", "against", "between",
  "through", "their", "there", "these", "those", "they", "them", "his", "her",
  "hers", "she", "him", "its", "who", "whom", "whose", "which", "when", "where",
  "why", "how", "are", "was", "were", "been", "being", "have", "has", "had",
  "does", "did", "doing", "not", "but", "out", "off", "can", "will", "just",
  "more", "most", "some", "such", "than", "then", "very", "only", "also", "one",
  "two", "all", "any", "both", "each", "own", "same", "too"
]);

const contentIndexLoader = createSessionBinaryIndexLoader("/models/content_embeddings_f16.bin");

/**
 * Clears the memoized runtime content embedding index promise (including negative cache).
 */
export function resetDefaultContentIndexCache() {
  contentIndexLoader.reset();
}

/**
 * Lazily loads `/models/content_embeddings_f16.bin` with graceful SPA-HTML / 404
 * session negative caching (transient network errors and aborts are not cached).
 */
export function loadDefaultContentIndex(url = "/models/content_embeddings_f16.bin", customFetch = null) {
  return contentIndexLoader.load(url, customFetch);
}

function tokenizeOverview(text = "") {
  const raw = String(text || "")
    .toLowerCase()
    .match(/[a-z0-9]{2,}/g) || [];
  return raw.filter(token => !OVERVIEW_STOPWORDS.has(token));
}

function buildOverviewTfMap(text = "") {
  const tokens = tokenizeOverview(text);
  if (tokens.length === 0) return null;

  const counts = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const uni = tokens[i];
    counts.set(uni, (counts.get(uni) || 0) + 1);
    if (i + 1 < tokens.length) {
      const bi = `${uni}_${tokens[i + 1]}`;
      counts.set(bi, (counts.get(bi) || 0) + 1);
    }
  }

  let normSq = 0;
  const vec = new Map();
  for (const [term, count] of counts.entries()) {
    const w = 1 + Math.log(count);
    vec.set(term, w);
    normSq += w * w;
  }
  const norm = Math.sqrt(normSq);
  if (norm <= 1e-12) return null;

  for (const [term, w] of vec.entries()) {
    vec.set(term, w / norm);
  }
  return vec;
}

function buildUserOverviewTfVector(userOverviewEntries = []) {
  if (!Array.isArray(userOverviewEntries) || userOverviewEntries.length === 0) {
    return null;
  }

  const userVec = new Map();
  for (const entry of userOverviewEntries) {
    const weight = Number(entry?.weight ?? 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const itemVec = buildOverviewTfMap(entry?.text || "");
    if (!itemVec) continue;
    for (const [term, val] of itemVec.entries()) {
      userVec.set(term, (userVec.get(term) || 0) + weight * val);
    }
  }

  if (userVec.size === 0) return null;

  let normSq = 0;
  for (const val of userVec.values()) normSq += val * val;
  const norm = Math.sqrt(normSq);
  if (norm <= 1e-12) return null;

  for (const [term, val] of userVec.entries()) {
    userVec.set(term, val / norm);
  }
  return userVec;
}

function cosineSparseTf(userVec, candText) {
  if (!userVec || !candText) return 0;
  const candVec = buildOverviewTfMap(candText);
  if (!candVec) return 0;

  let dot = 0;
  for (const [term, w] of candVec.entries()) {
    const u = userVec.get(term);
    if (u) dot += u * w;
  }
  return Math.max(0, Math.min(1, dot));
}

/**
 * Computes pure plot/overview unigram+bigram cosine similarity strictly from narrative text
 * (intentionally excludes genres, keywords, cast, and crew).
 */
export function computeOverviewBigramSim(userOverviewEntries = [], candidateOverview = "") {
  const userVec = buildUserOverviewTfVector(userOverviewEntries);
  return cosineSparseTf(userVec, candidateOverview);
}

function buildUserContentVector(weightedRatings, contentIndex, weightCutoff, minPositiveRating = 7) {
  const { dim, vectors, idToIndex } = contentIndex;
  const accum = new Float32Array(dim);
  let matchedPositiveCount = 0;
  let totalPositiveCount = 0;

  for (const entry of weightedRatings) {
    const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    if (!Number.isFinite(weight) || weight <= weightCutoff) continue;
    const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
    if (Number.isFinite(rating) && rating > 0 && rating < minPositiveRating) continue;
    totalPositiveCount++;

    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    if (!tmdbId) continue;

    const idx = idToIndex.get(tmdbId);
    if (idx === undefined) continue;

    const base = idx * dim;
    for (let d = 0; d < dim; d++) {
      accum[d] += weight * vectors[base + d];
    }
    matchedPositiveCount++;
  }

  if (matchedPositiveCount === 0) return null;
  const norm = l2NormalizeInPlace(accum, 0, dim);
  if (norm <= 1e-12) return null;

  return { vector: accum, totalPositiveCount };
}

/**
 * Builds Map<tmdbId, contentSim> from dense content embeddings and opt-in
 * overview bigram / structured metadata fallback.
 */
export function buildContentSimMap(
  weightedRatings = [],
  contentIndex = null,
  candidates = [],
  options = {}
) {
  const map = new Map();
  if (!Array.isArray(weightedRatings) || weightedRatings.length === 0) {
    return map;
  }

  const weightCutoff = getRelativeWeightCutoff(weightedRatings);
  if (weightCutoff === null) return map;
  const minPositiveRating = options.minPositiveRating ?? 7;

  if (contentIndex && contentIndex.count && contentIndex.dim) {
    const userContent = buildUserContentVector(weightedRatings, contentIndex, weightCutoff, minPositiveRating);
    if (userContent) {
      const queryVec = userContent.vector;
      const { count, dim, ids, vectors } = contentIndex;

      const enforceColdOnlyOnIndex = options.coldOnly === true;
      const collabSimMapForIndex = options.collabSimMap instanceof Map ? options.collabSimMap : null;
      const collabIndexForIndex = options.collabIndex || null;

      for (let i = 0; i < count; i++) {
        const id = ids[i];
        if (enforceColdOnlyOnIndex && hasCollaborativeCoverage(id, collabSimMapForIndex, collabIndexForIndex)) {
          continue;
        }
        const base = i * dim;
        let dot = 0;
        let normSq = 0;
        for (let d = 0; d < dim; d++) {
          const val = vectors[base + d];
          dot += queryVec[d] * val;
          normSq += val * val;
        }
        if (normSq > 1e-12) {
          map.set(id, dot / Math.sqrt(normSq));
        }
      }
    }
  }

  if (options.enableOverviewTfIdf === true && Array.isArray(candidates) && candidates.length > 0) {
    const userOverviewEntries = [];
    for (const entry of weightedRatings) {
      const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
      if (!Number.isFinite(weight) || weight <= weightCutoff) continue;
      const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
      if (Number.isFinite(rating) && rating > 0 && rating < minPositiveRating) continue;
      const text = entry?.movie?.overview || entry?.movie?.plot || entry?.overview || entry?.plot || "";
      if (text) userOverviewEntries.push({ text, weight });
    }

    const userTfVec = buildUserOverviewTfVector(userOverviewEntries);
    if (userTfVec) {
      for (const cand of candidates) {
        const id = Number(cand?.tmdbId ?? cand?.id ?? 0);
        if (!id || map.has(id)) continue;
        const overview = cand?.overview || cand?.plot || "";
        if (!overview) continue;
        const sim = cosineSparseTf(userTfVec, overview);
        if (sim > 0) map.set(id, sim);
      }
    }
  }

  // Intentionally restrict structured term fallback (coldOnly) to cold/unindexed films
  // (e.g. post-2023 releases where collabSim === 0 and no CVEM vector exists): on warm
  // indexed titles, adding noisy metadata TF-IDF alongside collaborative embeddings
  // degrades offline AUC/NDCG, whereas cold films otherwise receive zero personalization.
  if (options.enableStructuredFallback === true && Array.isArray(candidates) && candidates.length > 0) {
    const coldOnly = options.coldOnly !== false;
    const collabSimMap = options.collabSimMap instanceof Map ? options.collabSimMap : null;
    const collabIndex = options.collabIndex || null;
    const negScale = options.negScale ?? 0.35;
    const includeNegative = options.includeNegative !== false;

    const needsFallback = candidates.some((cand) => {
      const id = Number(cand?.tmdbId ?? cand?.id ?? 0);
      if (!id || map.has(id)) return false;
      return !(coldOnly && hasCollaborativeCoverage(id, collabSimMap, collabIndex));
    });

    if (needsFallback) {
      const { dfMap, docCount } = computeCorpusTermDf(candidates);
      const userVec = buildUserStructuredVector(weightedRatings, dfMap, docCount, {
        negScale,
        includeNegative,
        minPositiveRating
      });
      if (userVec) {
        for (const cand of candidates) {
          const id = Number(cand?.tmdbId ?? cand?.id ?? 0);
          if (!id || map.has(id)) continue;
          if (coldOnly && hasCollaborativeCoverage(id, collabSimMap, collabIndex)) continue;
          const sim = scoreStructuredCandidate(userVec, cand, dfMap, docCount);
          if (sim > 0) map.set(id, sim);
        }
      }
    }
  }

  return map;
}

/**
 * Retrieves top-K unindexed cold films (Bucket E-Cold) by semantic content similarity,
 * strictly skipping any film present in `options.collabIndex.idToIndex`,
 * `options.collabIdSet`, `collabSimMap`, or `excludeIds` (watched, watchlist, or already pooled).
 */
export function retrieveColdContentNeighbors(
  weightedRatings = [],
  contentIndex = null,
  excludeIds = new Set(),
  options = {}
) {
  if (!contentIndex || !contentIndex.count || !contentIndex.dim || !Array.isArray(weightedRatings) || weightedRatings.length === 0) {
    return [];
  }

  const collabIndex = options.collabIndex || null;
  const collabIdSet = typeof options.collabIdSet?.has === "function"
    ? options.collabIdSet
    : (options.collabIdSet && typeof options.collabIdSet[Symbol.iterator] === "function"
        ? new Set(options.collabIdSet)
        : null);
  const collabSimMap = options.collabSimMap instanceof Map ? options.collabSimMap : null;
  const repulsionMap = options.repulsionMap instanceof Map ? options.repulsionMap : null;
  const repulsionWeight = Number.isFinite(Number(options.repulsionWeight))
    ? Number(options.repulsionWeight)
    : (1.5 / 6.4);
  const topK = Math.max(1, Number(options.topK ?? 15));

  const excluded = new Set(
    [...(excludeIds || [])]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  );

  const simMap = buildContentSimMap(weightedRatings, contentIndex, [], {
    ...options,
    collabIndex,
    collabSimMap,
    coldOnly: false,
    enableOverviewTfIdf: false,
    enableStructuredFallback: false
  });
  if (!simMap || simMap.size === 0) return [];

  const results = [];
  for (const [rawId, rawSim] of simMap.entries()) {
    const tmdbId = Number(rawId);
    if (!tmdbId || excluded.has(tmdbId)) continue;
    if (
      collabIndex?.idToIndex?.has(tmdbId) ||
      collabIdSet?.has(tmdbId) ||
      collabSimMap?.has(tmdbId) ||
      hasCollaborativeCoverage(tmdbId, collabSimMap, collabIndex)
    ) continue;
    const contentSim = Number(rawSim);
    if (!Number.isFinite(contentSim) || contentSim <= 0) continue;
    const repulsion = repulsionMap?.get(tmdbId) ?? 0;
    const alignedScore = contentSim - repulsionWeight * repulsion;
    results.push({ tmdbId, contentSim, alignedScore });
  }

  results.sort((a, b) => (b.alignedScore !== a.alignedScore ? b.alignedScore - a.alignedScore : b.contentSim - a.contentSim));
  return results.slice(0, topK);
}

function hasCollaborativeCoverage(id, collabSimMap, collabIndex) {
  if (collabSimMap) {
    return Math.abs(Number(collabSimMap.get(id) ?? 0)) > 0.001;
  }
  return Boolean(collabIndex?.idToIndex?.has(id));
}

function extractMovieStructuredTerms(movie = {}) {
  const weights = new Map();
  const add = (key, val) => {
    if (val > 0 && !weights.has(key)) weights.set(key, val);
  };

  for (const rawG of movie.tmdbGenreIds || movie.genre_ids || []) {
    const g = Number(rawG);
    if (g > 0) add(`g:${g}`, 1.0);
  }
  for (const rawKw of movie.tmdbKeywords || []) {
    const kw = Number(rawKw);
    if (kw > 0 && !GENERIC_META_KEYWORD_IDS.has(kw)) add(`k:${kw}`, 1.5);
  }
  const crewId = Number(movie.crewPersonId || 0);
  if (crewId > 0) add(`d:${crewId}`, 1.4);

  const castIds = Array.isArray(movie.castIds) ? movie.castIds : [];
  for (let i = 0; i < castIds.length; i++) {
    const cId = Number(castIds[i]);
    if (cId > 0) add(`c:${cId}`, 0.8 * (1 / (1 + 0.2 * i)));
  }

  const yearNum = Number(String(movie.release_date || movie.year || "").slice(0, 4));
  if (yearNum >= 1910 && yearNum <= 2030) {
    add(`dec:${Math.floor(yearNum / 10) * 10}`, 0.4);
  }

  const overview = movie.overview || movie.plot || "";
  if (overview) {
    const tokens = tokenizeOverview(overview);
    if (tokens.length > 0) {
      const ovCounts = new Map();
      for (let i = 0; i < tokens.length; i++) {
        const uk = `ov:${tokens[i]}`;
        ovCounts.set(uk, (ovCounts.get(uk) || 0) + 1);
        if (i + 1 < tokens.length) {
          const bk = `ovb:${tokens[i]}_${tokens[i + 1]}`;
          ovCounts.set(bk, (ovCounts.get(bk) || 0) + 1);
        }
      }
      for (const [k, cnt] of ovCounts.entries()) {
        const mult = k.startsWith("ovb:") ? 0.8 : 0.6;
        weights.set(k, mult * (1 + Math.log(cnt)));
      }
    }
  }

  return weights;
}

function computeCorpusTermDf(candidates = []) {
  const dfMap = new Map();
  let docCount = 0;
  for (const m of candidates) {
    docCount++;
    for (const key of extractMovieStructuredTerms(m).keys()) {
      dfMap.set(key, (dfMap.get(key) || 0) + 1);
    }
  }
  return { dfMap, docCount: Math.max(2, docCount) };
}

function buildNormalizedMovieStructuredVec(movie, dfMap, docCount) {
  const raw = extractMovieStructuredTerms(movie);
  if (raw.size === 0) return null;
  const vec = new Map();
  let normSq = 0;
  for (const [k, w] of raw.entries()) {
    const idf = Math.log(1 + docCount / (1 + (dfMap.get(k) || 0)));
    const val = w * idf;
    vec.set(k, val);
    normSq += val * val;
  }
  const norm = Math.sqrt(normSq);
  if (norm <= 1e-12) return null;
  for (const [k, val] of vec.entries()) vec.set(k, val / norm);
  return vec;
}

function buildUserStructuredVector(weightedRatings, dfMap, docCount, options = {}) {
  const { negScale = 0.35, includeNegative = true, minPositiveRating = 7 } = options;
  const userVec = new Map();
  let hasPos = false;

  for (const entry of weightedRatings) {
    const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? 0);
    if (!Number.isFinite(weight) || weight === 0) continue;
    if (weight > 0 && rating > 0 && rating < minPositiveRating) continue;
    if (weight < 0 && (!includeNegative || rating >= 7)) continue;

    const mult = weight > 0 ? weight : weight * negScale;
    const movie = entry?.movie || entry;
    const mVec = buildNormalizedMovieStructuredVec(movie, dfMap, docCount);
    if (!mVec) continue;
    if (weight > 0) hasPos = true;
    for (const [k, val] of mVec.entries()) {
      userVec.set(k, (userVec.get(k) || 0) + mult * val);
    }
  }

  if (!hasPos || userVec.size === 0) return null;
  let normSq = 0;
  for (const val of userVec.values()) normSq += val * val;
  const norm = Math.sqrt(normSq);
  if (norm <= 1e-12) return null;
  for (const [k, val] of userVec.entries()) userVec.set(k, val / norm);
  return userVec;
}

function scoreStructuredCandidate(userVec, cand, dfMap, docCount) {
  const cVec = buildNormalizedMovieStructuredVec(cand, dfMap, docCount);
  if (!cVec) return 0;
  let dot = 0;
  for (const [k, val] of cVec.entries()) {
    const u = userVec.get(k);
    if (u) dot += u * val;
  }
  return Math.max(0, Math.min(1, dot));
}
