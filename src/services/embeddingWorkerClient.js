import {
  loadDefaultEmbeddingIndex,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  getCollabCatalogMax,
  retrieveAlignedEmbeddingNeighbors
} from "./embeddingService.js";

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
    w.onerror = (err) => {
      workerDisabled = true;
      try {
        w.terminate?.();
      } catch {
        // ignore
      }
      workerInstance = null;
      rejectAllPending(err instanceof Error ? err : new Error("Embedding worker failed"));
    };
    workerInstance = w;
    return w;
  } catch {
    workerDisabled = true;
    return null;
  }
}

async function computeOnMainThread({
  weightedRatings = [],
  excludeNumericIds = [],
  topK = 240,
  repulsionWeight = 0.25,
  embeddingIndex = undefined,
  loadIndexFn = loadDefaultEmbeddingIndex
}) {
  const index =
    embeddingIndex !== undefined
      ? embeddingIndex
      : await loadIndexFn().catch(() => null);

  if (!index) {
    return {
      embeddingIndex: null,
      collabSimMap: null,
      repulsionMap: null,
      collabCatalogMax: null,
      alignedNeighbors: [],
      usedWorker: false
    };
  }

  const excludeSet = new Set(excludeNumericIds);
  const collabSimMap = buildCollabSimMapFromIndex(weightedRatings, index);
  const repulsionMap = buildRepulsionMapFromIndex(weightedRatings, index);
  const collabCatalogMax = collabSimMap ? getCollabCatalogMax(collabSimMap) : null;
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
    collabSimMap,
    repulsionMap,
    collabCatalogMax,
    alignedNeighbors,
    usedWorker: false
  };
}

/**
 * Computes CVEM v1 collaborative similarity, repulsion, catalog max, and aligned
 * neighbors off the main thread in a Web Worker when supported, falling back
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

  // Strip heavy fields from weightedRatings before structured-clone transfer to worker
  const compactWeighted = (weightedRatings || []).map((entry) => ({
    weight: entry?.weight || 0,
    zScore: entry?.zScore || 0,
    movie: {
      tmdbId: entry?.movie?.tmdbId ?? entry?.movie?.id ?? null,
      userRating: entry?.movie?.userRating ?? 0
    }
  }));

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
        collabSimMap: null,
        repulsionMap: null,
        collabCatalogMax: null,
        alignedNeighbors: [],
        usedWorker: true
      };
    }

    return {
      embeddingIndex: null,
      collabSimMap: new Map(rawResult.collabEntries || []),
      repulsionMap: new Map(rawResult.repulsionEntries || []),
      collabCatalogMax: rawResult.collabCatalogMax ?? null,
      alignedNeighbors: Array.isArray(rawResult.alignedNeighbors) ? rawResult.alignedNeighbors : [],
      usedWorker: true
    };
  } catch {
    workerDisabled = true;
    return computeOnMainThread({
      weightedRatings,
      excludeNumericIds,
      topK,
      repulsionWeight,
      loadIndexFn
    });
  }
}
