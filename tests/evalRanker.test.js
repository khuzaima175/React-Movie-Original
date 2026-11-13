import test from "node:test";
import assert from "node:assert/strict";
import {
  temporalHoldoutSplit,
  evaluateRanker,
  evaluateRankerRolling,
  formatEvalReport
} from "../src/services/evalHarness.js";
import { encodeEmbeddingBinary, parseEmbeddingBinary } from "../src/services/embeddingService.js";
import { buildSyntheticBenchmark } from "./fixtures/syntheticVaults.js";

const { catalog, vaults } = buildSyntheticBenchmark();

test("temporalHoldoutSplit exposes the date at which the holdout starts", () => {
  const watched = [
    { id: "1", userRating: 9, dateWatched: "2026-01-01" },
    { id: "2", userRating: 8, dateWatched: "2026-02-01" },
    { id: "3", userRating: 5, dateWatched: "2026-03-01" },
    { id: "4", userRating: 10, dateWatched: "2026-04-01" },
    { id: "5", userRating: 8, dateWatched: "2026-05-01" }
  ];
  const split = temporalHoldoutSplit(watched, 2, 8);
  assert.equal(split.holdoutStartTs, Date.parse("2026-04-01"));
});

test("temporalHoldoutSplit reports no start date when the vault has no dates", () => {
  const watched = [
    { id: "1", userRating: 9 },
    { id: "2", userRating: 8 },
    { id: "3", userRating: 5 },
    { id: "4", userRating: 10 }
  ];
  const split = temporalHoldoutSplit(watched, 1, 8);
  assert.equal(split.holdoutStartTs, null);
});

test("evaluateRanker reports insufficient data instead of a number for a tiny vault", async () => {
  const tiny = vaults[0].watched.slice(0, 4);
  const res = await evaluateRanker({ watched: tiny, catalog, strategy: "ranker" });
  assert.equal(res.status, "insufficient_data");
  assert.ok(res.reason.length > 0);
  assert.equal(res.metrics, undefined);
});

test("evaluateRanker scores the real ranker on a persona vault without leaking training films", async () => {
  const { watched } = vaults[0];
  const res = await evaluateRanker({ watched, catalog, strategy: "ranker" });
  assert.equal(res.status, "ok");

  const split = temporalHoldoutSplit(watched, 10, 8);
  assert.equal(res.counts.train, split.trainWatched.length);
  assert.equal(res.counts.candidates, catalog.length - split.trainWatched.length);
  assert.equal(res.counts.holdoutPositives, split.holdoutPositives.size);
  assert.equal(res.counts.holdoutInCandidates, split.holdoutPositives.size);

  for (const key of ["recallAt20", "ndcgAt10", "novelty"]) {
    assert.ok(Number.isFinite(res.metrics[key]), `${key} must be finite`);
  }
  assert.ok(res.metrics.ndcgAt10 >= 0 && res.metrics.ndcgAt10 <= 1);
  assert.ok(res.metrics.recallAt20 >= 0 && res.metrics.recallAt20 <= 1);
});

test("evaluateRanker is deterministic for every strategy", async () => {
  const { watched } = vaults[1];
  for (const strategy of ["ranker", "popularity", "toy", "random"]) {
    const a = await evaluateRanker({ watched, catalog, strategy, seed: 3 });
    const b = await evaluateRanker({ watched, catalog, strategy, seed: 3 });
    assert.deepEqual(a, b, `${strategy} must be reproducible`);
  }
});

test("evaluateRanker rejects unknown strategies", async () => {
  await assert.rejects(
    evaluateRanker({ watched: vaults[0].watched, catalog, strategy: "magic" }),
    /Unknown strategy/
  );
});

