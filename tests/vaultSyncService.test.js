import test from "node:test";
import assert from "node:assert/strict";
import {
  compactVaultListForStorage,
  compactVaultMovieForStorage,
  getCanonicalMovieKey,
  mapLocalMovieToDbRow,
  mapDbRowToLocalMovie,
  mergeLocalAndCloudVault,
  fetchAllVaultRows,
  pullAndSyncCloudVault,
  mergeProfilePreferences,
  pullAndSyncProfilePreferences
} from "../src/services/vaultSyncService.js";

test("mapLocalMovieToDbRow and mapDbRowToLocalMovie round-trip ratings, notes, and recommendation metadata losslessly", () => {
  const movie = {
    imdbID: "tmdb_157336",
    tmdbId: 157336,
    title: "Interstellar",
    year: "2014",
    poster: "https://image.tmdb.org/t/p/w500/p.jpg",
    genre: "Sci-Fi, Drama",
    director: "Christopher Nolan",
    runtime: 169,
    imdbRating: 8.7,
    userRating: 10,
    userNote: "Theater IMAX rewatch",
    dateWatched: "2026-10-15T12:00:00.000Z",
    castIds: [10297],
    tmdbGenreIds: [878, 18],
    tmdbKeywords: [1432]
  };
  const dbRow = mapLocalMovieToDbRow(movie, "watched", "user-123", "2026-11-14T01:00:00.000Z");
  assert.equal(dbRow.movie_key, "tmdb_157336");
  assert.equal(dbRow.status, "watched");
  assert.equal(dbRow.user_rating, 10);
  assert.deepEqual(dbRow.metadata.tmdbKeywords, [1432]);

  const restored = mapDbRowToLocalMovie(dbRow);
  assert.equal(restored.imdbID, "tmdb_157336");
  assert.equal(restored.userRating, 10);
  assert.equal(restored.userNote, "Theater IMAX rewatch");
  assert.deepEqual(restored.castIds, [10297]);
});

test("mergeLocalAndCloudVault preserves guest local ratings, gives watched precedence over watchlist, and queues cloud upserts", () => {
  const localWatched = [
    { imdbID: "tt0111161", title: "Shawshank", userRating: 9, updatedAt: "2026-11-14T02:00:00.000Z" },
    { imdbID: "tmdb_272", tmdbId: 272, title: "Batman Begins", userRating: 8 }
  ];
  const localWatchlist = [
    { imdbID: "tt0133093", title: "The Matrix" }
  ];
  const cloudRows = [
    { movie_key: "tt0111161", imdb_id: "tt0111161", status: "watched", title: "Shawshank", user_rating: 7, metadata: {}, updated_at: "2026-11-10T00:00:00.000Z" },
    { movie_key: "tt0133093", imdb_id: "tt0133093", status: "watched", title: "The Matrix", user_rating: 10, metadata: {}, updated_at: "2026-11-12T00:00:00.000Z" },
    { movie_key: "tmdb_550", tmdb_id: 550, imdb_id: "tmdb_550", status: "watchlist", title: "Fight Club", metadata: {}, updated_at: "2026-11-11T00:00:00.000Z" }
  ];

  const merged = mergeLocalAndCloudVault({ localWatched, localWatchlist, cloudRows });
  assert.equal(merged.mergedWatched.length, 3);
  assert.equal(merged.mergedWatched.find((m) => m.imdbID === "tt0111161").userRating, 9);
  assert.equal(merged.mergedWatchlist.some((m) => m.imdbID === "tt0133093"), false);
  assert.equal(merged.mergedWatchlist.some((m) => m.imdbID === "tmdb_550"), true);
  const upsertKeys = merged.toUpsertCloud.map((r) => r.movie_key);
  assert.ok(upsertKeys.includes("tmdb_272"));
  assert.ok(upsertKeys.includes("tt0111161"));
});

test("getCanonicalMovieKey falls back predictably across imdbID, tmdbId, and id", () => {
  assert.equal(getCanonicalMovieKey({ imdbID: "tt0111161", tmdbId: 278 }), "tt0111161");
  assert.equal(getCanonicalMovieKey({ tmdbId: 278 }), "tmdb_278");
  assert.equal(getCanonicalMovieKey({ id: "custom_1" }), "custom_1");
});

