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
