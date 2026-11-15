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


test("buildContentSimMap structured cold fallback scores unindexed films cleanly while gating out indexed items when coldOnly is true", () => {
  const collabBuf = encodeEmbeddingBinary([{ tmdbId: 1, vector: [1, 0, 0, 0] }, { tmdbId: 50, vector: [0.9, 0.435, 0, 0] }]);
  const collabIndex = parseEmbeddingBinary(collabBuf);
  const collabSimMap = new Map([[50, 0.45]]);

  const ratings = [
    {
      movie: {
        tmdbId: 1,
        tmdbGenreIds: [878, 9648],
        tmdbKeywords: [9001, 9002],
        castIds: [701],
        crewPersonId: 801,
        overview: "A lone astronaut decodes an alien signal across deep space."
      },
      weight: 1.8
    },
    {
      movie: {
        tmdbId: 2,
        tmdbGenreIds: [35],
        tmdbKeywords: [9999],
        castIds: [799],
        crewPersonId: 899,
        overview: "A slapstick office prank goes wildly wrong."
      },
      weight: -1.5
    }
  ];

  const candidates = [
    { id: 50, tmdbId: 50, tmdbGenreIds: [878, 9648], tmdbKeywords: [9001], castIds: [701], crewPersonId: 801, overview: "Space mystery signal." },
    { id: 202610, tmdbId: 202610, tmdbGenreIds: [878, 9648], tmdbKeywords: [9001, 9002], castIds: [701], crewPersonId: 801, overview: "Deep space alien signal." },
    { id: 202611, tmdbId: 202611, tmdbGenreIds: [35], tmdbKeywords: [9999], castIds: [799], crewPersonId: 899, overview: "Slapstick office comedy." }
  ];

  const simMap = buildContentSimMap(ratings, null, candidates, {
    collabIndex,
    collabSimMap,
    enableStructuredFallback: true,
    coldOnly: true
  });

  assert.equal(simMap.has(50), false, "coldOnly leaves collab-indexed film unscored in fallback map");
  const coldPositive = simMap.get(202610);
  const coldNegative = simMap.get(202611) ?? 0;
  assert.ok(coldPositive > 0.5 && coldPositive <= 1.0, `cold aligned film receives positive bounded score, got ${coldPositive}`);
  assert.equal(simMap.has(202611), false);
  assert.equal(coldNegative, 0, "negative-subtracted mismatch clamps cleanly at 0");
});

test("loadDefaultContentIndex negative-caches 404/non-binary responses for session, does not cache network/abort errors, and resets cleanly", async () => {
  resetDefaultContentIndexCache();

  // 404 must be negative-cached for the session
  let fetchCount = 0;
  const fetch404 = async () => {
    fetchCount += 1;
    return { ok: false, status: 404 };
  };
  assert.equal(await loadDefaultContentIndex("/models/content_embeddings_f16.bin", fetch404), null);
  assert.equal(await loadDefaultContentIndex("/models/content_embeddings_f16.bin", fetch404), null);
  assert.equal(fetchCount, 1, "404 response must be negative-cached without re-fetching");

  // Non-binary HTML/magic fallback must also be negative-cached
  resetDefaultContentIndexCache();
  let htmlFetchCount = 0;
  const htmlBuf = new TextEncoder().encode("<!doctype html><html></html>").buffer;
  const fetchHtml = async () => {
    htmlFetchCount += 1;
    return { ok: true, arrayBuffer: async () => htmlBuf };
  };
  assert.equal(await loadDefaultContentIndex("/models/content_embeddings_f16.bin", fetchHtml), null);
  assert.equal(await loadDefaultContentIndex("/models/content_embeddings_f16.bin", fetchHtml), null);
  assert.equal(htmlFetchCount, 1, "non-binary payload must be negative-cached without re-fetching");

  // Network error must NOT be negative-cached
  resetDefaultContentIndexCache();
  const validBuf = encodeEmbeddingBinary([{ tmdbId: 10, vector: [1, 0, 0, 0] }]);
  let netAttempts = 0;
  const fetchFlakyNet = async () => {
    netAttempts += 1;
    if (netAttempts === 1) throw new TypeError("Failed to fetch");
    return { ok: true, arrayBuffer: async () => validBuf };
  };
  assert.equal(await loadDefaultContentIndex("/models/content_embeddings_f16.bin", fetchFlakyNet), null);
  const netRecovered = await loadDefaultContentIndex("/models/content_embeddings_f16.bin", fetchFlakyNet);
  assert.ok(netRecovered && netRecovered.count === 1, "subsequent call must retry after network error");
  assert.equal(netAttempts, 2);

  // AbortError must NOT be negative-cached
  resetDefaultContentIndexCache();
  let abortAttempts = 0;
  const fetchFlakyAbort = async () => {
    abortAttempts += 1;
    if (abortAttempts === 1) {
      const abortErr = new Error("Aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    return { ok: true, arrayBuffer: async () => validBuf };
  };
  assert.equal(await loadDefaultContentIndex("/models/content_embeddings_f16.bin", fetchFlakyAbort), null);
  const abortRecovered = await loadDefaultContentIndex("/models/content_embeddings_f16.bin", fetchFlakyAbort);
  assert.ok(abortRecovered && abortRecovered.count === 1, "subsequent call must retry after AbortError");
  assert.equal(abortAttempts, 2);

  // reset clears cached index too
  resetDefaultContentIndexCache();
  assert.equal(await loadDefaultContentIndex("/models/content_embeddings_f16.bin", fetch404), null);
});

test("buildContentSimMap reaches coldOnly structured fallback for unindexed post-2023 films even when contentIndex is null", () => {
  const weightedRatings = [
    {
      weight: 2.0,
      movie: {
        tmdbId: 1,
        crewPersonId: 525,
        tmdbGenreIds: [878, 53],
        tmdbKeywords: [4565, 9663]
      }
    }
  ];

  // Unindexed post-2023 film (not in collabSimMap, collabSim === 0) vs warm indexed film
  const candidates = [
    { tmdbId: 99001, crewPersonId: 525, tmdbGenreIds: [878, 53], tmdbKeywords: [4565] },
    { tmdbId: 500, crewPersonId: 525, tmdbGenreIds: [878, 53], tmdbKeywords: [4565] }
  ];
  const collabSimMap = new Map([[500, 0.72]]);

  const simMap = buildContentSimMap(weightedRatings, null, candidates, {
    collabSimMap,
    enableStructuredFallback: true,
    coldOnly: true
  });

  assert.ok((simMap.get(99001) ?? 0) > 0, "coldOnly structured fallback must score collabSim===0 film when contentIndex is null");
  assert.equal(simMap.has(500), false, "warm film with collabSim > 0 must remain skipped by coldOnly");
});