test("mergeLocalAndCloudVault does not let cloud row overwrite an untimestamped local rating", () => {
  const localWatched = [
    { imdbID: "tt0468569", title: "The Dark Knight", userRating: 9 }
  ];
  const cloudRows = [
    {
      movie_key: "tt0468569",
      imdb_id: "tt0468569",
      status: "watched",
      title: "The Dark Knight",
      user_rating: 6,
      metadata: {},
      updated_at: "2026-11-10T00:00:00.000Z"
    }
  ];

  const merged = mergeLocalAndCloudVault({
    localWatched,
    localWatchlist: [],
    cloudRows,
    userId: "user-1"
  });

  const dk = merged.mergedWatched.find((m) => m.imdbID === "tt0468569");
  assert.equal(dk.userRating, 9);
  assert.ok(merged.toUpsertCloud.some((row) => row.movie_key === "tt0468569" && row.user_rating === 9));
});

test("mapLocalMovieToDbRow sanitizes invalid timestamps, fractional tmdbId, and overflowing imdbRating", () => {
  const dirtyMovie = {
    imdbID: "tt0068646",
    tmdbId: "238.5",
    title: "The Godfather",
    year: "1972",
    imdbRating: "105.4",
    userRating: 10,
    dateWatched: "N/A",
    updatedAt: "not-a-valid-iso-date"
  };

  const nowIso = "2026-11-14T03:20:00.000Z";
  const row = mapLocalMovieToDbRow(dirtyMovie, "watched", "user-123", nowIso);

  assert.equal(row.date_watched, null);
  assert.equal(row.updated_at, nowIso);
  assert.equal(row.tmdb_id, null);
  assert.equal(row.imdb_rating, null);

  const validDated = mapLocalMovieToDbRow(
    { imdbID: "tt0068646", tmdbId: 238, title: "The Godfather", imdbRating: "9.24", dateWatched: "2026-11-01" },
    "watched",
    "user-123",
    nowIso
  );
  assert.equal(validDated.date_watched, "2026-11-01T00:00:00.000Z");
  assert.equal(validDated.tmdb_id, 238);
  assert.equal(validDated.imdb_rating, 9.2);
});


test("vaultSyncService preserves recSource provenance in metadata JSONB and across cloud merges", () => {
  const recSource = { shownAt: "2026-11-14T11:00:00.000Z", matchScore: 93, mood: "dark-thriller", rank: 2 };
  const localWatched = [
    {
      imdbID: "tt0114369",
      tmdbId: 807,
      title: "Se7en",
      year: "1995",
      userRating: 9,
      updatedAt: "2026-11-14T11:05:00.000Z",
      recSource
    }
  ];

  const dbRow = mapLocalMovieToDbRow(localWatched[0], "watched", "user-1", "2026-11-14T11:05:00.000Z");
  assert.deepEqual(dbRow.metadata.recSource, recSource);
  assert.deepEqual(mapDbRowToLocalMovie(dbRow).recSource, recSource);

  // Even if cloud row is newer without recSource, local recSource is preserved during merge
  const cloudWithoutRecSource = [
    {
      ...dbRow,
      updated_at: "2026-11-14T12:00:00.000Z",
      metadata: { ...dbRow.metadata, recSource: undefined }
    }
  ];
  const merged = mergeLocalAndCloudVault({
    localWatched,
    localWatchlist: [],
    cloudRows: cloudWithoutRecSource,
    userId: "user-1"
  });
  assert.deepEqual(merged.mergedWatched[0].recSource, recSource);
});

