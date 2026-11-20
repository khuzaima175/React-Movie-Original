import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPLORE_FOR_YOU_TTL_MS,
  compactForYouItemForCache,
  loadExploreForYouCache,
  saveExploreForYouCache,
  clearExploreForYouCache
} from "../src/services/exploreForYouCache.js";

test("compactForYouItemForCache keeps card and Deep Filter fields while stripping heavy API blobs", () => {
  const full = {
    tmdbId: 2543164,
    imdbID: "tt2543164",
    title: "Arrival",
    year: "2016",
    poster: "https://image.tmdb.org/t/p/w500/arrival.jpg",
    genre: "Drama, Sci-Fi, Mystery",
    tmdbGenreIds: [18, 878, 9648],
    imdbRating: "7.9",
    vote_average: 7.9,
    vote_count: 17000,
    runtime: 116,
    original_language: "en",
    originCountry: ["US"],
    release_date: "2016-11-11",
    forYouScore: 97,
    vibeTag: "Cerebral Sci-Fi",
    forYouReason: "Matches your high ratings for quiet existential sci-fi.",
    overview: "Very long overview text that should not bloat cloud JSONB...",
    credits: { cast: [1, 2, 3] },
    videos: { results: [] }
  };

  const compact = compactForYouItemForCache(full);
  assert.equal(compact.tmdbId, 2543164);
  assert.equal(compact.forYouScore, 97);
  assert.equal(compact.vibeTag, "Cerebral Sci-Fi");
  assert.deepEqual(compact.tmdbGenreIds, [18, 878, 9648]);
  assert.equal("overview" in compact, false);
  assert.equal("credits" in compact, false);
  assert.equal("videos" in compact, false);
});

test("local explore For You cache round-trips without IndexedDB, respects profileHash, and expires after TTL", async () => {
  const now = 1_800_000_000_000;
  await clearExploreForYouCache();

  await saveExploreForYouCache({
    profileHash: "hash_a",
    items: [{ tmdbId: 101, title: "Film A", forYouScore: 95 }],
    source: "gemini-flash-lite",
    modelUsed: "gemini-3.5-flash-lite",
    generatedAt: now
  });

  const hit = await loadExploreForYouCache({ profileHash: "hash_a", now: now + 10_000 });
  assert.equal(hit?.from, "local");
  assert.equal(hit?.items?.length, 1);
  assert.equal(hit?.items?.[0]?.tmdbId, 101);

  const wrongHash = await loadExploreForYouCache({ profileHash: "hash_b", now: now + 10_000 });
  assert.equal(wrongHash, null);

  const expired = await loadExploreForYouCache({
    profileHash: "hash_a",
    now: now + EXPLORE_FOR_YOU_TTL_MS + 1000
  });
  assert.equal(expired, null);
});

test("Supabase cache reads on local miss, writes on save, and is strictly bypassed when hasSampleData is true", async () => {
  const now = 1_800_000_000_000;
  await clearExploreForYouCache();

  const calls = [];
  let cloudRow = {
    user_id: "u1",
    profile_hash: "hash_cloud",
    source: "gemini-flash-lite",
    model_used: "gemini-3.1-flash-lite",
    items: [{ tmdbId: 505, title: "Cloud Cached Film", forYouScore: 92 }],
    updated_at: new Date(now - 5000).toISOString()
  };

  const mockSupabase = {
    from(table) {
      calls.push({ op: "from", table });
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  calls.push({ op: "select" });
                  return { data: cloudRow, error: null };
                }
              };
            }
          };
        },
        upsert: async (payload) => {
          calls.push({ op: "upsert", payload });
          cloudRow = { ...payload, updated_at: new Date(now).toISOString() };
          return { error: null };
        }
      };
    }
  };

  // Sample vault MUST NEVER touch Supabase
  await saveExploreForYouCache({
    profileHash: "hash_sample",
    items: [{ tmdbId: 777, title: "Sample Pick", forYouScore: 90 }],
    source: "local-ranker",
    generatedAt: now,
    userId: "u1",
    hasSampleData: true,
    supabaseClient: mockSupabase
  });
  const sampleRead = await loadExploreForYouCache({
    profileHash: "hash_cloud",
    userId: "u1",
    hasSampleData: true,
    supabaseClient: mockSupabase,
    now
  });
  assert.equal(sampleRead, null);
  assert.equal(calls.length, 0, "Sample vault must never query or upsert Supabase");

  // Real authenticated vault reads cloud row on local miss and rehydrates local cache
  const cloudHit = await loadExploreForYouCache({
    profileHash: "hash_cloud",
    userId: "u1",
    hasSampleData: false,
    supabaseClient: mockSupabase,
    now
  });
  assert.equal(cloudHit?.from, "supabase");
  assert.equal(cloudHit?.items?.[0]?.tmdbId, 505);

  // Subsequent load hits local cache without another Supabase select
  const selectCountBefore = calls.filter((c) => c.op === "select").length;
  const localHit = await loadExploreForYouCache({
    profileHash: "hash_cloud",
    userId: "u1",
    hasSampleData: false,
    supabaseClient: mockSupabase,
    now: now + 1000
  });
  assert.equal(localHit?.from, "local");
  assert.equal(calls.filter((c) => c.op === "select").length, selectCountBefore);

  // Real authenticated save upserts compact items to Supabase
  await saveExploreForYouCache({
    profileHash: "hash_new",
    items: [{ tmdbId: 888, title: "Fresh Cloud Pick", forYouScore: 98, overview: "strip me" }],
    source: "gemini-flash-lite",
    modelUsed: "gemini-3.5-flash-lite",
    generatedAt: now,
    userId: "u1",
    hasSampleData: false,
    supabaseClient: mockSupabase
  });
  const upsertCall = calls.find((c) => c.op === "upsert");
  assert.ok(upsertCall);
  assert.equal(upsertCall.payload.profile_hash, "hash_new");
  assert.equal("overview" in upsertCall.payload.items[0], false);
});
