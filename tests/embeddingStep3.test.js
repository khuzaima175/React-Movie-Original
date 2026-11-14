import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCollabSimMapFromIndex,
  computePersonaDetails,
  computeUserPersonas,
  computeUserRidgeEmbedding,
  encodeEmbeddingBinary,
  parseEmbeddingBinary,
} from "../src/services/embeddingService.js";

function makeOrthoIndex() {
  return parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 1, vector: [1, 0, 0, 0] },
    { tmdbId: 2, vector: [0.98, 0.2, 0, 0] },
    { tmdbId: 3, vector: [0.96, -0.28, 0, 0] },
    { tmdbId: 4, vector: [0, 1, 0, 0] },
    { tmdbId: 5, vector: [0, 0, 1, 0] },
    { tmdbId: 6, vector: [0, 0, 0, 1] },
  ]));
}

test("computePersonaDetails exposes normalized cluster masses while computeUserPersonas preserves Float32Array[] return", () => {
  const index = makeOrthoIndex();
  const ratings = [
    { tmdbId: 1, weight: 2.0, rating: 10 },
    { tmdbId: 2, weight: 2.0, rating: 10 },
    { tmdbId: 3, weight: 2.0, rating: 10 },
    { tmdbId: 4, weight: 0.6, rating: 8 },
  ];

  const details = computePersonaDetails(ratings, index, { splitThreshold: 0.2 });
  assert.equal(details.centroids.length, 2);
  assert.equal(details.masses.length, 2);
  const massSum = details.masses.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(massSum - 1.0) < 1e-6);
  assert.ok(details.masses[0] > details.masses[1], "dominant 3-film cluster should have higher mass");

  const compat = computeUserPersonas(ratings, index, { splitThreshold: 0.2 });
  assert.ok(Array.isArray(compat));
  assert.equal(compat.length, 2);
  assert.ok(compat[0] instanceof Float32Array);
});

test("buildCollabSimMapFromIndex log-sum-exp mixture favors higher-mass persona when candidate matches equally", () => {
  const index = makeOrthoIndex();
  const ratings = [
    { tmdbId: 1, weight: 2.0, rating: 10 },
    { tmdbId: 2, weight: 2.0, rating: 10 },
    { tmdbId: 3, weight: 2.0, rating: 10 },
    { tmdbId: 4, weight: 0.5, rating: 8 },
  ];

  const mapMax = buildCollabSimMapFromIndex(ratings, index, {
    splitThreshold: 0.2,
    personaBlend: 1.0,
    personaAggregation: "max",
  });
  const mapMix = buildCollabSimMapFromIndex(ratings, index, {
    splitThreshold: 0.2,
    personaBlend: 1.0,
    personaAggregation: "mixture",
    personaBeta: 8,
  });

  // Item 1 (major cluster) vs Item 4 (tiny cluster): max treats both clusters equally, mixture boosts major cluster relative to tiny cluster
  const gapMax = (mapMax.get(1) ?? 0) - (mapMax.get(4) ?? 0);
  const gapMix = (mapMix.get(1) ?? 0) - (mapMix.get(4) ?? 0);
  assert.ok(gapMix > gapMax + 0.1, `expected mixture gap ${gapMix} > max gap ${gapMax}`);
});

test("computeUserRidgeEmbedding separates high-rated positive direction from neutral/disliked directions", () => {
  const index = makeOrthoIndex();
  const ratings = [
    { tmdbId: 1, weight: 2.0, rating: 10 },
    { tmdbId: 2, weight: 1.5, rating: 9 },
    { tmdbId: 4, weight: -1.2, rating: 5 },
    { tmdbId: 5, weight: -1.8, rating: 3 },
    { tmdbId: 6, weight: 0.0, rating: 7 },
  ];

  const u = computeUserRidgeEmbedding(ratings, index, { ridgeLambda: 2.0, ridgeMinItems: 3 });
  assert.ok(u instanceof Float32Array);
  assert.ok(u[0] > 0.7, `positive axis should dominate: ${u[0]}`);
  assert.ok(u[2] < -0.2, `disliked axis should be negative: ${u[2]}`);

  const ridgeMap = buildCollabSimMapFromIndex(ratings, index, { ridgeBlend: 1.0, ridgeLambda: 2.0, ridgeMinItems: 3 });
  assert.ok((ridgeMap.get(1) ?? 0) > (ridgeMap.get(5) ?? 0));
});
