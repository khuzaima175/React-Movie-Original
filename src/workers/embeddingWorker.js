import {
  loadDefaultEmbeddingIndex,
  computeUserEmbedding,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  getCollabCatalogMax,
  retrieveAlignedEmbeddingNeighbors
} from "../services/embeddingService.js";
import {
  loadDefaultEaseIndex,
  buildEaseSimMapFromIndex,
  blendEaseAndCollabSimMaps
} from "../services/easeService.js";

let cachedIndexPromise = null;
let cachedEasePromise = null;

function getWorkerEmbeddingIndex() {
  if (!cachedIndexPromise) {
    cachedIndexPromise = loadDefaultEmbeddingIndex().catch(() => null);
  }
  return cachedIndexPromise;
}

function getWorkerEaseIndex() {
  if (!cachedEasePromise) {
    cachedEasePromise = loadDefaultEaseIndex().catch(() => null);
  }
  return cachedEasePromise;
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  if (type !== "computeExploreSignals") return;

  try {
    const [embeddingIndex, easeIndex] = await Promise.all([
      getWorkerEmbeddingIndex(),
      getWorkerEaseIndex()
    ]);
    if (!embeddingIndex) {
      self.postMessage({
        id,
        ok: true,
        result: {
          hasIndex: false,
          collabIds: null,
          collabEntries: [],
          repulsionEntries: [],
          collabCatalogMax: null,
          collabUserVec: null,
          alignedNeighbors: []
        }
      });
      return;
    }

    const weightedRatings = Array.isArray(payload?.weightedRatings) ? payload.weightedRatings : [];
    const excludeSet = new Set(Array.isArray(payload?.excludeNumericIds) ? payload.excludeNumericIds : []);
    const topK = Number.isFinite(Number(payload?.topK)) ? Number(payload.topK) : 240;
    const rawRepulsionWeight = Number(payload?.repulsionWeight);
    const repulsionWeight = Number.isFinite(rawRepulsionWeight) ? rawRepulsionWeight : 0.25;

    const baseCollabSimMap = buildCollabSimMapFromIndex(weightedRatings, embeddingIndex);
    const easeSimMap = easeIndex ? buildEaseSimMapFromIndex(weightedRatings, easeIndex) : null;
    const collabSimMap = blendEaseAndCollabSimMaps(easeSimMap, baseCollabSimMap, easeIndex);
    const repulsionMap = buildRepulsionMapFromIndex(weightedRatings, embeddingIndex);
    const collabCatalogMax = collabSimMap ? getCollabCatalogMax(collabSimMap) : null;
    const collabUserVec = computeUserEmbedding(weightedRatings, embeddingIndex);
    const alignedNeighbors = retrieveAlignedEmbeddingNeighbors(
      weightedRatings,
      embeddingIndex,
      excludeSet,
      {
        collabSimMap,
        repulsionMap,
        catalogMax: collabCatalogMax,
        repulsionWeight,
        topK
      }
    );

    self.postMessage({
      id,
      ok: true,
      result: {
        hasIndex: true,
        collabIds: embeddingIndex.ids || null,
        collabEntries: collabSimMap ? [...collabSimMap.entries()] : [],
        repulsionEntries: repulsionMap ? [...repulsionMap.entries()] : [],
        collabCatalogMax,
        collabUserVec: collabUserVec ? Array.from(collabUserVec) : null,
        alignedNeighbors
      }
    });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message || "Worker embedding computation failed"
    });
  }
};
