import test from "node:test";
import assert from "node:assert/strict";
import { extractTasteProfile, buildBucketAParams } from "../src/services/tmdbService.js";
import {
  DEFAULT_RECOMMENDATION_COUNT,
  MIN_VALID_CACHE_COUNT,
  generateProfileHash,
  getSmartCache,
  setSmartCache,
  buildGeminiReRankPrompt,
  mergeGeminiExplanationsWithRanker,
  getMovieRecommendations,
  normalizeMatchScore,
  resetSessionWorkingModels,
  resetModelInfoForTests
} from "../src/services/geminiService.js";

test("hatedKeywordIds sorts by negative weight descending before slicing top 5", async () => {
  const now = Date.UTC(2026, 10, 9);
  const watched = [
    { id: "bad1", userRating: 2, dateWatched: "2026-11-01", tmdbKeywords: [101, 102, 103, 104, 105, 999] },
    { id: "bad2", userRating: 1, dateWatched: "2026-11-08", tmdbKeywords: [999, 888] },
    { id: "bad3", userRating: 1, dateWatched: "2026-11-09", tmdbKeywords: [999, 888, 777] },
    { id: "good1", userRating: 9, dateWatched: "2026-11-09", tmdbGenreIds: [878] }
  ];
  const profile = await extractTasteProfile(watched, [], { now });
  assert.equal(profile.hatedKeywordIds[0], 999, "most frequent/recent disliked keyword 999 must be first");
  assert.ok(profile.hatedKeywordIds.includes(888), "second most disliked keyword 888 must be in top 5");
  assert.equal(profile.hatedKeywordIds.length, 5);
});

test("generateProfileHash does not mutate input arrays and invalidates when anchorTmdbId or crew changes", () => {
  const profile1 = {
    lovedGenreIds: [878, 18, 53],
    hatedKeywordIds: [200, 100],
    topCastIds: [50, 10],
    topCrewMemberId: 777,
    anchorTmdbId: 111
  };
  const watchlistGenres = [80, 12];
  const providers = [15, 8];

  const h1 = generateProfileHash(profile1, watchlistGenres, "any", providers);
  assert.deepEqual(profile1.lovedGenreIds, [878, 18, 53], "lovedGenreIds must not be mutated in place");
  assert.deepEqual(profile1.hatedKeywordIds, [200, 100], "hatedKeywordIds must not be mutated in place");
  assert.deepEqual(watchlistGenres, [80, 12], "watchlistGenres must not be mutated in place");
  assert.deepEqual(providers, [15, 8], "providers must not be mutated in place");

  const profile2 = { ...profile1, anchorTmdbId: 999 };
  const h2 = generateProfileHash(profile2, watchlistGenres, "any", providers);
  assert.notEqual(h1, h2, "new 10/10 anchor film must change the cache hash");
});

test("buildBucketAParams joins topCastIds with pipe (OR) instead of comma (AND)", () => {
  const params = buildBucketAParams(
    { lovedGenreIds: [878, 53], hatedKeywordIds: [11, 22], topCastIds: [500, 600], watchlistGenreIds: [] },
    "any",
    { userRegion: "US", userProviders: [] }
  );
  assert.equal(params.get("with_cast"), "500|600");
  assert.equal(params.get("with_genres"), "878|53");
  assert.equal(params.get("without_keywords"), "11|22");
});

test("mergeGeminiExplanationsWithRanker preserves calibrated ranker matchScore instead of LLM score", () => {
  const rankedCandidates = [
    { id: 101, tmdbId: 101, title: "Arrival", year: "2016", genre: "Sci-Fi", matchScore: 95, rankerProbability: 0.92, realData: true },
    { id: 102, tmdbId: 102, title: "Annihilation", year: "2018", genre: "Sci-Fi", matchScore: 84, rankerProbability: 0.69, realData: true }
  ];
  const geminiResponse = {
    tasteProfile: { favoriteGenres: ["Sci-Fi"], preferredEra: "2010s", ratingStyle: "Cerebral" },
    recommendations: [
      { tmdbId: 101, title: "Arrival", year: "2016", matchScore: 60, reason: "Fits your love of linguistic sci-fi." },
      { tmdbId: 102, title: "Annihilation", year: "2018", matchScore: 99, reason: "Matches your atmospheric sci-fi taste." }
    ]
  };
  const final = mergeGeminiExplanationsWithRanker(geminiResponse, rankedCandidates, { lovedGenreNames: ["Sci-Fi"] });
  assert.equal(final.recommendations[0].tmdbId, 101);
  assert.equal(final.recommendations[0].matchScore, 95, "must keep calibrated ranker matchScore=95");
  assert.equal(final.recommendations[1].matchScore, 84, "must keep calibrated ranker matchScore=84");
});


test("extractTasteProfile extracts lovedKeywordIds and topCrewIds, and fetchEmbeddingCandidates injects Bucket E neighbors", async () => {
  const tmdbMod = await import("../src/services/tmdbService.js");
  assert.equal(typeof tmdbMod.fetchEmbeddingCandidates, "function");

  const watched = [
    { id: 1, tmdbId: 1, userRating: 10, tmdbGenreIds: [18], tmdbKeywords: [10, 20], crewPersonId: 501, dateWatched: "2026-11-01" },
    { id: 2, tmdbId: 2, userRating: 9, tmdbGenreIds: [18], tmdbKeywords: [20, 30], crewPersonId: 502, dateWatched: "2026-11-02" }
  ];
  const profile = await extractTasteProfile(watched, [], { anchorCutoff: Infinity });
  assert.ok(Array.isArray(profile.lovedKeywordIds) && profile.lovedKeywordIds.includes(20));
  assert.ok(Array.isArray(profile.topCrewIds) && profile.topCrewIds.includes(501) && profile.topCrewIds.includes(502));

  const neighbors = [
    { tmdbId: 1, collabSim: 0.99 },   // already watched -> must be skipped
    { tmdbId: 300, collabSim: 0.85 }, // already in existingCandidates -> must be skipped
    { tmdbId: 400, collabSim: 0.81 }  // new embedding neighbor -> must be fetched and tagged Bucket E
  ];
  const existingCandidates = [{ id: 300, tmdbId: 300, title: "Existing" }];
  const injected = await tmdbMod.fetchEmbeddingCandidates(neighbors, watched, [], existingCandidates, {
    detailFetcher: async (id) => ({
      tmdbId: id,
      title: `Injected ${id}`,
      year: "2020",
      plot: "A deep film.",
      genre: "Drama",
      tmdbGenreIds: [18],
      tmdbKeywords: [20],
      castIds: [11],
      crewPersonId: 501,
      vote_average: 8.1,
      vote_count: 900
    })
  });
  assert.equal(injected.length, 1);
  assert.equal(injected[0].tmdbId, 400);
  assert.equal(injected[0].sourceBucket, "Bucket E (Embedding)");
  assert.equal(injected[0].collabSim, 0.81);
});

