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
  try {
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
    assert.ok(result.collabUserVec instanceof Float32Array);
    assert.equal(result.collabUserVec.length, 4);
    assert.ok(result.repulsionMap instanceof Map);
    assert.ok(Array.isArray(result.alignedNeighbors));
    assert.equal(result.alignedNeighbors[0]?.tmdbId, 20);
  } finally {
    resetEmbeddingWorkerClientForTest();
  }
});

test("computeExploreEmbeddingSignals recovers transparently when a Worker errors and disables worker mode for the session", async () => {
  resetEmbeddingWorkerClientForTest();
  try {
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
  } finally {
    resetEmbeddingWorkerClientForTest();
  }
});

test("computeExploreEmbeddingSignals returns collabIdSet in both main-thread and Web Worker modes", async () => {
  resetEmbeddingWorkerClientForTest();
  try {
    const tinyIndex = makeTinyEmbeddingIndex();
    const weightedRatings = [
      { movie: { tmdbId: 10, userRating: 10 }, weight: 1.5, zScore: 1.8 }
    ];

    // Main-thread fallback preserves full indexed IDs in collabIdSet
    const mainRes = await computeExploreEmbeddingSignals({
      weightedRatings,
      excludeNumericIds: [10],
      topK: 3,
      loadIndexFn: async () => tinyIndex
    });
    assert.equal(mainRes.usedWorker, false);
    assert.ok(mainRes.collabIdSet instanceof Set);
    assert.deepEqual([...mainRes.collabIdSet].sort((a, b) => a - b), [10, 20, 30, 40]);

    // Worker path exposes collabIdSet from worker payload even when embeddingIndex is null and collabEntries omits/zeroes warm IDs
    resetEmbeddingWorkerClientForTest();
    const workerRes = await computeExploreEmbeddingSignals({
      weightedRatings,
      excludeNumericIds: [10],
      topK: 3,
      createWorkerFn: () => ({
        onmessage: null,
        onerror: null,
        postMessage(msg) {
          setTimeout(() => {
            this.onmessage?.({
              data: {
                id: msg.id,
                ok: true,
                result: {
                  hasIndex: true,
                  collabIds: new Uint32Array([10, 20, 30, 40]),
                  collabEntries: [[20, 0.9], [40, 0.0005]],
                  repulsionEntries: [],
                  collabCatalogMax: 0.9,
                  collabUserVec: [1, 0, 0, 0],
                  alignedNeighbors: [{ tmdbId: 20, collabSim: 0.9, alignedScore: 0.9 }]
                }
              }
            });
          }, 0);
        },
        terminate() {}
      })
    });

    assert.equal(workerRes.usedWorker, true);
    assert.equal(workerRes.embeddingIndex, null);
    assert.ok(workerRes.collabIdSet instanceof Set);
    assert.deepEqual([...workerRes.collabIdSet].sort((a, b) => a - b), [10, 20, 30, 40]);
  } finally {
    resetEmbeddingWorkerClientForTest();
  }
});

test("computeExploreEmbeddingSignals forwards watchlistItems to EASE scoring on main thread and in worker payload", async () => {
  resetEmbeddingWorkerClientForTest();
  try {
    const { encodeEaseBinary, parseEaseBinary } = await import("../src/services/easeService.js");
    const tinyIndex = makeTinyEmbeddingIndex();
    const easeIdx = parseEaseBinary(encodeEaseBinary([
      { tmdbId: 10, neighbors: [{ index: 1, weight: 0.40 }] },
      { tmdbId: 20, neighbors: [{ index: 0, weight: 0.40 }] },
      { tmdbId: 30, neighbors: [{ index: 3, weight: 0.50 }] },
      { tmdbId: 40, neighbors: [{ index: 2, weight: 0.50 }] }
    ], 1));

    const mainWithWl = await computeExploreEmbeddingSignals({
      weightedRatings: [{ movie: { tmdbId: 10, userRating: 10 }, weight: 1.5 }],
      watchlistItems: [{ tmdbId: 30, updatedAt: "2026-11-24T00:00:00Z" }],
      excludeNumericIds: [10, 30],
      embeddingIndex: tinyIndex,
      easeIndex: easeIdx,
      loadIndexFn: async () => tinyIndex
    });
    // Without watchlistItems, 40 has 0 EASE signal; with watchlistItems=[30], 40 gets positive EASE blend
    const mainWithoutWl = await computeExploreEmbeddingSignals({
      weightedRatings: [{ movie: { tmdbId: 10, userRating: 10 }, weight: 1.5 }],
      excludeNumericIds: [10, 30],
      embeddingIndex: tinyIndex,
      easeIndex: easeIdx,
      loadIndexFn: async () => tinyIndex
    });
    assert.ok(
      (mainWithWl.collabSimMap.get(40) || 0) > (mainWithoutWl.collabSimMap.get(40) || 0),
      "Watchlist forward-intent must lift neighbor 40 in main-thread EASE+SVD blend"
    );

    // Worker payload includes compact watchlistItems when provided (including createdAt & ts)
    resetEmbeddingWorkerClientForTest();
    let capturedPayload = null;
    await computeExploreEmbeddingSignals({
      weightedRatings: [{ movie: { tmdbId: 10, userRating: 10 }, weight: 1.5 }],
      watchlistItems: [
        { tmdbId: 30, title: "Heavy unused field", updatedAt: "2026-11-24T00:00:00Z" },
        { tmdbId: 40, title: "Another heavy field", createdAt: "2026-11-23T00:00:00Z" },
        { movie: { tmdbId: 20, title: "Nested" }, ts: 1795478400000 }
      ],
      excludeNumericIds: [10, 30],
      createWorkerFn: () => ({
        onmessage: null,
        onerror: null,
        postMessage(msg) {
          capturedPayload = msg.payload;
          setTimeout(() => {
            this.onmessage?.({
              data: { id: msg.id, ok: true, result: { hasIndex: false } }
            });
          }, 0);
        },
        terminate() {}
      })
    });
    assert.deepEqual(capturedPayload?.watchlistItems, [
      { tmdbId: 30, updatedAt: "2026-11-24T00:00:00Z" },
      { tmdbId: 40, createdAt: "2026-11-23T00:00:00Z" },
      { tmdbId: 20, ts: 1795478400000 }
    ]);
  } finally {
    resetEmbeddingWorkerClientForTest();
  }
});

