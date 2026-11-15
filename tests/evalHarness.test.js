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

test("temporalHoldoutSplit retains positive films in holdout when total positives < holdoutPositiveCount", () => {
  const watched = [
    { id: "1", userRating: 6, dateWatched: "2026-01-01" },
    { id: "2", userRating: 9, dateWatched: "2026-02-01" },
    { id: "3", userRating: 5, dateWatched: "2026-03-01" },
    { id: "4", userRating: 6, dateWatched: "2026-04-01" },
    { id: "5", userRating: 5, dateWatched: "2026-05-01" }
  ];
  // Request holdoutPositiveCount=3 when only 1 positive (id="2") exists
  const split = temporalHoldoutSplit(watched, 3, 8);
  assert.ok(split.holdoutPositives.has("2"), "must include the positive film in holdoutPositives");
  assert.equal(split.trainWatched.length, 1, "keeps earlier history before the positive film in trainWatched");
});

test("selectMaskedTmdbIds is deterministic by seed, order-invariant, and empty for maskFrac=0", async () => {
  const { selectMaskedTmdbIds } = await import("../scripts/experiments/mask_eval_utils.mjs");
  const ids = Array.from({ length: 100 }, (_, i) => 1000 + i);
  const reversed = [...ids].reverse();

  assert.equal(selectMaskedTmdbIds(ids, 0, 1).size, 0);

  const a1 = selectMaskedTmdbIds(ids, 0.2, 1);
  const a1Rev = selectMaskedTmdbIds(reversed, 0.2, 1);
  const b1 = selectMaskedTmdbIds(ids, 0.2, 2);

  assert.equal(a1.size, 20);
  assert.deepEqual([...a1].sort((x, y) => x - y), [...a1Rev].sort((x, y) => x - y));
  assert.notDeepEqual([...a1].sort((x, y) => x - y), [...b1].sort((x, y) => x - y));
});