test("mergeGeminiExplanationsWithRanker preserves matchReasons from ranked candidate", () => {
  const geminiResult = {
    tasteProfile: { favoriteGenres: ["Sci-Fi"] },
    recommendations: [
      { tmdbId: 101, title: "Solaris", year: "1972", reason: "Deep atmospheric pacing." }
    ]
  };
  const rankedCandidates = [
    {
      id: 101,
      tmdbId: 101,
      title: "Solaris",
      year: "1972",
      matchScore: 94,
      matchReasons: ["🧬 High Taste-Twin Match", "🎬 Favorite Filmmaker"]
    }
  ];

  const merged = mergeGeminiExplanationsWithRanker(geminiResult, rankedCandidates, {});
  assert.equal(merged.recommendations.length, 1);
  assert.deepEqual(merged.recommendations[0].matchReasons, [
    "🧬 High Taste-Twin Match",
    "🎬 Favorite Filmmaker"
  ]);
});

test("getMovieRecommendations falls back to local calibrated ranker (never OMDb) when Gemini returns invalid JSON or bad schema", async () => {
  const originalFetch = globalThis.fetch;
  const prevGeminiKey = process.env.VITE_GEMINI_KEY;
  const prevTmdbKey = process.env.VITE_TMDB_KEY;
  const omdbCalls = [];
  process.env.VITE_GEMINI_KEY = "TEST_KEY";
  process.env.VITE_TMDB_KEY = "TEST_TMDB_KEY";
  resetSessionWorkingModels();
  resetModelInfoForTests();

  const mockCandidates = Array.from({ length: 12 }, (_, i) => ({
    id: 500 + i,
    tmdbId: 500 + i,
    title: `Verified Film ${i}`,
    year: "2022",
    release_date: "2022-05-01",
    overview: `Plot ${i}`,
    genre: "Sci-Fi",
    genre_ids: [878],
    vote_average: 8.0 - i * 0.1,
    vote_count: 1000,
    sourceBucket: "A"
  }));

  let aiCalls = 0;
  const mockAi = {
    models: {
      generateContent: async () => {
        aiCalls += 1;
        return {
          text: "{truncated invalid json...",
          usageMetadata: { totalTokenCount: 42 }
        };
      }
    }
  };

  globalThis.fetch = async (url) => {
    if (String(url).includes("omdbapi.com")) {
      omdbCalls.push(url);
      return { ok: false, status: 500 };
    }
    return { ok: true, json: async () => ({ results: [] }) };
  };

  try {
    const res = await getMovieRecommendations(
      [{ id: 1, tmdbId: 1, title: "Seed", userRating: 9, tmdbGenreIds: [878] }],
      [],
      null,
      {
        aiClient: mockAi,
        candidates: mockCandidates,
        embeddingIndex: null
      }
    );
    assert.equal(aiCalls, 1, "must NOT re-enter generateWithOmdbFallback after parse failure");
    assert.equal(omdbCalls.length, 0, "must NOT route to OMDb fallback on malformed Gemini JSON");
    assert.equal(res.recommendations.length, 10);
    assert.equal(res.recommendations[0].tmdbId, res.recommendations[0].id);
    assert.equal(res.modelInfo?.pipeline, "ranker-fallback");
    assert.equal(res.modelInfo?.isFallback, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevGeminiKey === undefined) delete process.env.VITE_GEMINI_KEY;
    else process.env.VITE_GEMINI_KEY = prevGeminiKey;
    if (prevTmdbKey === undefined) delete process.env.VITE_TMDB_KEY;
    else process.env.VITE_TMDB_KEY = prevTmdbKey;
    resetSessionWorkingModels();
    resetModelInfoForTests();
  }
});

test("reRankCandidatesWithGemini attaches modelInfo even when executeCascade returns null (!response)", async () => {
  const prevGeminiKey = process.env.VITE_GEMINI_KEY;
  const prevTmdbKey = process.env.VITE_TMDB_KEY;
  process.env.VITE_GEMINI_KEY = "TEST_KEY";
  process.env.VITE_TMDB_KEY = "TEST_TMDB_KEY";
  resetSessionWorkingModels();
  resetModelInfoForTests();

  const nullAi = { models: { generateContent: async () => { throw new Error("503 unavailable"); } } };
  const mockCandidates = Array.from({ length: 12 }, (_, i) => ({
    id: 600 + i,
    tmdbId: 600 + i,
    title: `Fallback Film ${i}`,
    year: "2021",
    overview: `Overview ${i}`,
    genre: "Drama",
    genre_ids: [18],
    vote_average: 7.8,
    vote_count: 500
  }));

  try {
    const res = await getMovieRecommendations(
      [{ id: 2, tmdbId: 2, title: "Seed 2", userRating: 8, tmdbGenreIds: [18] }],
      [],
      null,
      { aiClient: nullAi, candidates: mockCandidates, embeddingIndex: null }
    );
    assert.equal(res.recommendations.length, 10);
    assert.equal(res.modelInfo?.pipeline, "ranker-fallback");
    assert.equal(res.modelInfo?.model, null);
    assert.equal(res.modelInfo?.isFallback, true);
  } finally {
    if (prevGeminiKey === undefined) delete process.env.VITE_GEMINI_KEY;
    else process.env.VITE_GEMINI_KEY = prevGeminiKey;
    if (prevTmdbKey === undefined) delete process.env.VITE_TMDB_KEY;
    else process.env.VITE_TMDB_KEY = prevTmdbKey;
    resetSessionWorkingModels();
    resetModelInfoForTests();
  }
});

test("OMDb fallback throws clear error when Gemini returns invalid JSON or empty recommendations", async () => {
  const prevGeminiKey = process.env.VITE_GEMINI_KEY;
  const prevTmdbKey = process.env.VITE_TMDB_KEY;
  process.env.VITE_GEMINI_KEY = "TEST_KEY";
  delete process.env.VITE_TMDB_KEY;
  resetSessionWorkingModels();
  resetModelInfoForTests();

  const badAi = {
    models: {
      generateContent: async () => ({
        text: "{bad json",
        usageMetadata: { totalTokenCount: 10 }
      })
    }
  };

  try {
    await assert.rejects(
      () => getMovieRecommendations(
        [{ id: 3, tmdbId: 3, title: "Seed 3", userRating: 8, tmdbGenreIds: [18] }],
        [],
        null,
        { aiClient: badAi, embeddingIndex: null }
      ),
      /OMDb fallback generation returned invalid JSON or empty recommendations/
    );
  } finally {
    if (prevGeminiKey === undefined) delete process.env.VITE_GEMINI_KEY;
    else process.env.VITE_GEMINI_KEY = prevGeminiKey;
    if (prevTmdbKey === undefined) delete process.env.VITE_TMDB_KEY;
    else process.env.VITE_TMDB_KEY = prevTmdbKey;
    resetSessionWorkingModels();
    resetModelInfoForTests();
  }
});

