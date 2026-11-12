import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCSVLine,
  parseRating,
  parseImportDate,
  parseCSVImport,
  buildQuickAddWatchedMovie,
  buildBulkMoveWatchedItem,
  buildWatchedRecordFromImport
} from "../src/services/csvImport.js";

const NOW = Date.UTC(2026, 10, 12, 20, 0, 0); // 2026-11-12T20:00:00.000Z

test("parseCSVImport parses Letterboxd ratings.csv with logged dateSource and excludes URI from note", () => {
  const sixHoursAheadIso = new Date(NOW + 6 * 3600000).toISOString();
  const threeDaysAheadIso = new Date(NOW + 3 * 86400000).toISOString();

  const csv = [
    "Date,Name,Year,Letterboxd URI,Rating",
    "2024-03-15,Inception,2010,https://boxd.it/1234,4.5",
    `${sixHoursAheadIso},Arrival,2016,https://boxd.it/5678,5`,
    `${threeDaysAheadIso},Future Film,2026,https://boxd.it/9999,4`,
    "2026-02-30,Rollover Film,2026,https://boxd.it/2222,3.5",
    ",Empty Date Film,2020,https://boxd.it/3333,4"
  ].join("\n");

  const { rows } = parseCSVImport(csv, { now: NOW });
  assert.equal(rows.length, 5);

  const inception = rows[0];
  assert.equal(inception.title, "Inception");
  assert.equal(inception.year, "2010");
  assert.equal(inception.rating, 9);
  assert.equal(inception.note, "");
  assert.ok(!inception.note.includes("boxd.it"));
  assert.equal(inception.dateWatched, "2024-03-15T00:00:00.000Z");
  assert.equal(inception.dateSource, "logged");

  const arrival = rows[1];
  assert.equal(arrival.dateWatched, sixHoursAheadIso);
  assert.equal(arrival.dateSource, "logged");

  const futureFilm = rows[2];
  assert.equal(futureFilm.dateWatched, undefined);
  assert.equal(futureFilm.dateSource, undefined);

  const rolloverFilm = rows[3];
  assert.equal(rolloverFilm.dateWatched, undefined);
  assert.equal(rolloverFilm.dateSource, undefined);

  const emptyDateFilm = rows[4];
  assert.equal(emptyDateFilm.dateWatched, undefined);
  assert.equal(emptyDateFilm.dateSource, undefined);
});

test("parseCSVImport parses Letterboxd diary.csv preferring Watched Date over Date and rejecting invalid Watched Date", () => {
  const csv = [
    "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date",
    "2024-06-10,Dune: Part Two,2024,https://boxd.it/dune2,4.5,Yes,imax,2024-05-01",
    "2024-06-11,Old Logged Only,2001,https://boxd.it/old,4,,,",
    "2024-06-12,Bad Watched Date,2026,https://boxd.it/bad,3,,,2026-02-30",
    "2024-06-13,Too Far Future,2026,https://boxd.it/fut,3,,,2026-11-16"
  ].join("\n");

  const { rows } = parseCSVImport(csv, { now: NOW });
  assert.equal(rows.length, 4);

  assert.equal(rows[0].title, "Dune: Part Two");
  assert.equal(rows[0].rating, 9);
  assert.equal(rows[0].note, "");
  assert.equal(rows[0].dateWatched, "2024-05-01T00:00:00.000Z");
  assert.equal(rows[0].dateSource, "watched");

  // Empty Watched Date falls back to Date -> "logged"
  assert.equal(rows[1].dateWatched, "2024-06-11T00:00:00.000Z");
  assert.equal(rows[1].dateSource, "logged");

  // Invalid Watched Date is rejected rather than silently using Date
  assert.equal(rows[2].dateWatched, undefined);
  assert.equal(rows[2].dateSource, undefined);

  // >24h future Watched Date is rejected
  assert.equal(rows[3].dateWatched, undefined);
  assert.equal(rows[3].dateSource, undefined);
});

test("parseCSVImport leaves dateWatched unset on undated CSVs and preserves headerless (0,1,2,3) note layout", () => {
  const datedlessRecognized = [
    "Name,Year,Letterboxd URI,Rating",
    "Drive,2011,https://boxd.it/drive,4"
  ].join("\n");

  const res1 = parseCSVImport(datedlessRecognized, { now: NOW });
  assert.equal(res1.rows.length, 1);
  assert.equal(res1.rows[0].title, "Drive");
  assert.equal(res1.rows[0].rating, 8);
  assert.equal(res1.rows[0].note, "");
  assert.equal(res1.rows[0].dateWatched, undefined);
  assert.equal(res1.rows[0].dateSource, undefined);

  const headerless = [
    "Col0,Col1,Col2,Col3",
    "The Matrix,1999,5,Classic cyber thriller"
  ].join("\n");

  const res2 = parseCSVImport(headerless, { now: NOW });
  assert.equal(res2.rows.length, 1);
  assert.equal(res2.rows[0].title, "The Matrix");
  assert.equal(res2.rows[0].year, "1999");
  assert.equal(res2.rows[0].rating, 10);
  assert.equal(res2.rows[0].note, "Classic cyber thriller");
  assert.equal(res2.rows[0].dateWatched, undefined);
  assert.equal(res2.rows[0].dateSource, undefined);
});

