import test from "node:test";
import assert from "node:assert/strict";
import {
  temporalHoldoutSplit,
  computeRecallAtK,
  computeNDCGAtK,
  computeILD,
  computeNovelty,
  gridSearchHyperparams
} from "../src/services/evalHarness.js";

test("temporalHoldoutSplit holds out the last N liked films chronologically", () => {
  const watched = [
    { id: "1", userRating: 9, dateWatched: "2026-01-01" },
    { id: "2", userRating: 8, dateWatched: "2026-02-01" },
    { id: "3", userRating: 5, dateWatched: "2026-03-01" },
    { id: "4", userRating: 10, dateWatched: "2026-04-01" },
    { id: "5", userRating: 8, dateWatched: "2026-05-01" }
  ];
  const split = temporalHoldoutSplit(watched, 2, 8);
  assert.deepEqual(split.trainWatched.map(m => m.id), ["1", "2", "3"]);
  assert.deepEqual([...split.holdoutPositives], ["4", "5"]);
  assert.equal(split.holdoutRelevance.get("4"), 10);
});

test("computeRecallAtK and computeNDCGAtK match exact IR definitions", () => {
  const positives = new Set(["m2", "m5"]);
  const relevance = new Map([["m2", 10], ["m5", 8]]);
  const recs = ["m1", "m2", "m3", "m4", "m5"];

  assert.equal(computeRecallAtK(recs, positives, 2), 0.5);
  assert.equal(computeRecallAtK(recs, positives, 5), 1.0);

  const ndcg = computeNDCGAtK(recs, relevance, 5);
  assert.ok(ndcg > 0.5 && ndcg < 1.0, `expected 0.5 < ndcg < 1.0, got ${ndcg}`);
  assert.equal(computeNDCGAtK(["m2", "m5", "m1"], relevance, 3), 1.0);
});

test("computeILD and computeNovelty measure diversity and non-blockbuster novelty", () => {
  const vecs = new Map([
    [1, new Float32Array([1, 0])],
    [2, new Float32Array([0, 1])]
  ]);
  const ild = computeILD([1, 2], id => vecs.get(id) || null);
  assert.ok(Math.abs(ild - 1.0) < 1e-6, `orthogonal unit vectors have ILD=1.0, got ${ild}`);

  const blockbusterNovelty = computeNovelty([{ id: 1, vote_count: 9000 }], 10000);
  const indieNovelty = computeNovelty([{ id: 2, vote_count: 100 }], 10000);
  assert.ok(indieNovelty > blockbusterNovelty);
});

test("gridSearchHyperparams evaluates parameter grid on temporal holdout and returns bestParams", () => {
  const watched = [
    { id: "1", tmdbId: 1, userRating: 9, tmdbGenreIds: [878], dateWatched: "2026-01-01" },
    { id: "2", tmdbId: 2, userRating: 9, tmdbGenreIds: [878], dateWatched: "2026-02-01" },
    { id: "3", tmdbId: 3, userRating: 4, tmdbGenreIds: [27], dateWatched: "2026-03-01" },
    { id: "4", tmdbId: 4, userRating: 9, tmdbGenreIds: [878], dateWatched: "2026-04-01" },
    { id: "5", tmdbId: 5, userRating: 8, tmdbGenreIds: [878], dateWatched: "2026-05-01" }
  ];
  const catalog = [
    { id: "4", tmdbId: 4, tmdbGenreIds: [878], vote_average: 8.5, vote_count: 600 },
    { id: "5", tmdbId: 5, tmdbGenreIds: [878], vote_average: 8.1, vote_count: 400 },
    { id: "6", tmdbId: 6, tmdbGenreIds: [27], vote_average: 7.9, vote_count: 1000 }
  ];
  const result = gridSearchHyperparams(watched, catalog, {
    lambdas: [0.001, 0.002, 0.005],
    anchorCutoffs: [8, 9],
    holdoutSize: 2
  });
  assert.ok(result.bestParams);
  assert.equal(result.bestMetrics.recallAt20, 1.0);
  assert.equal(result.leaderboard.length, 6);
});
