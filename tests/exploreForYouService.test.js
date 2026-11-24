import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPLORE_FOR_YOU_TARGET_COUNT,
  EXPLORE_FOR_YOU_MIN_RATED,
  EXPLORE_FOR_YOU_AI_BATCH_LIMIT,
  buildExploreForYouProfileHash,
  buildExploreForYouBatchPrompt,
  buildMathVibeTag,
  mergeExploreForYouResponse,
  weightedShuffleForYou,
  filterForYouCatalog,
  generateExploreForYouPool
} from "../src/services/exploreForYouService.js";
import { encodeEmbeddingBinary, parseEmbeddingBinary } from "../src/services/embeddingService.js";

function makeCandidates(count = 120) {
  return Array.from({ length: count }, (_, i) => ({
    id: `tmdb_${1000 + i}`,
    tmdbId: 1000 + i,
    imdbID: `tmdb_${1000 + i}`,
    title: `Candidate Film ${i + 1}`,
    year: String(1995 + (i % 30)),
    release_date: `${1995 + (i % 30)}-06-15`,
    poster: `https://image.tmdb.org/t/p/w500/p${i}.jpg`,
    genre: i % 3 === 0 ? "Sci-Fi, Thriller" : i % 3 === 1 ? "Drama, Crime" : "Mystery, Action",
    tmdbGenreIds: i % 3 === 0 ? [878, 53] : i % 3 === 1 ? [18, 80] : [9648, 28],
    vote_average: Number((6.6 + (i % 24) * 0.1).toFixed(1)),
    imdbRating: (6.6 + (i % 24) * 0.1).toFixed(1),
    vote_count: 500 + i * 30,
    runtime: 95 + (i % 65),
    original_language: i % 5 === 0 ? "ko" : "en",
    matchScore: Math.max(55, 98 - Math.floor(i * 0.35)),
    popularity: 120 - i * 0.5
  }));
}

test("buildExploreForYouBatchPrompt stays bounded <= 28000 chars and emoji-free for 120 candidates + 50 watched", () => {
  const watched = Array.from({ length: 50 }, (_, i) => ({
    tmdbId: 10 + i,
    title: `Loved Film ${i}`,
    year: "2018",
    userRating: i < 20 ? 9 : 4,
    genre: "Sci-Fi, Drama",
    director: "Denis Villeneuve",
    userNote: "Strong practical atmosphere and tight tension."
  }));
  const candidates = makeCandidates(120);
  const prompt = buildExploreForYouBatchPrompt(
    { lovedGenreNames: ["Sci-Fi", "Thriller", "Drama"] },
    candidates,
    { watched, tasteRules: [{ text: "Prefer slow-burn tension", polarity: "prefer", enabled: true }], targetCount: 100 }
  );

  assert.ok(prompt.length <= 28000, `Expected <= 28000 chars, got ${prompt.length}`);
  assert.equal(/\p{Extended_Pictographic}/u.test(prompt), false);
  assert.match(prompt, /Candidate Film 1/);
  assert.match(prompt, /Loved Film 0/);
});

test("mergeExploreForYouResponse strips hallucinated IDs, preserves AI tags, deduplicates, and backfills to targetCount", () => {
  const candidates = makeCandidates(110);
  const geminiItems = [
    { id: 1005, s: 96, tag: "Cerebral Sci-Fi", r: "Echoes your taste for existential puzzles." },
    { id: 1005, s: 80, tag: "Duplicate", r: "Should be ignored." },
    { id: 999999, s: 99, tag: "Hallucinated", r: "Not in candidate pool." },
    { id: 1002, s: 94, tag: "Gritty Noir", r: "Tight pacing and moral ambiguity." }
  ];

  const merged = mergeExploreForYouResponse(candidates, geminiItems, { targetCount: 100 });
  assert.equal(merged.length, 100);
  assert.equal(merged.some((m) => m.tmdbId === 999999), false);

  const uniqueIds = new Set(merged.map((m) => m.tmdbId));
  assert.equal(uniqueIds.size, 100);

  const pick1005 = merged.find((m) => m.tmdbId === 1005);
  assert.equal(pick1005.forYouScore, 96);
  assert.equal(pick1005.vibeTag, "Cerebral Sci-Fi");
  assert.equal(pick1005.forYouReason, "Echoes your taste for existential puzzles.");
});