test("parseImportDate handles strict calendar dates and 24h tolerance edge cases", () => {
  assert.equal(parseImportDate("2024-02-29", NOW), "2024-02-29T00:00:00.000Z");
  assert.equal(parseImportDate("2025-02-29", NOW), null);
  assert.equal(parseImportDate("2026-02-30", NOW), null);
  assert.equal(parseImportDate("2026-04-31", NOW), null);
  assert.equal(parseImportDate("", NOW), null);
  assert.equal(parseImportDate("not-a-date", NOW), null);
  assert.equal(parseImportDate(new Date(NOW + 6 * 3600000).toISOString(), NOW), new Date(NOW + 6 * 3600000).toISOString());
  assert.equal(parseImportDate(new Date(NOW + 86400000).toISOString(), NOW), new Date(NOW + 86400000).toISOString());
  assert.equal(parseImportDate(new Date(NOW + 86400001).toISOString(), NOW), null);
  assert.equal(parseImportDate(new Date(NOW + 3 * 86400000).toISOString(), NOW), null);
});

test("buildQuickAddWatchedMovie sets dateWatched when userRating > 0 and no dateWatched exists", () => {
  const fixedNow = Date.UTC(2026, 10, 12, 12, 0, 0);
  const expectedIso = new Date(fixedNow).toISOString();

  const ratedAdd = buildQuickAddWatchedMovie({ id: "tt1", title: "Heat", year: "1995", userRating: 9 }, fixedNow);
  assert.equal(ratedAdd.dateWatched, expectedIso);

  const existingDate = buildQuickAddWatchedMovie({
    id: "tt2",
    title: "Thief",
    year: "1981",
    userRating: 8,
    dateWatched: "2024-01-10T00:00:00.000Z"
  }, fixedNow);
  assert.equal(existingDate.dateWatched, "2024-01-10T00:00:00.000Z");

  const unratedAdd = buildQuickAddWatchedMovie({ id: "tt3", title: "Unrated", year: "2024", userRating: 0 }, fixedNow);
  assert.equal(unratedAdd.dateWatched, undefined);
});

test("buildBulkMoveWatchedItem sets dateWatched when moving watchlist items into watched", () => {
  const fixedNow = Date.UTC(2026, 10, 12, 12, 0, 0);
  const expectedIso = new Date(fixedNow).toISOString();

  const moved = buildBulkMoveWatchedItem({ imdbID: "tt10", title: "Stalker", year: "1979" }, fixedNow);
  assert.equal(moved.dateWatched, expectedIso);

  const alreadyDated = buildBulkMoveWatchedItem({
    imdbID: "tt11",
    title: "Solaris",
    year: "1972",
    dateWatched: "2023-09-01T00:00:00.000Z"
  }, fixedNow);
  assert.equal(alreadyDated.dateWatched, "2023-09-01T00:00:00.000Z");
});

test("buildWatchedRecordFromImport attaches dateWatched and dateSource only when present", () => {
  const withDate = buildWatchedRecordFromImport(
    { imdbID: "tt1", title: "Inception", userRating: 9, userNote: "" },
    { dateWatched: "2024-03-15T00:00:00.000Z", dateSource: "logged" }
  );
  assert.equal(withDate.dateWatched, "2024-03-15T00:00:00.000Z");
  assert.equal(withDate.dateSource, "logged");

  const withoutDate = buildWatchedRecordFromImport(
    { imdbID: "tt2", title: "Drive", userRating: 8, userNote: "" },
    { title: "Drive", rating: 8, note: "" }
  );
  assert.equal("dateWatched" in withoutDate, false);
  assert.equal("dateSource" in withoutDate, false);
});

test("parseCSVLine and parseRating preserve quote escaping and star scaling", () => {
  assert.deepEqual(parseCSVLine('"Dune, Part Two",2024,4.5,"He said ""wow"""'), [
    "Dune, Part Two",
    "2024",
    "4.5",
    'He said "wow"'
  ]);
  assert.equal(parseRating("★★★★½"), 9);
  assert.equal(parseRating("3.5"), 7);
  assert.equal(parseRating("9"), 9);
});