test("normalizeMatchScore preserves calibrated scores between 50 and 69 without clamping up to 70", () => {
  assert.equal(normalizeMatchScore(55), 55);
  assert.equal(normalizeMatchScore(50), 50);
  assert.equal(normalizeMatchScore(69), 69);
  assert.equal(normalizeMatchScore(42), 50);
  assert.equal(normalizeMatchScore(104), 99);
  assert.equal(normalizeMatchScore(0.62), 62);
  assert.equal(normalizeMatchScore(0.06), 60);
  assert.equal(normalizeMatchScore(0.94), 94);
  assert.equal(normalizeMatchScore(NaN), null);
  assert.equal(normalizeMatchScore(null), null);
  assert.equal(normalizeMatchScore(undefined), null);
  assert.equal(normalizeMatchScore(0), null);
  assert.equal(normalizeMatchScore(-4), null);
  assert.equal(normalizeMatchScore(4), null);
});

test("getMovieRecommendations completes via local ranker when VITE_GEMINI_KEY is unset and candidates or TMDB exist", async () => {
  const prevGeminiKey = process.env.VITE_GEMINI_KEY;
  const prevTmdbKey = process.env.VITE_TMDB_KEY;
  delete process.env.VITE_GEMINI_KEY;
  delete process.env.VITE_TMDB_KEY;
  resetSessionWorkingModels();
  resetModelInfoForTests();

  try {
    const candidates = Array.from({ length: 12 }, (_, i) => ({
      id: 700 + i,
      tmdbId: 700 + i,
      title: `Keyless Film ${i}`,
      year: "2019",
      release_date: "2019-06-01",
      overview: `Plot ${i}`,
      genre: "Drama",
      genre_ids: [18],
      vote_average: 7.5 - i * 0.2,
      vote_count: 600
    }));

    const res = await getMovieRecommendations(
      [{ id: 10, tmdbId: 10, title: "Watched", userRating: 9, tmdbGenreIds: [18] }],
      [],
      null,
      { candidates, embeddingIndex: null }
    );
    assert.equal(res.recommendations.length, 10);
    assert.equal(res.modelInfo?.pipeline, "ranker-fallback");
  } finally {
    if (prevGeminiKey === undefined) delete process.env.VITE_GEMINI_KEY;
    else process.env.VITE_GEMINI_KEY = prevGeminiKey;
    if (prevTmdbKey === undefined) delete process.env.VITE_TMDB_KEY;
    else process.env.VITE_TMDB_KEY = prevTmdbKey;
    resetSessionWorkingModels();
    resetModelInfoForTests();
  }
});

test("getMovieRecommendations throws explicit error when neither Gemini key nor TMDB candidates are available", async () => {
  const prevGeminiKey = process.env.VITE_GEMINI_KEY;
  const prevTmdbKey = process.env.VITE_TMDB_KEY;
  delete process.env.VITE_GEMINI_KEY;
  delete process.env.VITE_TMDB_KEY;

  try {
    await assert.rejects(
      () => getMovieRecommendations(
        [{ id: 11, tmdbId: 11, title: "Watched", userRating: 8, tmdbGenreIds: [18] }],
        [],
        null,
        { embeddingIndex: null }
      ),
      /missing|TMDB/i
    );
  } finally {
    if (prevGeminiKey === undefined) delete process.env.VITE_GEMINI_KEY;
    else process.env.VITE_GEMINI_KEY = prevGeminiKey;
    if (prevTmdbKey === undefined) delete process.env.VITE_TMDB_KEY;
    else process.env.VITE_TMDB_KEY = prevTmdbKey;
  }
});

test("buildBucketAParams includes all 3 watchlistGenreIds matching extractTasteProfile and generateProfileHash", () => {
  const params = buildBucketAParams(
    {
      lovedGenreIds: [878],
      hatedKeywordIds: [],
      topCastIds: [],
      watchlistGenreIds: [18, 80, 9648]
    },
    "any",
    { userRegion: "US", userProviders: [] }
  );
  assert.equal(params.get("with_genres"), "878|18|80|9648");
});

test("enrichCandidatePoolMetadata hydrates keywords, castIds, crewPersonId, and streamProviders on Buckets A-D while surviving partial fetch failures", async () => {
  const { enrichCandidatePoolMetadata } = await import("../src/services/tmdbService.js");
  const pool = [
    { id: 101, tmdbId: 101, title: "Bucket A Film", genre_ids: [878], sourceBucket: "Bucket A: Semantic", providerMatchedByQuery: true },
    { id: 102, tmdbId: 102, title: "Failing Detail Film", genre_ids: [18], sourceBucket: "D", providerMatchedByQuery: false },
    { id: 103, tmdbId: 103, title: "Already Rich Film", tmdbKeywords: [77], castIds: [8], crewPersonId: 9, sourceBucket: "Bucket E (Embedding)" }
  ];

  let fetchCount = 0;
  const enriched = await enrichCandidatePoolMetadata(pool, {
    maxEnrich: 10,
    concurrency: 2,
    detailFetcher: async (id) => {
      fetchCount++;
      if (id === 102) throw new Error("429 Too Many Requests");
      return {
        tmdbId: id,
        director: "Denis Villeneuve",
        crewPersonId: 137427,
        castIds: [5292, 90633],
        tmdbKeywords: [4565, 9882],
        keywordNames: ["dystopia", "space"],
        tmdbGenreIds: [878, 18],
        streamProviders: [{ id: 8, name: "Netflix" }],
        runtimeMinutes: 163
      };
    }
  });

  assert.equal(enriched.length, 3, "failed detail lookups must never drop candidates");
  assert.equal(fetchCount, 2, "must skip candidates already carrying tmdbKeywords and castIds");
  assert.deepEqual(enriched[0].tmdbKeywords, [4565, 9882]);
  assert.deepEqual(enriched[0].castIds, [5292, 90633]);
  assert.equal(enriched[0].crewPersonId, 137427);
  assert.equal(enriched[0].sourceBucket, "Bucket A: Semantic", "must preserve sourceBucket");
  assert.equal(enriched[0].providerMatchedByQuery, true, "must preserve providerMatchedByQuery");
  assert.equal(enriched[1].id, 102, "unhydrated candidate remains intact");
  assert.deepEqual(enriched[2].tmdbKeywords, [77], "already-enriched candidate preserved");
});