test("weightedShuffleForYou preserves all unique items, varies ordering by seed, and biases high affinity early", () => {
  const items = makeCandidates(100).map((c, idx) => ({
    ...c,
    forYouScore: 99 - Math.floor(idx * 0.45)
  }));

  const a = weightedShuffleForYou(items, 101);
  const b = weightedShuffleForYou(items, 202);

  assert.equal(a.length, 100);
  assert.equal(new Set(a.map((x) => x.tmdbId)).size, 100);
  assert.notDeepEqual(
    a.slice(0, 15).map((x) => x.tmdbId),
    b.slice(0, 15).map((x) => x.tmdbId)
  );

  const avgTop20 = a.slice(0, 20).reduce((s, m) => s + m.forYouScore, 0) / 20;
  const avgBottom20 = a.slice(80).reduce((s, m) => s + m.forYouScore, 0) / 20;
  assert.ok(avgTop20 > avgBottom20 + 15, `Expected top-20 avg (${avgTop20}) >> bottom-20 avg (${avgBottom20})`);
});

test("filterForYouCatalog applies Explore Deep Filters locally and supports For You vs IMDb/Year sort", () => {
  const pool = makeCandidates(30).map((c, idx) => ({
    ...c,
    forYouScore: 95 - idx
  }));
  const watched = [{ tmdbId: 1000, title: "Candidate Film 1", userRating: 9 }];
  const watchlist = [{ tmdbId: 1003, title: "Candidate Film 4" }];

  const scifiOnly = filterForYouCatalog(
    pool,
    { genres: [878], genreMode: "and", withoutGenres: [], minImdb: 7.0, minVotes: 0, hideWatched: true, sortBy: "for_you" },
    watched,
    watchlist
  );
  assert.ok(scifiOnly.length > 0);
  assert.equal(scifiOnly.some((m) => m.tmdbId === 1000), false, "watched item hidden when hideWatched=true");
  assert.ok(scifiOnly.every((m) => m.tmdbGenreIds.includes(878) && Number(m.imdbRating) >= 7.0));
  const wlItem = scifiOnly.find((m) => m.tmdbId === 1003);
  if (wlItem) assert.equal(wlItem._inWatchlist, true);

  const byImdb = filterForYouCatalog(
    pool,
    { genres: [], withoutGenres: [], minImdb: 0, minVotes: 0, hideWatched: false, sortBy: "vote_average.desc" },
    watched,
    watchlist
  );
  assert.ok(Number(byImdb[0].imdbRating) >= Number(byImdb[byImdb.length - 1].imdbRating));
});

