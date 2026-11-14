import test from "node:test";
import assert from "node:assert/strict";
import {
  mapTmdbSearchItem,
  mergeAndRankSearchResults,
  searchCatalogMovies,
  loadSearchTrendingPosters
} from "../src/services/searchService.js";

test("mapTmdbSearchItem converts TMDB result to unified search record with genres, backdrop, and score", () => {
  const item = mapTmdbSearchItem({
    id: 272,
    title: "Batman Begins",
    release_date: "2005-06-10",
    vote_average: 7.72,
    poster_path: "/4MpN4kIEqUjW8OPtOQJXlTdHiJV.jpg",
    backdrop_path: "/ew5FcYi4.jpg",
    genre_ids: [28, 80, 18],
    overview: "Driven by tragedy, billionaire Bruce Wayne..."
  });
  assert.equal(item.imdbID, "tmdb_272");
  assert.equal(item.tmdbId, 272);
  assert.equal(item.Title, "Batman Begins");
  assert.equal(item.Year, "2005");
  assert.equal(item.imdbRating, "7.7");
  assert.match(item.Poster, /w342/);
  assert.match(item.backdrop, /w780/);
  assert.match(item.genre, /Action/);
});

test("mergeAndRankSearchResults deduplicates TMDB and OMDb entries and annotates inVault / userRating", () => {
  const watched = [{ imdbID: "tt0372784", title: "Batman Begins", year: "2005", userRating: 9 }];
  const watchlist = [{ imdbID: "tmdb_414906", tmdbId: 414906, title: "The Batman", year: "2022" }];
  const merged = mergeAndRankSearchResults({
    query: "batman",
    tmdbResults: [
      { imdbID: "tmdb_272", tmdbId: 272, Title: "Batman Begins", Year: "2005", imdbRating: "7.7", popularity: 80 },
      { imdbID: "tmdb_414906", tmdbId: 414906, Title: "The Batman", Year: "2022", imdbRating: "7.8", popularity: 95 }
    ],
    omdbResults: [
      { imdbID: "tt0372784", Title: "Batman Begins", Year: "2005", Type: "movie", Poster: "https://ex/p.jpg" }
    ],
    watched,
    watchlist
  });
  assert.equal(merged.length, 2);
  const begins = merged.find((m) => m.Title === "Batman Begins");
  assert.equal(begins.inVault, true);
  assert.equal(begins.userRating, 9);
  const theBatman = merged.find((m) => m.Title === "The Batman");
  assert.equal(theBatman.inWatchlist, true);
});

test("searchCatalogMovies matches instant local vault hits, prefers TMDB, and falls back to OMDb when TMDB returns empty", async () => {
  const results = await searchCatalogMovies({
    query: "batman",
    watched: [{ imdbID: "tt0468569", title: "The Dark Knight", year: "2008", userRating: 10 }],
    watchlist: [],
    fetchTmdb: async () => ({ results: [] }),
    fetchOmdb: async () => ({
      Response: "True",
      Search: [{ imdbID: "tt0096895", Title: "Batman", Year: "1989", Type: "movie", Poster: "N/A" }]
    })
  });
  assert.equal(results.some((r) => r.Title === "Batman"), true);
});

test("searchCatalogMovies keeps local Vault hits cleanly and survives backend errors gracefully", async () => {
  const results = await searchCatalogMovies({
    query: "inter",
    watched: [{ imdbID: "tt0816692", title: "Interstellar", year: "2014", userRating: 10, poster: "p.jpg" }],
    watchlist: [],
    fetchTmdb: async () => { throw new Error("Network down"); },
    fetchOmdb: async () => { throw new Error("Rate limit"); }
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].Title, "Interstellar");
  assert.equal(results[0].inVault, true);
  assert.equal(results[0].userRating, 10);
});

test("loadSearchTrendingPosters returns fallback visual posters when TMDB is unavailable", async () => {
  const list = await loadSearchTrendingPosters({
    watched: [],
    watchlist: [],
    fetchTmdb: async () => null,
    limit: 8
  });
  assert.equal(list.length, 8);
  assert.ok(list.every((item) => item.Poster && item.Title));
});
