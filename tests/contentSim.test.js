import test from "node:test";
import assert from "node:assert/strict";
import { encodeEmbeddingBinary, parseEmbeddingBinary } from "../src/services/embeddingService.js";
import {
  loadDefaultContentIndex,
  resetDefaultContentIndexCache,
  computeOverviewBigramSim,
  buildContentSimMap
} from "../src/services/contentSimService.js";

test("loadDefaultContentIndex degrades gracefully to null on 404 or SPA HTML fallback", async () => {
  resetDefaultContentIndexCache();
  const res404 = await loadDefaultContentIndex("/models/content_embeddings_f16.bin", async () => ({ ok: false, status: 404 }));
  assert.equal(res404, null);

  resetDefaultContentIndexCache();
  const html = new TextEncoder().encode("<!doctype html><html></html>").buffer;
  const resHtml = await loadDefaultContentIndex("/models/content_embeddings_f16.bin", async () => ({
    ok: true,
    headers: new Headers({ "content-type": "text/html" }),
    arrayBuffer: async () => html
  }));
  assert.equal(resHtml, null);
});

test("buildContentSimMap scores 2024+ content-only films and uses blendEmbeddings when both collab and content vectors exist", async () => {
  const collabBuf = encodeEmbeddingBinary([{ tmdbId: 1, vector: [1, 0, 0, 0] }]);
  const contentBuf = encodeEmbeddingBinary([
    { tmdbId: 1, vector: [0.9, 0.435, 0, 0] },      // Watched positive film
    { tmdbId: 202601, vector: [0.92, 0.391, 0, 0] }, // 2026 film absent from collabIndex!
    { tmdbId: 202602, vector: [-0.8, -0.6, 0, 0] }   // Unrelated 2026 film
  ]);

  resetDefaultContentIndexCache();
  const contentIndex = await loadDefaultContentIndex("/models/content_embeddings_f16.bin", async () => ({
    ok: true,
    arrayBuffer: async () => contentBuf
  }));
  const collabIndex = parseEmbeddingBinary(collabBuf);

  const weightedRatings = [{ movie: { tmdbId: 1 }, weight: 1.5, rating: 9 }];
  const simMap = buildContentSimMap(weightedRatings, contentIndex, [{ tmdbId: 202601 }, { tmdbId: 202602 }], {
    collabIndex
  });

  assert.ok(simMap.get(202601) > 0.85, "2024+ film missing from collabIndex gets strong contentSim from overview vector");
  assert.ok(simMap.get(202602) < 0, "unrelated film receives low/negative contentSim");
});

test("computeOverviewBigramSim computes pure plot-text cosine strictly without genre or keyword fields", () => {
  const userEntries = [
    { text: "A solitary stunt driver moonlights as a getaway driver in neon Los Angeles.", weight: 1.4 }
  ];
  const similarOverview = "A stuntman and getaway driver falls for his neighbor in neo-noir Los Angeles.";
  const unrelatedOverview = "A cheerful baker enters a pastry tournament in rural France.";

  const simMatch = computeOverviewBigramSim(userEntries, similarOverview);
  const simMismatch = computeOverviewBigramSim(userEntries, unrelatedOverview);

  assert.ok(simMatch > 0.15, `expected positive overview similarity, got ${simMatch}`);
  assert.ok(simMatch > simMismatch, "similar overview must outscore unrelated overview");
  assert.equal(computeOverviewBigramSim(userEntries, ""), 0);

  // Opt-in fallback disabled by default when contentIndex is null
  const ratings = [{
    movie: {
      tmdbId: 1,
      overview: userEntries[0].text,
      genres: ["Crime"],
      tmdbKeywords: [501]
    },
    weight: 1.4
  }];
  const candidates = [{ id: 99, tmdbId: 99, overview: similarOverview, genre_ids: [80], tmdbKeywords: [501] }];
  assert.equal(buildContentSimMap(ratings, null, candidates).size, 0);
  assert.ok(buildContentSimMap(ratings, null, candidates, { enableOverviewTfIdf: true }).get(99) > 0.15);
});