test("generateExploreForYouPool falls back cleanly to local ranker when aiClient is null or fails", async () => {
  const watched = [
    { tmdbId: 1, title: "Interstellar", year: "2014", userRating: 10, tmdbGenreIds: [878, 18] },
    { tmdbId: 2, title: "Blade Runner 2049", year: "2017", userRating: 10, tmdbGenreIds: [878, 18] },
    { tmdbId: 3, title: "Arrival", year: "2016", userRating: 9, tmdbGenreIds: [878, 18] }
  ];
  const candidates = makeCandidates(110);

  const hash1 = buildExploreForYouProfileHash({ watched, watchlist: [], tasteRules: [], userRegion: "US" });
  assert.ok(typeof hash1 === "string" && hash1.length > 4);
  assert.equal(EXPLORE_FOR_YOU_MIN_RATED, 3);

  const fallbackRes = await generateExploreForYouPool({
    watched,
    watchlist: [],
    candidates,
    aiClient: null,
    embeddingIndex: null,
    targetCount: 100
  });
  assert.equal(fallbackRes.source, "local-ranker");
  assert.equal(fallbackRes.items.length, 100);

  let aiCalled = 0;
  const geminiRes = await generateExploreForYouPool({
    watched,
    watchlist: [],
    candidates,
    embeddingIndex: null,
    targetCount: 100,
    aiClient: {
      models: {
        generateContent: async () => {
          aiCalled += 1;
          return {
            text: JSON.stringify({
              picks: candidates.slice(0, 60).map((c, idx) => ({
                id: c.tmdbId,
                s: 97 - Math.floor(idx * 0.4),
                tag: "Editorial Sci-Fi",
                r: "Fits your high ratings for atmospheric sci-fi."
              }))
            })
          };
        }
      }
    }
  });

  assert.equal(aiCalled, 1);
  assert.equal(geminiRes.source, "gemini-flash-lite");
  assert.equal(geminiRes.items.length, 100);
  assert.equal(geminiRes.items[0].vibeTag, "Editorial Sci-Fi");
});


test("buildExploreForYouProfileHash changes whenever watched movies, ratings, notes, or watchlist change", () => {
  const watchedA = [
    { tmdbId: 10, title: "Film A", userRating: 10 },
    { tmdbId: 20, title: "Film B", userRating: 9 },
    { tmdbId: 30, title: "Film C", userRating: 8 }
  ];
  const watchedB = [
    { tmdbId: 99, title: "Different Film", userRating: 10 },
    { tmdbId: 20, title: "Film B", userRating: 9 },
    { tmdbId: 30, title: "Film C", userRating: 8 }
  ];
  const watchedRatingChanged = [
    { tmdbId: 10, title: "Film A", userRating: 4 },
    { tmdbId: 20, title: "Film B", userRating: 9 },
    { tmdbId: 30, title: "Film C", userRating: 8 }
  ];
  const watchedNoteChanged = [
    { tmdbId: 10, title: "Film A", userRating: 10, userNote: "Loved the score" },
    { tmdbId: 20, title: "Film B", userRating: 9 },
    { tmdbId: 30, title: "Film C", userRating: 8 }
  ];

  const hA = buildExploreForYouProfileHash({ watched: watchedA, watchlist: [{ tmdbId: 1 }], userRegion: "US" });
  const hB = buildExploreForYouProfileHash({ watched: watchedB, watchlist: [{ tmdbId: 1 }], userRegion: "US" });
  const hRating = buildExploreForYouProfileHash({ watched: watchedRatingChanged, watchlist: [{ tmdbId: 1 }], userRegion: "US" });
  const hNote = buildExploreForYouProfileHash({ watched: watchedNoteChanged, watchlist: [{ tmdbId: 1 }], userRegion: "US" });
  const hWl = buildExploreForYouProfileHash({ watched: watchedA, watchlist: [{ tmdbId: 2 }], userRegion: "US" });

  assert.notEqual(hA, hB, "Different watched films must produce different profile hashes");
  assert.notEqual(hA, hRating, "Changed userRating must invalidate profile hash");
  assert.notEqual(hA, hNote, "Changed userNote must invalidate profile hash");
  assert.notEqual(hA, hWl, "Changed watchlist must invalidate profile hash");
});

