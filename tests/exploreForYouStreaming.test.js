import test from "node:test";
import assert from "node:assert/strict";
import {
  clearExploreForYouCache,
  saveExploreForYouCache,
  loadLatestLocalExploreForYouFallback
} from "../src/services/exploreForYouCache.js";
import {
  EXPLORE_FOR_YOU_ENRICH_LIMIT,
  generateExploreForYouPool
} from "../src/services/exploreForYouService.js";

function makeCandidate(id, title, genreIds = [878, 53], rating = 7.8) {
  return {
    id,
    tmdbId: id,
    imdbID: `tmdb_${id}`,
    title: title || `Film ${id}`,
    year: "2020",
    release_date: "2020-06-15",
    poster: `https://image.tmdb.org/t/p/w500/p_${id}.jpg`,
    genre: "Sci-Fi, Thriller",
    tmdbGenreIds: genreIds,
    vote_average: rating,
    imdbRating: String(rating),
    vote_count: 1500,
    popularity: 40
  };
}

test("loadLatestLocalExploreForYouFallback returns the newest fresh local pool even when profileHash changed", async () => {
  const now = 1_900_000_000_000;
  await clearExploreForYouCache();

  await saveExploreForYouCache({
    profileHash: "explore_fy_v3_older",
    items: [makeCandidate(101, "Older Pool Film")],
    source: "local-ranker",
    generatedAt: now - 60_000
  });

  await saveExploreForYouCache({
    profileHash: "explore_fy_v3_newer",
    items: [makeCandidate(202, "Newer Pool Film")],
    source: "gemini-flash-lite",
    generatedAt: now - 10_000
  });

  const fallback = await loadLatestLocalExploreForYouFallback({ now });
  assert.ok(fallback);
  assert.equal(fallback.from, "indexeddb-stale");
  assert.equal(fallback.profileHash, "explore_fy_v3_newer");
  assert.equal(fallback.items[0].tmdbId, 202);

  // Expired pools return null
  const expired = await loadLatestLocalExploreForYouFallback({ now: now + 8 * 24 * 60 * 60 * 1000 });
  assert.equal(expired, null);
});

test("generateExploreForYouPool emits Wave 1 before Wave 2 resolves, caps deep enrichment at EXPLORE_FOR_YOU_ENRICH_LIMIT, and respects AbortSignal", async () => {
  assert.equal(EXPLORE_FOR_YOU_ENRICH_LIMIT, 120);

  const watched = [
    { tmdbId: 1, title: "Inception", userRating: 10, tmdbGenreIds: [878, 53] },
    { tmdbId: 2, title: "Arrival", userRating: 9, tmdbGenreIds: [878, 18] },
    { tmdbId: 3, title: "Se7en", userRating: 9, tmdbGenreIds: [53, 80] }
  ];

  const wave1Batch = Array.from({ length: 45 }, (_, i) => makeCandidate(1000 + i, `Wave1 Film ${i + 1}`));
  const wave2Batch = Array.from({ length: 140 }, (_, i) => makeCandidate(2000 + i, `Wave2 Film ${i + 1}`));

  let releaseWave2;
  const wave2Gate = new Promise((resolve) => {
    releaseWave2 = resolve;
  });

  let enrichRequestedMax = 0;
  let fetchPoolCalls = 0;
  const events = [];

  const runPromise = generateExploreForYouPool({
    watched,
    watchlist: [],
    embeddingIndex: null,
    contentIndex: null,
    dnaIndex: null,
    aiClient: null,
    fetchCandidatePoolFn: async (_profile, _mood, _w, _wl, opts) => {
      fetchPoolCalls += 1;
      if (fetchPoolCalls === 1) {
        return wave1Batch;
      }
      await wave2Gate;
      return wave2Batch;
    },
    enrichPoolFn: async (pool, opts) => {
      enrichRequestedMax = Math.max(enrichRequestedMax, Number(opts?.maxEnrich || 0));
      return pool;
    },
    onPreliminaryReady: (payload) => {
      events.push({ stage: payload.stage, count: payload.items.length });
    }
  });

  // Wait briefly for Wave 1 to emit while Wave 2 is still blocked on wave2Gate
  for (let i = 0; i < 20 && events.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }

  assert.equal(events.length, 1, "Wave 1 must emit immediately before Wave 2 resolves");
  assert.equal(events[0].stage, "wave1");
  assert.equal(events[0].count, 45);

  releaseWave2();
  const finalRes = await runPromise;

  assert.equal(events.length, 2, "Wave 2 must emit once expanded math pool finishes");
  assert.equal(events[1].stage, "wave2");
  assert.equal(events[1].count, 185);
  assert.equal(finalRes.items.length, 185);
  assert.ok(
    enrichRequestedMax > 0 && enrichRequestedMax <= EXPLORE_FOR_YOU_ENRICH_LIMIT,
    `Deep enrichment must stay capped <= ${EXPLORE_FOR_YOU_ENRICH_LIMIT}, got ${enrichRequestedMax}`
  );
});

