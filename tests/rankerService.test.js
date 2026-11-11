import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCandidateFeatures,
  scoreCandidate,
  rankCandidatePool
} from "../src/services/rankerService.js";

test("scoreCandidate produces calibrated probabilities and monotonic matchScore in [50, 99]", () => {
  const strongFeatures = {
    collabSim: 0.75,
    contentSim: 0.65,
    genreOverlap: 0.8,
    keywordOverlap: 0.5,
    crewMatch: 1,
    castMatch: 1,
    bayesianRatingNorm: 0.85,
    noveltyBonus: 0.4,
    negativeKeywordPenalty: 0,
    providerMatch: 1
  };
  const weakFeatures = {
    collabSim: -0.2,
    contentSim: 0.0,
    genreOverlap: 0.0,
    keywordOverlap: 0.0,
    crewMatch: 0,
    castMatch: 0,
    bayesianRatingNorm: 0.3,
    noveltyBonus: 0.1,
    negativeKeywordPenalty: 1,
    providerMatch: 0
  };

  const strong = scoreCandidate(strongFeatures);
  const weak = scoreCandidate(weakFeatures);

  assert.ok(strong.probability > 0.8, `expected strong probability > 0.8, got ${strong.probability}`);
  assert.ok(weak.probability < 0.3, `expected weak probability < 0.3, got ${weak.probability}`);
  assert.ok(strong.matchScore >= 90 && strong.matchScore <= 99);
  assert.ok(weak.matchScore >= 50 && weak.matchScore < 70);
});

test("rankCandidatePool ranks 300 candidates down to topK=30 and attaches calibrated matchScore", () => {
  const candidates = Array.from({ length: 300 }, (_, i) => ({
    id: i + 1,
    tmdbId: i + 1,
    title: `Movie ${i + 1}`,
    genre_ids: i === 42 ? [878, 53] : [35],
    vote_average: i === 42 ? 8.4 : 6.5,
    vote_count: i === 42 ? 1200 : 200
  }));

  const context = {
    profile: { lovedGenreIds: [878, 53], hatedKeywordIds: [], topCastIds: [], topCrewMemberId: null },
    collabSimMap: new Map([[43, 0.88]]),
    contentSimMap: new Map([[43, 0.72]])
  };

  const top30 = rankCandidatePool(candidates, context, undefined, 30);
  assert.equal(top30.length, 30);
  assert.equal(top30[0].tmdbId, 43);
  assert.ok(top30[0].matchScore > top30[29].matchScore);
  assert.ok(top30[0].rankerProbability > top30[29].rankerProbability);
});

test("extractCandidateFeatures handles null collabSimMap and contentSimMap safely", () => {
  const feats = extractCandidateFeatures(
    { id: 10, tmdbId: 10, genre_ids: [878], vote_average: 7.8, vote_count: 500 },
    { profile: { lovedGenreIds: [878] }, collabSimMap: null, contentSimMap: null }
  );
  assert.equal(feats.collabSim, 0);
  assert.equal(feats.contentSim, 0);
  assert.equal(feats.genreOverlap, 1);
});

test("extractCandidateFeatures sets providerMatch=1 when candidate.providerMatchedByQuery is true", () => {
  const feats = extractCandidateFeatures(
    { id: 55, tmdbId: 55, genre_ids: [878], vote_average: 7.5, vote_count: 400, providerMatchedByQuery: true },
    { profile: { lovedGenreIds: [878] }, userProviders: [8, 9] }
  );
  assert.equal(feats.providerMatch, 1);
});


test("extractCandidateFeatures wires repulsionMap, profile.lovedKeywordIds, and profile.topCrewIds", () => {
  const candidate = {
    id: 77,
    tmdbId: 77,
    tmdbGenreIds: [18],
    tmdbKeywords: [501, 502],
    crewPersonId: 9002,
    castIds: [301],
    vote_average: 8.0,
    vote_count: 1000
  };
  const profile = {
    lovedGenreIds: [18],
    lovedKeywordIds: [501, 502, 503],
    topCrewMemberId: 9001,
    topCrewIds: [9001, 9002, 9003],
    topCastIds: [301],
    hatedKeywordIds: []
  };
  const repulsionMap = new Map([[77, 0.6]]);

  const feats = extractCandidateFeatures(candidate, { profile, repulsionMap });
  assert.ok(feats.keywordOverlap > 0.6, `expected keywordOverlap > 0.6 from profile.lovedKeywordIds, got ${feats.keywordOverlap}`);
  assert.equal(feats.crewMatch, 1, "expected crewMatch=1 from secondary favorite director in topCrewIds");
  assert.equal(feats.repulsion, 0.6, "expected repulsion=0.6 from repulsionMap");

  const cleanScore = scoreCandidate({ ...feats, repulsion: 0 });
  const repulsedScore = scoreCandidate(feats);
  assert.ok(repulsedScore.probability < cleanScore.probability, "repulsion must reduce candidate probability");
});


