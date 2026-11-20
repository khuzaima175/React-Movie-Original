import test from "node:test";
import assert from "node:assert/strict";
import {
  computeExploreEmbeddingSignals,
  resetEmbeddingWorkerClientForTest
} from "../src/services/embeddingWorkerClient.js";

function makeTinyEmbeddingIndex() {
  const dim = 4;
  const ids = [10, 20, 30, 40];
  const vecs = [
    [1, 0, 0, 0],
    [0.95, 0.31, 0, 0],
    [0, 1, 0, 0],
    [0.85, 0.52, 0, 0]
  ];
  const vectors = new Float32Array(ids.length * dim);
  const idToIndex = new Map();
  ids.forEach((id, i) => {
    idToIndex.set(id, i);
    for (let d = 0; d < dim; d += 1) {
      vectors[i * dim + d] = vecs[i][d];
    }
  });
  return { dim, count: ids.length, ids: new Uint32Array(ids), vectors, idToIndex };
}

test("computeExploreEmbeddingSignals falls back cleanly to main-thread embeddingService when Worker is unavailable", async () => {
  resetEmbeddingWorkerClientForTest();
  const tinyIndex = makeTinyEmbeddingIndex();
  const weightedRatings = [
    { movie: { tmdbId: 10, userRating: 10 }, weight: 1.5, zScore: 1.8 }
  ];

  const result = await computeExploreEmbeddingSignals({
    weightedRatings,
    excludeNumericIds: [10],
    topK: 3,
    repulsionWeight: 0.25,
    loadIndexFn: async () => tinyIndex
  });

  assert.equal(result.usedWorker, false);
  assert.ok(result.collabSimMap instanceof Map);
  assert.ok(result.collabSimMap.get(20) > 0.8);
  assert.ok(result.repulsionMap instanceof Map);
  assert.ok(Array.isArray(result.alignedNeighbors));
  assert.equal(result.alignedNeighbors[0]?.tmdbId, 20);
});

test("computeExploreEmbeddingSignals recovers transparently when a Worker errors and disables worker mode for the session", async () => {
  resetEmbeddingWorkerClientForTest();
  const tinyIndex = makeTinyEmbeddingIndex();
  const weightedRatings = [
    { movie: { tmdbId: 10, userRating: 10 }, weight: 1.5, zScore: 1.8 }
  ];

  let workerCreateCount = 0;
  const brokenWorkerFactory = () => {
    workerCreateCount += 1;
    return {
      onmessage: null,
      onerror: null,
      postMessage() {
        setTimeout(() => {
          this.onerror?.(new Error("Simulated worker crash"));
        }, 5);
      },
      terminate() {}
    };
  };

  const first = await computeExploreEmbeddingSignals({
    weightedRatings,
    excludeNumericIds: [10],
    topK: 3,
    repulsionWeight: 0.25,
    loadIndexFn: async () => tinyIndex,
    createWorkerFn: brokenWorkerFactory
  });

  assert.equal(first.usedWorker, false);
  assert.equal(first.alignedNeighbors[0]?.tmdbId, 20);
  assert.equal(workerCreateCount, 1);

  // Second call skips broken worker immediately
  const second = await computeExploreEmbeddingSignals({
    weightedRatings,
    excludeNumericIds: [10],
    topK: 3,
    repulsionWeight: 0.25,
    loadIndexFn: async () => tinyIndex,
    createWorkerFn: brokenWorkerFactory
  });

  assert.equal(second.usedWorker, false);
  assert.equal(workerCreateCount, 1);
});