test("generateExploreForYouPool stops cleanly on AbortSignal without invoking Flash-Lite", async () => {
  const controller = new AbortController();
  let aiCalled = false;
  const mockAi = {
    models: {
      generateContent: async () => {
        aiCalled = true;
        return { text: JSON.stringify({ picks: [] }) };
      }
    }
  };

  const wave1Batch = Array.from({ length: 20 }, (_, i) => makeCandidate(3000 + i, `Abort Film ${i + 1}`));
  const result = await generateExploreForYouPool({
    watched: [
      { tmdbId: 1, title: "A", userRating: 9, tmdbGenreIds: [878] },
      { tmdbId: 2, title: "B", userRating: 9, tmdbGenreIds: [878] },
      { tmdbId: 3, title: "C", userRating: 9, tmdbGenreIds: [878] }
    ],
    embeddingIndex: null,
    contentIndex: null,
    dnaIndex: null,
    aiClient: mockAi,
    signal: controller.signal,
    fetchCandidatePoolFn: async () => wave1Batch,
    enrichPoolFn: async (pool) => pool,
    onPreliminaryReady: (payload) => {
      if (payload.stage === "wave1") {
        controller.abort();
      }
    }
  });

  assert.equal(aiCalled, false, "Flash-Lite must not run after AbortSignal aborts");
  assert.equal(result.aborted, true);
});

test("preliminary Wave 2 cache entries serve stale-while-revalidate fallback without bypassing loadExploreForYouCache", async () => {
  const { loadExploreForYouCache } = await import("../src/services/exploreForYouCache.js");
  const now = 1_950_000_000_000;
  await clearExploreForYouCache();

  await saveExploreForYouCache({
    profileHash: "explore_fy_v3_prelim",
    items: [makeCandidate(4001, "Prelim Film")],
    source: "local-ranker",
    generatedAt: now,
    isPreliminary: true
  });

  const exactHit = await loadExploreForYouCache({ profileHash: "explore_fy_v3_prelim", now: now + 1000 });
  assert.equal(exactHit, null, "Preliminary Wave 2 record must not short-circuit Wave 3 / cloud cache");

  const staleHit = await loadLatestLocalExploreForYouFallback({ now: now + 1000 });
  assert.ok(staleHit);
  assert.equal(staleHit.items[0].tmdbId, 4001);
});

test("generateExploreForYouPool Wave 2 passes page: 2, Wave 1 excludeIds, and propagates AbortSignal to enrichPoolFn", async () => {
  const controller = new AbortController();
  const capturedOpts = [];
  let enrichSignal = null;

  await generateExploreForYouPool({
    watched: [
      { tmdbId: 1, title: "A", userRating: 9, tmdbGenreIds: [878] },
      { tmdbId: 2, title: "B", userRating: 9, tmdbGenreIds: [878] },
      { tmdbId: 3, title: "C", userRating: 9, tmdbGenreIds: [878] }
    ],
    embeddingIndex: null,
    contentIndex: null,
    dnaIndex: null,
    aiClient: null,
    signal: controller.signal,
    fetchCandidatePoolFn: async (_p, _m, _w, _wl, opts) => {
      capturedOpts.push(opts);
      return opts.page === 1
        ? [makeCandidate(5001, "W1 Film")]
        : [makeCandidate(5002, "W2 Film")];
    },
    enrichPoolFn: async (pool, opts) => {
      enrichSignal = opts?.signal || null;
      return pool;
    }
  });

  assert.equal(capturedOpts.length, 2);
  assert.equal(capturedOpts[0].page, 1);
  assert.equal(capturedOpts[1].page, 2);
  assert.ok(capturedOpts[1].excludeIds.includes(5001));
  assert.equal(enrichSignal, controller.signal);
});
