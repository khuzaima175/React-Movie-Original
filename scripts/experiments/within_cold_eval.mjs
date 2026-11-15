import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex
} = await imp("src/services/embeddingService.js");
const { buildContentSimMap } = await imp("src/services/contentSimService.js");
const { DEFAULT_RANKER_WEIGHTS, rankCandidatePool } = await imp("src/services/rankerService.js");
const { extractTasteProfile } = await imp("src/services/tmdbService.js");
const {
  temporalHoldoutSplit,
  computeRecallAtK,
  computeNDCGAtK
} = await imp("src/services/evalHarness.js");
const {
  selectMaskedTmdbIds,
  maskSimMapCandidates
} = await imp("scripts/experiments/mask_eval_utils.mjs");
const {
  loadDatasets,
  loadEmb,
  pairedBootstrapCI,
  formatCI
} = await imp("scripts/experiments/run_ablation.mjs");

export const DEFAULT_MASK_CONFIGS = [
  { maskFrac: 0.15, maskSeed: 1 },
  { maskFrac: 0.15, maskSeed: 2 },
  { maskFrac: 0.15, maskSeed: 3 },
  { maskFrac: 0.30, maskSeed: 1 },
  { maskFrac: 0.30, maskSeed: 2 },
  { maskFrac: 0.30, maskSeed: 3 }
];

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

