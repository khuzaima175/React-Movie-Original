import {
  loadDefaultEmbeddingIndex,
  computeUserEmbedding,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  getCollabCatalogMax,
  retrieveAlignedEmbeddingNeighbors
} from "./embeddingService.js";
import {
  loadDefaultEaseIndex,
  buildEaseSimMapFromIndex,
  blendEaseAndCollabSimMaps
} from "./easeService.js";

let workerInstance = null;
let workerDisabled = false;
let nextRequestId = 1;
const pendingRequests = new Map();

export function resetEmbeddingWorkerClientForTest() {
  if (workerInstance) {
    try {
      workerInstance.terminate?.();
    } catch {
      // ignore cleanup errors
    }
  }
  workerInstance = null;
  workerDisabled = false;
  pendingRequests.clear();
}

function rejectAllPending(reason) {
  for (const [, entry] of pendingRequests.entries()) {
    entry.reject(reason);
  }
  pendingRequests.clear();
}

function teardownWorker(reason) {
  workerDisabled = true;
  if (workerInstance) {
    try {
      workerInstance.terminate?.();
    } catch {
      // ignore
    }
    workerInstance = null;
  }
  rejectAllPending(reason instanceof Error ? reason : new Error(String(reason || "Embedding worker failed")));
}

function getOrCreateWorker(createWorkerFn) {
  if (workerDisabled) return null;
  if (workerInstance) return workerInstance;

  const factory =
    typeof createWorkerFn === "function"
      ? createWorkerFn
      : typeof Worker !== "undefined"
        ? () => new Worker(new URL("../workers/embeddingWorker.js", import.meta.url), { type: "module" })
        : null;

  if (!factory) return null;

  try {
    const w = factory();
    w.onmessage = (event) => {
      const { id, ok, result, error } = event.data || {};
      const pending = pendingRequests.get(id);
      if (!pending) return;
      pendingRequests.delete(id);
      if (ok) {
        pending.resolve(result);
      } else {
        pending.reject(new Error(error || "Worker error"));
      }
    };
    w.onerror = (err) => teardownWorker(err || "Embedding worker error");
    w.onmessageerror = () => teardownWorker("Embedding worker message deserialization failed");
    workerInstance = w;
    return w;
  } catch {
    workerDisabled = true;
    return null;
  }
}

function buildCollabIdSet(rawIds, collabSimMap = null) {
  const set = new Set();
  if (rawIds && typeof rawIds[Symbol.iterator] === "function") {
    for (const rawId of rawIds) {
      const id = Number(rawId);
      if (Number.isFinite(id) && id > 0) set.add(id);
    }
  }
  if (collabSimMap instanceof Map) {
    for (const rawId of collabSimMap.keys()) {
      const id = Number(rawId);
      if (Number.isFinite(id) && id > 0) set.add(id);
    }
  }
  return set.size > 0 ? set : null;
}

async function computeOnMainThread({
  weightedRatings = [],
  excludeNumericIds = [],
  topK = 240,
  repulsionWeight = 0.25,
  embeddingIndex = undefined,
  easeIndex = undefined,
  loadIndexFn = loadDefaultEmbeddingIndex,
  loadEaseFn = loadDefaultEaseIndex
}) {
  const [index, resolvedEaseIndex] = await Promise.all([
    embeddingIndex !== undefined
      ? Promise.resolve(embeddingIndex)
      : loadIndexFn().catch(() => null),
    easeIndex !== undefined
      ? Promise.resolve(easeIndex)
      : loadEaseFn().catch(() => null)
  ]);

  if (!index) {
    return {
      embeddingIndex: null,
      collabIdSet: null,
      collabSimMap: null,
      repulsionMap: null,
      collabCatalogMax: null,
      collabUserVec: null,
      alignedNeighbors: [],
      usedWorker: false
    };
  }

  const excludeSet = new Set(excludeNumericIds);
  const baseCollabSimMap = buildCollabSimMapFromIndex(weightedRatings, index);
  const easeSimMap = resolvedEaseIndex ? buildEaseSimMapFromIndex(weightedRatings, resolvedEaseIndex) : null;
  const collabSimMap = blendEaseAndCollabSimMaps(easeSimMap, baseCollabSimMap, resolvedEaseIndex);
  const repulsionMap = buildRepulsionMapFromIndex(weightedRatings, index);
  const collabCatalogMax = collabSimMap ? getCollabCatalogMax(collabSimMap) : null;
  const collabUserVec = computeUserEmbedding(weightedRatings, index);
  const alignedNeighbors = retrieveAlignedEmbeddingNeighbors(
    weightedRatings,
    index,
    excludeSet,
    {
      collabSimMap,
      repulsionMap,
      catalogMax: collabCatalogMax,
      repulsionWeight,
      topK
    }
  );

  return {
    embeddingIndex: index,
    collabIdSet: buildCollabIdSet(index.idToIndex ? index.idToIndex.keys() : index.ids, collabSimMap),
    collabSimMap,
    repulsionMap,
    collabCatalogMax,
    collabUserVec,
    alignedNeighbors,
    usedWorker: false
  };
}

