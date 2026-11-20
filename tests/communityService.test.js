import test from "node:test";
import assert from "node:assert/strict";
import {
  validateUsername,
  computeTasteTwinCompatibility,
  aggregateCommunityRatings,
  computeProfileTasteVector,
  pickUnseenFavoritesFromProfile
} from "../src/services/communityService.js";
import { encodeEmbeddingBinary, parseEmbeddingBinary } from "../src/services/embeddingService.js";

test("validateUsername normalizes @handle and enforces 3-24 lowercase alphanumeric/underscore rules", () => {
  assert.deepEqual(validateUsername("@Khuzaima_175"), {
    ok: true,
    username: "khuzaima_175",
    error: null
  });
  assert.equal(validateUsername("ab").ok, false);
  assert.equal(validateUsername("has space").ok, false);
  assert.equal(validateUsername("bad-dash!").ok, false);
  assert.equal(validateUsername("admin").ok, false);
  assert.equal(validateUsername("account").ok, false);
  assert.equal(validateUsername("a".repeat(25)).ok, false);
});

test("computeTasteTwinCompatibility maps 64-D cosine similarity to calibrated compatibility percentage", () => {
  const vecA = Array.from({ length: 64 }, (_, i) => (i === 0 ? 1 : 0));
  const vecSame = Array.from({ length: 64 }, (_, i) => (i === 0 ? 1 : 0));
  const vecOrtho = Array.from({ length: 64 }, (_, i) => (i === 1 ? 1 : 0));
  const vecOpposite = Array.from({ length: 64 }, (_, i) => (i === 0 ? -1 : 0));

  const same = computeTasteTwinCompatibility(vecA, vecSame);
  const ortho = computeTasteTwinCompatibility(vecA, vecOrtho);
  const opp = computeTasteTwinCompatibility(vecA, vecOpposite);

  assert.equal(same.matchPct, 99);
  assert.equal(same.label, "Taste Twin");
  assert.ok(ortho.matchPct >= 45 && ortho.matchPct <= 55);
  assert.ok(opp.matchPct <= 20);
  assert.equal(computeTasteTwinCompatibility(null, vecA), null);
  assert.equal(computeTasteTwinCompatibility([1, 2, 3], vecA), null);
});

test("aggregateCommunityRatings computes average, count, histogram, and separates written reviews", () => {
  const agg = aggregateCommunityRatings([
    { id: 1, username: "alice", user_rating: 9, user_note: "Masterpiece cinematography.", updated_at: "2026-11-20T10:00:00Z" },
    { id: 2, username: "bob", user_rating: 7, user_note: "", updated_at: "2026-11-19T10:00:00Z" },
    { id: 3, username: "carol", user_rating: 10, user_note: "The twist floored me.", contains_spoilers: true, updated_at: "2026-11-20T12:00:00Z" }
  ]);

  assert.equal(agg.count, 3);
  assert.equal(agg.average, 8.7);
  assert.equal(agg.histogram[10], 1);
  assert.equal(agg.histogram[9], 1);
  assert.equal(agg.histogram[7], 1);
  assert.equal(agg.histogram[5], 0);
  assert.equal(agg.reviews.length, 2);
  assert.equal(agg.reviews[0].username, "carol");
  assert.equal(agg.reviews[0].contains_spoilers, true);
});

test("computeProfileTasteVector builds a 64-D unit vector from real watched films and excludes isSample", () => {
  const mkVec = (axis) => Array.from({ length: 64 }, (_, i) => (i === axis ? 1 : 0));
  const index = parseEmbeddingBinary(
    encodeEmbeddingBinary([
      { tmdbId: 101, vector: mkVec(0) },
      { tmdbId: 102, vector: mkVec(0) },
      { tmdbId: 103, vector: mkVec(1) },
      { tmdbId: 104, vector: mkVec(2) }
    ])
  );

  const watched = [
    { tmdbId: 101, title: "A", userRating: 10 },
    { tmdbId: 102, title: "B", userRating: 9 },
    { tmdbId: 103, title: "C", userRating: 6 },
    { tmdbId: 104, title: "Sample", userRating: 10, isSample: true }
  ];

  const vec = computeProfileTasteVector(watched, index);
  assert.equal(Array.isArray(vec), true);
  assert.equal(vec.length, 64);
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-3);
  assert.ok(vec[0] > 0.7);
  assert.equal(vec[2], 0);
});

test("pickUnseenFavoritesFromProfile filters to 8+ rated films not yet in viewer watched list", () => {
  const profileRatings = [
    { movie_key: "tmdb:1", tmdb_id: 1, title: "Watched Already", user_rating: 10 },
    { movie_key: "tmdb:2", tmdb_id: 2, title: "Unseen Masterpiece", user_rating: 10 },
    { movie_key: "tmdb:3", tmdb_id: 3, title: "Unseen Great", user_rating: 9 },
    { movie_key: "tmdb:4", tmdb_id: 4, title: "Unseen Mediocre", user_rating: 6 }
  ];
  const viewerWatched = [{ tmdbId: 1, title: "Watched Already", userRating: 9 }];

  const picks = pickUnseenFavoritesFromProfile(profileRatings, viewerWatched, 6);
  assert.deepEqual(picks.map((p) => p.title), ["Unseen Masterpiece", "Unseen Great"]);
});
