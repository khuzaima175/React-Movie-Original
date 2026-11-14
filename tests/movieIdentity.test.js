import test from "node:test";
import assert from "node:assert/strict";
import * as dashboardService from "../src/services/dashboardService.js";
import { removeMovieEntries, upsertMovieEntry } from "../src/services/movieIdentity.js";

test("buildSeenCollisionSet correlates tmdb_<id> entries without explicit tmdbId against tmdbId records", () => {
  const watched = [
    { imdbID: "tt0242653", tmdbId: 605, title: "The Matrix Revolutions", year: "2003" }
  ];
  const seen = dashboardService.buildSeenCollisionSet(watched, []);
  const routeOnlyKeys = [...dashboardService.buildSeenCollisionSet([{ imdbID: "tmdb_605" }], [])];
  assert.equal(routeOnlyKeys.some((k) => seen.has(k)), true);
});

test("dashboardService exposes canonical movie identity matching helpers for MovieDetails and AppContext", () => {
  assert.equal(typeof dashboardService.isSameMovie, "function");
  assert.equal(typeof dashboardService.findMatchingMovie, "function");
  assert.equal(typeof dashboardService.extractTmdbNumericId, "function");
});

test("findMatchingMovie matches /movie/tmdb_605 enriched MovieDetails state against watchlist entries saved as tt0242653", () => {
  assert.equal(typeof dashboardService.findMatchingMovie, "function");

  const watchlist = [
    {
      imdbID: "tt0242653",
      tmdbId: 605,
      title: "The Matrix Revolutions",
      year: "2003"
    }
  ];

  // Simulates MovieDetails on /movie/tmdb_605 after loading TMDB + OMDb metadata
  const movieDetailsTarget = {
    selectedId: "tmdb_605",
    imdbID: "tt0242653",
    tmdbId: 605,
    title: "The Matrix Revolutions",
    year: "2003"
  };

  const matched = dashboardService.findMatchingMovie(watchlist, movieDetailsTarget);
  assert.ok(matched);
  assert.equal(matched.imdbID, "tt0242653");

  // Also matches before enriched movie finishes loading when only selectedId is known
  const preLoadTarget = { selectedId: "tmdb_605" };
  assert.ok(dashboardService.findMatchingMovie(watchlist, preLoadTarget));
});

test("findMatchingMovie matches /movie/tmdb_605 against legacy watchlist items that only have tt0242653 (no tmdbId)", () => {
  assert.equal(typeof dashboardService.findMatchingMovie, "function");

  const watchlist = [
    {
      imdbID: "tt0242653",
      title: "The Matrix Revolutions",
      year: "2003"
    }
  ];

  const movieDetailsTarget = {
    selectedId: "tmdb_605",
    imdbID: "tt0242653",
    tmdbId: 605,
    title: "The Matrix Revolutions",
    year: "2003"
  };

  const matched = dashboardService.findMatchingMovie(watchlist, movieDetailsTarget);
  assert.ok(matched);
  assert.equal(matched.imdbID, "tt0242653");
});

test("isSameMovie matches tmdb_<id> stored items with enriched tt<id> payloads without colliding same-year distinct films", () => {
  assert.equal(typeof dashboardService.isSameMovie, "function");

  const homeWatchlistItem = {
    id: "tmdb_605",
    imdbID: "tmdb_605",
    tmdbId: 605,
    title: "The Matrix Revolutions",
    year: "2003"
  };
  const enrichedPayload = {
    imdbID: "tt0242653",
    tmdbId: 605,
    title: "The Matrix Revolutions",
    year: "2003"
  };

  assert.equal(dashboardService.isSameMovie(homeWatchlistItem, enrichedPayload), true);
  assert.equal(dashboardService.isSameMovie(homeWatchlistItem, "tt0242653"), false);
  assert.equal(dashboardService.isSameMovie(homeWatchlistItem, "tmdb_605"), true);
  assert.equal(dashboardService.isSameMovie(enrichedPayload, "tmdb_605"), true);
  assert.equal(dashboardService.isSameMovie(enrichedPayload, "tt0242653"), true);

  // Two distinct 2022 Pinocchio films must NOT match solely on title+year
  const delToro = { imdbID: "tt1488589", tmdbId: 555604, title: "Pinocchio", year: "2022" };
  const zemeckis = { imdbID: "tt4593060", tmdbId: 532639, title: "Pinocchio", year: "2022" };
  assert.equal(dashboardService.isSameMovie(delToro, zemeckis), false);
});

test("upsertMovieEntry merges and deduplicates tmdb_<id> and tt<id> representations in place", () => {
  const existing = [
    {
      id: "tmdb_605",
      imdbID: "tmdb_605",
      tmdbId: 605,
      title: "The Matrix Revolutions",
      year: "2003",
      userRating: 7
    },
    {
      imdbID: "tt0133093",
      tmdbId: 603,
      title: "The Matrix",
      year: "1999",
      userRating: 10
    }
  ];

  const enrichedUpdate = {
    imdbID: "tt0242653",
    tmdbId: 605,
    title: "The Matrix Revolutions",
    year: "2003",
    userRating: 8
  };

  const updated = upsertMovieEntry(existing, enrichedUpdate);
  assert.equal(updated.length, 2);
  assert.equal(updated[0].imdbID, "tt0242653");
  assert.equal(updated[0].tmdbId, 605);
  assert.equal(updated[0].userRating, 8);
  assert.equal(updated[1].imdbID, "tt0133093");
});

test("removeMovieEntries removes cross-ID watchlist/watched entries whether targeted by tmdb_<id> or merged movie object", () => {
  const savedFromMovieDetails = [
    {
      imdbID: "tt0242653",
      tmdbId: 605,
      title: "The Matrix Revolutions",
      year: "2003"
    },
    {
      imdbID: "tt0133093",
      tmdbId: 603,
      title: "The Matrix",
      year: "1999"
    }
  ];

  // Removing via tmdb_605 (e.g. Home/Search route) must still remove the tt0242653 entry
  const removedByTmdb = removeMovieEntries(savedFromMovieDetails, "tmdb_605");
  assert.equal(removedByTmdb.removed.length, 1);
  assert.equal(removedByTmdb.removed[0].imdbID, "tt0242653");
  assert.equal(removedByTmdb.nextList.length, 1);
  assert.equal(removedByTmdb.nextList[0].imdbID, "tt0133093");

  // Removing a tmdb_605 saved entry via an enriched MovieDetails payload must also remove it
  const savedFromHome = [
    {
      id: "tmdb_605",
      imdbID: "tmdb_605",
      tmdbId: 605,
      title: "The Matrix Revolutions",
      year: "2003"
    }
  ];
  const enrichedPayload = {
    imdbID: "tt0242653",
    tmdbId: 605,
    title: "The Matrix Revolutions",
    year: "2003"
  };
  const removedByObject = removeMovieEntries(savedFromHome, enrichedPayload);
  assert.equal(removedByObject.removed.length, 1);
  assert.equal(removedByObject.removed[0].imdbID, "tmdb_605");
  assert.equal(removedByObject.nextList.length, 0);
});