function meanArr(vals = []) {
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

/**
 * Evaluates within-cold ranking quality over ONLY masked candidates (collabSim === 0)
 * alongside random baseline (20 / n_masked), warm subpool (same masked candidates with
 * mask=0 embeddings), warm full-pool (mask=0 full catalog), and zero structured
 * contentSim share among masked positives.
 */
export async function evaluateWithinColdCohort(
  users = [],
  catalog = [],
  emb = null,
  minPos = 8,
  maskConfigs = DEFAULT_MASK_CONFIGS,
  options = {}
) {
  if (!emb || !emb.ids || emb.ids.length === 0) {
    throw new Error("evaluateWithinColdCohort requires a non-null embedding index.");
  }

  const weights = options.weights || DEFAULT_RANKER_WEIGHTS;
  const minTrain = options.minTrain ?? 10;
  const minHoldoutPositives = options.minHoldoutPositives ?? 3;
  const holdoutSize = options.holdoutSize ?? 10;

  const maskedSetsByConfig = maskConfigs.map(cfg => ({
    maskFrac: Number(cfg.maskFrac),
    maskSeed: Number(cfg.maskSeed),
    key: `${cfg.maskFrac}:${cfg.maskSeed}`,
    maskedIds: selectMaskedTmdbIds(emb.ids, cfg.maskFrac, cfg.maskSeed)
  }));

  const perConfigAcc = maskedSetsByConfig.map(mc => ({
    maskFrac: mc.maskFrac,
    maskSeed: mc.maskSeed,
    nEvaluatedUsers: 0,
    totalMaskedCandidatesSum: 0,
    totalMaskedPositives: 0,
    zeroContentPosCount: 0,
    coldHits20Sum: 0,
    warmSubHits20Sum: 0,
    warmFullHits20Sum: 0,
    coldRec20: {},
    coldNdcg10: {},
    randomRec20: {},
    warmSubRec20: {},
    warmSubNdcg10: {},
    warmFullRec20: {},
    warmFullNdcg10: {},
    zeroContentShare: {}
  }));

  let eligibleUsers = 0;

  for (const u of users || []) {
    const split = temporalHoldoutSplit(u.ratings, holdoutSize, minPos);
    if (split.trainWatched.length < minTrain || split.holdoutPositives.size < minHoldoutPositives) {
      continue;
    }

    const holdoutKeys = new Set(split.holdoutRelevance.keys());
    const excluded = new Set();
    for (const m of u.ratings || []) {
      const k = getMovieKey(m);
      if (k && !holdoutKeys.has(k)) excluded.add(k);
    }
    const candidates = (catalog || []).filter(c => {
      const k = getMovieKey(c);
      return k && !excluded.has(k);
    });
    if (candidates.length === 0) continue;

    eligibleUsers++;

    const profile = await extractTasteProfile(split.trainWatched, [], {
      now: split.holdoutStartTs ?? undefined,
      anchorCutoff: Infinity
    });
    const baseCtx = {
      profile,
      anchorKeywords: profile.lovedKeywordIds || [],
      userProviders: []
    };

    const fullCollabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, emb);
    const fullRepulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, emb);

    // Mask=0 full-pool baseline computed once per user so we can evaluate the exact
    // same masked holdout positives when they sit inside the full unmasked pool.
    const fullWarmContentSimMap = buildContentSimMap(profile.weightedRatings, null, candidates, {
      collabIndex: emb,
      collabSimMap: fullCollabSimMap,
      enableStructuredFallback: true,
      coldOnly: true
    });
    const fullWarmRanked = rankCandidatePool(
      candidates,
      {
        ...baseCtx,
        collabSimMap: fullCollabSimMap,
        contentSimMap: fullWarmContentSimMap,
        repulsionMap: fullRepulsionMap
      },
      weights,
      candidates.length
    );
    const fullWarmRankedIds = fullWarmRanked.map(getMovieKey);

    for (let idx = 0; idx < maskedSetsByConfig.length; idx++) {
      const { maskedIds } = maskedSetsByConfig[idx];
      const acc = perConfigAcc[idx];

      const maskedCandidates = [];
      for (const c of candidates) {
        const tid = Number(c?.tmdbId ?? c?.id ?? 0);
        if (tid > 0 && maskedIds.has(tid)) maskedCandidates.push(c);
      }
      if (maskedCandidates.length === 0) continue;

      const maskedPos = new Set();
      const maskedRel = new Map();
      const maskedCandKeySet = new Set(maskedCandidates.map(getMovieKey));
      for (const id of split.holdoutPositives) {
        const key = String(id);
        if (maskedCandKeySet.has(key)) {
          maskedPos.add(key);
          maskedRel.set(key, Number(split.holdoutRelevance.get(key) ?? minPos));
        }
      }
      if (maskedPos.size === 0) continue;

      const uid = String(u.uid);
      acc.nEvaluatedUsers++;
      acc.totalMaskedCandidatesSum += maskedCandidates.length;
      acc.totalMaskedPositives += maskedPos.size;

      // Candidate-only masked maps ensure collabSim === 0 and repulsion === 0
      // on every masked candidate while user taste vector came from the full index.
      const maskedCollabSimMap = maskSimMapCandidates(fullCollabSimMap, maskedIds);
      const maskedRepulsionMap = maskSimMapCandidates(fullRepulsionMap, maskedIds);
      const coldContentSimMap = buildContentSimMap(
        profile.weightedRatings,
        null,
        maskedCandidates,
        {
          collabIndex: emb,
          collabSimMap: maskedCollabSimMap,
          enableStructuredFallback: true,
          coldOnly: true
        }
      );

      let zeroContentHere = 0;
      for (const key of maskedPos) {
        const tid = Number(key);
        const sim = Number(coldContentSimMap.get(tid) ?? 0);
        if (sim <= 0) zeroContentHere++;
      }
      acc.zeroContentPosCount += zeroContentHere;
      acc.zeroContentShare[uid] = zeroContentHere / maskedPos.size;

      const coldRanked = rankCandidatePool(
        maskedCandidates,
        {
          ...baseCtx,
          collabSimMap: maskedCollabSimMap,
          contentSimMap: coldContentSimMap,
          repulsionMap: maskedRepulsionMap
        },
        weights,
        maskedCandidates.length
      );
      const coldRankedIds = coldRanked.map(getMovieKey);

      const warmSubContentSimMap = buildContentSimMap(
        profile.weightedRatings,
        null,
        maskedCandidates,
        {
          collabIndex: emb,
          collabSimMap: fullCollabSimMap,
          enableStructuredFallback: true,
          coldOnly: true
        }
      );
      const warmSubRanked = rankCandidatePool(
        maskedCandidates,
        {
          ...baseCtx,
          collabSimMap: fullCollabSimMap,
          contentSimMap: warmSubContentSimMap,
          repulsionMap: fullRepulsionMap
        },
        weights,
        maskedCandidates.length
      );
      const warmSubRankedIds = warmSubRanked.map(getMovieKey);

      const cRec = computeRecallAtK(coldRankedIds, maskedPos, 20);
      const cNdcg = computeNDCGAtK(coldRankedIds, maskedRel, 10);
      const rRec = Math.min(1, 20 / maskedCandidates.length);
      const wsRec = computeRecallAtK(warmSubRankedIds, maskedPos, 20);
      const wsNdcg = computeNDCGAtK(warmSubRankedIds, maskedRel, 10);
      const wfRec = computeRecallAtK(fullWarmRankedIds, maskedPos, 20);
      const wfNdcg = computeNDCGAtK(fullWarmRankedIds, maskedRel, 10);

      acc.coldRec20[uid] = cRec;
      acc.coldNdcg10[uid] = cNdcg;
      acc.randomRec20[uid] = rRec;
      acc.warmSubRec20[uid] = wsRec;
      acc.warmSubNdcg10[uid] = wsNdcg;
      acc.warmFullRec20[uid] = wfRec;
      acc.warmFullNdcg10[uid] = wfNdcg;

      acc.coldHits20Sum += Math.round(cRec * maskedPos.size);
      acc.warmSubHits20Sum += Math.round(wsRec * maskedPos.size);
      acc.warmFullHits20Sum += Math.round(wfRec * maskedPos.size);
    }
  }

  const perSeed = perConfigAcc.map(acc => {
    const n = acc.nEvaluatedUsers;
    const nMaskedMean = n > 0 ? acc.totalMaskedCandidatesSum / n : 0;
    const meanMetric = obj => meanArr(Object.values(obj));
    return {
      maskFrac: acc.maskFrac,
      maskSeed: acc.maskSeed,
      nEvaluatedUsers: n,
      eligibleUsers,
      meanMaskedCandidates: nMaskedMean,
      totalMaskedPositives: acc.totalMaskedPositives,
      coldRecall20Macro: meanMetric(acc.coldRec20),
      coldRecall20Micro: acc.totalMaskedPositives > 0 ? acc.coldHits20Sum / acc.totalMaskedPositives : 0,
      coldNdcg10Macro: meanMetric(acc.coldNdcg10),
      randomRecall20: meanMetric(acc.randomRec20),
      warmSubpoolRecall20Macro: meanMetric(acc.warmSubRec20),
      warmSubpoolRecall20Micro: acc.totalMaskedPositives > 0 ? acc.warmSubHits20Sum / acc.totalMaskedPositives : 0,
      warmSubpoolNdcg10Macro: meanMetric(acc.warmSubNdcg10),
      warmFullpoolRecall20Macro: meanMetric(acc.warmFullRec20),
      warmFullpoolRecall20Micro: acc.totalMaskedPositives > 0 ? acc.warmFullHits20Sum / acc.totalMaskedPositives : 0,
      warmFullpoolNdcg10Macro: meanMetric(acc.warmFullNdcg10),
      zeroContentSimMacro: meanMetric(acc.zeroContentShare),
      zeroContentSimMicro: acc.totalMaskedPositives > 0 ? acc.zeroContentPosCount / acc.totalMaskedPositives : 0,
      zeroContentPosCount: acc.zeroContentPosCount,
      perUser: {
        coldRec20: acc.coldRec20,
        coldNdcg10: acc.coldNdcg10,
        randomRec20: acc.randomRec20,
        warmSubRec20: acc.warmSubRec20,
        warmSubNdcg10: acc.warmSubNdcg10,
        warmFullRec20: acc.warmFullRec20,
        warmFullNdcg10: acc.warmFullNdcg10,
        zeroContentShare: acc.zeroContentShare
      }
    };
  });

  const fracGroups = [];
  const uniqueFracs = [...new Set(perSeed.map(s => s.maskFrac))].sort((a, b) => a - b);

  for (const frac of uniqueFracs) {
    const group = perSeed.filter(s => s.maskFrac === frac);
    const seedAvgUserMap = field => {
      const sums = {};
      const counts = {};
      for (const s of group) {
        for (const [uid, val] of Object.entries(s.perUser[field])) {
          sums[uid] = (sums[uid] || 0) + val;
          counts[uid] = (counts[uid] || 0) + 1;
        }
      }
      const out = {};
      for (const uid of Object.keys(sums)) out[uid] = sums[uid] / counts[uid];
      return out;
    };

    const userColdRec = seedAvgUserMap("coldRec20");
    const userColdNdcg = seedAvgUserMap("coldNdcg10");
    const userRandomRec = seedAvgUserMap("randomRec20");
    const userWarmSubRec = seedAvgUserMap("warmSubRec20");
    const userWarmSubNdcg = seedAvgUserMap("warmSubNdcg10");

    const sumPos = group.reduce((s, x) => s + x.totalMaskedPositives, 0);
    const sumZero = group.reduce((s, x) => s + x.zeroContentPosCount, 0);
    const sumColdHits = group.reduce((s, x) => s + Math.round(x.coldRecall20Micro * x.totalMaskedPositives), 0);
    const sumWarmSubHits = group.reduce((s, x) => s + Math.round(x.warmSubpoolRecall20Micro * x.totalMaskedPositives), 0);
    const sumWarmFullHits = group.reduce((s, x) => s + Math.round(x.warmFullpoolRecall20Micro * x.totalMaskedPositives), 0);

    fracGroups.push({
      maskFrac: frac,
      seeds: group.length,
      eligibleUsers,
      meanEvaluatedUsersPerSeed: meanArr(group.map(s => s.nEvaluatedUsers)),
      uniqueEvaluatedUsersAcrossSeeds: Object.keys(userColdRec).length,
      meanMaskedCandidates: meanArr(group.map(s => s.meanMaskedCandidates)),
      totalMaskedPositivesAcrossSeeds: sumPos,
      meanMaskedPositivesPerSeed: meanArr(group.map(s => s.totalMaskedPositives)),
      coldRecall20Macro: meanArr(group.map(s => s.coldRecall20Macro)),
      coldRecall20Micro: sumPos > 0 ? sumColdHits / sumPos : 0,
      coldNdcg10Macro: meanArr(group.map(s => s.coldNdcg10Macro)),
      randomRecall20: meanArr(group.map(s => s.randomRecall20)),
      warmSubpoolRecall20Macro: meanArr(group.map(s => s.warmSubpoolRecall20Macro)),
      warmSubpoolRecall20Micro: sumPos > 0 ? sumWarmSubHits / sumPos : 0,
      warmSubpoolNdcg10Macro: meanArr(group.map(s => s.warmSubpoolNdcg10Macro)),
      warmFullpoolRecall20Macro: meanArr(group.map(s => s.warmFullpoolRecall20Macro)),
      warmFullpoolRecall20Micro: sumPos > 0 ? sumWarmFullHits / sumPos : 0,
      warmFullpoolNdcg10Macro: meanArr(group.map(s => s.warmFullpoolNdcg10Macro)),
      zeroContentSimMacro: meanArr(group.map(s => s.zeroContentSimMacro)),
      zeroContentSimMicro: sumPos > 0 ? sumZero / sumPos : 0,
      ciColdVsWarmSubpoolRec20: pairedBootstrapCI(userColdRec, userWarmSubRec),
      ciColdVsWarmSubpoolNdcg10: pairedBootstrapCI(userColdNdcg, userWarmSubNdcg),
      ciColdVsRandomRec20: pairedBootstrapCI(userColdRec, userRandomRec)
    });
  }

  return {
    minPos,
    eligibleUsers,
    summaryByMaskFrac: fracGroups,
    perSeed: perSeed.map(({ perUser, ...rest }) => rest)
  };
}

