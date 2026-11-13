import {
  resolveBinaryFetch,
  fetchEmbeddingBinaryIndex,
  getRelativeWeightCutoff,
  l2NormalizeInPlace,
  computeUserEmbedding,
  blendEmbeddings
} from "./embeddingService.js";

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

let cachedContentIndexPromise = null;

/**
 * Clears the memoized runtime content embedding index promise.
 */
export function resetDefaultContentIndexCache() {
  cachedContentIndexPromise = null;
}

/**
 * Lazily loads `/models/content_embeddings_f16.bin` with graceful SPA-HTML / 404 fallback.
 */
export function loadDefaultContentIndex(url = "/models/content_embeddings_f16.bin", customFetch = null) {
  const fetchFn = resolveBinaryFetch(customFetch);
  if (!fetchFn) return Promise.resolve(null);

  if (!cachedContentIndexPromise) {
    cachedContentIndexPromise = fetchEmbeddingBinaryIndex(url, fetchFn);
  }

  return cachedContentIndexPromise;
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

function buildUserContentVector(weightedRatings, contentIndex, weightCutoff) {
  const { dim, vectors, idToIndex } = contentIndex;
  const accum = new Float32Array(dim);
  let matchedPositiveCount = 0;
  let totalPositiveCount = 0;

  for (const entry of weightedRatings) {
    const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    if (!Number.isFinite(weight) || weight <= weightCutoff) continue;
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
 * Builds Map<tmdbId, contentSim> from dense content embeddings (with optional aligned
 * collaborative-content blending) and opt-in overview bigram TF-IDF fallback.
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

  if (contentIndex && contentIndex.count && contentIndex.dim) {
    const userContent = buildUserContentVector(weightedRatings, contentIndex, weightCutoff);
    if (userContent) {
      let queryVec = userContent.vector;
      const { count, dim, ids, vectors } = contentIndex;

      if (options.collabIndex && options.collabIndex.dim === dim && options.blendAligned !== false) {
        const collabVec = computeUserEmbedding(weightedRatings, options.collabIndex);
        if (collabVec) {
          let alignDot = 0;
          for (let d = 0; d < dim; d++) {
            alignDot += collabVec[d] * queryVec[d];
          }
          if (options.blendAligned === true || alignDot > 0.15) {
            queryVec = blendEmbeddings(
              collabVec,
              queryVec,
              userContent.totalPositiveCount,
              options.blendPivot ?? 8
            );
          }
        }
      }

      for (let i = 0; i < count; i++) {
        const base = i * dim;
        let dot = 0;
        let normSq = 0;
        for (let d = 0; d < dim; d++) {
          const val = vectors[base + d];
          dot += queryVec[d] * val;
          normSq += val * val;
        }
        if (normSq > 1e-12) {
          map.set(ids[i], dot / Math.sqrt(normSq));
        }
      }
    }
  }

  if (options.enableOverviewTfIdf === true && Array.isArray(candidates) && candidates.length > 0) {
    const userOverviewEntries = [];
    for (const entry of weightedRatings) {
      const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
      if (!Number.isFinite(weight) || weight <= weightCutoff) continue;
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

  return map;
}