test("generateExploreForYouPool wires collaborative embeddings and negative repulsion from embeddingIndex", async () => {
  // Build a minimal 4-film 2-dim embedding index matching embeddingService's binary format
  // Film 1 (loved 10/10): [1, 0]
  // Film 2 (disliked 2/10): [0, 1]
  // Candidate 201 (aligned with loved): [0.99, 0.1]
  // Candidate 202 (aligned with disliked): [0.1, 0.99]
  const idToIndex = new Map([
    [1, 0],
    [2, 1],
    [201, 2],
    [202, 3]
  ]);
  const ids = new Int32Array([1, 2, 201, 202]);
  const vectors = new Float32Array([
    1.0, 0.0,
    0.0, 1.0,
    0.99, 0.1,
    0.1, 0.99
  ]);
  const mockEmbeddingIndex = { count: 4, dim: 2, idToIndex, ids, vectors };

  const watched = [
    { tmdbId: 1, title: "Loved Anchor", year: "2014", userRating: 10, tmdbGenreIds: [18] },
    { tmdbId: 2, title: "Hated Anchor", year: "2015", userRating: 2, tmdbGenreIds: [18] },
    { tmdbId: 3, title: "Neutral Film", year: "2016", userRating: 7, tmdbGenreIds: [18] }
  ];

  // Give both candidates identical metadata so ONLY collaborative similarity + repulsion can separate them!
  const identicalCandidates = [
    {
      id: 202,
      tmdbId: 202,
      title: "Near Disliked Film",
      year: "2020",
      release_date: "2020-05-01",
      poster: "https://image.tmdb.org/t/p/w500/202.jpg",
      genre: "Drama",
      tmdbGenreIds: [18],
      vote_average: 7.5,
      vote_count: 1000,
      popularity: 50
    },
    {
      id: 201,
      tmdbId: 201,
      title: "Near Loved Film",
      year: "2020",
      release_date: "2020-05-01",
      poster: "https://image.tmdb.org/t/p/w500/201.jpg",
      genre: "Drama",
      tmdbGenreIds: [18],
      vote_average: 7.5,
      vote_count: 1000,
      popularity: 50
    }
  ];

  const res = await generateExploreForYouPool({
    watched,
    watchlist: [],
    candidates: identicalCandidates,
    embeddingIndex: mockEmbeddingIndex,
    aiClient: null,
    targetCount: 10
  });

  assert.equal(res.items.length, 2);
  assert.equal(res.items[0].tmdbId, 201, "Loved embedding neighbor must outrank disliked neighbor");
  assert.ok(res.items[0].forYouScore > res.items[1].forYouScore);
});

test("filterForYouCatalog enforces Runtime, Language, Country, Person, Keywords, and Streaming provider facets", () => {
  const rawPool = [
    {
      tmdbId: 301,
      title: "Korean Neo-Noir",
      year: "2022",
      tmdbGenreIds: [53, 80],
      imdbRating: "8.1",
      vote_count: 1200,
      runtime: 112,
      original_language: "ko",
      originCountry: ["KR"],
      personIds: [555, 666],
      keywordIds: [9001, 9002],
      providerIds: [8],
      forYouScore: 95
    },
    {
      tmdbId: 302,
      title: "Long US Epic",
      year: "2021",
      tmdbGenreIds: [18],
      imdbRating: "8.0",
      vote_count: 2500,
      runtime: 165,
      original_language: "en",
      originCountry: ["US"],
      personIds: [777],
      keywordIds: [9009],
      providerIds: [1899],
      forYouScore: 93
    },
    {
      tmdbId: 303,
      title: "Sparse Unhydrated Film",
      year: "2020",
      tmdbGenreIds: [53],
      imdbRating: "7.5",
      vote_count: 500,
      runtime: null,
      original_language: "",
      originCountry: [],
      personIds: [],
      keywordIds: [],
      providerIds: [],
      forYouScore: 88
    }
  ];

  assert.deepEqual(
    filterForYouCatalog(rawPool, { runtimeMax: 120 }).map((m) => m.tmdbId),
    [301],
    "runtimeMax must exclude longer films AND films missing runtime"
  );
  assert.deepEqual(
    filterForYouCatalog(rawPool, { language: "ko" }).map((m) => m.tmdbId),
    [301],
    "language filter must exclude mismatched and unknown language films"
  );
  assert.deepEqual(
    filterForYouCatalog(rawPool, { country: "KR" }).map((m) => m.tmdbId),
    [301],
    "country filter must exclude mismatched and unknown country films"
  );
  assert.deepEqual(
    filterForYouCatalog(rawPool, { person: { id: 555, name: "Park" } }).map((m) => m.tmdbId),
    [301],
    "person filter must match personIds"
  );
  assert.deepEqual(
    filterForYouCatalog(rawPool, { keywords: [{ id: 9001, name: "noir" }] }).map((m) => m.tmdbId),
    [301],
    "keywords filter must match keywordIds"
  );
  assert.deepEqual(
    filterForYouCatalog(rawPool, { providers: [8] }).map((m) => m.tmdbId),
    [301],
    "providers filter must match providerIds"
  );
});


