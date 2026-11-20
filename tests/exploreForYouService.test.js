import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPLORE_FOR_YOU_TARGET_COUNT,
  EXPLORE_FOR_YOU_MIN_RATED,
  buildExploreForYouProfileHash,
  buildExploreForYouBatchPrompt,
  mergeExploreForYouResponse,
  weightedShuffleForYou,
  filterForYouCatalog,
  generateExploreForYouPool
} from "../src/services/exploreForYouService.js";

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

  const merged = mergeExploreForYouResponse(candidates, geminiItems, { targetCount: EXPLORE_FOR_YOU_TARGET_COUNT });
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