test("buildMaskedCandidateMapsForEval masks only candidate maps without altering user vector and routes masked films to coldOnly fallback", async () => {
  const {
    buildMaskedCandidateMapsForEval,
    verifyColdFallbackPath
  } = await import("../scripts/experiments/mask_eval_utils.mjs");
  const { encodeEmbeddingBinary, parseEmbeddingBinary } = await import("../src/services/embeddingService.js");
  const { evaluateRanker } = await import("../src/services/evalHarness.js");

  // 4-D toy index: film 101 (loved in train), film 102 (disliked in train),
  // candidate 201 (warm), candidate 202 (masked), candidate 203 (naturally unindexed)
  const buf = encodeEmbeddingBinary([
    { tmdbId: 101, vector: [1, 0, 0, 0] },
    { tmdbId: 102, vector: [0, 1, 0, 0] },
    { tmdbId: 201, vector: [0.95, 0.05, 0, 0] },
    { tmdbId: 202, vector: [0.9, 0.1, 0, 0] }
  ]);
  const embIndex = parseEmbeddingBinary(buf);

  const watched = [
    { id: 101, tmdbId: 101, userRating: 10, tmdbGenreIds: [878], tmdbKeywords: [4565], crewPersonId: 525, dateWatched: "2026-01-01" },
    { id: 102, tmdbId: 102, userRating: 2, tmdbGenreIds: [27], tmdbKeywords: [9999], crewPersonId: 10, dateWatched: "2026-02-01" },
    { id: 201, tmdbId: 201, userRating: 9, tmdbGenreIds: [878], tmdbKeywords: [4565], crewPersonId: 525, dateWatched: "2026-03-01" },
    { id: 202, tmdbId: 202, userRating: 9, tmdbGenreIds: [878], tmdbKeywords: [4565], crewPersonId: 525, dateWatched: "2026-04-01" },
    { id: 203, tmdbId: 203, userRating: 9, tmdbGenreIds: [878], tmdbKeywords: [4565], crewPersonId: 525, dateWatched: "2026-05-01" }
  ];
  const catalog = watched.map(w => ({ ...w, vote_average: 8.2, vote_count: 1000 }));

  // Mask both a train item (101) AND a candidate item (202):
  // User vector must still use 101 from the full index!
  const maskedIds = new Set([101, 202]);

  const unmaskedPrep = await buildMaskedCandidateMapsForEval({
    watched, catalog, holdoutSize: 3, minPositiveRating: 8, embeddingIndex: embIndex, maskedIds: new Set()
  });
  const maskedPrep = await buildMaskedCandidateMapsForEval({
    watched, catalog, holdoutSize: 3, minPositiveRating: 8, embeddingIndex: embIndex, maskedIds
  });

  // Unmasked candidate 201 must have identical collabSim & repulsion even though train film 101 was in maskedIds
  assert.equal(maskedPrep.maskedCollabSimMap.get(201), unmaskedPrep.fullCollabSimMap.get(201));
  assert.equal(maskedPrep.maskedRepulsionMap.get(201), unmaskedPrep.fullRepulsionMap.get(201));
  assert.ok((maskedPrep.maskedCollabSimMap.get(201) ?? 0) > 0.5);

  // Masked candidate 202 must have 0/absent collabSim and repulsion on candidate side
  assert.equal(maskedPrep.maskedCollabSimMap.has(202), false);
  assert.equal(maskedPrep.maskedRepulsionMap.has(202), false);

  // Verify coldOnly fallback gives structured contentSim > 0 to masked candidate 202 and 0 to warm candidate 201
  const chk = await verifyColdFallbackPath({
    watched, catalog, embeddingIndex: embIndex, maskedIds, holdoutSize: 3, minPositiveRating: 8
  });
  assert.equal(chk.verified, true);
  assert.equal(chk.maskedCandCount, 1);
  assert.equal(chk.maskedCollabZeroCount, 1);
  assert.equal(chk.maskedContentNonZeroCount, 1);
  assert.equal(chk.warmColdLeakCount, 0);

  // End-to-end evaluateRanker call runs cleanly with masked maps
  const evalRes = await evaluateRanker({
    watched,
    catalog,
    embeddingIndex: embIndex,
    collabSimMap: maskedPrep.maskedCollabSimMap,
    repulsionMap: maskedPrep.maskedRepulsionMap,
    strategy: "ranker",
    holdoutSize: 3,
    minPositiveRating: 8,
    minTrain: 2,
    includeRankedDetails: true
  });
  assert.equal(evalRes.status, "ok");
  assert.equal(evalRes.rankedIds.length, 3);
});

test("computeWarmColdBreakdown and aggregateWarmColdBreakdowns split warm, masked, and cold positives accurately", async () => {
  const { computeWarmColdBreakdown, aggregateWarmColdBreakdowns } = await import("../scripts/experiments/mask_eval_utils.mjs");
  const indexIdSet = new Set([1, 2, 3, 4]);
  const maskedIds = new Set([2, 4]); // 2 and 4 are masked cold; 5 is naturally unindexed cold; 1 and 3 are warm
  const candidateIds = ["1", "2", "3", "4", "5", "6"]; // cold in pool: 2, 4, 5, 6 (4/6 = 66.7%)
  const rankedIds = ["1", "2", "5", "3"]; // all 4 in top-20: cold top20 = 2, 5 (2/4 = 50%), masked top20 = 2
  const holdoutPositives = new Set(["1", "2", "4", "5"]); // warm: 1 (hit); masked: 2 (hit), 4 (miss); all cold: 2 (hit), 4 (miss), 5 (hit)

  // Slice top-20 of length 4 from rankedIds => wait: let's add enough warm fillers or check ratio directly
  const b = computeWarmColdBreakdown({
    rankedIds: ["1", "2", "3"], // top20 has 3 items: 1 (warm), 2 (masked cold), 3 (warm) -> cold hits: 2 (1/3), warm hits: 1 (1/1)
    candidateIds,
    holdoutPositives,
    indexIdSet,
    maskedIds
  });

  assert.equal(b.posWarmCount, 1);
  assert.equal(b.posWarmHits, 1);
  assert.equal(b.warmRecall20, 1.0);

  assert.equal(b.posColdCount, 3); // ids 2, 4, 5
  assert.equal(b.posColdHits, 1); // only id 2 in rankedIds
  assert.ok(Math.abs(b.coldRecall20 - 1 / 3) < 1e-9);

  assert.equal(b.posMaskedCount, 2); // ids 2, 4 (5 is unindexed, not masked)
  assert.equal(b.posMaskedHits, 1); // id 2
  assert.equal(b.maskedRecall20, 0.5);

  assert.ok(Math.abs(b.top20ColdShare - 1 / 3) < 1e-9);
  assert.ok(Math.abs(b.poolColdShare - 4 / 6) < 1e-9);
  assert.equal(b.holdoutColdShare, 0.75);

  const agg = aggregateWarmColdBreakdowns([b]);
  assert.equal(agg.nUsers, 1);
  assert.equal(agg.totalColdPos, 3);
  assert.equal(agg.totalColdHits, 1);
  assert.equal(agg.totalWarmPos, 1);
  assert.equal(agg.totalWarmHits, 1);
  assert.equal(agg.microMaskedRecall20, 0.5);
});

