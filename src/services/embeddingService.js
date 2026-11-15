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

export function l2NormalizeInPlace(vec, offset = 0, len = vec.length) {
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

function getUnitSlice(vectors, base, dim) {
  const out = new Float32Array(dim);
  for (let d = 0; d < dim; d++) {
    out[d] = vectors[base + d];
  }
  l2NormalizeInPlace(out, 0, dim);
  return out;
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
 * Preserves Bayesian-shrunk sub-unit vector magnitudes while snapping unit vectors to 1.0.
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

  if (count <= 0 || count > 500000 || dim <= 0 || dim > 1024) {
    throw new Error(`Invalid CVEM dimensions: count=${count}, dim=${dim}`);
  }

  const expectedByteLength = 16 + count * 4 + count * dim * 2;
  if (buffer.byteLength !== expectedByteLength) {
    throw new Error(
      `Invalid CVEM byteLength: expected ${expectedByteLength}, got ${buffer.byteLength}`
    );
  }

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
    let sumSq = 0;
    for (let d = 0; d < dim; d++) {
      const val = float16ToFloat32(view.getUint16(vecOffset, true));
      vectors[base + d] = val;
      sumSq += val * val;
      vecOffset += 2;
    }
    if (sumSq >= 0.98) {
      l2NormalizeInPlace(vectors, base, dim);
    }
  }

  return {
    dim,
    count,
    ids,
    vectors,
    idToIndex
  };
}

const RELATIVE_WEIGHT_CUTOFF_RATIO = 1e-6;

/**
 * Computes a vault-relative minimum weight (`1e-6 * max(|w|)`) so uniformly decayed
 * vaults remain valid while negligible entries are skipped. Returns null if max(|w|) === 0.
 */
export function getRelativeWeightCutoff(weightedRatings = []) {
  let maxAbsW = 0;
  for (const entry of weightedRatings) {
    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    if (!tmdbId || !Number.isFinite(weight)) continue;
    const absW = Math.abs(weight);
    if (absW > maxAbsW) maxAbsW = absW;
  }
  return maxAbsW > 0 ? RELATIVE_WEIGHT_CUTOFF_RATIO * maxAbsW : null;
}

/**
 * Computes the user's personalized single taste vector (backward-compatible):
 * user_vec = sum(w_i * e_i) / sum(|w_i|), L2-normalized.
 */
