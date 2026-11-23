import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseEmbeddingBinary, encodeEmbeddingBinary } from "../src/services/embeddingService.js";
import { buildContentSimMap } from "../src/services/contentSimService.js";

test("buildContentSimMap with coldOnly:true scores unindexed cold films via contentIndex while leaving warm indexed films untouched", () => {
  const contentIndex = parseEmbeddingBinary(
    encodeEmbeddingBinary([
      { tmdbId: 100, vector: [1, 0, 0, 0] }, // watched favorite
      { tmdbId: 200, vector: [0.95, 0.31, 0, 0] }, // warm candidate (in collabSimMap > 0)
      { tmdbId: 300, vector: [0.92, 0.39, 0, 0] } // cold 2025 candidate (not in collabSimMap)
    ])
  );
  const collabIndex = parseEmbeddingBinary(
    encodeEmbeddingBinary([
      { tmdbId: 100, vector: [1, 0, 0, 0] },
      { tmdbId: 200, vector: [0.8, 0.6, 0, 0] }
    ])
  );
  const collabSimMap = new Map([
    [100, 1.0],
    [200, 0.8]
  ]);
  const weightedRatings = [{ tmdbId: 100, rating: 10, weight: 1.5, movie: { tmdbId: 100, title: "Seed" } }];
  const candidates = [
    { tmdbId: 200, title: "Warm Film" },
    { tmdbId: 300, title: "Cold 2025 Film" }
  ];

  const map = buildContentSimMap(weightedRatings, contentIndex, candidates, {
    collabIndex,
    collabSimMap,
    enableStructuredFallback: true,
    coldOnly: true
  });

  assert.equal(map.has(200), false, "Warm film with collabSim > 0 must NOT be overwritten when coldOnly=true");
  assert.ok((map.get(300) || 0) > 0.8, `Expected strong semantic contentSim for cold film 300, got ${map.get(300)}`);
});

test("production public/models/content_embeddings_f16.bin exists, parses as CVEM v1 (128-D), and scores 2024+ cold releases", () => {
  const binPath = path.resolve(process.cwd(), "public/models/content_embeddings_f16.bin");
  assert.ok(fs.existsSync(binPath), "Expected production public/models/content_embeddings_f16.bin to exist");
  const buf = fs.readFileSync(binPath);
  const idx = parseEmbeddingBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(idx.dim, 128);
  assert.ok(idx.count >= 10000, `Expected >= 10,000 indexed movies (historical + 2024-2026), got ${idx.count}`);

  // Dune: Part Two (693134, 2024) should have strong semantic similarity to Dune (438631) / Interstellar (157336)
  assert.ok(idx.idToIndex.has(693134), "Expected 2024 release Dune: Part Two (693134) in content_embeddings_f16.bin");
  const scores = buildContentSimMap(
    [
      { tmdbId: 157336, rating: 10, weight: 1.5, movie: { tmdbId: 157336, title: "Interstellar" } },
      { tmdbId: 27205, rating: 10, weight: 1.4, movie: { tmdbId: 27205, title: "Inception" } }
    ],
    idx,
    [{ tmdbId: 693134, title: "Dune: Part Two" }],
    { collabIndex: null, collabSimMap: new Map(), coldOnly: true }
  );
  assert.ok((scores.get(693134) || 0) > 0, "Expected positive semantic contentSim for Dune: Part Two");
});