test("evaluateBucketECohort computes isolated Bucket E recall, index ceiling, indexed-only recall, hit rate, and 30->60 marginals", async () => {
  const { evaluateBucketECohort, retrieveBucketENeighborsForTrainVault } = await import(
    "../scripts/experiments/bucket_e_recall.mjs"
  );
  const { encodeEmbeddingBinary, parseEmbeddingBinary } = await import("../src/services/embeddingService.js");

  // Build synthetic index of 70 items: 101 (loved in train), 102 (disliked in train),
  // holdout items 201 (rank <= 30), 202 (rank 31..60), 203 (rank > 60), 9999 (unindexed),
  // plus filler items 500..564 sorted smoothly by alignment with [1, 0, 0, 0].
  const items = [
    { tmdbId: 101, vector: [1, 0, 0, 0] },
    { tmdbId: 102, vector: [0, 1, 0, 0] },
    { tmdbId: 201, vector: [0.99, 0, 0, 0.1] },
    { tmdbId: 202, vector: [0.65, 0, 0, 0.76] },
    { tmdbId: 203, vector: [0.1, 0, 0, 0.99] }
  ];
  // Top 35 fillers strictly better than 202 ([0.65, 0, 0, 0.76]) so 202 lands around rank 37 (in 30..60)
  for (let i = 0; i < 65; i++) {
    const x = i < 35 ? 0.98 - i * 0.008 : 0.6 - (i - 35) * 0.01;
    const w = Math.sqrt(Math.max(0, 1 - x * x));
    items.push({ tmdbId: 500 + i, vector: [x, 0, 0, w] });
  }
  const emb = parseEmbeddingBinary(encodeEmbeddingBinary(items));

  const trainRatings = Array.from({ length: 12 }, (_, idx) => ({
    id: idx === 0 ? 101 : idx === 1 ? 102 : 700 + idx,
    tmdbId: idx === 0 ? 101 : idx === 1 ? 102 : 700 + idx,
    userRating: idx === 0 ? 10 : idx === 1 ? 2 : 6,
    dateWatched: `2026-01-${String(idx + 1).padStart(2, "0")}`
  }));
  const holdoutRatings = [
    { id: 201, tmdbId: 201, userRating: 9, dateWatched: "2026-02-01" },
    { id: 202, tmdbId: 202, userRating: 9, dateWatched: "2026-02-02" },
    { id: 203, tmdbId: 203, userRating: 9, dateWatched: "2026-02-03" },
    ...Array.from({ length: 7 }, (_, i) => ({
      id: 9900 + i,
      tmdbId: 9900 + i,
      userRating: 8,
      dateWatched: `2026-02-${String(i + 4).padStart(2, "0")}`
    }))
  ];
  const user = { uid: "u1", ratings: [...trainRatings, ...holdoutRatings] };

  // Prefix invariance check: slice(0, 30) matches calling with maxK=30
  const n30 = await retrieveBucketENeighborsForTrainVault(trainRatings, null, emb, 30);
  const n60 = await retrieveBucketENeighborsForTrainVault(trainRatings, null, emb, 60);
  assert.deepEqual(n60.slice(0, 30).map(x => x.tmdbId), n30.map(x => x.tmdbId));
  assert.equal(n30.some(x => x.tmdbId === 101), false, "train vault item must be excluded");

  const report = await evaluateBucketECohort([user], emb, 8, [15, 30, 60, 150]);
  assert.equal(report.validUsers, 1);
  assert.equal(report.totalHoldoutPos, 10);
  assert.equal(report.indexedHoldoutPos, 3);
  assert.equal(report.indexCeilingMicro, 0.3);

  const row30 = report.byK.find(r => r.topK === 30);
  const row60 = report.byK.find(r => r.topK === 60);
  assert.equal(row30.totalHits, 1);
  assert.equal(row30.recallMicro, 0.1);
  assert.ok(Math.abs(row30.indexedRecallMicro - 1 / 3) < 1e-9);
  assert.equal(row60.totalHits, 2);
  assert.equal(report.marginal30to60.marginalHits, 1);
});

