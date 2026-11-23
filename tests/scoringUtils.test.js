import test from "node:test";
import assert from "node:assert/strict";
import {
  computeUserRatingStats,
  computeZScoredWeights,
  computeBayesianScore,
  resolveDecayFloor,
  computeTimeDecay,
  DEFAULT_DECAY_TIER_FLOORS
} from "../src/services/scoringUtils.js";
import { extractTasteProfile } from "../src/services/tmdbService.js";

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

test("tiered decay floor preserves 5-year-old 10/10 masterpieces above recent casual 8/10s", () => {
  const now = Date.UTC(2026, 10, 23);
  const fiveYearsAgo = new Date(now - 1825 * 86400000).toISOString();
  const yesterday = new Date(now - 1 * 86400000).toISOString();

  const watched = [
    { id: "interstellar", title: "Interstellar", userRating: 10, dateWatched: fiveYearsAgo },
    { id: "casual_eight", title: "Recent 8", userRating: 8, dateWatched: yesterday },
    { id: "old_seven", title: "Old 7", userRating: 7, dateWatched: fiveYearsAgo },
    { id: "old_six", title: "Old 6", userRating: 6, dateWatched: fiveYearsAgo },
    { id: "old_two", title: "Old 2", userRating: 2, dateWatched: fiveYearsAgo }
  ];

  const tiered = computeZScoredWeights(watched, { now });
  const legacy = computeZScoredWeights(watched, { now, decayMode: "legacy" });

  const tMaster = tiered.find(r => r.movie.id === "interstellar");
  const tCasual8 = tiered.find(r => r.movie.id === "casual_eight");
  const tOld6 = tiered.find(r => r.movie.id === "old_six");
  const tOld2 = tiered.find(r => r.movie.id === "old_two");

  const lMaster = legacy.find(r => r.movie.id === "interstellar");
  const lCasual8 = legacy.find(r => r.movie.id === "casual_eight");

  // Under legacy pure exponential decay, a 5-year-old 10/10 drops below a recent 8/10
  assert.ok(lMaster.weight < lCasual8.weight, "legacy decay under-weights old 10/10 below recent 8/10");

  // Under default tiered floor, 5-year-old 10/10 retains >= 0.35 floor and stays above recent 8/10
  assert.ok(tMaster.timeDecay >= DEFAULT_DECAY_TIER_FLOORS.masterpiece);
  assert.ok(tMaster.weight > tCasual8.weight, "5-year-old 10/10 must still outweigh recent casual 8/10");

  // Casual mid-tier ratings fade toward 0.10 while strong dislikes retain >= 0.25 floor
  assert.ok(tOld6.timeDecay < 0.15 && tOld6.timeDecay >= DEFAULT_DECAY_TIER_FLOORS.neutral);
  assert.ok(tOld2.timeDecay >= DEFAULT_DECAY_TIER_FLOORS.disliked);
});

test("rewatchCount >= 2 promotes 8-9 star films to masterpiece floor without promoting low ratings", () => {
  const now = Date.UTC(2026, 10, 23);
  const fiveYearsAgo = new Date(now - 1825 * 86400000).toISOString();

  const watched = [
    { id: "rewatched8", userRating: 8, dateWatched: fiveYearsAgo, watchMeta: { rewatchCount: 3 } },
    { id: "single8", userRating: 8, dateWatched: fiveYearsAgo },
    { id: "rewatched6", userRating: 6, dateWatched: fiveYearsAgo, watchMeta: { rewatchCount: 3 } }
  ];

  const res = computeZScoredWeights(watched, { now });
  const rw8 = res.find(r => r.movie.id === "rewatched8");
  const s8 = res.find(r => r.movie.id === "single8");
  const rw6 = res.find(r => r.movie.id === "rewatched6");

  assert.equal(resolveDecayFloor(rw8.movie, 8), DEFAULT_DECAY_TIER_FLOORS.masterpiece);
  assert.equal(resolveDecayFloor(s8.movie, 8), DEFAULT_DECAY_TIER_FLOORS.great);
  assert.equal(resolveDecayFloor(rw6.movie, 6), DEFAULT_DECAY_TIER_FLOORS.neutral);
  assert.ok(rw8.timeDecay > s8.timeDecay);
});

test("computeTimeDecay and resolveDecayFloor support uniform mode and clamp out-of-range floors", () => {
  assert.equal(computeTimeDecay(0, { floor: 0.35 }), 1);
  assert.equal(computeTimeDecay(100000, { lambda: 0.002, floor: 0.35 }), 0.35);
  assert.equal(computeTimeDecay(100, { floor: 1.5 }), 1);
  assert.ok(Math.abs(computeTimeDecay(100, { lambda: 0.002, floor: -0.5 }) - Math.exp(-0.2)) < 1e-12);
  assert.equal(resolveDecayFloor({}, 10, { decayMode: "uniform", decayFloor: 0.4 }), 0.4);
  assert.equal(resolveDecayFloor({}, 10, { decayMode: "legacy" }), 0);
});

test("extractTasteProfile keeps a 5-year-old 10/10 favorite ahead of a recent 8/10 for anchor, genres, and hated tropes", async () => {
  const now = Date.UTC(2026, 10, 23);
  const fiveYearsAgo = new Date(now - 1825 * 86400000).toISOString();
  const yesterday = new Date(now - 1 * 86400000).toISOString();

  const watched = [
    { id: "tt0816692", tmdbId: 157336, title: "Interstellar", userRating: 10, dateWatched: fiveYearsAgo, tmdbGenreIds: [878], tmdbKeywords: [9882] },
    { id: "tt9990001", tmdbId: 9001, title: "Recent RomCom", userRating: 8, dateWatched: yesterday, tmdbGenreIds: [10749], tmdbKeywords: [9673] },
    { id: "tt9990002", tmdbId: 9002, title: "Average Film", userRating: 6, dateWatched: yesterday, tmdbGenreIds: [35], tmdbKeywords: [] },
    { id: "tt9990003", tmdbId: 9003, title: "Old Dislike", userRating: 2, dateWatched: fiveYearsAgo, tmdbGenreIds: [27], tmdbKeywords: [12345] }
  ];

  const profile = await extractTasteProfile(watched, [], { now });
  assert.equal(profile.anchorTmdbId, 157336, "5-year-old 10/10 should remain top anchor over recent 8/10");
  assert.equal(profile.lovedGenreIds[0], 878, "Sci-Fi from 5-year-old 10/10 should top lovedGenreIds");
  assert.ok(profile.hatedKeywordIds.includes(12345), "5-year-old 2/10 dealbreaker keyword should remain active");
});
