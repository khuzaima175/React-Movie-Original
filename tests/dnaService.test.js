import test from "node:test";
import assert from "node:assert/strict";
import { encodeDnaBinary, parseDnaBinary, buildUserDnaProfile, dnaSim } from "../src/services/dnaService.js";

const rows = [
  { tmdbId: 1, axes: [100, 0, 50, 50] },
  { tmdbId: 2, axes: [90, 10, 50, 50] },
  { tmdbId: 3, axes: [0, 100, 50, 50] },
  { tmdbId: 4, axes: [10, 90, 50, 50] },
];

test("binary round-trips ids and axes", () => {
  const idx = parseDnaBinary(encodeDnaBinary(rows));
  assert.equal(idx.dim, 4);
  assert.deepEqual([...idx.vectors.slice(0, 4)].length, 4);
  assert.ok(idx.idToIndex.has(3));
});

test("rejects bad magic / length", () => {
  assert.throws(() => parseDnaBinary(new ArrayBuffer(8)));
  const buf = encodeDnaBinary(rows);
  assert.throws(() => parseDnaBinary(buf.slice(0, buf.byteLength - 1)));
});

test("mean-centred similarity: like-minded positive, opposite negative", () => {
  const idx = parseDnaBinary(encodeDnaBinary(rows));
  const profile = buildUserDnaProfile(idx, [1, 2]);
  const same = dnaSim(idx, profile, 2);
  const opposite = dnaSim(idx, profile, 3);
  assert.ok(same > 0.9, `same=${same}`);
  assert.ok(opposite < -0.9, `opposite=${opposite}`);
});

test("unknown ids / empty profile give 0", () => {
  const idx = parseDnaBinary(encodeDnaBinary(rows));
  assert.equal(buildUserDnaProfile(idx, [999]), null);
  assert.equal(dnaSim(idx, null, 1), 0);
  assert.equal(dnaSim(idx, buildUserDnaProfile(idx, [1]), 999), 0);
});

test("loadDefaultDnaIndex rejects 404/HTML safely and buildDnaSimMap scores matching CDNA films", async () => {
  const {
    encodeDnaBinary,
    loadDefaultDnaIndex,
    resetDefaultDnaIndexCache,
    buildDnaSimMap
  } = await import("../src/services/dnaService.js");
  resetDefaultDnaIndexCache();
  assert.equal(await loadDefaultDnaIndex("/models/cinematic_dna_u8.bin", async () => ({ ok: false, status: 404 })), null);

  resetDefaultDnaIndexCache();
  const htmlBuf = new TextEncoder().encode("<!doctype html><html></html>").buffer;
  assert.equal(
    await loadDefaultDnaIndex("/models/cinematic_dna_u8.bin", async () => ({
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      arrayBuffer: async () => htmlBuf
    })),
    null
  );

  resetDefaultDnaIndexCache();
  const buf = encodeDnaBinary([
    { tmdbId: 10, axes: [90, 80, 70, 60] },
    { tmdbId: 11, axes: [88, 78, 68, 62] },
    { tmdbId: 12, axes: [10, 20, 30, 40] }
  ]);
  const idx = await loadDefaultDnaIndex("/models/cinematic_dna_u8.bin", async () => ({
    ok: true,
    arrayBuffer: async () => buf
  }));
  const map = buildDnaSimMap([{ movie: { tmdbId: 10 }, rating: 9, weight: 1.2 }], idx);
  assert.ok(map.get(11) > map.get(12));
});