test("expanded math-first For You pool targets >= 250 films, emits immediate preliminary results, tags math picks cleanly, and keeps Gemini to 1 single call", async () => {
  assert.ok(EXPLORE_FOR_YOU_TARGET_COUNT >= 250, `Expected >= 250 target count, got ${EXPLORE_FOR_YOU_TARGET_COUNT}`);
  assert.equal(EXPLORE_FOR_YOU_AI_BATCH_LIMIT, 100);

  const mathTag = buildMathVibeTag({ genre: "Sci-Fi, Thriller", year: "2019", imdbRating: "8.2" });
  assert.ok(mathTag.length >= 4 && mathTag.length <= 32);
  assert.equal(/\p{Extended_Pictographic}/u.test(mathTag), false);

  const watched = [
    { tmdbId: 1, title: "Interstellar", year: "2014", userRating: 10, tmdbGenreIds: [878, 18] },
    { tmdbId: 2, title: "Blade Runner 2049", year: "2017", userRating: 10, tmdbGenreIds: [878, 18] },
    { tmdbId: 3, title: "Arrival", year: "2016", userRating: 9, tmdbGenreIds: [878, 18] }
  ];
  const candidates260 = makeCandidates(260);

  let prelimCount = 0;
  let prelimLength = 0;
  let aiCallCount = 0;
  let geminiPromptLen = 0;

  const finalRes = await generateExploreForYouPool({
    watched,
    watchlist: [],
    candidates: candidates260,
    embeddingIndex: null,
    targetCount: EXPLORE_FOR_YOU_TARGET_COUNT,
    onPreliminaryReady: (prelim) => {
      prelimCount += 1;
      prelimLength = prelim?.items?.length || 0;
    },
    aiClient: {
      models: {
        generateContent: async ({ contents }) => {
          aiCallCount += 1;
          geminiPromptLen = String(contents || "").length;
          return {
            text: JSON.stringify({
              picks: candidates260.slice(0, 40).map((c, idx) => ({
                id: c.tmdbId,
                s: 98 - Math.floor(idx * 0.3),
                tag: "Bespoke Sci-Fi",
                r: "Tuned to your sci-fi favorites."
              }))
            })
          };
        }
      }
    }
  });

  assert.equal(prelimCount, 1, "onPreliminaryReady must fire immediately before Gemini completes");
  assert.equal(prelimLength, EXPLORE_FOR_YOU_TARGET_COUNT);
  assert.equal(aiCallCount, 1, "Must invoke Gemini Flash-Lite at most once");
  assert.ok(geminiPromptLen <= 28000);
  assert.equal(finalRes.items.length, EXPLORE_FOR_YOU_TARGET_COUNT);
  // Math-ranked tail items must also carry clean deterministic vibe tags
  assert.ok(finalRes.items.every((m) => typeof m.vibeTag === "string" && m.vibeTag.length > 0));
});

