/**
 * Client-Side Sparse Full-Rank EASE^R Engine (CVEA v1 Binary Format)
 *
 * Parses a compact ~3.5 MB top-K outgoing item-item EASE^R graph trained on MovieLens 32M
 * (`public/models/item_ease_k64.cvea`), scores any user's vault in < 1 ms, and blends
 * cleanly with the SVD collaborative similarity map (60% EASE^R / 40% SVD by default)
 * with automatic SVD fallback for cold/ultra-rare films outside the EASE^R graph.
 */

import {
  float16ToFloat32,
  float32ToFloat16,
  createSessionBinaryIndexLoader
} from "./embeddingService.js";

const CVEA_MAGIC = "CVEA";
const CVEA_VERSION = 1;

export const DEFAULT_EASE_MODEL_URL = "/models/item_ease_k64.cvea";
export const DEFAULT_EASE_BLEND_WEIGHT = 0.60;

/**
 * Encodes an array of `{ tmdbId, neighbors: [{ index, weight }] }` into a CVEA v1 ArrayBuffer.
 * Useful for tests and offline tooling.
 */
export function encodeEaseBinary(items = [], kOverride = null) {
  const count = items.length;
  const K = kOverride ?? (count > 0 ? (items[0].neighbors?.length || 0) : 0);
  const headerBytes = 16;
  const idsBytes = count * 4;
  const idxBytes = count * K * 2;
  const wBytes = count * K * 2;

  const buffer = new ArrayBuffer(headerBytes + idsBytes + idxBytes + wBytes);
  const view = new DataView(buffer);

  for (let i = 0; i < 4; i++) {
    view.setUint8(i, CVEA_MAGIC.charCodeAt(i));
  }
  view.setUint32(4, CVEA_VERSION, true);
  view.setUint32(8, count, true);
  view.setUint32(12, K, true);

  let idOff = headerBytes;
  let idxOff = headerBytes + idsBytes;
  let wOff = idxOff + idxBytes;

  for (let i = 0; i < count; i++) {
    const item = items[i];
    view.setUint32(idOff, Number(item.tmdbId) >>> 0, true);
    idOff += 4;
    const nbrs = Array.isArray(item.neighbors) ? item.neighbors : [];
    for (let j = 0; j < K; j++) {
      const n = nbrs[j];
      const targetIdx = n ? Math.max(0, Math.min(count - 1, Number(n.index) || 0)) : 0;
      const weight = n ? Number(n.weight) || 0 : 0;
      view.setUint16(idxOff, targetIdx, true);
      view.setUint16(wOff, float32ToFloat16(weight), true);
      idxOff += 2;
      wOff += 2;
    }
  }

  return buffer;
}

/**
 * Parses a CVEA v1 ArrayBuffer into compact typed arrays for sub-millisecond sparse scoring.
 */
export function parseEaseBinary(buffer) {
  if (!buffer || buffer.byteLength < 16) {
    throw new Error("Invalid CVEA EASE buffer");
  }
  const view = new DataView(buffer);
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  if (magic !== CVEA_MAGIC) {
    throw new Error(`Invalid CVEA magic header: ${magic}`);
  }
  const version = view.getUint32(4, true);
  if (version !== CVEA_VERSION) {
    throw new Error(`Unsupported CVEA version: ${version}`);
  }
  const count = view.getUint32(8, true);
  const K = view.getUint32(12, true);
  if (count <= 0 || count > 65535 || K <= 0 || K > 512) {
    throw new Error(`Invalid CVEA dimensions: count=${count}, K=${K}`);
  }

  const expectedByteLength = 16 + count * 4 + count * K * 4;
  if (buffer.byteLength !== expectedByteLength) {
    throw new Error(
      `Invalid CVEA byteLength: expected ${expectedByteLength}, got ${buffer.byteLength}`
    );
  }

  const ids = new Uint32Array(count);
  const idToIndex = new Map();
  let off = 16;
  for (let i = 0; i < count; i++) {
    const id = view.getUint32(off, true);
    ids[i] = id;
    idToIndex.set(id, i);
    off += 4;
  }

  const totalEdges = count * K;
  const nbrIdx = new Uint16Array(totalEdges);
  for (let i = 0; i < totalEdges; i++) {
    nbrIdx[i] = view.getUint16(off, true);
    off += 2;
  }

  const nbrW = new Float32Array(totalEdges);
  for (let i = 0; i < totalEdges; i++) {
    nbrW[i] = float16ToFloat32(view.getUint16(off, true));
    off += 2;
  }

  return {
    count,
    K,
    ids,
    idToIndex,
    nbrIdx,
    nbrW
  };
}

