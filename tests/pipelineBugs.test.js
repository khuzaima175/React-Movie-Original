import test from "node:test";
import assert from "node:assert/strict";
import { extractTasteProfile, buildBucketAParams } from "../src/services/tmdbService.js";
import {
  generateProfileHash,
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

  const mockCandidates = Array.from({ length: 8 }, (_, i) => ({
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
    assert.equal(res.recommendations.length, 6);
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
  const mockCandidates = Array.from({ length: 6 }, (_, i) => ({
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
    assert.equal(res.recommendations.length, 6);
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
  assert.equal(normalizeMatchScore(NaN), 88);
});

test("getMovieRecommendations completes via local ranker when VITE_GEMINI_KEY is unset and candidates or TMDB exist", async () => {
  const prevGeminiKey = process.env.VITE_GEMINI_KEY;
  const prevTmdbKey = process.env.VITE_TMDB_KEY;
  delete process.env.VITE_GEMINI_KEY;
  delete process.env.VITE_TMDB_KEY;
  resetSessionWorkingModels();
  resetModelInfoForTests();

  try {
    const candidates = Array.from({ length: 6 }, (_, i) => ({
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
    assert.equal(res.recommendations.length, 6);
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

