import test from "node:test";
import assert from "node:assert/strict";
import { extractTasteProfile, buildBucketAParams } from "../src/services/tmdbService.js";
import { generateProfileHash } from "../src/services/geminiService.js";

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