test("a collaborative similarity map that favours the held-out films raises NDCG@10", async () => {
  const { watched } = vaults[2];
  const split = temporalHoldoutSplit(watched, 10, 8);

  const base = await evaluateRanker({ watched, catalog, strategy: "ranker" });
  const oracleMap = new Map(
    catalog.map(c => [c.id, split.holdoutPositives.has(String(c.id)) ? 1 : 0])
  );
  const boosted = await evaluateRanker({
    watched,
    catalog,
    strategy: "ranker",
    collabSimMap: oracleMap
  });

  assert.ok(
    boosted.metrics.ndcgAt10 > base.metrics.ndcgAt10,
    `oracle collabSim (${boosted.metrics.ndcgAt10}) must beat none (${base.metrics.ndcgAt10})`
  );
});

test("rolling-origin evaluation trains only on earlier data in every fold", async () => {
  const { watched } = vaults[0];
  const rolling = await evaluateRankerRolling({
    watched,
    catalog,
    folds: 2,
    strategies: ["ranker"]
  });

  const ranker = rolling.strategies.ranker;
  assert.equal(ranker.status, "ok");
  assert.equal(ranker.folds.length, 2);
  assert.equal(ranker.foldsUsed, 2);

  const [latest, earlier] = ranker.folds;
  assert.ok(earlier.counts.train < latest.counts.train, `train sizes ${earlier.counts.train} vs ${latest.counts.train}`);

  for (const fold of ranker.folds) {
    assert.ok(fold.counts.holdoutPositives >= 3);
    assert.equal(fold.counts.holdoutInCandidates, fold.counts.holdoutPositives);
  }
});

test("rolling-origin evaluation flags a fold whose training window is too small instead of scoring it", async () => {
  const rolling = await evaluateRankerRolling({
    watched: vaults[0].watched,
    catalog,
    folds: 3,
    strategies: ["ranker"]
  });
  const ranker = rolling.strategies.ranker;
  assert.equal(ranker.folds.length, 3);
  assert.equal(ranker.folds[2].status, "insufficient_data");
  assert.equal(ranker.foldsUsed, 2);
});

test("rolling-origin evaluation reports mean and spread per metric", async () => {
  const rolling = await evaluateRankerRolling({
    watched: vaults[0].watched,
    catalog,
    folds: 3,
    strategies: ["ranker", "random"]
  });

  const { mean, std } = rolling.strategies.ranker;
  for (const key of ["recallAt20", "ndcgAt10", "novelty"]) {
    assert.ok(Number.isFinite(mean[key]), `mean.${key}`);
    assert.ok(Number.isFinite(std[key]) && std[key] >= 0, `std.${key}`);
  }
});

test("rolling-origin evaluation reports insufficient data when no fold is usable", async () => {
  const rolling = await evaluateRankerRolling({
    watched: vaults[0].watched.slice(0, 6),
    catalog,
    folds: 3,
    strategies: ["ranker"]
  });
  assert.equal(rolling.strategies.ranker.status, "insufficient_data");
});

test("the real ranker beats random and popularity baselines across all persona vaults", async () => {
  const means = { ranker: [], random: [], popularity: [] };
  for (const vault of vaults) {
    const rolling = await evaluateRankerRolling({
      watched: vault.watched,
      catalog,
      folds: 3,
      strategies: ["ranker", "random", "popularity"],
      seed: 5
    });
    for (const name of Object.keys(means)) {
      assert.equal(rolling.strategies[name].status, "ok", `${vault.name}/${name}`);
      means[name].push(rolling.strategies[name].mean.ndcgAt10);
    }
  }
  const avg = list => list.reduce((a, b) => a + b, 0) / list.length;
  assert.ok(avg(means.ranker) > avg(means.random), `ranker ${avg(means.ranker)} vs random ${avg(means.random)}`);
  assert.ok(avg(means.ranker) > avg(means.popularity), `ranker ${avg(means.ranker)} vs popularity ${avg(means.popularity)}`);
});

test("evaluation is invariant to shifting every date by a constant (decay is relative to the holdout)", async () => {
  const { watched } = vaults[1];
  const shifted = watched.map(m => ({
    ...m,
    dateWatched: new Date(Date.parse(m.dateWatched) - 20 * 365 * 86400000).toISOString().slice(0, 10)
  }));

  for (const strategy of ["ranker", "popularity", "toy", "random"]) {
    const a = await evaluateRanker({ watched, catalog, strategy });
    const b = await evaluateRanker({ watched: shifted, catalog, strategy });
    assert.deepEqual(a.metrics, b.metrics, `${strategy} must not depend on today's date`);
  }
});