test("computeExploreEmbeddingSignals outer catch fallback forwards watchlistItems, watchlistWeight, easeIndex, and loadEaseFn", async () => {
  const { encodeEaseBinary, parseEaseBinary } = await import("../src/services/easeService.js");
  const tinyIndex = makeTinyEmbeddingIndex();
  const easeIdx = parseEaseBinary(encodeEaseBinary([
    { tmdbId: 10, neighbors: [{ index: 1, weight: 0.40 }] },
    { tmdbId: 20, neighbors: [{ index: 0, weight: 0.40 }] },
    { tmdbId: 30, neighbors: [{ index: 3, weight: 0.50 }] },
    { tmdbId: 40, neighbors: [{ index: 2, weight: 0.50 }] }
  ], 1));

  const failingWorkerFactory = () => ({
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      setTimeout(() => {
        this.onmessage?.({
          data: { id: msg.id, ok: false, error: "Simulated worker failure" }
        });
      }, 0);
    },
    terminate() {}
  });

  // 1. Explicit easeIndex + custom watchlistWeight forwarded on worker rejection
  resetEmbeddingWorkerClientForTest();
  let explicitResDefaultWeight;
  try {
    explicitResDefaultWeight = await computeExploreEmbeddingSignals({
      weightedRatings: [{ movie: { tmdbId: 10, userRating: 10 }, weight: 1.5 }],
      watchlistItems: [{ tmdbId: 30, ts: 1795478400000 }],
      watchlistWeight: 0.25,
      excludeNumericIds: [10, 30],
      easeIndex: easeIdx,
      loadIndexFn: async () => tinyIndex,
      loadEaseFn: async () => {
        throw new Error("loadEaseFn should not be called when easeIndex is provided");
      },
      createWorkerFn: failingWorkerFactory
    });
  } finally {
    resetEmbeddingWorkerClientForTest();
  }

  let explicitResHigherWeight;
  try {
    explicitResHigherWeight = await computeExploreEmbeddingSignals({
      weightedRatings: [{ movie: { tmdbId: 10, userRating: 10 }, weight: 1.5 }],
      watchlistItems: [{ tmdbId: 30, ts: 1795478400000 }],
      watchlistWeight: 0.50,
      excludeNumericIds: [10, 30],
      easeIndex: easeIdx,
      loadIndexFn: async () => tinyIndex,
      createWorkerFn: failingWorkerFactory
    });
  } finally {
    resetEmbeddingWorkerClientForTest();
  }

  assert.equal(explicitResDefaultWeight.usedWorker, false);
  assert.equal(explicitResHigherWeight.usedWorker, false);
  assert.ok(
    (explicitResDefaultWeight.collabSimMap.get(40) || 0) > 0,
    "Fallback must forward easeIndex and watchlistItems so neighbor 40 receives positive EASE score"
  );
  assert.ok(
    (explicitResHigherWeight.collabSimMap.get(40) || 0) > (explicitResDefaultWeight.collabSimMap.get(40) || 0),
    "Fallback must forward watchlistWeight so higher weight increases neighbor 40 EASE score"
  );

  // 2. loadEaseFn invoked when easeIndex is omitted on worker rejection
  resetEmbeddingWorkerClientForTest();
  let loadEaseCalls = 0;
  let loaderFallbackRes;
  try {
    loaderFallbackRes = await computeExploreEmbeddingSignals({
      weightedRatings: [{ movie: { tmdbId: 10, userRating: 10 }, weight: 1.5 }],
      watchlistItems: [{ tmdbId: 30, createdAt: "2026-11-24T00:00:00Z" }],
      excludeNumericIds: [10, 30],
      loadIndexFn: async () => tinyIndex,
      loadEaseFn: async () => {
        loadEaseCalls += 1;
        return easeIdx;
      },
      createWorkerFn: failingWorkerFactory
    });
  } finally {
    resetEmbeddingWorkerClientForTest();
  }

  assert.equal(loaderFallbackRes.usedWorker, false);
  assert.equal(loadEaseCalls, 1, "Fallback must invoke loadEaseFn when easeIndex is undefined");
  assert.equal(
    loaderFallbackRes.collabSimMap.get(40),
    explicitResDefaultWeight.collabSimMap.get(40),
    "Fallback via loadEaseFn must match explicit easeIndex watchlist EASE lift on neighbor 40"
  );
});
