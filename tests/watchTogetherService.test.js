import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreJointCandidate,
  rankWatchTogetherCandidates,
  buildPartnerScoreMapFromVector,
  evaluateSwipeRound,
  generateRoomCode
} from "../src/services/watchTogetherService.js";

test("scoreJointCandidate uses Nash-welfare harmonic weighting and penalizes asymmetric vetoes", () => {
  const balanced = scoreJointCandidate(0.78, 0.78);
  const asymmetric = scoreJointCandidate(0.98, 0.15);
  assert.ok(balanced.jointScore > asymmetric.jointScore);
  assert.equal(balanced.balanceLabel, "Mutual Sweet Spot");
  assert.equal(asymmetric.balanceLabel, "One-Sided");
});

test("rankWatchTogetherCandidates excludes both partners' watched films across ID formats", () => {
  const candidates = [
    { tmdbId: 27205, imdbID: "tt1375666", title: "Inception", year: "2010" },
    { tmdbId: 157336, imdbID: "tt0816692", title: "Interstellar", year: "2014" },
    { tmdbId: 335984, imdbID: "tt1856101", title: "Blade Runner 2049", year: "2017" }
  ];
  const scoresA = new Map([[27205, 0.9], [157336, 0.85], [335984, 0.82]]);
  const scoresB = new Map([[27205, 0.9], [157336, 0.86], [335984, 0.84]]);

  const ranked = rankWatchTogetherCandidates({
    candidates,
    scoresA,
    scoresB,
    watchedA: [{ imdbID: "tt1375666", title: "Inception", year: "2010" }],
    watchedB: [{ tmdbId: 157336, title: "Interstellar", year: "2014" }]
  });

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].tmdbId, 335984);
  assert.ok(ranked[0].matchPctA >= 50 && ranked[0].matchPctB >= 50);
});

test("rankWatchTogetherCandidates drops candidates matching either partner's avoid rules", () => {
  const candidates = [
    { tmdbId: 1, title: "Scary Movie", genre: "Horror, Thriller", tmdbGenreIds: [27, 53] },
    { tmdbId: 2, title: "Jazz Musical", genre: "Music, Romance", tmdbGenreIds: [10402, 10749] },
    { tmdbId: 3, title: "Smart Mystery", genre: "Mystery, Drama", tmdbGenreIds: [9648, 18] }
  ];
  const scoresA = new Map([[1, 0.9], [2, 0.9], [3, 0.8]]);
  const scoresB = new Map([[1, 0.9], [2, 0.9], [3, 0.82]]);

  const ranked = rankWatchTogetherCandidates({
    candidates,
    scoresA,
    scoresB,
    tasteRulesA: [{ id: "r1", polarity: "avoid", text: "avoid horror", active: true }],
    tasteRulesB: [{ id: "r2", polarity: "avoid", text: "no musicals", active: true }]
  });

  assert.deepEqual(ranked.map((r) => r.tmdbId), [3]);
});

test("buildPartnerScoreMapFromVector maps 64-D cosine affinities to [0, 1] safely", () => {
  const fakeIdx = {
    count: 2,
    dim: 64,
    ids: new Uint32Array([10, 20]),
    idToIndex: new Map([[10, 0], [20, 1]]),
    vectors: new Float32Array(128)
  };
  fakeIdx.vectors[0] = 1;
  fakeIdx.vectors[64] = -1;

  const partnerVec = new Array(64).fill(0);
  partnerVec[0] = 1;

  const map = buildPartnerScoreMapFromVector(partnerVec, fakeIdx, [10, 20, 999]);
  assert.ok(map.get(10) > 0.95);
  assert.ok(map.get(20) < 0.05);
  assert.equal(map.has(999), false);
});

test("evaluateSwipeRound surfaces mutual yes matches and falls back to top-3 compromises", () => {
  const deck = [
    { tmdbId: 1, title: "Pick 1", jointScore: 0.9 },
    { tmdbId: 2, title: "Pick 2", jointScore: 0.85 },
    { tmdbId: 3, title: "Pick 3", jointScore: 0.8 },
    { tmdbId: 4, title: "Pick 4", jointScore: 0.75 }
  ];

  const withMatch = evaluateSwipeRound({
    deck,
    votesA: { 1: "no", 2: "yes", 3: "yes" },
    votesB: { 1: "yes", 2: "no", 3: "yes" }
  });
  assert.deepEqual(withMatch.mutualMatches.map((m) => m.tmdbId), [3]);

  const noMatch = evaluateSwipeRound({
    deck,
    votesA: { 1: "no", 2: "yes" },
    votesB: { 1: "yes", 2: "no" }
  });
  assert.equal(noMatch.mutualMatches.length, 0);
  assert.equal(noMatch.fallbackCompromises.length, 3);
  assert.deepEqual(noMatch.fallbackCompromises.map((m) => m.tmdbId), [1, 2, 3]);
});

test("generateRoomCode creates uppercase 8-char alphanumeric codes", () => {
  const code = generateRoomCode();
  assert.match(code, /^[A-Z0-9]{8}$/);
});
