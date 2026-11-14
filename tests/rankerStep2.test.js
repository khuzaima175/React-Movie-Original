import test from "node:test";
import assert from "node:assert/strict";
import { getCollabCatalogMax, getCollabCatalogPercentile } from "../src/services/embeddingService.js";
import {
  DEFAULT_RANKER_WEIGHTS,
  rankCandidatePool,
  scoreCandidate,
} from "../src/services/rankerService.js";

test("scoreCandidate smooth damping varies continuously across 0..0.02 without a cliff at 0.001", () => {
  const weights = {
    bias: 0,
    collabSim: 0,
    genreOverlap: 1.0,
    bayesianRatingNorm: 1.0,
  };
  const opts = { metadataDampingFactor: 0.35 };
  const s0 = scoreCandidate({ collabSim: 0, genreOverlap: 1, bayesianRatingNorm: 1 }, weights, opts).logit;
  const sLow = scoreCandidate({ collabSim: 0.0009, genreOverlap: 1, bayesianRatingNorm: 1 }, weights, opts).logit;
  const sJustAbove = scoreCandidate({ collabSim: 0.0011, genreOverlap: 1, bayesianRatingNorm: 1 }, weights, opts).logit;
  const sMid = scoreCandidate({ collabSim: 0.01, genreOverlap: 1, bayesianRatingNorm: 1 }, weights, opts).logit;
  const sHigh = scoreCandidate({ collabSim: 0.05, genreOverlap: 1, bayesianRatingNorm: 1 }, weights, opts).logit;

  assert.equal(s0, 2.0);
  assert.ok(Math.abs(sLow - sJustAbove) < 0.02, `expected tiny diff around 0.001, got ${Math.abs(sLow - sJustAbove)}`);
  assert.ok(s0 > sMid && sMid > sHigh, `expected monotonic decrease: ${s0} > ${sMid} > ${sHigh}`);
  assert.ok(Math.abs(sHigh - 0.70) < 1e-6, `expected full damping 2 * 0.35 = 0.70 at 0.05, got ${sHigh}`);
});

test("getCollabCatalogMax and rankCandidatePool are invariant to unrelated pool outliers", () => {
  const catalogMap = new Map();
  for (let i = 1; i <= 100; i++) {
    catalogMap.set(i, i * 0.01);
  }

  assert.ok(Math.abs(getCollabCatalogMax(catalogMap) - 1.00) < 1e-6);
  assert.ok(Math.abs(getCollabCatalogPercentile(catalogMap, 0.50) - 0.50) < 0.02);

  const baseCandidate = { id: 40, tmdbId: 40, title: "Target", genre: "Drama", year: 2015, popularity: 20 };
  const midCandidate = { id: 60, tmdbId: 60, title: "Mid", genre: "Drama", year: 2016, popularity: 20 };
  const outlierCandidate = { id: 100, tmdbId: 100, title: "Outlier", genre: "Drama", year: 2017, popularity: 20 };

  const context = { collabSimMap: catalogMap, profile: { lovedGenreIds: [] } };
  const rankedSmall = rankCandidatePool([baseCandidate, midCandidate], context, DEFAULT_RANKER_WEIGHTS, 10);
  const rankedWithOutlier = rankCandidatePool(
    [baseCandidate, midCandidate, outlierCandidate],
    context,
    DEFAULT_RANKER_WEIGHTS,
    10
  );

  const findScore = (list, id) => list.find(c => c.id === id);
  const targetA = findScore(rankedSmall, 40);
  const targetB = findScore(rankedWithOutlier, 40);
  assert.equal(targetA.rankerLogit, targetB.rankerLogit);
  assert.equal(targetA.features.collabSim, targetB.features.collabSim);
  assert.ok(Math.abs(targetA.features.collabSim - 0.40) < 1e-6);
});

test("rankCandidatePool falls back cleanly to pool-max for tiny synthetic collabSimMap (< 50 items)", () => {
  const tinyMap = new Map([
    [1, 0.15],
    [2, 0.30],
    [3, 0.0],
  ]);
  assert.equal(getCollabCatalogMax(tinyMap), null);
  assert.equal(getCollabCatalogPercentile(tinyMap, 0.15), null);

  const candidates = [
    { id: 1, tmdbId: 1, title: "Half", genre: "Drama", year: 2015, popularity: 20 },
    { id: 2, tmdbId: 2, title: "Top", genre: "Drama", year: 2015, popularity: 20 },
    { id: 3, tmdbId: 3, title: "Zero", genre: "Drama", year: 2015, popularity: 20 },
  ];
  const ranked = rankCandidatePool(candidates, { collabSimMap: tinyMap }, DEFAULT_RANKER_WEIGHTS, 10);
  const half = ranked.find(c => c.id === 1);
  const top = ranked.find(c => c.id === 2);
  assert.ok(Math.abs(top.features.collabSim - 1.0) < 1e-6);
  assert.ok(Math.abs(half.features.collabSim - 0.5) < 1e-6);
});