test("filterForYouCatalog filters personalized pool by query across title, genre, director, and plot", () => {
  const pool = [
    { tmdbId: 329, title: "Jurassic Park", genre: "Adventure, Sci-Fi", director: "Steven Spielberg" },
    { tmdbId: 135397, title: "Jurassic World", genre: "Action, Sci-Fi", director: "Colin Trevorrow" },
    { tmdbId: 27205, title: "Inception", genre: "Action, Sci-Fi", director: "Christopher Nolan" }
  ];
  const matched = filterForYouCatalog(pool, { query: "jurassic" });
  assert.deepEqual(matched.map((m) => m.tmdbId), [329, 135397]);
});

test("generateExploreForYouPool Wave 2 injects Bucket E-Cold semantic neighbors when contentIndex is loaded", async () => {
  const embeddingIndex = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 1, vector: [1, 0, 0, 0] },
    { tmdbId: 200, vector: [0.99, 0.14, 0, 0] }
  ]));
  const contentIndex = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 1, vector: [1, 0, 0, 0] },
    { tmdbId: 200, vector: [0.99, 0.14, 0, 0] }, // warm (must be skipped by Bucket E-Cold)
    { tmdbId: 303, vector: [0.96, 0.28, 0, 0] }  // cold 2025 semantic hit
  ]));
  const watched = [
    { tmdbId: 1, title: "Seed 1", year: "2020", userRating: 10, tmdbGenreIds: [878] },
    { tmdbId: 2, title: "Seed 2", year: "2021", userRating: 9, tmdbGenreIds: [878] },
    { tmdbId: 3, title: "Seed 3", year: "2022", userRating: 8, tmdbGenreIds: [878] }
  ];

  const fetchEmbCalls = [];
  const res = await generateExploreForYouPool({
    watched,
    watchlist: [],
    embeddingIndex,
    contentIndex,
    aiClient: null,
    targetCount: 15,
    fetchCandidatePoolFn: async (_profile, _mood, _w, _wl, opts) => {
      const start = opts?.page === 2 ? 600 : 500;
      return Array.from({ length: 8 }, (_, i) => ({
        id: start + i,
        tmdbId: start + i,
        title: `Base ${start + i}`,
        year: "2021",
        release_date: "2021-05-01",
        poster: `https://image.tmdb.org/t/p/w500/${start + i}.jpg`,
        genre: "Comedy",
        tmdbGenreIds: [35],
        vote_average: 7.1,
        vote_count: 250
      }));
    },
    fetchEmbeddingFn: async (neighbors, _w, _wl, _existing, opts) => {
      fetchEmbCalls.push({ neighbors, opts });
      return neighbors.map((n) => ({
        id: n.tmdbId,
        tmdbId: n.tmdbId,
        title: `Emb ${n.tmdbId}`,
        year: opts?.sourceBucket?.includes("Cold") ? "2025" : "2019",
        release_date: opts?.sourceBucket?.includes("Cold") ? "2025-05-01" : "2019-05-01",
        poster: `https://image.tmdb.org/t/p/w500/${n.tmdbId}.jpg`,
        genre: "Sci-Fi",
        tmdbGenreIds: [878],
        vote_average: 7.8,
        vote_count: 400,
        collabSim: n.collabSim ?? 0,
        sourceBucket: opts?.sourceBucket || "Bucket E (Embedding)"
      }));
    },
    enrichPoolFn: async (pool) => pool
  });

  const coldCall = fetchEmbCalls.find((c) => c.opts?.sourceBucket === "Bucket E-Cold (Semantic)");
  assert.ok(coldCall, "Wave 2 must invoke fetchEmbeddingFn with sourceBucket 'Bucket E-Cold (Semantic)'");
  assert.deepEqual(coldCall.neighbors.map((n) => n.tmdbId), [303], "Bucket E-Cold must skip warm collabIndex ID 200");
  assert.equal(coldCall.opts.maxNeighbors, 12);
  assert.ok(res.items.some((m) => m.tmdbId === 303), "Cold neighbor 303 must appear in final Explore For You items");
});

