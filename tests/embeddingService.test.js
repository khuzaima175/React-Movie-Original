import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeEmbeddingBinary,
  parseEmbeddingBinary,
  computeUserEmbedding,
  blendEmbeddings,
  retrieveByEmbedding,
  loadDefaultEmbeddingIndex,
  resetDefaultEmbeddingIndexCache,
  buildCollabSimMapFromIndex
} from "../src/services/embeddingService.js";

test("encodeEmbeddingBinary and parseEmbeddingBinary round-trip float16 embeddings accurately", () => {
  const rawItems = [
    { tmdbId: 603, vector: [0.8, 0.6, 0.0, 0.0] },   // The Matrix
    { tmdbId: 155, vector: [0.7, 0.7, 0.1, 0.0] },   // The Dark Knight
    { tmdbId: 11036, vector: [-0.8, -0.6, 0.0, 0.0] } // Opposite genre film
  ];
  const buf = encodeEmbeddingBinary(rawItems);
  const index = parseEmbeddingBinary(buf);

  assert.equal(index.count, 3);
  assert.equal(index.dim, 4);
  assert.equal(index.idToIndex.get(603), 0);
  const v0 = index.vectors.subarray(0, 4);
  assert.ok(Math.abs(v0[0] - 0.8) < 0.002);
  assert.ok(Math.abs(v0[1] - 0.6) < 0.002);
});

test("computeUserEmbedding pushes away from negatively weighted films and retrieves nearest neighbors", () => {
  const index = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 1, vector: [1, 0, 0, 0] },
    { tmdbId: 2, vector: [0.9, 0.435, 0, 0] },
    { tmdbId: 3, vector: [0, 1, 0, 0] },
    { tmdbId: 4, vector: [-0.9, 0.435, 0, 0] }
  ]));

  // User loved film 1 (+1.0) and hated film 3 (-1.0)
  const userVec = computeUserEmbedding(
    [
      { movie: { tmdbId: 1 }, weight: 1.0 },
      { movie: { tmdbId: 3 }, weight: -1.0 }
    ],
    index
  );
  assert.ok(userVec instanceof Float32Array);

  const neighbors = retrieveByEmbedding(userVec, index, new Set([1, 3]), 2);
  assert.equal(neighbors.length, 2);
  assert.equal(neighbors[0].tmdbId, 2);
  assert.ok(neighbors[0].collabSim > neighbors[1].collabSim);
});

test("computeUserEmbedding returns null when no rated films exist in the index", () => {
  const index = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 1, vector: [1, 0, 0, 0] }
  ]));
  const userVec = computeUserEmbedding([{ movie: { tmdbId: 999999 }, weight: 1.2 }], index);
  assert.equal(userVec, null);
  assert.deepEqual(retrieveByEmbedding(userVec, index, new Set(), 10), []);
});

test("blendEmbeddings weights toward content for low-rating items and toward collab for high-rating items", () => {
  const collab = new Float32Array([1, 0]);
  const content = new Float32Array([0, 1]);
  const coldBlend = blendEmbeddings(collab, content, 5, 50); // alpha = 5/55
  const warmBlend = blendEmbeddings(collab, content, 500, 50); // alpha = 500/550
  assert.ok(coldBlend[1] > coldBlend[0], "cold item leans toward content vector");
  assert.ok(warmBlend[0] > warmBlend[1], "warm item leans toward collab vector");
});