export function computeUserEmbedding(weightedRatings = [], index) {
  if (!index || !index.dim || !weightedRatings || weightedRatings.length === 0) {
    return null;
  }

  const weightCutoff = getRelativeWeightCutoff(weightedRatings);
  if (weightCutoff === null) return null;

  const { dim, vectors, idToIndex } = index;
  const accum = new Float32Array(dim);
  let sumAbsWeight = 0;

  for (const entry of weightedRatings) {
    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
    if (!tmdbId || !Number.isFinite(weight) || Math.abs(weight) <= weightCutoff) continue;
    // Generous-rater guard: 7-10★ films must never subtract from taste centroids even if negative z-score
    if (weight < 0 && Number.isFinite(rating) && rating >= 7) continue;

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
 * Clusters a user's positively weighted films into K in [1, 4] deterministic spherical K-Means
 * taste personas so contrasting genres (e.g. Oldboy + Toy Story) do not collapse into a midpoint.
 */
/**
 * Computes K-Means++ user taste centroids along with each cluster's normalized positive mass.
 */
export function computePersonaDetails(weightedRatings = [], index, options = {}) {
  if (!index || !index.dim || !weightedRatings || weightedRatings.length === 0) {
    return { centroids: [], masses: [] };
  }

  const weightCutoff = getRelativeWeightCutoff(weightedRatings);
  if (weightCutoff === null) return { centroids: [], masses: [] };

  const { dim, vectors, idToIndex } = index;
  const minPositiveRating = options.minPositiveRating ?? 0;
  const maxIterations = options.maxIterations ?? 12;
  const splitThreshold = options.splitThreshold ?? 0.05;

  const posEntries = [];
  const mildNegEntries = [];
  for (const entry of weightedRatings) {
    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
    if (!tmdbId || !Number.isFinite(weight) || Math.abs(weight) <= weightCutoff) continue;
    const idx = idToIndex.get(tmdbId);
    if (idx === undefined) continue;

    if (weight > 0 && (!Number.isFinite(rating) || rating >= minPositiveRating)) {
      const unitVec = getUnitSlice(vectors, idx * dim, dim);
      posEntries.push({ tmdbId, idx, weight, unitVec });
    } else if (weight < 0 && Number.isFinite(rating) && rating > 4 && rating < 7) {
      mildNegEntries.push({ idx, weight });
    }
  }

  if (posEntries.length === 0) return { centroids: [], masses: [] };

  posEntries.sort((a, b) => (b.weight !== a.weight ? b.weight - a.weight : a.tmdbId - b.tmdbId));

  const defaultK =
    posEntries.length < 4 ? 1 : posEntries.length < 12 ? 2 : posEntries.length < 20 ? 3 : 4;
  const targetK = Math.max(1, Math.min(posEntries.length, Number(options.k) || defaultK));

  // Deterministic farthest-first (K-Means++) initialization: only split when clusters are genuinely distinct
  const centroids = [Float32Array.from(posEntries[0].unitVec)];
  while (centroids.length < targetK) {
    let farthestIdx = -1;
    let minMaxSim = Infinity;
    for (let i = 0; i < posEntries.length; i++) {
      const v = posEntries[i].unitVec;
      let maxSim = -Infinity;
      for (const c of centroids) {
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += c[d] * v[d];
        if (dot > maxSim) maxSim = dot;
      }
      if (maxSim < minMaxSim) {
        minMaxSim = maxSim;
        farthestIdx = i;
      }
    }
    if (farthestIdx === -1 || minMaxSim > splitThreshold) break;
    centroids.push(Float32Array.from(posEntries[farthestIdx].unitVec));
  }

  const K = centroids.length;
  if (K === 1) {
    const centroid = new Float32Array(dim);
    for (const item of posEntries) {
      const base = item.idx * dim;
      for (let d = 0; d < dim; d++) {
        centroid[d] += item.weight * vectors[base + d];
      }
    }
    for (const neg of mildNegEntries) {
      const base = neg.idx * dim;
      for (let d = 0; d < dim; d++) {
        centroid[d] += 0.5 * neg.weight * vectors[base + d];
      }
    }
    l2NormalizeInPlace(centroid, 0, dim);
    return { centroids: [centroid], masses: [1.0] };
  }

  const assignments = new Int32Array(posEntries.length).fill(-1);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (let i = 0; i < posEntries.length; i++) {
      const v = posEntries[i].unitVec;
      let bestK = 0;
      let bestSim = -Infinity;
      for (let k = 0; k < K; k++) {
        let dot = 0;
        const c = centroids[k];
        for (let d = 0; d < dim; d++) dot += c[d] * v[d];
        if (dot > bestSim) {
          bestSim = dot;
          bestK = k;
        }
      }
      if (assignments[i] !== bestK) {
        assignments[i] = bestK;
        changed = true;
      }
    }
    if (!changed) break;

    for (let k = 0; k < K; k++) {
      const accum = new Float32Array(dim);
      let countK = 0;
      for (let i = 0; i < posEntries.length; i++) {
        if (assignments[i] !== k) continue;
        countK++;
        const w = posEntries[i].weight;
        const base = posEntries[i].idx * dim;
        for (let d = 0; d < dim; d++) accum[d] += w * vectors[base + d];
      }
      if (countK > 0) {
        l2NormalizeInPlace(accum, 0, dim);
        centroids[k] = accum;
      }
    }
  }

  const rawMasses = new Float64Array(K);
  let totalMass = 0;
  for (let i = 0; i < posEntries.length; i++) {
    const k = assignments[i];
    if (k >= 0 && k < K) {
      rawMasses[k] += posEntries[i].weight;
      totalMass += posEntries[i].weight;
    }
  }

  const outCentroids = [];
  const outMasses = [];
  for (let k = 0; k < K; k++) {
    if (rawMasses[k] > 0) {
      outCentroids.push(centroids[k]);
      outMasses.push(totalMass > 0 ? rawMasses[k] / totalMass : 1 / K);
    }
  }
  if (outCentroids.length === 0) {
    return {
      centroids,
      masses: centroids.map(() => 1 / centroids.length),
    };
  }
  return { centroids: outCentroids, masses: outMasses };
}

export function computeUserPersonas(weightedRatings = [], index, options = {}) {
  return computePersonaDetails(weightedRatings, index, options).centroids;
}

/**
 * Solves weighted 64x64 Ridge Regression (E^T C E + lambda I) u = E^T C z
 * over all indexed user ratings (positive, neutral, and negative) and returns
 * an L2-normalized collaborative preference vector.
 */
export function computeUserRidgeEmbedding(weightedRatings = [], index, options = {}) {
  if (!index || !index.dim || !weightedRatings || weightedRatings.length === 0) {
    return null;
  }

  const { dim, vectors, idToIndex } = index;
  const minItems = options.ridgeMinItems ?? 10;
  const lambda = Number(options.ridgeLambda ?? 20);

  const entries = [];
  const ratings = [];
  let maxAbsWeight = 0;
  for (const entry of weightedRatings) {
    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    const idx = tmdbId ? idToIndex.get(tmdbId) : undefined;
    if (idx === undefined) continue;
    const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
    const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    if (Number.isFinite(weight) && Math.abs(weight) > maxAbsWeight) {
      maxAbsWeight = Math.abs(weight);
    }
    entries.push({ idx, rating, weight });
    if (Number.isFinite(rating) && rating > 0) ratings.push(rating);
  }

  if (entries.length < minItems) return null;

  let meanR = 7.0;
  let stdR = 1.5;
  if (ratings.length >= 2) {
    meanR = ratings.reduce((s, r) => s + r, 0) / ratings.length;
    const varR = ratings.reduce((s, r) => s + (r - meanR) * (r - meanR), 0) / ratings.length;
    stdR = Math.max(1.0, Math.sqrt(varR));
  }
  const baseline = Math.min(meanR, 7.5);
  const weightScale = maxAbsWeight > 0 ? maxAbsWeight : 1;

  const A = new Float64Array(dim * dim);
  const b = new Float64Array(dim);
  for (let d = 0; d < dim; d++) A[d * dim + d] = lambda;

  let anyNonZeroTarget = false;
  for (const item of entries) {
    let z = (Number.isFinite(item.rating) && item.rating > 0)
      ? (item.rating - baseline) / stdR
      : (item.weight / weightScale) * 2.0;
    z = Math.max(-2.5, Math.min(2.5, Number.isFinite(z) ? z : 0));
    if (Math.abs(z) > 1e-9) anyNonZeroTarget = true;

    const normW = maxAbsWeight > 0 ? Math.abs(item.weight) / maxAbsWeight : 0;
    const c = (Number.isFinite(item.weight) && normW > 0)
      ? Math.max(0.5, Math.min(2.0, 0.75 + 0.5 * normW))
      : 1.0;

    const base = item.idx * dim;
    for (let i = 0; i < dim; i++) {
      const ei = vectors[base + i];
      const cei = c * ei;
      b[i] += cei * z;
      const rowOff = i * dim;
      for (let j = i; j < dim; j++) {
        A[rowOff + j] += cei * vectors[base + j];
      }
    }
  }
  if (!anyNonZeroTarget) return null;

  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < i; j++) {
      A[i * dim + j] = A[j * dim + i];
    }
  }

  for (let col = 0; col < dim; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(A[col * dim + col]);
    for (let r = col + 1; r < dim; r++) {
      const v = Math.abs(A[r * dim + col]);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = r;
      }
    }
    if (maxVal < 1e-12) return null;
    if (pivotRow !== col) {
      for (let k = col; k < dim; k++) {
        const tmp = A[col * dim + k];
        A[col * dim + k] = A[pivotRow * dim + k];
        A[pivotRow * dim + k] = tmp;
      }
      const tmpB = b[col];
      b[col] = b[pivotRow];
      b[pivotRow] = tmpB;
    }
    const diag = A[col * dim + col];
    for (let r = col + 1; r < dim; r++) {
      const factor = A[r * dim + col] / diag;
      if (factor === 0) continue;
      for (let k = col; k < dim; k++) {
        A[r * dim + k] -= factor * A[col * dim + k];
      }
      b[r] -= factor * b[col];
    }
  }

  const u = new Float32Array(dim);
  for (let i = dim - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < dim; j++) {
      sum -= A[i * dim + j] * u[j];
    }
    u[i] = sum / A[i * dim + i];
  }
  const norm = l2NormalizeInPlace(u, 0, dim);
  return norm > 0 ? u : null;
}