test("extractCandidateFeatures reads context.dnaSimMap cleanly and defaults to 0 when absent", async () => {
  const { DEFAULT_RANKER_WEIGHTS, extractCandidateFeatures } = await import("../src/services/rankerService.js");
  assert.equal(DEFAULT_RANKER_WEIGHTS.dnaSim, 0);

  const featsAbsent = extractCandidateFeatures({ id: 55, tmdbId: 55 }, {});
  assert.equal(featsAbsent.dnaSim, 0);

  const featsPresent = extractCandidateFeatures(
    { id: 55, tmdbId: 55 },
    { dnaSimMap: new Map([[55, 0.72]]) }
  );
  assert.equal(featsPresent.dnaSim, 0.72);
});

test("executeCascade enforces spendTracker.canUseArgon() and calls markArgonUnavailable on Argon 429 errors", async () => {
  const { executeCascade, parseFreeTextMoodWithGemini } = await import("../src/services/geminiService.js");
  const { createSpendTracker } = await import("../src/services/aiSpendTracker.js");

  // 1. Keyless parseFreeTextMoodWithGemini degrades safely without throwing
  const keylessMood = await parseFreeTextMoodWithGemini(null, "like Drive but funnier");
  assert.deepEqual(keylessMood, { moodId: "any", withGenres: [], withoutKeywords: [], minYear: null, maxYear: null });

  // 2. When spend cap is already reached, argon models must be skipped completely
  const cappedStore = { getItem: () => "10", setItem: () => {} };
  const cappedTracker = createSpendTracker({ storage: cappedStore, capUsd: 6 });
  const calledModels = [];
  const fakeAi = {
    models: {
      generateContent: async ({ model }) => {
        calledModels.push(model);
        return { text: "ok" };
      }
    }
  };
  resetSessionWorkingModels();
  const resCapped = await executeCascade(
    fakeAi,
    ["gemini-4-argon", "gemini-3.5-flash-lite"],
    { contents: "hi" },
    { cascadeType: "curation", spendTracker: cappedTracker }
  );
  assert.equal(resCapped.text, "ok");
  assert.deepEqual(calledModels, ["gemini-3.5-flash-lite"]);

  // 3. When argon fails with 429/quota, markArgonUnavailable disables argon for subsequent calls
  resetSessionWorkingModels();
  const activeTracker = createSpendTracker({ storage: { getItem: () => "0", setItem: () => {} }, capUsd: 6 });
  const callsAfterQuota = [];
  const quotaAi = {
    models: {
      generateContent: async ({ model }) => {
        callsAfterQuota.push(model);
        if (model.includes("argon")) {
          const err = new Error("429 RESOURCE_EXHAUSTED");
          err.status = 429;
          throw err;
        }
        return { text: "fallback-ok" };
      }
    }
  };
  await executeCascade(
    quotaAi,
    ["gemini-4-argon", "gemini-3.5-flash-lite"],
    { contents: "hi" },
    { cascadeType: "curation", spendTracker: activeTracker }
  );
  assert.equal(activeTracker.canUseArgon(), false, "markArgonUnavailable must disable argon for session");
  await executeCascade(
    quotaAi,
    ["gemini-4-argon", "gemini-3.5-flash-lite"],
    { contents: "hi2" },
    { cascadeType: "curation", spendTracker: activeTracker }
  );
  assert.deepEqual(callsAfterQuota, ["gemini-4-argon", "gemini-3.5-flash-lite", "gemini-3.5-flash-lite"]);
  resetSessionWorkingModels();
});

