/**
 * Client-Side Float16 Collaborative & Content Embedding Engine (CVEM v1 Binary Format)
 */

const MAGIC = "CVEM";
const VERSION = 1;

/**
 * IEEE-754 Half-Precision (uint16) to Single-Precision (float32)
 */
export function float16ToFloat32(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

/**
 * Single-Precision (float32) to IEEE-754 Half-Precision (uint16)
 */
export function float32ToFloat16(val) {
  const fView = new Float32Array(1);
  const iView = new Uint32Array(fView.buffer);
  fView[0] = val;
  const x = iView[0];

  const sign = (x >> 16) & 0x8000;
  let exp = ((x >> 23) & 0xff) - 127 + 15;
  let mant = (x >> 13) & 0x03ff;

  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x0400) >> (1 - exp);
    return sign | mant;
  }
  if (exp >= 31) {
    return sign | 0x7c00;
  }
  return sign | (exp << 10) | mant;
}

function l2NormalizeInPlace(vec, offset = 0, len = vec.length) {
  let sumSq = 0;
  for (let i = 0; i < len; i++) {
    const v = vec[offset + i];
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 1e-12) {
    for (let i = 0; i < len; i++) {
      vec[offset + i] /= norm;
    }
  }
  return norm;
}

/**
 * Encodes an array of { tmdbId, vector } into a compact CVEM v1 ArrayBuffer.
 */
export function encodeEmbeddingBinary(items = []) {
  const count = items.length;
  const dim = count > 0 ? items[0].vector.length : 0;
  const headerBytes = 16;
  const idsBytes = count * 4;
  const vecBytes = count * dim * 2;

  const buffer = new ArrayBuffer(headerBytes + idsBytes + vecBytes);
  const view = new DataView(buffer);

  for (let i = 0; i < 4; i++) {
    view.setUint8(i, MAGIC.charCodeAt(i));
  }
  view.setUint32(4, VERSION, true);
  view.setUint32(8, count, true);
  view.setUint32(12, dim, true);

  let idOffset = headerBytes;
  let vecOffset = headerBytes + idsBytes;

  for (let i = 0; i < count; i++) {
    const { tmdbId, vector } = items[i];
    view.setUint32(idOffset, Number(tmdbId), true);
    idOffset += 4;

    const tmp = Float32Array.from(vector);
    l2NormalizeInPlace(tmp, 0, dim);

    for (let d = 0; d < dim; d++) {
      view.setUint16(vecOffset, float32ToFloat16(tmp[d]), true);
      vecOffset += 2;
    }
  }

  return buffer;
}

/**
 * Parses a CVEM v1 ArrayBuffer into a contiguous Float32Array index for fast cosine search.
 */
export function parseEmbeddingBinary(buffer) {
  if (!buffer || buffer.byteLength < 16) {
    throw new Error("Invalid CVEM embedding buffer");
  }
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== MAGIC) {
    throw new Error(`Invalid embedding magic header: ${magic}`);
  }

  const version = view.getUint32(4, true);
  if (version !== VERSION) {
    throw new Error(`Unsupported CVEM version: ${version}`);
  }

  const count = view.getUint32(8, true);
  const dim = view.getUint32(12, true);

  const ids = new Uint32Array(count);
  const vectors = new Float32Array(count * dim);
  const idToIndex = new Map();

  let idOffset = 16;
  let vecOffset = 16 + count * 4;

  for (let i = 0; i < count; i++) {
    const id = view.getUint32(idOffset, true);
    ids[i] = id;
    idToIndex.set(id, i);
    idOffset += 4;

    const base = i * dim;
    for (let d = 0; d < dim; d++) {
      vectors[base + d] = float16ToFloat32(view.getUint16(vecOffset, true));
      vecOffset += 2;
    }
    l2NormalizeInPlace(vectors, base, dim);
  }

  return {
    dim,
    count,
    ids,
    vectors,
    idToIndex
  };
}

/**
 * Computes the user's personalized taste vector:
 * user_vec = sum(w_i * e_i) / sum(|w_i|), L2-normalized.
 * Disliked movies (w_i < 0) push the vector away from their embeddings.
 */
