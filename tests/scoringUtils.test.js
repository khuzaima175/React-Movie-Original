import test from "node:test";
import assert from "node:assert/strict";
import {
  computeUserRatingStats,
  computeZScoredWeights,
  computeBayesianScore
} from "../src/services/scoringUtils.js";

test("computeZScoredWeights normalizes harsh vs generous raters and assigns negative zScore to 4-5 ratings", () => {
  const now = Date.UTC(2026, 10, 9);
  const watched = [
    { id: "m1", userRating: 9, dateWatched: "2026-11-09T00:00:00Z" },
    { id: "m2", userRating: 8, dateWatched: "2026-11-09T00:00:00Z" },
    { id: "m3", userRating: 7, dateWatched: "2026-11-09T00:00:00Z" },
    { id: "m4", userRating: 4, dateWatched: "2026-11-09T00:00:00Z" }
  ];
  const res = computeZScoredWeights(watched, { lambda: 0.002, now });
  const m1 = res.find(r => r.movie.id === "m1");
  const m4 = res.find(r => r.movie.id === "m4");
  assert.ok(m1.zScore > 0.9, `expected m1 zScore > 0.9, got ${m1.zScore}`);
  assert.ok(m4.zScore < -1.0, `expected m4 zScore < -1.0, got ${m4.zScore}`);
  assert.equal(m1.timeDecay, 1);
  assert.equal(m1.weight, m1.zScore);
});

test("computeZScoredWeights handles zero-variance ratings without NaN and clamps future dates", () => {
  const now = Date.UTC(2026, 10, 9);
  const watched = [
    { id: "a", userRating: 8, dateWatched: "2027-01-01T00:00:00Z" },
    { id: "b", userRating: 8, dateWatched: "2026-11-09T00:00:00Z" },
    { id: "c", userRating: 8, dateWatched: "2026-11-09T00:00:00Z" }
  ];
  const res = computeZScoredWeights(watched, { lambda: 0.002, now });
  for (const item of res) {
    assert.ok(Number.isFinite(item.weight), "weight must be finite");
    assert.equal(item.daysSince, 0, "future dates must clamp daysSince to 0");
    assert.equal(item.zScore, 0.5, "equal high ratings (>=7) get +0.5 baseline zScore");
  }
});

test("computeZScoredWeights applies bulkPriorDays=180 when dateWatched is missing or isBulkImported=true", () => {
  const now = Date.UTC(2026, 10, 9);
  const watched = [
    { id: "recent", userRating: 9, dateWatched: "2026-11-09T00:00:00Z" },
    { id: "backlog", userRating: 9, addedAt: "2026-11-09T00:00:00Z", isBulkImported: true },
    { id: "undated", userRating: 5 }
  ];
  const res = computeZScoredWeights(watched, { lambda: 0.002, now, bulkPriorDays: 180 });
  const recent = res.find(r => r.movie.id === "recent");
  const backlog = res.find(r => r.movie.id === "backlog");
  const undated = res.find(r => r.movie.id === "undated");
  assert.equal(recent.daysSince, 0);
  assert.equal(backlog.daysSince, 180);
  assert.equal(undated.daysSince, 180);
  assert.ok(recent.weight > backlog.weight);
});

test("computeBayesianScore shrinks low-vote movies toward global mean C=7.0", () => {
  const lowVoteTen = computeBayesianScore(10.0, 10, 500, 7.0);
  const highVoteEight = computeBayesianScore(8.2, 5000, 500, 7.0);
  assert.ok(highVoteEight > lowVoteTen);
});


test("computeZScoredWeights supports dual-clock bi-exponential decay (0.70 slow + 0.30 fast)", () => {
  const now = Date.UTC(2026, 10, 9);
  const tenDaysAgo = new Date(now - 10 * 86400000).toISOString();
  const oneYearAgo = new Date(now - 365 * 86400000).toISOString();
  const watched = [
    { id: "binge", userRating: 9, dateWatched: tenDaysAgo },
    { id: "classic", userRating: 9, dateWatched: oneYearAgo },
    { id: "mid", userRating: 6, dateWatched: oneYearAgo }
  ];

  const dual = computeZScoredWeights(watched, { dualClock: true, now });
  const binge = dual.find(r => r.movie.id === "binge");
  const classic = dual.find(r => r.movie.id === "classic");

  const expectedBingeDecay = 0.70 * Math.exp(-0.0008 * 10) + 0.30 * Math.exp(-0.07 * 10);
  const expectedClassicDecay = 0.70 * Math.exp(-0.0008 * 365) + 0.30 * Math.exp(-0.07 * 365);

  assert.ok(Math.abs(binge.timeDecay - expectedBingeDecay) < 1e-6);
  assert.ok(Math.abs(classic.timeDecay - expectedClassicDecay) < 1e-6);
  assert.ok(binge.weight > classic.weight);
});
