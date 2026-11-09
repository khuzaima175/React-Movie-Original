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