test("evaluateRanker builds collabSimMap from embeddingIndex using only training history", async () => {
  const { watched } = vaults[0];
  const split = temporalHoldoutSplit(watched, 10, 8);
  const likedTrain = split.trainWatched.filter(m => m.userRating >= 9);

  // Align embeddings of liked training films and held-out positives along [1, 0, 0, 0], others along [0, 1, 0, 0]
  const alignedSet = new Set([
    ...likedTrain.map(m => Number(m.id)),
    ...[...split.holdoutPositives].map(Number)
  ]);
  const items = catalog.map(c => ({
    tmdbId: Number(c.id),
    vector: alignedSet.has(Number(c.id)) ? [1, 0, 0, 0] : [0, 1, 0, 0]
  }));
  const embeddingIndex = parseEmbeddingBinary(encodeEmbeddingBinary(items));

  const withoutIdx = await evaluateRanker({ watched, catalog, strategy: "ranker" });
  const withIdx = await evaluateRanker({ watched, catalog, strategy: "ranker", embeddingIndex });

  assert.ok(
    withIdx.metrics.ndcgAt10 > withoutIdx.metrics.ndcgAt10,
    `expected embeddingIndex to improve ndcgAt10 (${withIdx.metrics.ndcgAt10} vs ${withoutIdx.metrics.ndcgAt10})`
  );
  assert.ok(withIdx.coverage.vaultCovered > 0);
  assert.ok(withIdx.coverage.catalogCovered > 0);
});

test("formatEvalReport renders a comparable table of strategies", async () => {
  const rolling = await evaluateRankerRolling({
    watched: vaults[0].watched,
    catalog,
    folds: 2,
    strategies: ["ranker", "popularity"]
  });
  const text = formatEvalReport(rolling);
  assert.match(text, /ranker/);
  assert.match(text, /popularity/);
  assert.match(text, /ndcgAt10/);
});

test("evaluateRanker reports negHitAt20, uniqueRecommendedCount, medianCandidateVotes, and supports contentIndex/dnaIndex", async () => {
  const { encodeDnaBinary, parseDnaBinary } = await import("../src/services/dnaService.js");
  const { watched } = vaults[0];
  const split = temporalHoldoutSplit(watched, 10, 8);
  const likedTrain = split.trainWatched.filter(m => m.userRating >= 8);

  const items = catalog.map(c => ({
    tmdbId: Number(c.id),
    vector: likedTrain.some(m => Number(m.id) === Number(c.id)) || split.holdoutPositives.has(String(c.id))
      ? [1, 0, 0, 0]
      : [0, 1, 0, 0]
  }));
  const contentIndex = parseEmbeddingBinary(encodeEmbeddingBinary(items));
  const dnaIndex = parseDnaBinary(
    encodeDnaBinary(
      catalog.map(c => ({
        tmdbId: Number(c.id),
        axes: split.holdoutPositives.has(String(c.id)) || likedTrain.some(m => Number(m.id) === Number(c.id))
          ? [95, 85, 75, 65]
          : [10, 20, 30, 40]
      }))
    )
  );

  const res = await evaluateRanker({
    watched,
    catalog,
    strategy: "ranker",
    holdoutSize: 10,
    minTrain: 5,
    minHoldoutPositives: 2,
    negativeThreshold: 4,
    contentIndex,
    dnaIndex
  });

  assert.equal(res.status, "ok");
  assert.equal(typeof res.metrics.negHitAt20, "number");
  assert.ok(res.metrics.negHitAt20 >= 0 && res.metrics.negHitAt20 <= 1);
  assert.equal(typeof res.metrics.uniqueRecommendedCount, "number");
  assert.equal(typeof res.metrics.medianCandidateVotes, "number");
  assert.ok(res.metrics.uniqueRecommendedCount > 0);
});

