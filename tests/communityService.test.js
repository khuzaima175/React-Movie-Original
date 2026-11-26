import test from "node:test";
import assert from "node:assert/strict";
import {
  validateUsername,
  computeTasteTwinCompatibility,
  aggregateCommunityRatings,
  computeProfileTasteVector,
  pickUnseenFavoritesFromProfile,
  sortCommunityReviews,
  fetchFriendsActivityFeed,
  fetchCommunityDirectory,
  toggleReviewLike
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

test("sortCommunityReviews ranks higher Taste Match % first in 'taste' mode and highest likes first in 'likes' mode", () => {
  const viewerVec = [1, ...new Array(63).fill(0)];
  const profileVectorMap = new Map([
    ["u_twin", [0.95, ...new Array(63).fill(0)]],
    ["u_diff", [-0.8, ...new Array(63).fill(0)]]
  ]);
  const reviews = [
    { id: 1, user_id: "u_diff", user_note: "B", like_count: 10, updated_at: "2026-11-25T10:00:00Z" },
    { id: 2, user_id: "u_twin", user_note: "A", like_count: 1, updated_at: "2026-11-24T10:00:00Z" }
  ];
  const byTaste = sortCommunityReviews(reviews, { sortBy: "taste", viewerVector: viewerVec, profileVectorMap });
  assert.equal(byTaste[0].id, 2);
  assert.ok(byTaste[0].tasteMatchPct > byTaste[1].tasteMatchPct);

  const byLikes = sortCommunityReviews(reviews, { sortBy: "likes", viewerVector: viewerVec, profileVectorMap });
  assert.equal(byLikes[0].id, 1);
});

test("fetchFriendsActivityFeed returns followed users' recent ratings in descending order", async () => {
  const fakeSupabase = {
    from(table) {
      if (table === "user_follows") {
        return {
          select() {
            return {
              eq: async () => ({ data: [{ following_id: "u2" }], error: null })
            };
          }
        };
      }
      if (table === "community_ratings") {
        return {
          select() {
            return {
              in() {
                return {
                  order() {
                    return {
                      limit: async () => ({
                        data: [
                          { id: 10, user_id: "u2", username: "alex", title: "Arrival", user_rating: 9, updated_at: "2026-11-25T12:00:00Z" }
                        ],
                        error: null
                      })
                    };
                  }
                };
              }
            };
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };
  const res = await fetchFriendsActivityFeed("u1", { limit: 10 }, { supabaseClient: fakeSupabase });
  assert.equal(res.status, "ok");
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].username, "alex");
  assert.deepEqual(res.followingIds, ["u2"]);
});

test("fetchCommunityDirectory scores members by Taste Twin compatibility and toggleReviewLike writes own row", async () => {
  const viewerVec = [1, ...new Array(63).fill(0)];
  const fakeSupabase = {
    from(table) {
      if (table === "public_profiles") {
        const chain = {
          or() { return chain; },
          order() { return chain; },
          limit: async () => ({
            data: [
              { user_id: "u_other", username: "other", taste_vector: [-0.9, ...new Array(63).fill(0)], watched_count: 50 },
              { user_id: "u_twin", username: "twin", taste_vector: [0.99, ...new Array(63).fill(0)], watched_count: 25 }
            ],
            error: null
          })
        };
        return { select: () => chain };
      }
      if (table === "community_review_likes") {
        return {
          insert: async () => ({ error: null }),
          delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) })
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };

  const dir = await fetchCommunityDirectory({ viewerVector: viewerVec }, { supabaseClient: fakeSupabase });
  assert.equal(dir.status, "ok");
  assert.equal(dir.profiles[0].username, "twin");
  assert.ok(dir.profiles[0].tasteTwin.matchPct >= 90);

  const liked = await toggleReviewLike({ userId: "u1", ratingId: 10, currentlyLiked: false }, { supabaseClient: fakeSupabase });
  assert.equal(liked.ok, true);
  assert.equal(liked.isLiked, true);
});
