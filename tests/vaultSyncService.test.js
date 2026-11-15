import test from "node:test";
import assert from "node:assert/strict";
import {
  getCanonicalMovieKey,
  mapLocalMovieToDbRow,
  mapDbRowToLocalMovie,
  mergeLocalAndCloudVault,
  fetchAllVaultRows,
  pullAndSyncCloudVault
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
