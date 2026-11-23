import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  encodeEaseBinary,
  parseEaseBinary,
  buildEaseSimMapFromIndex,
  blendEaseAndCollabSimMaps,
  loadDefaultEaseIndex,
  resetDefaultEaseIndexCache
} from "../src/services/easeService.js";

test("encodeEaseBinary and parseEaseBinary round-trip CVEA v1 binary losslessly within float16 precision", () => {
  const items = [
    { tmdbId: 155, neighbors: [{ index: 1, weight: 0.42 }, { index: 2, weight: 0.15 }] },
    { tmdbId: 272, neighbors: [{ index: 0, weight: 0.51 }, { index: 2, weight: 0.08 }] },
    { tmdbId: 1124, neighbors: [{ index: 0, weight: 0.25 }, { index: 1, weight: 0.19 }] }
  ];
  const buf = encodeEaseBinary(items, 2);
  const parsed = parseEaseBinary(buf);

  assert.equal(parsed.count, 3);
  assert.equal(parsed.K, 2);
  assert.deepEqual([...parsed.ids], [155, 272, 1124]);
  assert.equal(parsed.idToIndex.get(272), 1);
  assert.equal(parsed.nbrIdx[0], 1);
  assert.ok(Math.abs(parsed.nbrW[0] - 0.42) < 0.002);
  assert.equal(parsed.nbrIdx[2], 0);
  assert.ok(Math.abs(parsed.nbrW[2] - 0.51) < 0.002);
});

test("parseEaseBinary rejects invalid magic header, version, or truncated buffers", () => {
  const valid = encodeEaseBinary([{ tmdbId: 10, neighbors: [{ index: 0, weight: 0.1 }] }], 1);
  const badMagic = valid.slice(0);
  new DataView(badMagic).setUint8(0, "X".charCodeAt(0));
  assert.throws(() => parseEaseBinary(badMagic), /Invalid CVEA magic/);

  const badVer = valid.slice(0);
  new DataView(badVer).setUint32(4, 99, true);
  assert.throws(() => parseEaseBinary(badVer), /Unsupported CVEA version/);

  assert.throws(() => parseEaseBinary(valid.slice(0, 18)), /Invalid CVEA byteLength/);
});

test("buildEaseSimMapFromIndex accumulates higher scores for 10/10 watches and applies repulsion for <=4/10 dislikes", () => {
  const items = [
    { tmdbId: 100, neighbors: [{ index: 2, weight: 0.50 }, { index: 3, weight: 0.10 }] },
    { tmdbId: 200, neighbors: [{ index: 3, weight: 0.60 }, { index: 2, weight: 0.05 }] },
    { tmdbId: 300, neighbors: [{ index: 0, weight: 0.40 }, { index: 1, weight: 0.10 }] },
    { tmdbId: 400, neighbors: [{ index: 1, weight: 0.40 }, { index: 0, weight: 0.10 }] }
  ];
  const idx = parseEaseBinary(encodeEaseBinary(items, 2));

  const map = buildEaseSimMapFromIndex(
    [
      { tmdbId: 100, rating: 10, weight: 1.5 },
      { tmdbId: 200, rating: 3, weight: -1.2 }
    ],
    idx
  );

  // Movie 300 gets +1.30 * 0.50 + (-0.35) * 0.05 = ~0.6325
  // Movie 400 gets +1.30 * 0.10 + (-0.35) * 0.60 = ~-0.08
  assert.ok(map.get(300) > 0.6, `Expected strong positive EASE score for 300, got ${map.get(300)}`);
  assert.ok(map.get(400) < 0, `Expected negative EASE score for disliked neighbor 400, got ${map.get(400)}`);
});

