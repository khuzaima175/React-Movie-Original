import test from "node:test";
import assert from "node:assert/strict";
import {
  getCanonicalMovieKey,
  mapLocalMovieToDbRow,
  mapDbRowToLocalMovie,
  mergeLocalAndCloudVault
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
