import test from "node:test";
import assert from "node:assert/strict";
import { buildRatingHistogramBins } from "../src/services/vaultStats.js";

test("buildRatingHistogramBins tallies full 1-10 scale without clamping low ratings to 6", () => {
  const watched = [
    { title: "A", userRating: 10 },
    { title: "B", userRating: 9 },
    { title: "C", userRating: 8.4 },
    { title: "D", userRating: 4 },
    { title: "E", userRating: 2 },
    { title: "F", userRating: 1 }
  ];

  const { bins, maxCount } = buildRatingHistogramBins(watched);
  assert.equal(bins.length, 10);
  assert.deepEqual(
    bins.map((b) => b.score),
    [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
  );
  assert.equal(maxCount, 1);

  const countByScore = Object.fromEntries(bins.map((b) => [b.score, b.count]));
  assert.deepEqual(countByScore, {
    10: 1,
    9: 1,
    8: 1,
    7: 0,
    6: 0,
    5: 0,
    4: 1,
    3: 0,
    2: 1,
    1: 1
  });
  assert.equal(bins.find((b) => b.score === 4).label, "4★");
  assert.equal(bins.find((b) => b.score === 4).heightPct, 100);
});

test("buildRatingHistogramBins handles empty vault with 10 zero bins and safe maxCount", () => {
  const { bins, maxCount } = buildRatingHistogramBins([]);
  assert.equal(bins.length, 10);
  assert.equal(maxCount, 1);
  assert.ok(bins.every((b) => b.count === 0 && b.heightPct === 0));
});

test("buildRatingHistogramBins skips unrated entries cleanly without counting them as 1 star", () => {
  const watched = [
    { title: "Unrated Zero", userRating: 0 },
    { title: "Unrated Missing" },
    { title: "Null Rating", userRating: null, imdbRating: "N/A" },
    { title: "Imdb Fallback", userRating: 0, imdbRating: "7.8" },
    { title: "Explicit Low", userRating: 1 }
  ];

  const { bins } = buildRatingHistogramBins(watched);
  const countByScore = Object.fromEntries(bins.map((b) => [b.score, b.count]));
  assert.equal(countByScore[8], 1);
  assert.equal(countByScore[1], 1);
  const totalCounted = bins.reduce((sum, b) => sum + b.count, 0);
  assert.equal(totalCounted, 2);
});