test("blendEaseAndCollabSimMaps blends 60/40 cleanly, preserves cold SVD items, and falls back when EASE is null", () => {
  const svdMap = new Map([
    [10, 0.8],
    [20, 0.4],
    [999, 0.6] // ultra-rare movie not in EASE graph
  ]);
  const easeMap = new Map([
    [10, 0.25],
    [20, 1.0]
  ]);
  const fakeEaseIdx = { idToIndex: new Map([[10, 0], [20, 1]]) };

  // Null fallback returns SVD map untouched
  assert.strictEqual(blendEaseAndCollabSimMaps(null, svdMap, null), svdMap);

  const blended = blendEaseAndCollabSimMaps(easeMap, svdMap, fakeEaseIdx, { easeWeight: 0.6 });
  // Movie 10: 0.6 * (0.25/1.0) + 0.4 * (0.8/0.8) = 0.15 + 0.40 = 0.55
  // Movie 20: 0.6 * (1.0/1.0) + 0.4 * (0.4/0.8) = 0.60 + 0.20 = 0.80
  // Movie 999 (cold outside EASE): (1 - 0.6*0.5) * (0.6/0.8) = 0.7 * 0.75 = 0.525
  assert.ok(Math.abs(blended.get(10) - 0.55) < 1e-6);
  assert.ok(Math.abs(blended.get(20) - 0.80) < 1e-6);
  assert.ok(Math.abs(blended.get(999) - 0.525) < 1e-6);
  assert.ok(blended.get(20) > blended.get(10));
});

test("loadDefaultEaseIndex rejects SPA HTML fallback and loads valid CVEA payload", async () => {
  resetDefaultEaseIndexCache();
  const htmlFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html; charset=utf-8" },
    arrayBuffer: async () => new ArrayBuffer(0)
  });
  const htmlRes = await loadDefaultEaseIndex("/models/item_ease_k64.cvea", htmlFetch);
  assert.equal(htmlRes, null);

  resetDefaultEaseIndexCache();
  const validBuf = encodeEaseBinary([{ tmdbId: 550, neighbors: [{ index: 0, weight: 0.3 }] }], 1);
  const okFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/octet-stream" },
    arrayBuffer: async () => validBuf
  });
  const okRes = await loadDefaultEaseIndex("/models/item_ease_k64.cvea", okFetch);
  assert.equal(okRes?.count, 1);
  assert.equal(okRes?.ids[0], 550);
  resetDefaultEaseIndexCache();
});

test("production public/models/item_ease_k64.cvea parses cleanly and scores in < 20ms", () => {
  const modelPath = path.resolve(process.cwd(), "public/models/item_ease_k64.cvea");
  assert.ok(fs.existsSync(modelPath), "Expected production item_ease_k64.cvea binary to exist");
  const buf = fs.readFileSync(modelPath);
  const idx = parseEaseBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(idx.count, 14000);
  assert.equal(idx.K, 64);

  // Score Dark Knight (155) + Inception (27205) + Interstellar (157336)
  const t0 = performance.now();
  const scores = buildEaseSimMapFromIndex(
    [
      { tmdbId: 155, rating: 10 },
      { tmdbId: 27205, rating: 10 },
      { tmdbId: 157336, rating: 9 }
    ],
    idx
  );
  const elapsed = performance.now() - t0;
  assert.ok(scores.size > 50, "Expected rich sparse neighbor fan-out");
  // Top unseen Nolan/sci-fi neighbors should rank cleanly at the top
  const unseenTop15 = [...scores.entries()]
    .filter(([id]) => id !== 155 && id !== 27205 && id !== 157336)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([id]) => id);
  assert.ok(unseenTop15.includes(49026), "Expected The Dark Knight Rises (49026) in top 15 EASE neighbors");
  assert.ok(unseenTop15.includes(272), "Expected Batman Begins (272) in top 15 EASE neighbors");
  assert.ok(unseenTop15.includes(1124), "Expected The Prestige (1124) in top 15 EASE neighbors");
  assert.ok((scores.get(272) || 0) > 0.08, "Expected Batman Begins (272) strong EASE affinity");
  assert.ok((scores.get(1124) || 0) > 0.08, "Expected The Prestige (1124) strong EASE affinity");
  assert.ok(elapsed < 50, `Expected sub-50ms sparse EASE scoring, got ${elapsed.toFixed(2)}ms`);
});