test("Task 3: 10-pick cache floor 7, moodFilters hash, prompt/backfill to 10, and excludeIds refresh", async () => {
  assert.equal(DEFAULT_RECOMMENDATION_COUNT, 10);
  assert.equal(MIN_VALID_CACHE_COUNT, 7);

  // 1. Smart cache rejects caches that shrink below 7 valid items
  const prevStorage = globalThis.localStorage;
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v))
  };

  try {
    const recs10 = Array.from({ length: 10 }, (_, i) => ({ tmdbId: 900 + i, title: `Pick ${i}`, matchScore: 88 }));
    setSmartCache("test_hash_10", { recommendations: recs10 });
    assert.equal(getSmartCache("test_hash_10", [{ tmdbId: 900 }, { tmdbId: 901 }], [])?.recommendations.length, 8);
    assert.equal(
      getSmartCache("test_hash_10", [{ tmdbId: 900 }, { tmdbId: 901 }, { tmdbId: 902 }, { tmdbId: 903 }], []),
      null,
      "cache must invalidate when fewer than 7 valid recommendations remain"
    );
  } finally {
    if (prevStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevStorage;
  }

  // 2. generateProfileHash preserves 4-arg equality while differentiating moodFilters
  const prof = { lovedGenreIds: [18, 53], hatedKeywordIds: [], topCastIds: [10], anchorTmdbId: 1, topCrewMemberId: 2 };
  const hLegacy = generateProfileHash(prof, [80], "any", []);
  const hNullFilter = generateProfileHash(prof, [80], "any", [], null);
  const hComfort = generateProfileHash(prof, [80], "any", [], { moodId: "comfort-watch", withGenres: ["Comedy"] });
  const hThriller = generateProfileHash(prof, [80], "any", [], { moodId: "dark-thriller", withGenres: ["Thriller"] });
  assert.equal(hNullFilter, hLegacy);
  assert.notEqual(hComfort, hLegacy);
  assert.notEqual(hComfort, hThriller);

  // 3. Prompt demands 10 items + mood directive & merge backfills partial Gemini picks up to 10 without duplicates
  const ranked15 = Array.from({ length: 15 }, (_, i) => ({
    id: 800 + i,
    tmdbId: 800 + i,
    title: `Ranked Film ${i}`,
    year: "2020",
    vote_average: 8.1,
    vote_count: 900,
    genre: "Comedy",
    matchScore: 95 - i,
    matchReasons: ["🎭 Comfort Watch Fit"],
    overview: `Warm overview ${i}`
  }));

  const prompt = buildGeminiReRankPrompt(prof, "comfort-watch", ranked15, {
    moodFilters: { query: "light comedy", withGenres: ["Comedy"], withoutKeywords: ["gore"], maxYear: 2022 }
  });
  assert.match(prompt, /select 10 distinct/i);
  assert.match(prompt, /Array of 10 items/i);
  assert.match(prompt, /Comfort Watch|rewatchability|Mood Directive/i);
  assert.match(prompt, /gore/i);

  const partialGemini = {
    tasteProfile: { favoriteGenres: ["Comedy"], preferredEra: "Mixed", ratingStyle: "Warm" },
    recommendations: ranked15.slice(0, 6).map((c) => ({
      tmdbId: c.tmdbId,
      title: c.title,
      year: c.year,
      anchorTitles: [],
      reason: `Critics' pick for ${c.title}.`
    }))
  };
  const backfilled = mergeGeminiExplanationsWithRanker(partialGemini, ranked15, prof, {});
  assert.equal(backfilled.recommendations.length, 10);
  assert.equal(new Set(backfilled.recommendations.map((r) => r.tmdbId)).size, 10);

  // 4. getMovieRecommendations excludes seen IDs and shortlists up to 30 to Gemini, falling back smoothly if exhausted
  const prevGKey = process.env.VITE_GEMINI_KEY;
  process.env.VITE_GEMINI_KEY = "TEST_KEY";
  resetSessionWorkingModels();
  resetModelInfoForTests();

  let promptCandidateCount = 0;
  const mockAi = {
    models: {
      generateContent: async ({ contents }) => {
        const match = String(contents).match(/PRE-RANKED CANDIDATE MOVIES \(Top (\d+)\)/);
        if (match) promptCandidateCount = Number(match[1]);
        return {
          text: JSON.stringify({
            tasteProfile: { favoriteGenres: ["Comedy"], preferredEra: "2000s", ratingStyle: "Warm" },
            recommendations: []
          }),
          usageMetadata: { totalTokenCount: 15 }
        };
      }
    }
  };

  try {
    const pool35 = Array.from({ length: 35 }, (_, i) => ({
      id: 1200 + i,
      tmdbId: 1200 + i,
      title: `Pool Film ${i}`,
      year: "2018",
      release_date: "2018-04-01",
      overview: `Warm heartwarming story ${i}`,
      genre: "Comedy, Family",
      tmdbGenreIds: [35, 10751],
      genre_ids: [35, 10751],
      vote_average: 7.9,
      vote_count: 1100
    }));

    const seenFirst5 = [1200, 1201, 1202, 1203, 1204];
    const refreshed = await getMovieRecommendations(
      [{ id: 1, tmdbId: 1, title: "Seed", userRating: 9, tmdbGenreIds: [35] }],
      [],
      null,
      {
        mood: "comfort-watch",
        excludeIds: seenFirst5,
        candidates: pool35,
        embeddingIndex: null,
        aiClient: mockAi
      }
    );

    assert.equal(promptCandidateCount, 30, "shortlist to Gemini must pass up to 30 candidates");
    assert.equal(refreshed.recommendations.length, 10);
    assert.ok(
      !refreshed.recommendations.some((r) => seenFirst5.includes(r.tmdbId)),
      "excluded IDs must not reappear when 30 unseen candidates remain"
    );

    // Exhaustion safety: excluding 33 of 35 candidates still returns 10 picks instead of collapsing
    delete process.env.VITE_GEMINI_KEY;
    const nearExhausted = await getMovieRecommendations(
      [{ id: 1, tmdbId: 1, title: "Seed", userRating: 9, tmdbGenreIds: [35] }],
      [],
      null,
      {
        mood: "comfort-watch",
        excludeIds: pool35.slice(0, 33).map((c) => c.tmdbId),
        candidates: pool35,
        embeddingIndex: null
      }
    );
    assert.equal(nearExhausted.recommendations.length, 10);

    // Exhaustion guard deduplication must also work cleanly for string/non-numeric candidate IDs
    const stringPool = Array.from({ length: 12 }, (_, i) => ({
      id: `tt990${String(i).padStart(2, "0")}`,
      title: `String Film ${i}`,
      year: "2019",
      release_date: "2019-06-01",
      overview: `Warm story ${i}`,
      genre: "Comedy",
      tmdbGenreIds: [35],
      genre_ids: [35],
      vote_average: 7.5 + i * 0.01,
      vote_count: 900
    }));
    const dedupedExhausted = await getMovieRecommendations(
      [{ id: 1, tmdbId: 1, title: "Seed", userRating: 9, tmdbGenreIds: [35] }],
      [],
      null,
      {
        mood: "comfort-watch",
        excludeIds: stringPool.slice(0, 10).map((c) => c.id),
        candidates: stringPool,
        embeddingIndex: null,
        targetCount: 10
      }
    );
    assert.equal(dedupedExhausted.recommendations.length, 10);
    const seenStringTitles = new Set(dedupedExhausted.recommendations.map((r) => r.title));
    assert.equal(seenStringTitles.size, 10, "exhaustion guard must not duplicate string-ID candidates");

    // 5. Phase 2: region-scoped generateProfileHash, provider/imdbID preservation, and explicit mood disabling recent reserve
    const hUS = generateProfileHash(prof, [80], "any", [8], null, "US");
    const hPK = generateProfileHash(prof, [80], "any", [8], null, "PK");
    const hDefaultReg = generateProfileHash(prof, [80], "any", [], null, "");
    assert.equal(hDefaultReg, hLegacy);
    assert.notEqual(hUS, hPK, "generateProfileHash must differentiate streaming regions");

    const nowYear = new Date().getUTCFullYear();
    const mixedMoodAndRecentPool = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: 2100 + i,
        tmdbId: 2100 + i,
        imdbID: `tt21000${i}`,
        title: `Cozy Watch ${i}`,
        year: "2016",
        release_date: "2016-06-01",
        overview: `Heartwarming comedy story ${i}`,
        genre: "Comedy, Romance",
        tmdbGenreIds: [35, 10749],
        genre_ids: [35, 10749],
        vote_average: 7.5,
        vote_count: 900,
        streamProviders: [{ id: 8, name: "Netflix" }],
        freeProviders: [{ id: 73, name: "Tubi TV" }],
        providersHydrated: true,
        providerMatchedByQuery: true
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: 2200 + i,
        tmdbId: 2200 + i,
        imdbID: `tt22000${i}`,
        title: `Recent Grim Crime ${i}`,
        year: String(nowYear),
        release_date: `${nowYear}-03-01`,
        overview: `Gritty serial thriller ${i}`,
        genre: "Crime, Thriller, Horror",
        tmdbGenreIds: [80, 53, 27],
        genre_ids: [80, 53, 27],
        vote_average: 8.4,
        vote_count: 5000,
        streamProviders: [{ id: 8, name: "Netflix" }],
        freeProviders: [],
        providersHydrated: true,
        providerMatchedByQuery: true
      }))
    ];

    const comfortResult = await getMovieRecommendations(
      [{ id: 1, tmdbId: 1, title: "Seed", userRating: 9, tmdbGenreIds: [80, 53] }],
      [],
      null,
      {
        mood: "comfort-watch",
        userProviders: [8],
        candidates: mixedMoodAndRecentPool,
        embeddingIndex: null,
        targetCount: 10
      }
    );
    assert.equal(comfortResult.recommendations.length, 10);
    assert.equal(
      comfortResult.recommendations.some((r) => r.title.startsWith("Recent Grim Crime")),
      false,
      "explicit comfort-watch must not hijack slots with recent Crime/Thriller/Horror releases"
    );
    assert.equal(comfortResult.recommendations[0].streamProviders?.[0]?.id, 8);
    assert.equal(comfortResult.recommendations[0].freeProviders?.[0]?.id, 73);
    assert.match(comfortResult.recommendations[0].imdbID || "", /^tt21000/);
  } finally {
    if (prevGKey === undefined) delete process.env.VITE_GEMINI_KEY;
    else process.env.VITE_GEMINI_KEY = prevGKey;
    resetSessionWorkingModels();
    resetModelInfoForTests();
  }
});