function buildMarkdownReport(report) {
  const fmt = v => (v !== null && v !== undefined && Number.isFinite(v) ? v.toFixed(4) : "n/a");
  const pct = v => (v !== null && v !== undefined && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "n/a");

  const lines = [
    "# Within-Cold Ranking Quality Evaluation (`clean2` Index)",
    "",
    `- Generated: \`${report.generatedAt}\``,
    "- Protocol: For each `(cohort, minPos)` and `(maskFrac ∈ {0.15, 0.30}, seed ∈ {1, 2, 3})`, rank **only** the masked candidates (`collabSim === 0`) via `rankCandidatePool` with `coldOnly: true` structured `contentSim`, and compare among masked holdout positives against the random baseline (`20 / n_masked`) and the exact same positives when warm (`mask = 0`, both within the same `n_masked` subpool and inside the full unmasked ~9.7k pool).",
    "",
    "## Summary Across Seeds (`{1, 2, 3}`)",
    "",
    "| Cohort | Mask | Mean `n_masked` | Eval Users/Seed (`pos` Sum) | Cold Rec@20 (Micro) | Random (`20/n`) | Cold vs Random `Rec@20` (95% CI) | Warm Subpool Rec@20 | Warm FullPool Rec@20 | Cold NDCG@10 | Warm Subpool NDCG@10 | Warm FullPool NDCG@10 | Cold vs Warm Subpool `NDCG@10` (95% CI) | Zero Structured `contentSim` (Micro / Macro) |",
    "| :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: |"
  ];

  for (const ds of report.datasets) {
    for (const g of ds.summaryByMaskFrac) {
      lines.push(
        `| ${ds.label} | ${(g.maskFrac * 100).toFixed(0)}% | ${g.meanMaskedCandidates.toFixed(0)} | ${g.meanEvaluatedUsersPerSeed.toFixed(1)} (${g.totalMaskedPositivesAcrossSeeds}) | ${fmt(g.coldRecall20Macro)} (${fmt(g.coldRecall20Micro)}) | ${fmt(g.randomRecall20)} | ${formatCI(g.ciColdVsRandomRec20)} | ${fmt(g.warmSubpoolRecall20Macro)} | ${fmt(g.warmFullpoolRecall20Macro)} | ${fmt(g.coldNdcg10Macro)} | ${fmt(g.warmSubpoolNdcg10Macro)} | ${fmt(g.warmFullpoolNdcg10Macro)} | ${formatCI(g.ciColdVsWarmSubpoolNdcg10)} | ${pct(g.zeroContentSimMicro)} / ${pct(g.zeroContentSimMacro)} |`
      );
    }
  }

  lines.push(
    "",
    "## Per-Seed Breakdown",
    "",
    "| Cohort | Mask | Seed | Eval Users (`pos`) | Mean `n_masked` | Cold Rec@20 | Random Rec@20 | Warm Sub Rec@20 | Warm Full Rec@20 | Cold NDCG@10 | Warm Sub NDCG@10 | Zero `contentSim` (Micro) |",
    "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
  );

  for (const ds of report.datasets) {
    for (const s of ds.perSeed) {
      lines.push(
        `| ${ds.label} | ${(s.maskFrac * 100).toFixed(0)}% | ${s.maskSeed} | ${s.nEvaluatedUsers} (${s.totalMaskedPositives}) | ${s.meanMaskedCandidates.toFixed(0)} | ${fmt(s.coldRecall20Macro)} | ${fmt(s.randomRecall20)} | ${fmt(s.warmSubpoolRecall20Macro)} | ${fmt(s.warmFullpoolRecall20Macro)} | ${fmt(s.coldNdcg10Macro)} | ${fmt(s.warmSubpoolNdcg10Macro)} | ${pct(s.zeroContentSimMicro)} |`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

const isDirectMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectMain) {
  const t0 = Date.now();
  const { catalog, users328, users300 } = loadDatasets();
  const embClean2 = loadEmb(".data/item_embeddings_clean2_f16.bin");

  const specs = [
    { label: "328 >=8★", users: users328, minPos: 8 },
    { label: "328 >=9★", users: users328, minPos: 9 },
    { label: "fresh_300 >=8★", users: users300, minPos: 8 },
    { label: "fresh_300 >=9★", users: users300, minPos: 9 }
  ];

  const datasets = [];
  for (const spec of specs) {
    const tSpec = Date.now();
    const res = await evaluateWithinColdCohort(spec.users, catalog, embClean2, spec.minPos, DEFAULT_MASK_CONFIGS);
    datasets.push({ label: spec.label, ...res });
    console.log(`Finished ${spec.label} in ${((Date.now() - tSpec) / 1000).toFixed(1)}s`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    embeddingIndexPath: ".data/item_embeddings_clean2_f16.bin",
    maskConfigs: DEFAULT_MASK_CONFIGS,
    datasets
  };

  const outDir = path.join(ROOT, "scripts/experiments/results");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonOut = path.join(outDir, "within_cold_eval.json");
  const mdOut = path.join(outDir, "within_cold_eval.md");
  const md = buildMarkdownReport(report);
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdOut, md);

  console.log(md);
  console.log(`Completed all within-cold evaluations in ${((Date.now() - t0) / 1000).toFixed(1)}s. Saved ${jsonOut} and ${mdOut}`);
}