/**
 * Computes CVEM v1 collaborative similarity, repulsion, catalog max, user vector, and
 * aligned neighbors off the main thread in a Web Worker when supported, falling back
 * transparently to main-thread `embeddingService.js` in Node tests or on worker error.
 */
export async function computeExploreEmbeddingSignals({
  weightedRatings = [],
  excludeNumericIds = [],
  topK = 240,
  repulsionWeight = 0.25,
  embeddingIndex = undefined,
  loadIndexFn = loadDefaultEmbeddingIndex,
  createWorkerFn = null
} = {}) {
  if (embeddingIndex !== undefined) {
    return computeOnMainThread({
      weightedRatings,
      excludeNumericIds,
      topK,
      repulsionWeight,
      embeddingIndex,
      loadIndexFn
    });
  }

  const worker = getOrCreateWorker(createWorkerFn);
  if (!worker) {
    return computeOnMainThread({
      weightedRatings,
      excludeNumericIds,
      topK,
      repulsionWeight,
      loadIndexFn
    });
  }

  // Strip heavy display fields while preserving exact numeric/rating fields used by embeddingService.js
  const compactWeighted = (weightedRatings || []).map((entry) => {
    const out = {};
    if (entry?.weight !== undefined) out.weight = entry.weight;
    if (entry?.finalWeight !== undefined) out.finalWeight = entry.finalWeight;
    if (entry?.zScore !== undefined) out.zScore = entry.zScore;
    if (entry?.rating !== undefined) out.rating = entry.rating;
    if (entry?.tmdbId !== undefined) out.tmdbId = entry.tmdbId;
    const movie = {};
    if (entry?.movie?.tmdbId !== undefined) movie.tmdbId = entry.movie.tmdbId;
    if (entry?.movie?.id !== undefined) movie.id = entry.movie.id;
    if (entry?.movie?.userRating !== undefined) movie.userRating = entry.movie.userRating;
    if (entry?.movie?.UserRating !== undefined) movie.UserRating = entry.movie.UserRating;
    out.movie = movie;
    return out;
  });

  try {
    const rawResult = await new Promise((resolve, reject) => {
      const id = nextRequestId++;
      pendingRequests.set(id, { resolve, reject });
      worker.postMessage({
        id,
        type: "computeExploreSignals",
        payload: {
          weightedRatings: compactWeighted,
          excludeNumericIds: [...excludeNumericIds],
          topK,
          repulsionWeight
        }
      });
    });

    if (!rawResult?.hasIndex) {
      return {
        embeddingIndex: null,
        collabIdSet: null,
        collabSimMap: null,
        repulsionMap: null,
        collabCatalogMax: null,
        collabUserVec: null,
        alignedNeighbors: [],
        usedWorker: true
      };
    }

    const collabSimMap = new Map(rawResult.collabEntries || []);
    return {
      embeddingIndex: null,
      collabIdSet: buildCollabIdSet(rawResult.collabIds, collabSimMap),
      collabSimMap,
      repulsionMap: new Map(rawResult.repulsionEntries || []),
      collabCatalogMax: rawResult.collabCatalogMax ?? null,
      collabUserVec: Array.isArray(rawResult.collabUserVec)
        ? new Float32Array(rawResult.collabUserVec)
        : null,
      alignedNeighbors: Array.isArray(rawResult.alignedNeighbors) ? rawResult.alignedNeighbors : [],
      usedWorker: true
    };
  } catch (err) {
    teardownWorker(err);
    return computeOnMainThread({
      weightedRatings,
      excludeNumericIds,
      topK,
      repulsionWeight,
      loadIndexFn
    });
  }
}