/**
 * Builds a Map<tmdbId, repulsionPenalty> in [0, 1] for candidates that fall within cosine
 * similarity > threshold of genuinely disliked films, without corrupting positive personas.
 */
export function buildRepulsionMapFromIndex(weightedRatings = [], index = null, options = {}) {
  const map = new Map();
  if (!index || !index.count || !weightedRatings || weightedRatings.length === 0) return map;

  const weightCutoff = getRelativeWeightCutoff(weightedRatings);
  if (weightCutoff === null) return map;

  const { count, dim, ids, vectors, idToIndex } = index;
  const threshold = options.threshold ?? 0.35;
  const exponent = options.exponent ?? 2;
  const maxDislikeRating = options.maxDislikeRating ?? 5;

  const disliked = [];
  for (const entry of weightedRatings) {
    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
    if (!tmdbId || !Number.isFinite(weight) || weight >= -weightCutoff) continue;
    if (Number.isFinite(rating) && rating > maxDislikeRating) continue;

    const idx = idToIndex.get(tmdbId);
    if (idx === undefined) continue;
    disliked.push({
      mag: Math.min(2.0, Math.abs(weight)),
      unitVec: getUnitSlice(vectors, idx * dim, dim)
    });
  }

  if (disliked.length === 0) return map;

  const denom = Math.max(1e-6, 1 - threshold);
  for (let i = 0; i < count; i++) {
    const base = i * dim;
    let normSq = 0;
    for (let d = 0; d < dim; d++) normSq += vectors[base + d] * vectors[base + d];
    if (normSq < 1e-12) continue;
    const invNorm = 1 / Math.sqrt(normSq);

    let maxPen = 0;
    for (const neg of disliked) {
      let dot = 0;
      for (let d = 0; d < dim; d++) {
        dot += neg.unitVec[d] * (vectors[base + d] * invNorm);
      }
      if (dot > threshold) {
        const excess = (dot - threshold) / denom;
        const pen = Math.min(1, neg.mag * Math.pow(excess, exponent));
        if (pen > maxPen) maxPen = pen;
      }
    }
    map.set(ids[i], maxPen);
  }

  return map;
}