function createKeysetVaultMockClient(totalRows = 2300, { failOnPage = null } = {}) {
  const allDbRows = Array.from({ length: totalRows }, (_, i) => {
    const id = i + 1;
    const tmdbId = 100000 + id;
    return {
      id,
      user_id: "user-123",
      movie_key: `tmdb_${tmdbId}`,
      status: "watched",
      user_rating: (id % 10) + 1,
      title: `Film ${id}`,
      year: "2020",
      tmdb_id: tmdbId,
      poster: "N/A",
      updated_at: "2026-11-01T00:00:00.000Z"
    };
  });

  const pageQueries = [];
  const upsertCalls = [];

  const client = {
    pageQueries,
    upsertCalls,
    from(table) {
      assert.equal(table, "user_vault_items");
      const queryState = { userId: null, orderCol: null, ascending: null, gtCol: null, gtVal: null, limitVal: null };

      const builder = {
        select(cols) {
          assert.equal(cols, "*");
          return builder;
        },
        eq(col, val) {
          if (col === "user_id") queryState.userId = val;
          return builder;
        },
        order(col, opts) {
          queryState.orderCol = col;
          queryState.ascending = opts?.ascending;
          return builder;
        },
        gt(col, val) {
          queryState.gtCol = col;
          queryState.gtVal = val;
          return builder;
        },
        limit(val) {
          queryState.limitVal = val;
          const pageIndex = pageQueries.length + 1;
          pageQueries.push({ pageIndex, ...queryState });

          if (failOnPage === pageIndex) {
            return Promise.resolve({
              data: null,
              error: new Error(`Simulated Supabase failure on page ${pageIndex}`)
            });
          }

          assert.equal(queryState.orderCol, "id");
          assert.equal(queryState.ascending, true);
          assert.equal(queryState.gtCol, "id");
          assert.equal(queryState.limitVal, 1000);

          const filtered = allDbRows
            .filter((r) => (queryState.userId ? r.user_id === queryState.userId : true) && r.id > queryState.gtVal)
            .slice(0, queryState.limitVal);

          return Promise.resolve({ data: filtered, error: null });
        },
        upsert(chunk, opts) {
          upsertCalls.push({ chunk, opts });
          return Promise.resolve({ data: chunk, error: null });
        }
      };

      return builder;
    }
  };

  return client;
}

test("fetchAllVaultRows paginates 2,300 rows using id keyset pagination until an empty page", async () => {
  const client = createKeysetVaultMockClient(2300);

  const rows = await fetchAllVaultRows(client, "user-123");
  assert.equal(rows.length, 2300);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[2299].id, 2300);
  assert.deepEqual(
    client.pageQueries.map((q) => q.gtVal),
    [0, 1000, 2000, 2300],
    "must pull pages 1..3 (1000, 1000, 300) and stop on empty page 4"
  );

  // Also works when called directly as fetchAllVaultRows(client) without userId
  const clientDirect = createKeysetVaultMockClient(2300);
  const directRows = await fetchAllVaultRows(clientDirect);
  assert.equal(directRows.length, 2300);
  assert.equal(directRows[0].id, 1);
  assert.equal(directRows[2299].id, 2300);
});

test("pullAndSyncCloudVault aborts without merging or upserting when page 2 fails", async () => {
  const client = createKeysetVaultMockClient(2300, { failOnPage: 2 });
  let mergeCalls = 0;
  let onMergedCalls = 0;

  await assert.rejects(
    () =>
      pullAndSyncCloudVault(client, {
        userId: "user-123",
        localWatched: [{ imdbID: "tmdb_1", tmdbId: 1, userRating: 9, title: "Local Film" }],
        localWatchlist: [],
        mergeFn: (...args) => {
          mergeCalls += 1;
          return mergeLocalAndCloudVault(...args);
        },
        onMerged: () => {
          onMergedCalls += 1;
        }
      }),
    /Simulated Supabase failure on page 2/
  );

  assert.equal(client.pageQueries.length, 2, "must halt pagination on page 2 error");
  assert.equal(mergeCalls, 0, "must skip mergeLocalAndCloudVault on any page error");
  assert.equal(onMergedCalls, 0, "must skip updating local state on any page error");
  assert.equal(client.upsertCalls.length, 0, "must skip all cloud upserts on any page error");
});

