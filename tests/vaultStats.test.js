import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRatingHistogramBins,
  attachRecSourceToRecommendations,
  resolveMovieRecSource,
  computeRecommendationHitRate
} from "../src/services/vaultStats.js";

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


test("attachRecSourceToRecommendations stamps rank, mood, matchScore, and shownAt sequentially", () => {
  const recs = [
    { tmdbId: 550, title: "Fight Club", matchScore: 93 },
    { tmdbId: 680, title: "Pulp Fiction", matchScore: 89 }
  ];
  const stamped = attachRecSourceToRecommendations(recs, "dark-thriller", "2026-11-14T10:00:00.000Z");
  assert.deepEqual(stamped[0].recSource, {
    shownAt: "2026-11-14T10:00:00.000Z",
    matchScore: 93,
    mood: "dark-thriller",
    rank: 1
  });
  assert.deepEqual(stamped[1].recSource, {
    shownAt: "2026-11-14T10:00:00.000Z",
    matchScore: 89,
    mood: "dark-thriller",
    rank: 2
  });
});

test("resolveMovieRecSource preserves provenance from direct recSource, watchlist bridge, or active aiRecommendations", () => {
  const aiRecs = [
    {
      tmdbId: 27205,
      imdbID: "tt1375666",
      title: "Inception",
      matchScore: 94,
      recSource: { shownAt: "2026-11-14T08:00:00.000Z", matchScore: 94, mood: "mind-bending", rank: 1 }
    }
  ];

  // 1. Direct rating matching aiRecommendations by TMDB ID
  const direct = resolveMovieRecSource({ tmdbId: 27205, title: "Inception" }, aiRecs, []);
  assert.equal(direct.mood, "mind-bending");
  assert.equal(direct.rank, 1);
  assert.equal(direct.matchScore, 94);

  // 2. Watchlist -> Watched transition after aiRecommendations changed
  const watchlisted = {
    imdbID: "tt0482571",
    tmdbId: 1124,
    title: "The Prestige",
    recSource: { shownAt: "2026-11-10T12:00:00.000Z", matchScore: 91, mood: "any", rank: 3 }
  };
  const promoted = resolveMovieRecSource({ imdbID: "tt0482571", title: "The Prestige", userRating: 9 }, [], [watchlisted]);
  assert.deepEqual(promoted, watchlisted.recSource);

  // 3. Unrelated film produces null
  assert.equal(resolveMovieRecSource({ imdbID: "tt9999999", title: "Unrelated Film" }, aiRecs, []), null);
});

test("computeRecommendationHitRate computes real-world >=8 and >=9 hit rates over rated AI picks", () => {
  const empty = computeRecommendationHitRate([]);
  assert.deepEqual(empty, {
    totalRatedFromRecs: 0,
    count8Plus: 0,
    count9Plus: 0,
    hitRate8Plus: 0,
    hitRate9Plus: 0,
    meanRating: 0
  });

  const watched = [
    { title: "Organic Hit", userRating: 10 }, // no recSource -> excluded
    { title: "Unrated From Rec", userRating: 0, recSource: { shownAt: "2026-11-14T00:00:00Z", matchScore: 90, mood: "any", rank: 1 } },
    { title: "Rec Pick 9", userRating: 9, recSource: { shownAt: "2026-11-14T00:00:00Z", matchScore: 92, mood: "any", rank: 1 } },
    { title: "Rec Pick 8", userRating: 8, recSource: { shownAt: "2026-11-14T00:00:00Z", matchScore: 88, mood: "any", rank: 2 } },
    { title: "Rec Miss 7", userRating: 7, recSource: { shownAt: "2026-11-14T00:00:00Z", matchScore: 86, mood: "any", rank: 3 } },
    { title: "Rec Miss 10 NonRec", userRating: 10 } // no recSource -> excluded
  ];

  const stats = computeRecommendationHitRate(watched);
  assert.equal(stats.totalRatedFromRecs, 3);
  assert.equal(stats.count8Plus, 2);
  assert.equal(stats.count9Plus, 1);
  assert.ok(Math.abs(stats.hitRate8Plus - 2 / 3) < 1e-9);
  assert.ok(Math.abs(stats.hitRate9Plus - 1 / 3) < 1e-9);
  assert.ok(Math.abs(stats.meanRating - 8) < 1e-9);
});