const DEFAULT_WATCHLIST_EASE_WEIGHT = 0.25;
const MAX_WATCHLIST_EASE_ITEMS = 15;

/**
 * Extracts a numeric epoch timestamp from watchlist metadata for recency ordering, returning 0 when absent.
 */
function parseWatchlistTimestamp(item) {
  const rawTs = item?.updatedAt ?? item?.dateAdded ?? item?.addedAt ?? item?.createdAt ?? item?.ts;
  if (typeof rawTs === "number" && Number.isFinite(rawTs)) return rawTs;
  if (typeof rawTs === "string" && rawTs.trim()) {
    const parsed = Date.parse(rawTs);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * Computes sparse full-rank EASE^R similarity scores across all items in `easeIndex`
 * in O(|watched| * K) time (< 1 ms for typical vaults).
 */
export function buildEaseSimMapFromIndex(weightedRatings = [], easeIndex = null, options = {}) {
  const map = new Map();
  const safeWatched = Array.isArray(weightedRatings) ? weightedRatings : [];
  const rawWatchlist = Array.isArray(options?.watchlistItems) ? options.watchlistItems : [];
  const rawWlWeight = options?.watchlistWeight !== undefined
    ? Number(options.watchlistWeight)
    : DEFAULT_WATCHLIST_EASE_WEIGHT;
  const watchlistWeight = Number.isFinite(rawWlWeight) && rawWlWeight > 0 ? rawWlWeight : 0;
  const useWatchlist = watchlistWeight > 0 && rawWatchlist.length > 0;

  if (!easeIndex || !easeIndex.count || !easeIndex.K || (safeWatched.length === 0 && !useWatchlist)) {
    return map;
  }

  const { count, K, ids, idToIndex, nbrIdx, nbrW } = easeIndex;
  const negWeight = Number.isFinite(Number(options?.negWeight)) ? Number(options.negWeight) : -0.35;
  const scores = new Float32Array(count);
  const seenTmdbIds = useWatchlist ? new Set() : null;
  let touched = 0;

  for (const entry of safeWatched) {
    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    if (!Number.isFinite(tmdbId) || tmdbId <= 0) continue;
    if (seenTmdbIds) seenTmdbIds.add(tmdbId);
    const idx = idToIndex.get(tmdbId);
    if (idx === undefined) continue;

    const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
    const rawW = Number(entry?.weight ?? entry?.finalWeight ?? 0);

    let x = 0;
    if (Number.isFinite(rating) && rating > 0) {
      if (rating >= 7) {
        // Implicit + explicit continuous positive signal: 7->0.85, 8->1.00, 9->1.15, 10->1.30
        x = 0.7 + 0.6 * ((rating - 6) / 4);
      } else if (rating >= 6) {
        x = 0.25;
      } else if (rating <= 4) {
        x = negWeight;
      }
    } else if (Number.isFinite(rawW) && rawW !== 0) {
      x = rawW > 0 ? Math.min(1.3, Math.max(0.4, rawW)) : Math.max(negWeight, rawW);
    }

    if (x === 0) continue;
    touched++;

    const base = idx * K;
    for (let k = 0; k < K; k++) {
      const target = nbrIdx[base + k];
      if (target < count) {
        scores[target] += x * nbrW[base + k];
      }
    }
  }

  if (useWatchlist) {
    const candidates = [];
    for (let i = 0; i < rawWatchlist.length; i++) {
      const item = rawWatchlist[i];
      const tmdbId = Number(item?.tmdbId ?? item?.movie?.tmdbId ?? item?.id ?? 0);
      if (!Number.isFinite(tmdbId) || tmdbId <= 0 || seenTmdbIds.has(tmdbId)) continue;
      const idx = idToIndex.get(tmdbId);
      if (idx === undefined) continue;
      candidates.push({ tmdbId, idx, ts: parseWatchlistTimestamp(item), order: i });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => (b.ts - a.ts) || (b.order - a.order));
      const appliedIds = new Set();
      let appliedCount = 0;
      for (const cand of candidates) {
        if (appliedIds.has(cand.tmdbId)) continue;
        appliedIds.add(cand.tmdbId);
        appliedCount++;
        touched++;

        const base = cand.idx * K;
        for (let k = 0; k < K; k++) {
          const target = nbrIdx[base + k];
          if (target < count) {
            scores[target] += watchlistWeight * nbrW[base + k];
          }
        }
        if (appliedCount >= MAX_WATCHLIST_EASE_ITEMS) break;
      }
    }
  }

  if (touched === 0) return map;

  for (let i = 0; i < count; i++) {
    const s = scores[i];
    if (s !== 0 && Number.isFinite(s)) {
      map.set(ids[i], s);
    }
  }
  return map;
}

/**
 * Blends the sparse full-rank EASE^R similarity map with the SVD collaborative map
 * (default 60% EASE^R / 40% SVD, verified +47.6% NDCG@10 / +41.9% NDCG@20 / +7.1% Long-Tail
 * across 300 unseen MovieLens 32M users). Gracefully preserves SVD scores when EASE^R is
 * unavailable or for ultra-rare films outside the EASE^R graph.
 */
export function blendEaseAndCollabSimMaps(
  easeSimMap = null,
  collabSimMap = null,
  easeIndex = null,
  options = {}
) {
  const hasEase = easeSimMap instanceof Map && easeSimMap.size > 0;
  const hasCollab = collabSimMap instanceof Map && collabSimMap.size > 0;

  if (!hasEase && !hasCollab) return new Map();
  if (!hasEase) return collabSimMap;
  if (!hasCollab) return easeSimMap;

  const rawWeight = Number(options.easeWeight ?? DEFAULT_EASE_BLEND_WEIGHT);
  const easeWeight = Number.isFinite(rawWeight) ? Math.max(0, Math.min(1, rawWeight)) : DEFAULT_EASE_BLEND_WEIGHT;
  if (easeWeight <= 0) return collabSimMap;
  if (easeWeight >= 1) return easeSimMap;

  let maxE = 0;
  for (const v of easeSimMap.values()) {
    if (Number.isFinite(v) && v > maxE) maxE = v;
  }
  let maxS = 0;
  for (const v of collabSimMap.values()) {
    if (Number.isFinite(v) && v > maxS) maxS = v;
  }
  if (maxE <= 1e-9) return collabSimMap;
  if (maxS <= 1e-9) return easeSimMap;

  const out = new Map();
  const inEaseGraph = easeIndex?.idToIndex;
  const coldFallbackScale = 1 - easeWeight * 0.5;

  for (const [id, sv] of collabSimMap.entries()) {
    const sNorm = sv / maxS;
    const ev = easeSimMap.get(id) ?? 0;
    const eNorm = ev / maxE;
    if (!inEaseGraph || inEaseGraph.has(id) || easeSimMap.has(id)) {
      out.set(id, easeWeight * eNorm + (1 - easeWeight) * sNorm);
    } else {
      // Ultra-rare film outside EASE graph: keep smoothly scaled SVD signal instead of zeroing 60% of its score
      out.set(id, coldFallbackScale * sNorm);
    }
  }

  for (const [id, ev] of easeSimMap.entries()) {
    if (!out.has(id)) {
      out.set(id, easeWeight * (ev / maxE));
    }
  }

  return out;
}

const defaultEaseLoader = createSessionBinaryIndexLoader(DEFAULT_EASE_MODEL_URL, parseEaseBinary);

/**
 * Lazily loads `/models/item_ease_k64.cvea` in browser environments (or via customFetch).
 * Gracefully resolves to null on 404, network error, Node.js runtime, or SPA HTML fallback.
 */
export function loadDefaultEaseIndex(url = DEFAULT_EASE_MODEL_URL, customFetch = null) {
  return defaultEaseLoader.load(url, customFetch);
}

/**
 * Clears the memoized runtime EASE index promise (used for testing or manual reloads).
 */
export function resetDefaultEaseIndexCache() {
  defaultEaseLoader.reset();
}