test("mergeLocalAndCloudVault never resurrects cleared ratingBreakdown or watchMeta from older cloudRow and skips null metadata", () => {
  const localNewer = {
    imdbID: "tt0816692",
    tmdbId: 157336,
    title: "Interstellar",
    userRating: 9,
    userNote: "",
    updatedAt: "2026-11-15T14:00:00.000Z"
  };

  const olderCloudRow = {
    user_id: "u1",
    movie_key: "tt0816692",
    status: "watched",
    title: "Interstellar",
    user_rating: 9,
    user_note: "Old note",
    updated_at: "2026-11-10T10:00:00.000Z",
    metadata: {
      imdbID: "tt0816692",
      tmdbId: 157336,
      director: "Christopher Nolan",
      ratingBreakdown: { story: 5, visuals: 5 },
      watchMeta: { format: "imax", containsSpoilers: true }
    }
  };

  const { mergedWatched, toUpsertCloud } = mergeLocalAndCloudVault({
    localWatched: [localNewer],
    localWatchlist: [],
    cloudRows: [olderCloudRow],
    userId: "u1",
    nowIso: "2026-11-15T14:01:00.000Z"
  });

  assert.equal(mergedWatched.length, 1);
  assert.equal(mergedWatched[0].director, "Christopher Nolan");
  assert.equal(mergedWatched[0].userNote, "");
  assert.equal("ratingBreakdown" in mergedWatched[0], false);
  assert.equal("watchMeta" in mergedWatched[0], false);
  assert.equal("ratingBreakdown" in toUpsertCloud[0].metadata, false);
  assert.equal("watchMeta" in toUpsertCloud[0].metadata, false);

  const nullStrippedRow = mapLocalMovieToDbRow(
    { ...localNewer, ratingBreakdown: null, watchMeta: undefined },
    "watched",
    "u1"
  );
  assert.equal("ratingBreakdown" in nullStrippedRow.metadata, false);
  assert.equal("watchMeta" in nullStrippedRow.metadata, false);
});

test("mergeLocalAndCloudVault prevents multi-device deleted films from resurrecting via lastSyncedAt and deletedKeys tombstones", () => {
  // Scenario A: Device B synced at 10:00Z. Movie X (updated 09:00Z) was deleted on Device A at 11:00Z.
  // Movie Y (updated 11:30Z) was newly added offline on Device B after lastSyncedAt.
  const deviceBWatched = [
    { imdbID: "tt0133093", title: "The Matrix", userRating: 9, updatedAt: "2026-11-15T09:00:00.000Z" },
    { imdbID: "tt0816692", title: "Interstellar", userRating: 10, updatedAt: "2026-11-15T11:30:00.000Z" }
  ];
  const deviceBWatchlist = [
    { imdbID: "tt0111161", title: "Shawshank", updatedAt: "2026-11-15T08:00:00.000Z" }
  ];

  const mergedRemoteDelete = mergeLocalAndCloudVault({
    localWatched: deviceBWatched,
    localWatchlist: deviceBWatchlist,
    cloudRows: [],
    userId: "u1",
    lastSyncedAt: "2026-11-15T10:00:00.000Z",
    nowIso: "2026-11-15T12:00:00.000Z"
  });

  assert.deepEqual(
    mergedRemoteDelete.mergedWatched.map((m) => m.imdbID),
    ["tt0816692"],
    "must drop tt0133093 (older than lastSyncedAt and missing from cloud) while keeping newer offline addition tt0816692"
  );
  assert.equal(mergedRemoteDelete.mergedWatchlist.length, 0, "must drop remotely deleted watchlist item older than lastSyncedAt");
  assert.deepEqual(mergedRemoteDelete.toUpsertCloud.map((r) => r.movie_key), ["tt0816692"]);

  // Scenario B: Local tombstone in `deletedKeys` suppresses stale cloud row and emits `toDeleteCloud`
  const cloudRowsWithDeleted = [
    {
      movie_key: "tt0068646",
      imdb_id: "tt0068646",
      status: "watched",
      title: "The Godfather",
      user_rating: 10,
      updated_at: "2026-11-15T10:00:00.000Z",
      metadata: {}
    }
  ];
  const mergedTombstone = mergeLocalAndCloudVault({
    localWatched: [],
    localWatchlist: [],
    cloudRows: cloudRowsWithDeleted,
    userId: "u1",
    deletedKeys: { tt0068646: "2026-11-15T11:00:00.000Z" }
  });
  assert.equal(mergedTombstone.mergedWatched.length, 0);
  assert.deepEqual(mergedTombstone.toDeleteCloud, ["tt0068646"]);
});