test("loadDefaultEmbeddingIndex loads and caches valid CVEM binary and returns null on 404 or SPA HTML fallback", async () => {
  resetDefaultEmbeddingIndexCache();
  const validBuf = encodeEmbeddingBinary([
    { tmdbId: 603, vector: [0.8, 0.6, 0, 0] },
    { tmdbId: 155, vector: [0.6, 0.8, 0, 0] }
  ]);

  let fetchCalls = 0;
  const mockFetchOk = async () => {
    fetchCalls++;
    return { ok: true, arrayBuffer: async () => validBuf };
  };

  const idx1 = await loadDefaultEmbeddingIndex("/models/item_embeddings_f16.bin", mockFetchOk);
  const idx2 = await loadDefaultEmbeddingIndex("/models/item_embeddings_f16.bin", mockFetchOk);
  assert.ok(idx1);
  assert.equal(idx1.count, 2);
  assert.equal(idx1, idx2);
  assert.equal(fetchCalls, 1, "memoizes promise across calls");

  // SPA HTML fallback (status 200 returning <!DOCTYPE html> instead of CVEM binary)
  resetDefaultEmbeddingIndexCache();
  const htmlBytes = new TextEncoder().encode("<!DOCTYPE html><html><body>Not found</body></html>").buffer;
  const idxHtml = await loadDefaultEmbeddingIndex("/models/item_embeddings_f16.bin", async () => ({
    ok: true,
    arrayBuffer: async () => htmlBytes
  }));
  assert.equal(idxHtml, null, "gracefully returns null when SPA returns HTML instead of CVEM binary");
});

test("buildCollabSimMapFromIndex computes cosine similarity map for all items in index", () => {
  const index = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 10, vector: [1, 0, 0, 0] },
    { tmdbId: 20, vector: [0.8, 0.6, 0, 0] }
  ]));
  const simMap = buildCollabSimMapFromIndex([{ movie: { tmdbId: 10 }, weight: 1.5 }], index);
  assert.ok(simMap instanceof Map);
  assert.ok(Math.abs(simMap.get(20) - 0.8) < 0.01);
});

test("parseEmbeddingBinary strictly rejects Vite SPA HTML fallback, invalid dims, and mismatched byteLength", () => {
  const spaHtmlBuffer = new TextEncoder().encode("<!doctype html><html><body>Vite SPA fallback</body></html>").buffer;
  assert.throws(
    () => parseEmbeddingBinary(spaHtmlBuffer),
    /Invalid embedding magic header/,
    "must reject HTML fallback buffer directly in parseEmbeddingBinary"
  );

  // Craft a buffer with valid CVEM header (count=2, dim=4) but truncated byteLength
  const validBuf = encodeEmbeddingBinary([
    { tmdbId: 1, vector: [1, 0, 0, 0] },
    { tmdbId: 2, vector: [0, 1, 0, 0] }
  ]);
  const truncatedBuf = validBuf.slice(0, validBuf.byteLength - 2);
  assert.throws(
    () => parseEmbeddingBinary(truncatedBuf),
    /Invalid CVEM byteLength/,
    "must reject buffer whose byteLength does not match header + count*4 + count*dim*2"
  );

  // Craft a buffer with out-of-bounds dim (e.g. dim=0)
  const badDimBuf = new ArrayBuffer(16);
  const view = new DataView(badDimBuf);
  "CVEM".split("").forEach((ch, i) => view.setUint8(i, ch.charCodeAt(0)));
  view.setUint32(4, 1, true); // version 1
  view.setUint32(8, 1, true); // count 1
  view.setUint32(12, 0, true); // dim 0 (invalid)
  assert.throws(
    () => parseEmbeddingBinary(badDimBuf),
    /Invalid CVEM dimensions/,
    "must reject buffer with out-of-bounds dim"
  );
});

test("loadDefaultEmbeddingIndex rejects responses with Content-Type: text/html before reading body", async () => {
  resetDefaultEmbeddingIndexCache();
  let arrayBufferCalled = false;
  const mockHtmlHeaderFetch = async () => ({
    ok: true,
    headers: {
      get: (name) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null)
    },
    arrayBuffer: async () => {
      arrayBufferCalled = true;
      return new ArrayBuffer(0);
    }
  });

  const idx = await loadDefaultEmbeddingIndex("/models/item_embeddings_f16.bin", mockHtmlHeaderFetch);
  assert.equal(idx, null, "must return null when content-type includes text/html");
  assert.equal(arrayBufferCalled, false, "should not even read arrayBuffer when content-type is text/html");
});