test("evaluateWithinColdCohort ranks only masked candidates, computes random baseline, warm subpool/fullpool baselines, and zero structured contentSim share", async () => {
  const { evaluateWithinColdCohort } = await import("../scripts/experiments/within_cold_eval.mjs");
  const { encodeEmbeddingBinary, parseEmbeddingBinary } = await import("../src/services/embeddingService.js");
  const { selectMaskedTmdbIds } = await import("../scripts/experiments/mask_eval_utils.mjs");

  // 24 items in index: train 101..110 (101..104 liked scifi+kw4565+crew525, 105..110 disliked horror),
  // holdout positives 201..210, extra catalog 301..304.
  const embItems = [];
  const catalog = [];
  for (let i = 1; i <= 10; i++) {
    const id = 100 + i;
    const liked = i <= 4;
    embItems.push({ tmdbId: id, vector: liked ? [1, 0, 0, 0] : [0, 1, 0, 0] });
    catalog.push({
      id,
      tmdbId: id,
      title: `Train ${id}`,
      userRating: liked ? 9 : 4,
      tmdbGenreIds: liked ? [878] : [27],
      tmdbKeywords: liked ? [4565] : [9999],
      crewPersonId: liked ? 525 : 10,
      vote_average: 7.5,
      vote_count: 800,
      dateWatched: `2026-01-${String(i).padStart(2, "0")}`
    });
  }
  for (let i = 1; i <= 10; i++) {
    const id = 200 + i;
    const noMetaMatch = i === 10;
    embItems.push({ tmdbId: id, vector: [0.95, 0.05, 0, 0] });
    catalog.push({
      id,
      tmdbId: id,
      title: `HoldoutPos ${id}`,
      userRating: 9,
      tmdbGenreIds: noMetaMatch ? [99] : [878],
      tmdbKeywords: noMetaMatch ? [7777] : [4565],
      crewPersonId: noMetaMatch ? 888 : 525,
      vote_average: noMetaMatch ? 6.0 : 8.5,
      vote_count: 900,
      dateWatched: `2026-02-${String(i).padStart(2, "0")}`
    });
  }
  for (let i = 1; i <= 4; i++) {
    const id = 300 + i;
    embItems.push({ tmdbId: id, vector: [0.1, 0.9, 0, 0] });
    catalog.push({
      id,
      tmdbId: id,
      title: `Filler ${id}`,
      tmdbGenreIds: [27],
      tmdbKeywords: [9999],
      crewPersonId: 10,
      vote_average: 5.5,
      vote_count: 500
    });
  }

  const emb = parseEmbeddingBinary(encodeEmbeddingBinary(embItems));
  const user = { uid: "u1", ratings: catalog.slice(0, 20) };

  const maskedHalf = selectMaskedTmdbIds(emb.ids, 0.5, 1);
  assert.ok(maskedHalf.size >= 10);

  const report = await evaluateWithinColdCohort(
    [user],
    catalog,
    emb,
    8,
    [{ maskFrac: 0.5, maskSeed: 1 }]
  );
  assert.equal(report.eligibleUsers, 1);
  assert.equal(report.perSeed.length, 1);
  const s = report.perSeed[0];
  assert.equal(s.nEvaluatedUsers, 1);
  assert.ok(s.meanMaskedCandidates > 0 && s.meanMaskedCandidates < 14);
  assert.ok(Math.abs(s.randomRecall20 - Math.min(1, 20 / s.meanMaskedCandidates)) < 1e-9);
  assert.ok(s.coldRecall20Macro >= 0 && s.coldRecall20Macro <= 1);
  assert.ok(s.warmSubpoolRecall20Macro >= 0 && s.warmSubpoolRecall20Macro <= 1);
  assert.ok(s.zeroContentSimMicro >= 0 && s.zeroContentSimMicro <= 1);
});