test("compactVaultMovieForStorage and compactVaultListForStorage shrink 2,300+ film vaults while retaining all ranker & studio fields", () => {
  const bloatedMovie = {
    imdbID: "tt0816692",
    tmdbId: 157336,
    title: "Interstellar",
    Title: "Interstellar",
    year: "2014",
    Year: "2014",
    poster: "https://image.tmdb.org/t/p/w500/p.jpg",
    Poster: "https://image.tmdb.org/t/p/w500/p.jpg",
    genre: "Sci-Fi, Drama",
    Genre: "Sci-Fi, Drama",
    director: "Christopher Nolan",
    Director: "Christopher Nolan",
    runtime: 169,
    Runtime: 169,
    userRating: 10,
    userNote: "Masterpiece",
    ratingBreakdown: { story: 5, visuals: 5 },
    watchMeta: { format: "imax" },
    recSource: { shownAt: "2026-11-15T00:00:00Z", matchScore: 95, mood: "any", rank: 1, pipeline: "gemini" },
    overview: "A".repeat(900),
    Plot: "A".repeat(900),
    tmdbGenreIds: [878, 18],
    tmdbKeywords: Array.from({ length: 45 }, (_, i) => i + 1),
    keywordNames: Array.from({ length: 30 }, (_, i) => `kw_${i}`),
    castIds: Array.from({ length: 25 }, (_, i) => 1000 + i),
    crewPersonId: 525,
    credits: { cast: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Actor ${i}` })) },
    videos: { results: [{ key: "abc" }] }
  };

  const standard = compactVaultMovieForStorage(bloatedMovie, { aggressive: false });
  assert.equal("Title" in standard, false);
  assert.equal("Plot" in standard, false);
  assert.equal("credits" in standard, false);
  assert.equal("videos" in standard, false);
  assert.ok(standard.overview.length <= 260);
  assert.equal(standard.tmdbKeywords.length, 20);
  assert.equal(standard.castIds.length, 10);
  assert.equal(standard.crewPersonId, 525);
  assert.deepEqual(standard.ratingBreakdown, { story: 5, visuals: 5 });

  const aggressive = compactVaultListForStorage([bloatedMovie], { aggressive: true })[0];
  assert.equal("overview" in aggressive, false);
  assert.equal(aggressive.userRating, 10);
  assert.equal(aggressive.userNote, "Masterpiece");
  assert.equal(aggressive.tmdbKeywords.length, 20);
  assert.equal(aggressive.castIds.length, 10);
});

test("isSample survives a local → DB row → local round trip", () => {
  const sampleMovie = {
    imdbID: "tt0816692",
    tmdbId: 157336,
    title: "Interstellar",
    year: "2014",
    userRating: 10,
    isSample: true
  };
  const dbRow = mapLocalMovieToDbRow(sampleMovie, "watched", "user-123");
  const restored = mapDbRowToLocalMovie(dbRow);
  assert.equal(restored.isSample, true);
});

test("mergeLocalAndCloudVault excludes isSample items so sample vaults never sync to Supabase", () => {
  const localWatched = [
    { imdbID: "tt0816692", title: "Interstellar", userRating: 10, isSample: true },
    { imdbID: "tt0133093", title: "The Matrix", userRating: 9 }
  ];
  const localWatchlist = [
    { imdbID: "tt0114369", title: "Se7en", isSample: true }
  ];

  const merged = mergeLocalAndCloudVault({
    localWatched,
    localWatchlist,
    cloudRows: [],
    userId: "user-123"
  });

  assert.deepEqual(
    merged.mergedWatched.map((m) => m.imdbID),
    ["tt0133093"]
  );
  assert.equal(merged.mergedWatchlist.length, 0);
  assert.deepEqual(
    merged.toUpsertCloud.map((row) => row.movie_key),
    ["tt0133093"]
  );
});

test("mergeProfilePreferences preserves local non-default region/providers/tasteRules on first sign-in and adopts cloud values when local is default", () => {
  const firstSignIn = mergeProfilePreferences({
    local: {
      displayName: "",
      userRegion: "US",
      userWatchProviders: [8],
      tasteRules: [{ id: "r1", text: "No horror", polarity: "avoid", active: true }]
    },
    cloud: {
      display_name: "Alex",
      user_region: "GLOBAL",
      preferred_providers: [],
      taste_rules: [],
      updated_at: "2026-11-19T00:00:00Z"
    },
    lastSyncedAt: null
  });
  assert.equal(firstSignIn.displayName, "Alex");
  assert.equal(firstSignIn.userRegion, "US");
  assert.deepEqual(firstSignIn.userWatchProviders, [8]);
  assert.equal(firstSignIn.tasteRules.length, 1);
  assert.equal(firstSignIn.shouldUpsertCloud, true);

  const freshDevice = mergeProfilePreferences({
    local: { displayName: "", userRegion: "GLOBAL", userWatchProviders: [], tasteRules: [] },
    cloud: {
      display_name: "Alex",
      user_region: "GB",
      preferred_providers: [8, 9],
      taste_rules: [{ id: "r2", text: "Prefer neo-noir", polarity: "prefer", active: true }],
      updated_at: "2026-11-20T00:00:00Z"
    },
    lastSyncedAt: null
  });
  assert.equal(freshDevice.displayName, "Alex");
  assert.equal(freshDevice.userRegion, "GB");
  assert.deepEqual(freshDevice.userWatchProviders, [8, 9]);
  assert.equal(freshDevice.tasteRules.length, 1);
  assert.equal(freshDevice.shouldUpsertCloud, false);
});

test("pullAndSyncProfilePreferences fetches cloud profile and upserts when local has richer preferences", async () => {
  let upserted = null;
  const mockSupabase = {
    from(table) {
      assert.equal(table, "profiles");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "u1",
                display_name: "Khuzaima",
                user_region: "GLOBAL",
                preferred_providers: [],
                taste_rules: [],
                updated_at: "2026-11-19T00:00:00Z"
              },
              error: null
            })
          })
        }),
        upsert: async (payload) => {
          upserted = payload;
          return { error: null };
        }
      };
    }
  };

  const result = await pullAndSyncProfilePreferences(mockSupabase, {
    userId: "u1",
    localPrefs: {
      displayName: "",
      userRegion: "US",
      userWatchProviders: [8, 337],
      tasteRules: [{ id: "r1", text: "Prefer slow-burn thrillers", polarity: "prefer", active: true }]
    },
    lastSyncedAt: null
  });

  assert.equal(result.displayName, "Khuzaima");
  assert.equal(result.userRegion, "US");
  assert.deepEqual(result.userWatchProviders, [8, 337]);
  assert.equal(result.tasteRules.length, 1);
  assert.ok(upserted);
  assert.equal(upserted.user_region, "US");
  assert.equal(upserted.taste_rules.length, 1);
});

test("mergeProfilePreferences honors intentional local clears (empty providers/rules/GLOBAL) when localPrefsUpdatedAt > cloud.updated_at", () => {
  const cleared = mergeProfilePreferences({
    local: {
      displayName: "Alex",
      userRegion: "GLOBAL",
      userWatchProviders: [],
      tasteRules: []
    },
    cloud: {
      display_name: "Alex",
      user_region: "US",
      preferred_providers: [8, 9],
      taste_rules: [{ id: "r1", text: "No horror", polarity: "avoid", active: true }],
      updated_at: "2026-11-20T10:00:00.000Z"
    },
    lastSyncedAt: "2026-11-20T10:00:00.000Z",
    localPrefsUpdatedAt: "2026-11-20T10:05:00.000Z"
  });

  assert.equal(cleared.userRegion, "GLOBAL");
  assert.deepEqual(cleared.userWatchProviders, []);
  assert.deepEqual(cleared.tasteRules, []);
  assert.equal(cleared.shouldUpsertCloud, true);
});