test("generateExploreForYouPool Wave 2 excludes warm indexed films in Web Worker mode (embeddingIndex === null, near-zero or empty collabSim)", async () => {
  const { resetEmbeddingWorkerClientForTest } = await import("../src/services/embeddingWorkerClient.js");
  resetEmbeddingWorkerClientForTest();

  const contentIndex = parseEmbeddingBinary(encodeEmbeddingBinary([
    { tmdbId: 1, vector: [1, 0, 0, 0] },
    { tmdbId: 200, vector: [0.99, 0.14, 0, 0] }, // warm indexed in worker, missing from sparse collabEntries
    { tmdbId: 202, vector: [0.98, 0.19, 0, 0] }, // warm indexed in worker, blended collabSim: 0.0005
    { tmdbId: 303, vector: [0.96, 0.28, 0, 0] }  // true cold 2025 hit
  ]));
  const watched = [
    { tmdbId: 1, title: "Seed 1", year: "2020", userRating: 10, tmdbGenreIds: [878] },
    { tmdbId: 2, title: "Seed 2", year: "2021", userRating: 9, tmdbGenreIds: [878] },
    { tmdbId: 3, title: "Seed 3", year: "2022", userRating: 8, tmdbGenreIds: [878] }
  ];

  const fetchEmbCalls = [];
  const createWorkerFn = () => ({
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      setTimeout(() => {
        this.onmessage?.({
          data: {
            id: msg.id,
            ok: true,
            result: {
              hasIndex: true,
              collabIds: new Uint32Array([1, 200, 202]),
              collabEntries: [[202, 0.0005]],
              repulsionEntries: [],
              collabCatalogMax: 0.5,
              collabUserVec: [1, 0, 0, 0],
              alignedNeighbors: []
            }
          }
        });
      }, 0);
    },
    terminate() {}
  });

  try {
    await generateExploreForYouPool({
      watched,
      watchlist: [],
      contentIndex,
      createWorkerFn,
      aiClient: null,
      targetCount: 15,
      fetchCandidatePoolFn: async (_profile, _mood, _w, _wl, opts) => {
        const start = opts?.page === 2 ? 600 : 500;
        return Array.from({ length: 8 }, (_, i) => ({
          id: start + i,
          tmdbId: start + i,
          title: `Base ${start + i}`,
          year: "2021",
          release_date: "2021-05-01",
          poster: `https://image.tmdb.org/t/p/w500/${start + i}.jpg`,
          genre: "Comedy",
          tmdbGenreIds: [35],
          vote_average: 7.1,
          vote_count: 250
        }));
      },
      fetchEmbeddingFn: async (neighbors, _w, _wl, _existing, opts) => {
        fetchEmbCalls.push({ neighbors, opts });
        return neighbors.map((n) => ({
          id: n.tmdbId,
          tmdbId: n.tmdbId,
          title: `Emb ${n.tmdbId}`,
          year: "2025",
          release_date: "2025-05-01",
          poster: `https://image.tmdb.org/t/p/w500/${n.tmdbId}.jpg`,
          genre: "Sci-Fi",
          tmdbGenreIds: [878],
          vote_average: 7.8,
          vote_count: 400,
          collabSim: n.collabSim ?? 0,
          sourceBucket: opts?.sourceBucket || "Bucket E-Cold (Semantic)"
        }));
      },
      enrichPoolFn: async (pool) => pool
    });
  } finally {
    resetEmbeddingWorkerClientForTest();
  }

  const coldCall = fetchEmbCalls.find((c) => c.opts?.sourceBucket === "Bucket E-Cold (Semantic)");
  assert.ok(coldCall, "Wave 2 must still invoke Bucket E-Cold in Web Worker mode");
  assert.deepEqual(
    coldCall.neighbors.map((n) => n.tmdbId),
    [303],
    "Bucket E-Cold in Web Worker mode must exclude warm 200 (collabIdSet) and 202 (collabSim 0.0005)"
  );
});