test("generous-rater 8/10 guard: 7-10★ ratings never enter hatedKeywordIds, computeUserEmbedding subtraction, or mildNegEntries", async () => {
  const { computeUserEmbedding, computeUserPersonas } = await import("../src/services/embeddingService.js");
  const { computeZScoredWeights } = await import("../src/services/scoringUtils.js");

  // Generous rater: mean ~ 9.1, so rating=8 has negative zScore (< -0.4)
  const now = Date.UTC(2026, 10, 14);
  const generousWatched = [
    { id: 1, tmdbId: 1, title: "Ten A", userRating: 10, dateWatched: "2026-11-10", tmdbGenreIds: [18], tmdbKeywords: [701] },
    { id: 2, tmdbId: 2, title: "Ten B", userRating: 10, dateWatched: "2026-11-10", tmdbGenreIds: [18], tmdbKeywords: [702] },
    { id: 3, tmdbId: 3, title: "Ten C", userRating: 10, dateWatched: "2026-11-10", tmdbGenreIds: [18], tmdbKeywords: [703] },
    { id: 4, tmdbId: 4, title: "Nine A", userRating: 9, dateWatched: "2026-11-10", tmdbGenreIds: [18], tmdbKeywords: [704] },
    { id: 5, tmdbId: 5, title: "Eight Film", userRating: 8, dateWatched: "2026-11-10", tmdbGenreIds: [878], tmdbKeywords: [9999] }
  ];

  const weights = computeZScoredWeights(generousWatched, { now });
  const eightWeight = weights.find((w) => w.movie.tmdbId === 5);
  assert.ok(eightWeight.zScore < -0.4, "fixture must produce zScore < -0.4 for 8/10 generous rater");

  // 1. extractTasteProfile: keyword 9999 from 8/10 must NOT become hated
  const profile = await extractTasteProfile(generousWatched, [], { now });
  assert.equal(profile.hatedKeywordIds.includes(9999), false, "8/10 keyword must never enter hatedKeywordIds");

  // 2. computeUserEmbedding & computeUserPersonas: 8/10 orthogonal vector must NOT be subtracted
  const embIndex = {
    dim: 2,
    idToIndex: new Map([[1, 0], [5, 1]]),
    vectors: new Float32Array([
      1, 0, // id=1 along +x
      0, 1  // id=5 orthogonal along +y
    ])
  };
  const userVec = computeUserEmbedding(
    [
      { movie: generousWatched[0], weight: 1.0, rating: 10 },
      { movie: generousWatched[4], weight: -1.0, rating: 8 }
    ],
    embIndex
  );
  // Since id=5 has rating=8 (>=7), it must be skipped (y component === 0 instead of -y subtraction)
  assert.ok(Math.abs(userVec[0] - 1) < 1e-6 && Math.abs(userVec[1]) < 1e-6, "8/10 must never subtract from computeUserEmbedding");

  const personas = computeUserPersonas(
    [
      { movie: generousWatched[0], weight: 1.0, rating: 10 },
      { movie: generousWatched[4], weight: -1.0, rating: 8 }
    ],
    embIndex
  );
  assert.equal(personas.length, 1);
  assert.ok(Math.abs(personas[0][1]) < 1e-6, "8/10 must never subtract inside computeUserPersonas mildNegEntries");
});

test("vault-aware generateProfileHash, >80 candidate batch enrichment, cand.features.hydrated, and hydrationCoverage telemetry", async () => {
  const { enrichCandidatePoolMetadata } = await import("../src/services/tmdbService.js");
  const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await import("../src/services/rankerService.js");

  // 1. generateProfileHash 7th parameter (watched)
  const prof = { lovedGenreIds: [878], hatedKeywordIds: [12], anchorTmdbId: 603, topCrewMemberId: 1, topCastIds: [2] };
  const h6 = generateProfileHash(prof, [80], "any", [8], null, "US");
  const h7Empty = generateProfileHash(prof, [80], "any", [8], null, "US", []);
  assert.equal(h7Empty, h6, "7-arg generateProfileHash with empty watched preserves 6-arg equality");

  const w1 = [{ tmdbId: 10, title: "Film A", userRating: 8 }];
  const w2 = [{ tmdbId: 10, title: "Film A", userRating: 9 }];
  const hVault8 = generateProfileHash(prof, [80], "any", [8], null, "US", w1);
  const hVault9 = generateProfileHash(prof, [80], "any", [8], null, "US", w2);
  assert.notEqual(hVault8, h6);
  assert.notEqual(hVault8, hVault9, "changing a rating must invalidate profile hash");

  // 2. Full-pool enrichment (>80 items) via /api/tmdb-batch proxy + cand.features.hydrated + modelInfo.hydrationCoverage
  const pool95 = Array.from({ length: 95 }, (_, i) => ({
    id: 5000 + i,
    tmdbId: 5000 + i,
    title: `Batch Film ${i}`,
    year: "2021",
    overview: `Sci-fi mystery ${i}`,
    genre: "Sci-Fi",
    tmdbGenreIds: [878],
    genre_ids: [878],
    vote_average: 7.5,
    vote_count: 1000
  }));

  const batchCalls = [];
  const prevVitTmdb = process.env.VITE_TMDB_KEY;
  delete process.env.VITE_TMDB_KEY;
  try {
    const enriched = await enrichCandidatePoolMetadata(pool95, {
      forceProxy: true,
      fetchFn: async (url) => {
        batchCalls.push(String(url));
        const qs = new URLSearchParams(String(url).split("?")[1] || "");
        const ids = (qs.get("ids") || "").split(",").map(Number);
        const results = {};
        for (const id of ids) {
          if (id === 5094) continue; // simulate 1 failed hydration
          results[String(id)] = {
            id,
            title: `Batch Film ${id - 5000}`,
            genres: [{ id: 878, name: "Sci-Fi" }],
            keywords: { keywords: [{ id: 101, name: "space" }] },
            credits: { crew: [{ job: "Director", id: 700 + (id % 50), name: `Director ${id % 50}` }], cast: [{ id: 901, name: "Actor A" }] },
            external_ids: { imdb_id: `tt50${id}` }
          };
        }
        return { ok: true, status: 200, json: async () => ({ results, errors: { "5094": { status: 404 } } }) };
      }
    });

    assert.equal(Array.isArray(enriched), true, "enrichCandidatePoolMetadata must keep returning an Array");
    assert.equal(batchCalls.length, 3, "95 IDs should chunk into 3 batch calls (40+40+15)");
    assert.equal(enriched[93].hydrated, true, "items beyond 80 must be hydrated");
    assert.equal(enriched[93].features.hydrated, true);
    assert.equal(enriched[94].hydrated, false);

    const ranked = rankCandidatePool(enriched, { profile: prof }, DEFAULT_RANKER_WEIGHTS, 30);
    assert.equal(Array.isArray(ranked), true);
    assert.equal(ranked.every((c) => typeof c.features?.hydrated === "boolean"), true);

    const res = await getMovieRecommendations(
      [{ id: 1, tmdbId: 1, title: "Seed", userRating: 9, tmdbGenreIds: [878] }],
      [],
      null,
      { candidates: enriched, embeddingIndex: null, enrichCandidates: false }
    );
    assert.deepEqual(res.modelInfo?.hydrationCoverage, {
      hydrated: 94,
      total: 95,
      ratio: 94 / 95,
      percent: 99
    });
  } finally {
    if (prevVitTmdb === undefined) delete process.env.VITE_TMDB_KEY;
    else process.env.VITE_TMDB_KEY = prevVitTmdb;
  }
});