/**
 * Computes the repulsion penalty for a single candidate tmdbId.
 */
export function computeRepulsion(weightedRatings = [], index = null, candidateTmdbId = 0, options = {}) {
  const map = buildRepulsionMapFromIndex(weightedRatings, index, options);
  return map.get(Number(candidateTmdbId)) || 0;
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
 * Accepts either a single Float32Array vector or an array of persona Float32Array vectors.
 */
export function retrieveByEmbedding(userVecOrPersonas, index, excludeTmdbIds = new Set(), topK = 250) {
  if (!userVecOrPersonas || !index || !index.count) return [];

  const personas = Array.isArray(userVecOrPersonas)
    ? userVecOrPersonas.filter(v => v && v.length === index.dim)
    : userVecOrPersonas.length === index.dim
      ? [userVecOrPersonas]
      : [];
  if (personas.length === 0) return [];

  const { count, dim, ids, vectors } = index;
  const excluded = new Set([...(excludeTmdbIds || [])].map(Number));
  const results = [];

  for (let i = 0; i < count; i++) {
    const tmdbId = ids[i];
    if (excluded.has(tmdbId)) continue;

    const base = i * dim;
    let bestDot = -Infinity;
    for (const p of personas) {
      let dot = 0;
      for (let d = 0; d < dim; d++) {
        dot += p[d] * vectors[base + d];
      }
      if (dot > bestDot) bestDot = dot;
    }
    results.push({ tmdbId, collabSim: bestDot });
  }

  results.sort((a, b) => b.collabSim - a.collabSim);
  return results.slice(0, topK);
}

/**
 * Retrieves top-K neighbors aligned with the ranker's collaborative blend and repulsion penalty
 * (`collabSim - repulsionWeight * repulsion`), pruning hated clusters before slicing topK.
 */
export function retrieveAlignedEmbeddingNeighbors(
  weightedRatings = [],
  index = null,
  excludeTmdbIds = new Set(),
  options = {}
) {
  if (!index || !index.count || !index.ids) return [];

  const collabSimMap =
    options.collabSimMap instanceof Map
      ? options.collabSimMap
      : buildCollabSimMapFromIndex(weightedRatings, index);
  if (!collabSimMap || collabSimMap.size === 0) return [];

  const repulsionMap =
    options.repulsionMap instanceof Map
      ? options.repulsionMap
      : buildRepulsionMapFromIndex(weightedRatings, index);

  const catalogMax =
    options.catalogMax !== undefined
      ? (options.catalogMax !== null && Number.isFinite(Number(options.catalogMax))
          ? Math.max(0.05, Number(options.catalogMax))
          : null)
      : (() => {
          const detected = getCollabCatalogMax(collabSimMap);
          return detected !== null ? Math.max(0.05, detected) : null;
        })();

  const repulsionWeight = options.repulsionWeight ?? (1.5 / 6.4);
  const topK = options.topK ?? 40;
  const excluded = new Set([...(excludeTmdbIds || [])].map(Number));
  const { count, ids } = index;
  const results = [];

  for (let i = 0; i < count; i++) {
    const tmdbId = ids[i];
    if (excluded.has(tmdbId)) continue;

    const rawCollabSim = collabSimMap.get(tmdbId) ?? 0;
    const collabSim =
      rawCollabSim > 0 && catalogMax !== null
        ? Math.min(1.0, rawCollabSim / catalogMax)
        : rawCollabSim;
    const repulsion = repulsionMap?.get(tmdbId) ?? 0;
    const alignedScore = collabSim - repulsionWeight * repulsion;
    results.push({ tmdbId, collabSim, repulsion, alignedScore });
  }

  results.sort((a, b) => b.alignedScore - a.alignedScore);
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
 * Resolves a browser or injected fetch function without mutating Node global state.
 */
export function resolveBinaryFetch(customFetch = null) {
  if (typeof customFetch === "function") return customFetch;
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch.bind(window);
  }
  return null;
}

/**
 * Fetches and parses a CVEM binary index with SPA HTML fallback rejection.
 */
export function fetchEmbeddingBinaryIndex(url, fetchFn, parser = parseEmbeddingBinary) {
  if (typeof fetchFn !== "function") return Promise.resolve(null);
  return Promise.resolve()
    .then(() => fetchFn(url))
    .then(res => {
      if (!res || !res.ok) return null;
      const contentType = String(res.headers?.get?.("content-type") || "").toLowerCase();
      if (contentType.includes("text/html")) return null;
      return res.arrayBuffer();
    })
    .then(buf => (buf ? parser(buf) : null))
    .catch(() => null);
}

/**
 * Lazily loads `/models/item_embeddings_f16.bin` in browser environments (or via customFetch).
 * Gracefully resolves to null on 404, network error, Node.js runtime, or SPA HTML fallback.
 */
export function loadDefaultEmbeddingIndex(url = "/models/item_embeddings_f16.bin", customFetch = null) {
  const fetchFn = resolveBinaryFetch(customFetch);
  if (!fetchFn) return Promise.resolve(null);

  if (!cachedEmbeddingIndexPromise) {
    cachedEmbeddingIndexPromise = fetchEmbeddingBinaryIndex(url, fetchFn);
  }

  return cachedEmbeddingIndexPromise;
}

/**
 * Builds a Map<tmdbId, collabSim> across all items in the embedding index using multi-persona
 * K-Means centroids blended with top-3 nearest loved films.
 */
const collabDistributionCache = new WeakMap();

function getOrBuildSortedPositives(collabSimMap, minCatalogSize = 50) {
  if (!(collabSimMap instanceof Map) || collabSimMap.size < minCatalogSize) {
    return null;
  }
  let sortedPos = collabDistributionCache.get(collabSimMap);
  if (!sortedPos) {
    const pos = [];
    for (const v of collabSimMap.values()) {
      if (Number.isFinite(v) && v > 0) pos.push(v);
    }
    if (pos.length < 2) {
      collabDistributionCache.set(collabSimMap, new Float64Array(0));
      return null;
    }
    pos.sort((a, b) => a - b);
    sortedPos = Float64Array.from(pos);
    collabDistributionCache.set(collabSimMap, sortedPos);
  }
  return sortedPos.length >= 2 ? sortedPos : null;
}

/**
 * Returns the maximum positive score across the catalog map so normalization
 * stays independent of candidate pool outliers.
 */
export function getCollabCatalogMax(collabSimMap, minCatalogSize = 50) {
  const sortedPos = getOrBuildSortedPositives(collabSimMap, minCatalogSize);
  return sortedPos ? sortedPos[sortedPos.length - 1] : null;
}

/**
 * Computes pool-independent catalog percentile in [0, 1] over positive scores.
 */
export function getCollabCatalogPercentile(collabSimMap, rawScore, options = {}) {
  const sortedPos = getOrBuildSortedPositives(collabSimMap, options.minCatalogSize ?? 50);
  if (!sortedPos) return null;
  const n = sortedPos.length;

  const s = Number(rawScore);
  if (!Number.isFinite(s) || s <= 0) return 0;

  let pct;
  if (s < sortedPos[0]) {
    pct = sortedPos[0] > 0 ? (s / sortedPos[0]) / n : 0;
  } else if (s > sortedPos[n - 1]) {
    pct = 1.0;
  } else {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedPos[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    let upper = lo;
    if (lo < n && sortedPos[lo] === s) {
      let uHi = n;
      while (upper < uHi) {
        const mid = (upper + uHi) >>> 1;
        if (sortedPos[mid] <= s) upper = mid + 1;
        else uHi = mid;
      }
      pct = (0.5 * (lo + upper + 1)) / n;
    } else if (lo === 0) {
      pct = sortedPos[0] > 0 ? (s / sortedPos[0]) / n : 0;
    } else if (lo >= n) {
      pct = 1.0;
    } else {
      const span = sortedPos[lo] - sortedPos[lo - 1];
      const frac = span > 0 ? (s - sortedPos[lo - 1]) / span : 0;
      pct = (lo + frac) / n;
    }
  }

  const clamped = Math.max(0, Math.min(1, pct));
  const gamma = Number(options.percentileGamma ?? 1);
  return gamma !== 1 && Number.isFinite(gamma) && gamma > 0
    ? Math.pow(clamped, gamma)
    : clamped;
}

export function buildCollabSimMapFromIndex(weightedRatings = [], index = null, options = {}) {
  const map = new Map();
  if (!index || !index.count || !weightedRatings || weightedRatings.length === 0) return map;

  const weightCutoff = getRelativeWeightCutoff(weightedRatings);
  if (weightCutoff === null) return map;

  const { count, dim, ids, vectors, idToIndex } = index;
  const { centroids: personas, masses: personaMasses } = computePersonaDetails(weightedRatings, index, options);
  const useMixture = (options.personaAggregation ?? "mixture") === "mixture";
  const beta = Math.max(0.1, Number(options.personaBeta ?? 20));
  const ridgeBlend = Math.max(0, Math.min(1, Number(options.ridgeBlend ?? 0.25)));
  const ridgeVec = ridgeBlend > 0 ? computeUserRidgeEmbedding(weightedRatings, index, options) : null;

  if (personas.length === 0) {
    const fallbackVec = computeUserEmbedding(weightedRatings, index);
    if (!fallbackVec && !ridgeVec) return map;
    for (let i = 0; i < count; i++) {
      const base = i * dim;
      let fallbackDot = 0;
      let ridgeDot = 0;
      if (fallbackVec) {
        for (let d = 0; d < dim; d++) fallbackDot += fallbackVec[d] * vectors[base + d];
      }
      if (ridgeVec) {
        for (let d = 0; d < dim; d++) ridgeDot += ridgeVec[d] * vectors[base + d];
      }
      const val = (fallbackVec && ridgeVec)
        ? (1 - ridgeBlend) * fallbackDot + ridgeBlend * ridgeDot
        : (ridgeVec ? ridgeDot : fallbackDot);
      map.set(ids[i], val);
    }
    return map;
  }

  if (ridgeVec && ridgeBlend >= 1) {
    for (let i = 0; i < count; i++) {
      const base = i * dim;
      let ridgeDot = 0;
      for (let d = 0; d < dim; d++) ridgeDot += ridgeVec[d] * vectors[base + d];
      map.set(ids[i], ridgeDot);
    }
    return map;
  }

  const logMasses = useMixture && personas.length > 1
    ? personaMasses.map(m => Math.log(Math.max(1e-6, m)))
    : null;
  const personaDots = logMasses ? new Float64Array(personas.length) : null;

  const minPositiveRating = options.minPositiveRating ?? 7;
  const personaBlend = options.personaBlend ?? (personas.length === 1 ? 1.0 : 0.70);
  const loved = [];
  for (const entry of weightedRatings) {
    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
    if (!tmdbId || !Number.isFinite(weight) || weight <= weightCutoff) continue;
    if (Number.isFinite(rating) && rating < minPositiveRating) continue;
    const idx = idToIndex.get(tmdbId);
    if (idx === undefined) continue;
    loved.push({ weight, idx });
  }
  loved.sort((a, b) => b.weight - a.weight);
  const topLovedPool = loved.slice(0, 25);

  for (let i = 0; i < count; i++) {
    const base = i * dim;
    let bestPersonaSim = -Infinity;
    if (logMasses) {
      let maxLogit = -Infinity;
      for (let k = 0; k < personas.length; k++) {
        const p = personas[k];
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += p[d] * vectors[base + d];
        const logit = beta * dot + logMasses[k];
        personaDots[k] = logit;
        if (logit > maxLogit) maxLogit = logit;
      }
      let sumExp = 0;
      for (let k = 0; k < personas.length; k++) {
        sumExp += Math.exp(personaDots[k] - maxLogit);
      }
      bestPersonaSim = (maxLogit + Math.log(sumExp)) / beta;
    } else {
      for (const p of personas) {
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += p[d] * vectors[base + d];
        if (dot > bestPersonaSim) bestPersonaSim = dot;
      }
    }

    let clusterScore;
    if (topLovedPool.length <= 1 || personaBlend >= 1) {
      clusterScore = bestPersonaSim;
    } else {
      // Find top-3 closest individual loved films for candidate i (preserving Bayesian shrinkage)
      let s1 = -Infinity, w1 = 0;
      let s2 = -Infinity, w2 = 0;
      let s3 = -Infinity, w3 = 0;
      for (const item of topLovedPool) {
        const lBase = item.idx * dim;
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += vectors[lBase + d] * vectors[base + d];
        if (dot > s1) {
          s3 = s2; w3 = w2;
          s2 = s1; w2 = w1;
          s1 = dot; w1 = item.weight;
        } else if (dot > s2) {
          s3 = s2; w3 = w2;
          s2 = dot; w2 = item.weight;
        } else if (dot > s3) {
          s3 = dot; w3 = item.weight;
        }
      }

      let wSum = w1;
      let weightedSim = w1 * s1;
      if (s2 > -Infinity) { wSum += w2; weightedSim += w2 * s2; }
      if (s3 > -Infinity) { wSum += w3; weightedSim += w3 * s3; }
      const topLovedSim = wSum > 0 ? weightedSim / wSum : bestPersonaSim;
      clusterScore = personaBlend * bestPersonaSim + (1 - personaBlend) * topLovedSim;
    }

    if (ridgeVec && ridgeBlend > 0) {
      let ridgeDot = 0;
      for (let d = 0; d < dim; d++) ridgeDot += ridgeVec[d] * vectors[base + d];
      map.set(ids[i], (1 - ridgeBlend) * clusterScore + ridgeBlend * ridgeDot);
    } else {
      map.set(ids[i], clusterScore);
    }
  }

  return map;
}
