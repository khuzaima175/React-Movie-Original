import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBackupJsonPayload,
  buildRatingsCsv,
  parseJsonBackupContent,
  summarizeImportDiff,
  resolveCsvRowFallbackRecord
} from "../src/services/vaultPortability.js";
import { parseCSVImport } from "../src/services/csvImport.js";

test("buildBackupJsonPayload and buildRatingsCsv serialize rated films, TMDB IDs, and omit fake zeroes on Letterboxd export", () => {
  const watched = [
    { imdbID: "tmdb_157336", tmdbId: 157336, title: "Interstellar", year: "2014", userRating: 10, dateWatched: "2026-10-01T00:00:00.000Z" },
    { imdbID: "tt0111161", title: "Shawshank", year: "1994", userRating: 0 }
  ];
  const json = buildBackupJsonPayload({ watched, watchlist: [], userRegion: "US", userWatchProviders: [8], now: 1700000000000 });
  assert.equal(json.schemaVersion, 2);
  assert.equal(json.watched.length, 2);

  const fullCsv = buildRatingsCsv({ watched, watchlist: [], format: "cinemavault" });
  assert.match(fullCsv, /TMDB ID/);
  assert.match(fullCsv, /157336/);

  const lbCsv = buildRatingsCsv({ watched, watchlist: [], format: "letterboxd" });
  const lines = lbCsv.trim().split("\n");
  assert.equal(lines.length, 2);
});

test("parseJsonBackupContent accepts both v1/v2 objects and bare rating arrays", () => {
  const fromArray = parseJsonBackupContent(JSON.stringify([{ title: "Dune", year: "2021", userRating: 9 }]));
  assert.equal(fromArray.watched.length, 1);
  assert.equal(fromArray.watched[0].title, "Dune");

  const fromObj = parseJsonBackupContent(JSON.stringify({ watched: [{ imdbID: "tt1", title: "A", userRating: 8 }], watchlist: [] }));
  assert.equal(fromObj.watched.length, 1);
});

test("summarizeImportDiff supports add_new, merge_update, and replace modes deterministically", () => {
  const existingWatched = [{ imdbID: "tt1", title: "Film A", userRating: 6 }];
  const incomingWatched = [
    { imdbID: "tt1", title: "Film A", userRating: 9 },
    { imdbID: "tt2", title: "Film B", userRating: 8 }
  ];
  const mergeRes = summarizeImportDiff({
    existingWatched,
    existingWatchlist: [],
    incomingWatched,
    incomingWatchlist: [],
    mode: "merge_update"
  });
  assert.equal(mergeRes.newWatchedCount, 1);
  assert.equal(mergeRes.updatedRatingCount, 1);
  assert.equal(mergeRes.mergedWatched.find((m) => m.imdbID === "tt1").userRating, 9);
});

test("resolveCsvRowFallbackRecord never invents fake 5 or 7 ratings for unrated rows", () => {
  const unrated = resolveCsvRowFallbackRecord({ title: "Some Film", year: "2020", rating: null, type: "" });
  assert.equal(unrated.status, "watchlist");

  const explicitUnratedWatched = resolveCsvRowFallbackRecord({ title: "Watched Film", year: "2020", rating: null, type: "Watched" });
  assert.equal(explicitUnratedWatched.status, "watched");
  assert.equal(explicitUnratedWatched.record.userRating, 0);
});

test("parseCSVImport recognizes IMDb Const and Your Rating headers", () => {
  const csv = "Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres\ntt0111161,10,2026-05-01,The Shawshank Redemption,https://www.imdb.com/title/tt0111161/,movie,9.3,142,1994,Drama";
  const parsed = parseCSVImport(csv);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].imdbId, "tt0111161");
  assert.equal(parsed.rows[0].rating, 10);
});