export function computeUserEmbedding(weightedRatings = [], index) {
  if (!index || !index.dim || !weightedRatings || weightedRatings.length === 0) {
    return null;
  }

  const { dim, vectors, idToIndex } = index;
  const accum = new Float32Array(dim);
  let sumAbsWeight = 0;

  for (const entry of weightedRatings) {
    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    if (!tmdbId || !Number.isFinite(weight) || Math.abs(weight) < 1e-6) continue;

    const idx = idToIndex.get(tmdbId);
    if (idx === undefined) continue;

    const base = idx * dim;
    for (let d = 0; d < dim; d++) {
      accum[d] += weight * vectors[base + d];
    }
    sumAbsWeight += Math.abs(weight);
  }

  if (sumAbsWeight === 0) return null;

  for (let d = 0; d < dim; d++) {
    accum[d] /= sumAbsWeight;
  }

  const norm = l2NormalizeInPlace(accum, 0, dim);
  return norm > 1e-12 ? accum : null;
}

/**
 * Blends collaborative and content embeddings weighted by rating count:
 * alpha = ratingCount / (ratingCount + pivot).
 */
export function blendEmbeddings(collabVec, contentVec, ratingCount = 0, pivot = 50) {
  if (!collabVec && !contentVec) return null;
  if (!collabVec) {
    const out = Float32Array.from(contentVec);
    l2NormalizeInPlace(out);
    return out;
  }
  if (!contentVec) {
    const out = Float32Array.from(collabVec);
    l2NormalizeInPlace(out);
    return out;
  }

  const len = Math.min(collabVec.length, contentVec.length);
  const n = Math.max(0, Number(ratingCount) || 0);
  const alpha = n / (n + Math.max(1, pivot));
  const blended = new Float32Array(len);

  for (let d = 0; d < len; d++) {
    blended[d] = alpha * collabVec[d] + (1 - alpha) * contentVec[d];
  }
  l2NormalizeInPlace(blended);
  return blended;
}

/**
 * Retrieves top-K nearest neighbors by cosine similarity from the embedding index.
 */
export function retrieveByEmbedding(userVec, index, excludeTmdbIds = new Set(), topK = 250) {
  if (!userVec || !index || !index.count) return [];

  const { count, dim, ids, vectors } = index;
  const excluded = new Set([...(excludeTmdbIds || [])].map(Number));
  const results = [];

  for (let i = 0; i < count; i++) {
    const tmdbId = ids[i];
    if (excluded.has(tmdbId)) continue;

    const base = i * dim;
    let dot = 0;
    for (let d = 0; d < dim; d++) {
      dot += userVec[d] * vectors[base + d];
    }
    results.push({ tmdbId, collabSim: dot });
  }

  results.sort((a, b) => b.collabSim - a.collabSim);
  return results.slice(0, topK);
}

let cachedEmbeddingIndexPromise = null;

/**
 * Clears the memoized runtime embedding index promise (used for testing or manual reloads).
 */
export function resetDefaultEmbeddingIndexCache() {
  cachedEmbeddingIndexPromise = null;
}

/**
 * Lazily loads `/models/item_embeddings_f16.bin` in browser environments (or via customFetch).
 * Gracefully resolves to null on 404, network error, Node.js runtime, or SPA HTML fallback.
 */
export function loadDefaultEmbeddingIndex(url = "/models/item_embeddings_f16.bin", customFetch = null) {
  const fetchFn =
    customFetch ||
    (typeof window !== "undefined" && typeof window.fetch === "function"
      ? window.fetch.bind(window)
      : null);

  if (!fetchFn) return Promise.resolve(null);

  if (!cachedEmbeddingIndexPromise) {
    cachedEmbeddingIndexPromise = Promise.resolve()
      .then(() => fetchFn(url))
      .then(res => (res && res.ok ? res.arrayBuffer() : null))
      .then(buf => (buf ? parseEmbeddingBinary(buf) : null))
      .catch(() => null);
  }

  return cachedEmbeddingIndexPromise;
}

/**
 * Builds a Map<tmdbId, collabSim> across all items in the embedding index from the user's weighted ratings.
 */
export function buildCollabSimMapFromIndex(weightedRatings = [], index = null) {
  const map = new Map();
  if (!index || !index.count) return map;
  const userVec = computeUserEmbedding(weightedRatings, index);
  if (!userVec) return map;
  const { count, dim, ids, vectors } = index;
  for (let i = 0; i < count; i++) {
    const base = i * dim;
    let dot = 0;
    for (let d = 0; d < dim; d++) {
      dot += userVec[d] * vectors[base + d];
    }
    map.set(ids[i], dot);
  }
  return map;
}