test("backfillMissingTmdbIds resolves IMDb/strict title+year movies, skips TV series, and avoids retrying already-enriched or checked items", async () => {
  const { backfillMissingTmdbIds, getVaultBackfillItemKey } = await import("../src/services/tmdbService.js");

  const watched = [
    // 1. Legacy OMDb movie with imdbID only
    {
      imdbID: "tt2911666",
      Title: "John Wick",
      Year: "2014",
      Poster: "https://m.media-amazon.com/wick.jpg",
      userRating: 9,
      updatedAt: "2026-11-14T00:00:00.000Z"
    },
    // 2. Empty /3/find -> strict title+year must reject 2025 remake and pick 2010 match; missing TMDB poster keeps "N/A"
    {
      imdbID: "tt0892769",
      title: "How to Train Your Dragon",
      year: "2010",
      poster: "N/A",
      userRating: 9
    },
    // 3. Explicit TV series must trigger zero network calls
    {
      imdbID: "tt5753856",
      title: "Dark",
      year: "2017–2020",
      Type: "series",
      userRating: 10
    },
    // 4. Legacy untagged year-range series must be tagged Type:"series" with zero calls
    {
      imdbID: "tt21209876",
      Title: "Solo Leveling",
      Year: "2024–",
      userRating: 9
    },
    // 5. Series without range year detected via /3/find tv_results must never call /3/search/movie
    {
      imdbID: "tt0903747",
      title: "Breaking Bad",
      year: "2008",
      userRating: 10
    },
    // 6. Already enriched item must trigger zero network calls
    {
      imdbID: "tt1375666",
      tmdbId: 27205,
      title: "Inception",
      year: "2010",
      poster: "https://image.tmdb.org/t/p/w500/inception.jpg",
      tmdbGenreIds: [28, 878],
      tmdbKeywords: [101],
      castIds: [6193],
      crewPersonId: 525,
      userRating: 10
    }
  ];

  const watchlist = [
    // Wrong-year remake only in /3/search/movie -> must NOT resolve to wrong movie
    {
      title: "Wrong Year Remake Film",
      year: "2010"
    }
  ];

  const fetchCalls = [];
  const prevVitTmdb = process.env.VITE_TMDB_KEY;
  delete process.env.VITE_TMDB_KEY;
  try {
    const res = await backfillMissingTmdbIds(watched, watchlist, {
      forceProxy: true,
      lookupConcurrency: 1,
      fetchFn: async (url) => {
        const u = String(url);
        fetchCalls.push(u);
        const qs = new URLSearchParams(u.split("?")[1] || "");
        const tmdbPath = qs.get("path") || "";

        if (tmdbPath === "/3/find/tt2911666") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              movie_results: [{ id: 245891, title: "John Wick", release_date: "2014-10-22", poster_path: "/wick_stub.jpg" }],
              tv_results: []
            })
          };
        }
        if (tmdbPath === "/3/find/tt0892769") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ movie_results: [], tv_results: [] })
          };
        }
        if (tmdbPath === "/3/find/tt0903747") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ movie_results: [], tv_results: [{ id: 1396, name: "Breaking Bad" }] })
          };
        }
        if (tmdbPath === "/3/search/movie") {
          const query = qs.get("query") || "";
          if (query === "Wrong Year Remake Film") {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                results: [
                  { id: 999888, title: "Wrong Year Remake Film", release_date: "2025-06-13", popularity: 99 }
                ]
              })
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              results: [
                { id: 1087192, title: "How to Train Your Dragon", release_date: "2025-06-13", popularity: 99 },
                { id: 10191, title: "How to Train Your Dragon", release_date: "2010-03-26", poster_path: null, popularity: 50 }
              ]
            })
          };
        }
        if (u.startsWith("/api/tmdb-batch?")) {
          const ids = (qs.get("ids") || "").split(",").map(Number);
          const results = {};
          for (const id of ids) {
            if (id === 245891) {
              results["245891"] = {
                id: 245891,
                title: "John Wick",
                release_date: "2014-10-22",
                poster_path: "/wick_tmdb.jpg",
                genres: [{ id: 28, name: "Action" }, { id: 53, name: "Thriller" }],
                keywords: { keywords: [{ id: 9715, name: "revenge" }, { id: 10292, name: "hitman" }] },
                credits: {
                  crew: [{ job: "Director", id: 40644, name: "Chad Stahelski" }],
                  cast: [{ id: 6384, name: "Keanu Reeves" }]
                },
                external_ids: { imdb_id: "tt2911666" }
              };
            }
            if (id === 10191) {
              results["10191"] = {
                id: 10191,
                title: "How to Train Your Dragon",
                release_date: "2010-03-26",
                poster_path: null,
                genres: [{ id: 16, name: "Animation" }],
                keywords: { keywords: [{ id: 1299, name: "dragon" }] },
                credits: {
                  crew: [{ job: "Director", id: 69797, name: "Dean DeBlois" }],
                  cast: [{ id: 69799, name: "Jay Baruchel" }]
                },
                external_ids: { imdb_id: "tt0892769" }
              };
            }
          }
          return { ok: true, status: 200, json: async () => ({ results }) };
        }
        throw new Error(`Unexpected fetch URL: ${u}`);
      }
    });

    assert.equal(res.rateLimited, false);
    assert.deepEqual(res.resolvedIds, [245891, 10191]);
    // 1) John Wick resolved cleanly without inventing dateWatched
    assert.equal(res.watched[0].tmdbId, 245891);
    assert.deepEqual(res.watched[0].tmdbGenreIds, [28, 53]);
    assert.deepEqual(res.watched[0].tmdbKeywords, [9715, 10292]);
    assert.deepEqual(res.watched[0].castIds, [6384]);
    assert.equal(res.watched[0].crewPersonId, 40644);
    assert.equal(res.watched[0].poster, "https://image.tmdb.org/t/p/w500/wick_tmdb.jpg");
    assert.equal(res.watched[0].userRating, 9);
    assert.equal("dateWatched" in res.watched[0], false);

    // 2) Strict title+year picked 2010 (10191) instead of 2025 remake and preserved "N/A" poster when poster_path is null
    assert.equal(res.watched[1].tmdbId, 10191);
    assert.equal(res.watched[1].poster, "N/A");
    assert.equal(res.watchlist[0].tmdbId, undefined, "Wrong-year remake candidate must be rejected");
    assert.equal(res.checkedKeys.includes(getVaultBackfillItemKey(watchlist[0])), true);

    // 3) Series items have NO tmdbId and were skipped/tagged safely without searching movie endpoint for Dark, Solo Leveling, or Breaking Bad
    assert.equal(res.watched[2].tmdbId, undefined);
    assert.equal(res.watched[3].tmdbId, undefined);
    assert.equal(res.watched[3].Type, "series");
    assert.equal(res.watched[4].tmdbId, undefined);
    assert.equal(res.watched[4].Type, "series");

    const searchUrls = fetchCalls.filter((u) => u.includes("%2F3%2Fsearch%2Fmovie"));
    assert.equal(searchUrls.length, 2, "Only the empty-/3/find movie and missing-imdb watchlist movie should call /3/search/movie");
    assert.equal(fetchCalls.some((u) => u.includes("tt5753856") || u.includes("tt21209876") || u.includes("tt1375666")), false);

    // Calling again on the updated lists + checkedKeys triggers ZERO network calls
    const retryCalls = [];
    const second = await backfillMissingTmdbIds(res.watched, res.watchlist, {
      forceProxy: true,
      alreadyChecked: res.checkedKeys,
      fetchFn: async (url) => {
        retryCalls.push(String(url));
        throw new Error("Should not call network on already-enriched/checked items");
      }
    });
    assert.equal(retryCalls.length, 0);
    assert.equal(second.updatedCount, 0);

    // Rate-limit (429) test stops cleanly and does not mark 429 item checked
    const rlCalls = [];
    const rlRes = await backfillMissingTmdbIds(
      [
        { imdbID: "tt0133093", Title: "The Matrix", Year: "1999", userRating: 10 },
        { imdbID: "tt0110912", Title: "Pulp Fiction", Year: "1994", userRating: 9 }
      ],
      [],
      {
        forceProxy: true,
        lookupConcurrency: 1,
        fetchFn: async (url) => {
          rlCalls.push(String(url));
          return { ok: false, status: 429, json: async () => ({ errorCode: "PROXY_RATE_LIMIT" }) };
        }
      }
    );
    assert.equal(rlRes.rateLimited, true);
    assert.equal(rlCalls.length, 1, "Must stop making lookups immediately on HTTP 429");
    assert.equal(rlRes.checkedKeys.includes(getVaultBackfillItemKey({ imdbID: "tt0133093" })), false);

    // maxLookups caps /3/find calls independently while still batch-hydrating existing-tmdbId entries
    const budgetCalls = [];
    const budgetRes = await backfillMissingTmdbIds(
      [
        { imdbID: "tt2911666", Title: "John Wick", Year: "2014", userRating: 9 },
        { imdbID: "tt4425200", Title: "John Wick: Chapter 2", Year: "2017", userRating: 9 },
        { tmdbId: 10191, imdbID: "tt0892769", title: "How to Train Your Dragon", year: "2010", userRating: 9 }
      ],
      [],
      {
        forceProxy: true,
        maxItems: 5,
        maxLookups: 1,
        fetchFn: async (url) => {
          const u = String(url);
          budgetCalls.push(u);
          const qs = new URLSearchParams(u.split("?")[1] || "");
          const tmdbPath = qs.get("path") || "";
          if (tmdbPath === "/3/find/tt2911666") {
            return { ok: true, status: 200, json: async () => ({ movie_results: [{ id: 245891, title: "John Wick", release_date: "2014-10-22" }] }) };
          }
          if (u.startsWith("/api/tmdb-batch?")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                results: {
                  "245891": { id: 245891, title: "John Wick", release_date: "2014-10-22", genres: [{ id: 28, name: "Action" }], keywords: { keywords: [{ id: 9, name: "action" }] }, credits: { crew: [], cast: [{ id: 6384 }] } },
                  "10191": { id: 10191, title: "How to Train Your Dragon", release_date: "2010-03-26", genres: [{ id: 16, name: "Animation" }], keywords: { keywords: [{ id: 12, name: "dragon" }] }, credits: { crew: [], cast: [{ id: 69799 }] } }
                }
              })
            };
          }
          throw new Error(`Unexpected budget call: ${u}`);
        }
      }
    );
    assert.equal(budgetRes.watched[0].tmdbId, 245891);
    assert.equal(budgetRes.watched[1].tmdbId, undefined, "2nd lookup-needing item deferred cleanly under maxLookups: 1");
    assert.deepEqual(budgetRes.watched[2].tmdbKeywords, [12], "existing-tmdbId item still batch-hydrated within maxItems");
    assert.equal(budgetCalls.length, 2, "1 /3/find + 1 /api/tmdb-batch");
  } finally {
    if (prevVitTmdb === undefined) delete process.env.VITE_TMDB_KEY;
    else process.env.VITE_TMDB_KEY = prevVitTmdb;
  }
});