test("selectTopKWithColdQuota keys strictly on collabSim === 0 (ignoring release date) and fills N slots by rankerProbability", async () => {
  const {
    selectTopKWithColdQuota,
    isCollabColdCandidate,
    scoreTopKSlateWarmCold
  } = await import("../scripts/experiments/cold_quota_eval.mjs");

  const mk = (id, rawCollabSim, prob, releaseDate) => ({
    id,
    tmdbId: id,
    release_date: releaseDate,
    features: { rawCollabSim, collabSim: rawCollabSim },
    rankerProbability: prob
  });

  // Construct ordered descending list:
  // - Warm items with 2026 release dates must NOT be treated as cold!
  // - Cold items (rawCollabSim === 0) with 1995 release dates MUST be treated as cold!
  const ordered = [
    mk(1, 0.9, 0.99, "2026-06-01"),
    mk(2, 0.8, 0.98, "2026-05-01"),
    mk(3, 0.7, 0.97, "2025-01-01"),
    mk(4, 0.6, 0.96, "2024-01-01"),
    mk(5, 0.5, 0.95, "2022-01-01"),
    mk(6, 0.4, 0.94, "2021-01-01"),
    mk(7, 0.3, 0.93, "2020-01-01"),
    mk(8, 0.2, 0.92, "2019-01-01"),
    mk(9, 0.1, 0.91, "2018-01-01"),
    mk(10, 0.05, 0.90, "2017-01-01"),
    mk(101, 0, 0.75, "1995-01-01"), // old release year, collabSim === 0 -> cold!
    mk(102, 0, 0.74, "1998-01-01"),
    mk(103, 0, 0.73, "2001-01-01")
  ];

  assert.equal(isCollabColdCandidate(ordered[0]), false);
  assert.equal(isCollabColdCandidate(ordered[10]), true);

  const q0 = selectTopKWithColdQuota(ordered, 0, 10);
  assert.deepEqual(q0.map(x => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const q3 = selectTopKWithColdQuota(ordered, 3, 10);
  assert.equal(q3.length, 10);
  assert.equal(q3.filter(isCollabColdCandidate).length, 3);
  assert.deepEqual(q3.map(x => x.id), [1, 2, 3, 4, 5, 6, 7, 101, 102, 103]);

  // If fewer cold items exist than requested quota N=5, fills with all available cold + best warm remaining
  const q5 = selectTopKWithColdQuota(ordered, 5, 10);
  assert.equal(q5.length, 10);
  assert.equal(q5.filter(isCollabColdCandidate).length, 3);
  assert.deepEqual(q5.map(x => x.id), [1, 2, 3, 4, 5, 6, 7, 101, 102, 103]); // slots 1..5 warm, 101..103 cold, 6..7 backfill warm -> [1..7, 101..103]

  const holdoutPos = new Set(["1", "101", "102"]);
  const holdoutRel = new Map([["1", 10], ["101", 9], ["102", 8]]);
  const coldSet = new Set(["101", "102", "103"]);
  const stats = scoreTopKSlateWarmCold(q3, holdoutPos, holdoutRel, coldSet, 10);
  assert.equal(stats.coldSlots, 3);
  assert.equal(stats.coldHits, 2);
  assert.equal(stats.warmHits, 1);
  assert.equal(stats.recall10, 1.0);
  assert.equal(stats.coldRecall10, 1.0);
  assert.equal(stats.warmRecall10, 1.0);
});