test("fitRankerWeights learns L2-regularized pairwise weights from positive vs negative feature examples", async () => {
  const mod = await import("../src/services/rankerService.js");
  assert.equal(typeof mod.fitRankerWeights, "function");

  // User cares strongly about crewMatch and keywordOverlap
  const positives = Array.from({ length: 15 }, () => ({
    collabSim: 0.1,
    contentSim: 0,
    genreOverlap: 0.5,
    keywordOverlap: 0.9,
    crewMatch: 1,
    castMatch: 0,
    bayesianRatingNorm: 0.6,
    noveltyBonus: 0.1,
    negativeKeywordPenalty: 0,
    repulsion: 0,
    providerMatch: 0.5
  }));
  const negatives = Array.from({ length: 30 }, () => ({
    collabSim: 0.1,
    contentSim: 0,
    genreOverlap: 0.5,
    keywordOverlap: 0.1,
    crewMatch: 0,
    castMatch: 0,
    bayesianRatingNorm: 0.6,
    noveltyBonus: 0.5,
    negativeKeywordPenalty: 0,
    repulsion: 0,
    providerMatch: 0.5
  }));

  const learned = mod.fitRankerWeights(positives, negatives, mod.DEFAULT_RANKER_WEIGHTS, {
    iterations: 40,
    learningRate: 0.15,
    l2: 0.05
  });

  assert.ok(learned.crewMatch > mod.DEFAULT_RANKER_WEIGHTS.crewMatch, "crewMatch weight should increase");
  assert.ok(learned.keywordOverlap > mod.DEFAULT_RANKER_WEIGHTS.keywordOverlap, "keywordOverlap weight should increase");
  assert.ok(learned.noveltyBonus < mod.DEFAULT_RANKER_WEIGHTS.noveltyBonus, "noveltyBonus weight should decrease");
});

test("generateMatchReasons generates high-signal badges and attaches them in rankCandidatePool", async () => {
  const mod = await import("../src/services/rankerService.js");
  assert.equal(typeof mod.generateMatchReasons, "function");

  const auteurCultFeats = {
    collabSim: 0.32,
    crewMatch: 1,
    castMatch: 0,
    keywordOverlap: 0.5,
    noveltyBonus: 0.5,
    genreOverlap: 0.8,
    bayesianRatingNorm: 0.8
  };
  const badges = mod.generateMatchReasons(auteurCultFeats);
  assert.ok(badges.includes("🧬 High Taste-Twin Match"), "should have taste-twin match");
  assert.ok(badges.includes("🎬 Favorite Filmmaker"), "should have favorite filmmaker");
  assert.ok(badges.length <= 3, "badges should be capped at 3");

  const candidates = [
    { id: 1, tmdbId: 1, genre_ids: [18], vote_average: 8.2, vote_count: 500 }
  ];
  const ranked = mod.rankCandidatePool(candidates, {
    profile: { lovedGenreIds: [18] },
    collabSimMap: new Map([[1, 0.4]])
  }, undefined, 1);

  assert.equal(ranked.length, 1);
  assert.ok(Array.isArray(ranked[0].matchReasons), "candidate should have matchReasons array");
  assert.ok(ranked[0].matchReasons.length > 0, "candidate should have at least one badge");
});

test("scoreCandidate damps genreOverlap and bayesianRatingNorm when hasCollabSignal is true", () => {
  const withCollab = {
    collabSim: 0.8,
    genreOverlap: 1.0,
    bayesianRatingNorm: 0.8
  };
  const withoutCollab = {
    collabSim: 0.0,
    genreOverlap: 1.0,
    bayesianRatingNorm: 0.8
  };
  const weights = { bias: 0, collabSim: 0, genreOverlap: 2.0, bayesianRatingNorm: 2.0 };
  const scoreWith = scoreCandidate(withCollab, weights, { metadataDampingFactor: 0.25 });
  const scoreWithout = scoreCandidate(withoutCollab, weights, { metadataDampingFactor: 0.25 });

  // With collab, genre and rating should contribute (1.0*2 + 0.8*2)*0.25 = 0.9 logit
  assert.ok(Math.abs(scoreWith.logit - 0.9) < 1e-4, `expected 0.9, got ${scoreWith.logit}`);
  // Without collab, full strength: 1.0*2 + 0.8*2 = 3.6 logit
  assert.ok(Math.abs(scoreWithout.logit - 3.6) < 1e-4, `expected 3.6, got ${scoreWithout.logit}`);
});

test("rankCandidatePool normalizes collabSim pool-relatively and preserves rawCollabSim", () => {
  const candidates = [
    { id: 1, tmdbId: 1, collabSim: 0.15 },
    { id: 2, tmdbId: 2, collabSim: 0.30 },
    { id: 3, tmdbId: 3, collabSim: 0.0 }
  ];
  const ranked = rankCandidatePool(candidates, {}, undefined, 3);
  const top = ranked.find(c => c.tmdbId === 2);
  const mid = ranked.find(c => c.tmdbId === 1);
  const zero = ranked.find(c => c.tmdbId === 3);

  assert.equal(top.features.rawCollabSim, 0.30);
  assert.equal(top.features.collabSim, 1.0); // 0.30 / 0.30
  assert.equal(mid.features.rawCollabSim, 0.15);
  assert.equal(mid.features.collabSim, 0.5);  // 0.15 / 0.30
  assert.equal(zero.features.collabSim, 0.0);
});
