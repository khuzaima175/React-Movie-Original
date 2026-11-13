import test from "node:test";
import assert from "node:assert/strict";
import {
  RATING_TIERS,
  UNRATED_TIER,
  getRatingTier,
  prepareQuickRatePayload,
  prepareWatchlistPayload
} from "../src/services/ratingTiers.js";

test("getRatingTier covers 1-10 tiers and returns UNRATED_TIER for unset scores instead of defaulting to 8", () => {
  for (let score = 1; score <= 10; score += 1) {
    assert.ok(RATING_TIERS[score]?.label);
    assert.equal(getRatingTier(score).label, RATING_TIERS[score].label);
  }
  assert.deepEqual(getRatingTier(0), UNRATED_TIER);
  assert.deepEqual(getRatingTier(null), UNRATED_TIER);
  assert.deepEqual(getRatingTier(undefined), UNRATED_TIER);
  assert.notEqual(getRatingTier(0).label, RATING_TIERS[8].label);
});

test("prepareQuickRatePayload requires an explicit 1-10 rating and never silently defaults to 8 or 0", () => {
  const movie = { id: "tt0109830", title: "Forrest Gump", year: "1994", imdbRating: "8.8" };
  assert.equal(prepareQuickRatePayload(movie, null), null);
  assert.equal(prepareQuickRatePayload(movie, 0), null);
  assert.equal(prepareQuickRatePayload(movie, undefined), null);
  assert.equal(prepareQuickRatePayload(null, 9), null);
});

test("prepareQuickRatePayload builds watched payload with explicit rating, trimmed note, and dateWatched", () => {
  const fixedNow = Date.UTC(2026, 10, 14, 1, 45, 0);
  const movie = {
    id: "tmdb_13",
    tmdbId: 13,
    title: "Forrest Gump",
    year: "1994",
    imdbRating: "8.8"
  };

  const payload = prepareQuickRatePayload(
    { ...movie, userNote: "  Timeless classic  " },
    9,
    fixedNow
  );
  assert.equal(payload.imdbID, "tmdb_13");
  assert.equal(payload.userRating, 9);
  assert.equal(payload.userNote, "Timeless classic");
  assert.equal(payload.dateWatched, new Date(fixedNow).toISOString());

  const clamped = prepareQuickRatePayload(movie, 10.4, fixedNow);
  assert.equal(clamped.userRating, 10);
});

test("prepareWatchlistPayload strips stale ratings and dateWatched when bookmarking Plan to Watch", () => {
  const item = prepareWatchlistPayload({
    imdbID: "tt0109830",
    title: "Forrest Gump",
    year: "1994",
    userRating: 8,
    dateWatched: "2024-01-01T00:00:00.000Z"
  });
  assert.equal(item.userRating, 0);
  assert.equal("dateWatched" in item, false);
});
