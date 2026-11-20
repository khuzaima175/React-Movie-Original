import {
  loadDefaultEmbeddingIndex,
  computeUserEmbedding,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  getCollabCatalogMax,
  retrieveAlignedEmbeddingNeighbors
} from "../services/embeddingService.js";

let cachedIndexPromise = null;

function getWorkerEmbeddingIndex() {
  if (!cachedIndexPromise) {
    cachedIndexPromise = loadDefaultEmbeddingIndex().catch(() => null);
  }
  return cachedIndexPromise;
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  if (type !== "computeExploreSignals") return;

  try {
    const embeddingIndex = await getWorkerEmbeddingIndex();
    if (!embeddingIndex) {
      self.postMessage({
        id,
        ok: true,
        result: {
          hasIndex: false,
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

    const collabSimMap = buildCollabSimMapFromIndex(weightedRatings, embeddingIndex);
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
