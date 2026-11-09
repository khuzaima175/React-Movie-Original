import test from "node:test";
import assert from "node:assert/strict";
import { extractTasteProfile, buildBucketAParams } from "../src/services/tmdbService.js";
import {
  generateProfileHash,
  buildGeminiReRankPrompt,
  mergeGeminiExplanationsWithRanker
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
