import test from "node:test";
import assert from "node:assert/strict";
import {
  CRAFT_ASPECTS,
  WATCH_FORMATS,
  computeVaultCalibration,
  normalizeRatingBreakdown,
  computeCraftAverage,
  normalizeWatchMeta,
  buildWatchedRatingPayload
} from "../src/services/ratingStudioService.js";
import { upsertMovieEntry } from "../src/services/movieIdentity.js";

test("computeVaultCalibration handles empty or unrated vaults cleanly", () => {
  const res = computeVaultCalibration([], 8);
  assert.equal(res.ratedCount, 0);
  assert.deepEqual(res.anchorMovies, []);
  assert.equal(res.topPercentile, null);
  assert.match(res.summaryText, /first|rate/i);

  const unratedOnly = computeVaultCalibration([{ imdbID: "tt1", title: "X", userRating: 0 }], 7);
  assert.equal(unratedOnly.ratedCount, 0);
  assert.equal(unratedOnly.topPercentile, null);
});

test("computeVaultCalibration finds exact-score anchors, excludes self, and falls back to nearest score", () => {
  const watched = [
    { imdbID: "tt01", title: "Alpha", year: "2020", userRating: 9, dateWatched: "2026-11-10T00:00:00Z" },
    { imdbID: "tt02", title: "Beta", year: "2021", userRating: 9, dateWatched: "2026-11-12T00:00:00Z" },
    { imdbID: "tt03", title: "Self", year: "2022", userRating: 9 },
    { imdbID: "tt04", title: "Gamma", year: "2019", userRating: 7 },
    { imdbID: "tt05", title: "Delta", year: "2018", userRating: 6 }
  ];
  const exact = computeVaultCalibration(watched, 9, { imdbID: "tt03" });
  assert.equal(exact.ratedCount, 4);
  assert.equal(exact.sameScoreCount, 2);
  assert.equal(exact.anchorMovies.length, 2);
  assert.equal(exact.anchorMovies[0].imdbID, "tt02"); // most recent first
  assert.ok(exact.anchorMovies.every((m) => m.imdbID !== "tt03"));
  assert.ok(exact.topPercentile >= 1 && exact.topPercentile <= 100);

  const nearest = computeVaultCalibration(watched, 8, { imdbID: "tt03" });
  assert.equal(nearest.sameScoreCount, 0);
  assert.ok(nearest.anchorMovies.length > 0);
  assert.ok(nearest.anchorMovies.some((m) => m.userRating === 9 || m.userRating === 7));
});

test("normalizeRatingBreakdown strips zeros/out-of-range and returns null when blank", () => {
  assert.equal(CRAFT_ASPECTS.length, 4);
  assert.equal(normalizeRatingBreakdown({ story: 0, direction: 0 }), null);
  assert.equal(normalizeRatingBreakdown(null), null);
  assert.deepEqual(
    normalizeRatingBreakdown({ story: 5, direction: 4.4, acting: 99, visuals: 3, unknown: 5 }),
    { story: 5, direction: 4, acting: 5, visuals: 3 }
  );
  assert.equal(computeCraftAverage({ story: 5, direction: 4 }), 4.5);
  assert.equal(computeCraftAverage(null), null);
});

test("normalizeWatchMeta preserves legitimate values and omits default-empty state", () => {
  assert.equal(WATCH_FORMATS.length, 4);
  assert.equal(normalizeWatchMeta({ format: "", rewatchCount: 0, containsSpoilers: false }), null);
  assert.deepEqual(
    normalizeWatchMeta({ format: "theater", rewatchCount: 2, containsSpoilers: true }),
    { format: "theater", rewatchCount: 2, containsSpoilers: true }
  );
  assert.deepEqual(
    normalizeWatchMeta({ format: "invalid_fmt", rewatchCount: 1, containsSpoilers: false }),
    { rewatchCount: 1 }
  );
});

test("buildWatchedRatingPayload preserves base fields, merges breakdown/watchMeta, and strips cleared sub-objects", () => {
  const enriched = buildWatchedRatingPayload({
    movie: { imdbID: "tt0133093", tmdbId: 603, title: "The Matrix", year: "1999", genre: "Action, Sci-Fi", runtimeMinutes: 136 },
    userRating: 9,
    userNote: "Masterpiece #Masterpiece",
    ratingBreakdown: { story: 5, visuals: 5 },
    watchMeta: { format: "imax", rewatchCount: 3 },
    nowIso: "2026-11-15T12:00:00.000Z"
  });
  assert.deepEqual(enriched.ratingBreakdown, { story: 5, visuals: 5 });
  assert.deepEqual(enriched.watchMeta, { format: "imax", rewatchCount: 3 });
  assert.equal(enriched.runtime, 136);

  const cleared = buildWatchedRatingPayload({
    movie: { imdbID: "tt0133093", tmdbId: 603, title: "The Matrix", year: "1999" },
    baseWatchedItem: {
      imdbID: "tt0133093",
      dateWatched: "2025-01-01T00:00:00.000Z",
      ratingBreakdown: { story: 5 },
      watchMeta: { format: "theater" }
    },
    userRating: 9,
    userNote: "Rewatched!",
    ratingBreakdown: { story: 0 },
    watchMeta: { format: "", rewatchCount: 0, containsSpoilers: false },
    nowIso: "2026-11-15T12:00:00.000Z"
  });
  assert.equal(cleared.userRating, 9);
  assert.equal(cleared.dateWatched, "2025-01-01T00:00:00.000Z");
  assert.equal(cleared.updatedAt, "2026-11-15T12:00:00.000Z");
  assert.equal("ratingBreakdown" in cleared, false);
  assert.equal("watchMeta" in cleared, false);
});

test("buildWatchedRatingPayload({ markCleared: true }) clears existing ratingBreakdown and watchMeta across upsertMovieEntry", () => {
  const existingList = [
    {
      imdbID: "tt0133093",
      tmdbId: 603,
      title: "The Matrix",
      year: "1999",
      userRating: 9,
      ratingBreakdown: { story: 5, direction: 5 },
      watchMeta: { format: "imax", rewatchCount: 2, containsSpoilers: true },
      updatedAt: "2026-11-10T00:00:00.000Z"
    }
  ];

  const studioPayload = buildWatchedRatingPayload({
    movie: { imdbID: "tt0133093", tmdbId: 603, title: "The Matrix", year: "1999" },
    baseWatchedItem: existingList[0],
    userRating: 8,
    userNote: "Cleared craft & watch log",
    ratingBreakdown: null,
    watchMeta: null,
    markCleared: true,
    nowIso: "2026-11-15T14:00:00.000Z"
  });

  const nextList = upsertMovieEntry(existingList, studioPayload);
  assert.equal(nextList.length, 1);
  assert.equal(nextList[0].userRating, 8);
  assert.equal("ratingBreakdown" in nextList[0], false);
  assert.equal("watchMeta" in nextList[0], false);

  // Partial QuickRate update omitting those keys must still preserve them
  const partialList = upsertMovieEntry(existingList, {
    imdbID: "tt0133093",
    userRating: 10,
    updatedAt: "2026-11-15T15:00:00.000Z"
  });
  assert.deepEqual(partialList[0].ratingBreakdown, { story: 5, direction: 5 });
  assert.deepEqual(partialList[0].watchMeta, { format: "imax", rewatchCount: 2, containsSpoilers: true });
});
