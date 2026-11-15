import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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

export const COLD_QUOTA_VALUES = [0, 2, 3, 5];
export const TOP_K_FINAL = 10;
export const RUN_CONFIGS = [
  { maskFrac: 0, maskSeed: 1, tag: "m0_s1" },
  { maskFrac: 0.15, maskSeed: 1, tag: "m15_s1" },
  { maskFrac: 0.15, maskSeed: 2, tag: "m15_s2" },
  { maskFrac: 0.15, maskSeed: 3, tag: "m15_s3" },
  { maskFrac: 0.30, maskSeed: 1, tag: "m30_s1" },
  { maskFrac: 0.30, maskSeed: 2, tag: "m30_s2" },
  { maskFrac: 0.30, maskSeed: 3, tag: "m30_s3" }
];

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

function meanArr(vals = []) {
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

/**
 * Cold classifier keyed strictly on collaborative signal (`collabSim === 0`),
 * intentionally independent of candidate release date.
 */
export function isCollabColdCandidate(cand) {
  return Number(cand?.features?.rawCollabSim ?? cand?.features?.collabSim ?? 0) === 0;
}

/**
 * Harness-only selector that guarantees up to `coldQuota` slots in the final `topK`
 * are filled by cold candidates (`collabSim === 0`), chosen in descending
 * `rankerProbability` order among cold candidates, while filling remaining slots
 * from top-ranked candidates overall. Preserves descending `rankerProbability`
 * ordering across the final `topK`.
 */
export function selectTopKWithColdQuota(orderedCandidates = [], coldQuota = 0, topK = TOP_K_FINAL) {
  const list = Array.isArray(orderedCandidates) ? orderedCandidates : [];
  const limit = Math.min(Math.max(0, Math.floor(Number(topK) || 0)), list.length);
  if (limit === 0) return [];

  const quota = Math.min(limit, Math.max(0, Math.floor(Number(coldQuota) || 0)));
  if (quota === 0) {
    return list.slice(0, limit);
  }

  const headCount = Math.max(0, limit - quota);
  const selected = [];
  const usedIdx = new Set();
  const usedKeys = new Set();

  const tryPick = idx => {
    if (usedIdx.has(idx)) return false;
    const item = list[idx];
    const key = getMovieKey(item);
    if (key && usedKeys.has(key)) return false;
    usedIdx.add(idx);
    if (key) usedKeys.add(key);
    selected.push(item);
    return true;
  };

  let coldPicked = 0;
  for (let i = 0; i < headCount && i < list.length; i++) {
    if (tryPick(i) && isCollabColdCandidate(list[i])) {
      coldPicked++;
    }
  }

  for (let i = 0; i < list.length && coldPicked < quota && selected.length < limit; i++) {
    if (usedIdx.has(i)) continue;
    if (!isCollabColdCandidate(list[i])) continue;
    if (tryPick(i)) coldPicked++;
  }

  for (let i = 0; i < list.length && selected.length < limit; i++) {
    tryPick(i);
  }

  selected.sort((a, b) => Number(b.rankerProbability ?? 0) - Number(a.rankerProbability ?? 0));
  return selected;
}

/**
 * Evaluates a single ranked top-K slate against holdout positives/relevance, breaking
 * hits and recall down into cold (`collabSim === 0`) vs warm (`collabSim !== 0`).
 */
export function scoreTopKSlateWarmCold(topSlate = [], holdoutPositives = new Set(), holdoutRelevance = new Map(), coldCandidateKeySet = new Set(), topK = TOP_K_FINAL) {
  const slateIds = topSlate.slice(0, topK).map(getMovieKey);
  const ndcg10 = computeNDCGAtK(slateIds, holdoutRelevance, topK);
  const recall10 = computeRecallAtK(slateIds, holdoutPositives, topK);

  let coldSlots = 0;
  let coldHits = 0;
  let warmHits = 0;
  for (let i = 0; i < Math.min(topK, topSlate.length); i++) {
    const item = topSlate[i];
    const key = getMovieKey(item);
    const isCold = isCollabColdCandidate(item);
    if (isCold) coldSlots++;
    if (holdoutPositives.has(key)) {
      if (isCold) coldHits++;
      else warmHits++;
    }
  }

  let totalColdPos = 0;
  let totalWarmPos = 0;
  for (const posId of holdoutPositives) {
    if (coldCandidateKeySet.has(String(posId))) totalColdPos++;
    else totalWarmPos++;
  }

  return {
    ndcg10,
    recall10,
    coldSlots,
    coldHits,
    warmHits,
    totalColdPos,
    totalWarmPos,
    coldRecall10: totalColdPos > 0 ? coldHits / totalColdPos : null,
    warmRecall10: totalWarmPos > 0 ? warmHits / totalWarmPos : null
  };
}

/**
 * Runs one `(maskFrac, maskSeed)` configuration across all requested `(cohort, minPos)`
 * datasets and all `coldQuota ∈ quotas`.
 */
export async function evaluateColdQuotaConfig({
  maskFrac = 0,
  maskSeed = 1,
  quotas = COLD_QUOTA_VALUES,
  specs = [],
  catalog = [],
  emb = null
}) {
  if (!emb || !emb.ids) {
    throw new Error("evaluateColdQuotaConfig requires a non-null embedding index.");
  }
  const maskedIds = maskFrac > 0 ? selectMaskedTmdbIds(emb.ids, maskFrac, maskSeed) : new Set();
  const outDatasets = {};

  for (const spec of specs) {
    const accByQuota = Object.fromEntries(
      quotas.map(q => [
        q,
        {
          ndcg10: {},
          recall10: {},
          coldHitsMap: {},
          warmHitsMap: {},
          coldRec10Map: {},
          warmRec10Map: {},
          coldSlotsSum: 0,
          coldHitsSum: 0,
          warmHitsSum: 0,
          totalColdPosSum: 0,
          totalWarmPosSum: 0,
          totalHoldoutPosSum: 0
        }
      ])
    );

    let evaluatedUsers = 0;

    for (const u of spec.users || []) {
      const split = temporalHoldoutSplit(u.ratings, 10, spec.minPos);
      if (split.trainWatched.length < 10 || split.holdoutPositives.size < 3) continue;

      const holdoutKeys = new Set(split.holdoutRelevance.keys());
      const excluded = new Set();
      for (const m of u.ratings || []) {
        const k = getMovieKey(m);
        if (k && !holdoutKeys.has(k)) excluded.add(k);
      }
      const candidates = catalog.filter(c => {
        const k = getMovieKey(c);
        return k && !excluded.has(k);
      });
      if (candidates.length === 0) continue;

      evaluatedUsers++;

      const profile = await extractTasteProfile(split.trainWatched, [], {
        now: split.holdoutStartTs ?? undefined,
        anchorCutoff: Infinity
      });
      const fullCollab = buildCollabSimMapFromIndex(profile.weightedRatings, emb);
      const fullRep = buildRepulsionMapFromIndex(profile.weightedRatings, emb);
      const candCollab = maskSimMapCandidates(fullCollab, maskedIds);
      const candRep = maskSimMapCandidates(fullRep, maskedIds);
      const contentMap = buildContentSimMap(profile.weightedRatings, null, candidates, {
        collabIndex: emb,
        collabSimMap: candCollab,
        enableStructuredFallback: true,
        coldOnly: true
      });

      const ordered = rankCandidatePool(
        candidates,
        {
          profile,
          collabSimMap: candCollab,
          contentSimMap: contentMap,
          repulsionMap: candRep,
          anchorKeywords: profile.lovedKeywordIds || [],
          userProviders: []
        },
        DEFAULT_RANKER_WEIGHTS,
        candidates.length
      );

      const coldCandidateKeySet = new Set();
      for (const item of ordered) {
        if (isCollabColdCandidate(item)) coldCandidateKeySet.add(getMovieKey(item));
      }

      const uid = String(u.uid);
      for (const q of quotas) {
        const top10 = selectTopKWithColdQuota(ordered, q, TOP_K_FINAL);
        const s = scoreTopKSlateWarmCold(
          top10,
          split.holdoutPositives,
          split.holdoutRelevance,
          coldCandidateKeySet,
          TOP_K_FINAL
        );
        const acc = accByQuota[q];
        acc.ndcg10[uid] = s.ndcg10;
        acc.recall10[uid] = s.recall10;
        acc.coldHitsMap[uid] = s.coldHits;
        acc.warmHitsMap[uid] = s.warmHits;
        if (s.coldRecall10 !== null) acc.coldRec10Map[uid] = s.coldRecall10;
        if (s.warmRecall10 !== null) acc.warmRec10Map[uid] = s.warmRecall10;
        acc.coldSlotsSum += s.coldSlots;
        acc.coldHitsSum += s.coldHits;
        acc.warmHitsSum += s.warmHits;
        acc.totalColdPosSum += s.totalColdPos;
        acc.totalWarmPosSum += s.totalWarmPos;
        acc.totalHoldoutPosSum += split.holdoutPositives.size;
      }
    }

    outDatasets[spec.label] = {
      label: spec.label,
      minPos: spec.minPos,
      evaluatedUsers,
      byQuota: Object.fromEntries(
        quotas.map(q => {
          const acc = accByQuota[q];
          return [
            q,
            {
              quota: q,
              evaluatedUsers,
              ndcg10Mean: meanArr(Object.values(acc.ndcg10)) ?? 0,
              recall10Mean: meanArr(Object.values(acc.recall10)) ?? 0,
              meanColdSlots: evaluatedUsers > 0 ? acc.coldSlotsSum / evaluatedUsers : 0,
              coldHitsTotal: acc.coldHitsSum,
              warmHitsTotal: acc.warmHitsSum,
              totalColdPos: acc.totalColdPosSum,
              totalWarmPos: acc.totalWarmPosSum,
              totalHoldoutPos: acc.totalHoldoutPosSum,
              coldRecall10Macro: meanArr(Object.values(acc.coldRec10Map)),
              coldRecall10Micro: acc.totalColdPosSum > 0 ? acc.coldHitsSum / acc.totalColdPosSum : null,
              warmRecall10Macro: meanArr(Object.values(acc.warmRec10Map)),
              warmRecall10Micro: acc.totalWarmPosSum > 0 ? acc.warmHitsSum / acc.totalWarmPosSum : null,
              perUser: {
                ndcg10: acc.ndcg10,
                recall10: acc.recall10,
                coldHits: acc.coldHitsMap,
                warmHits: acc.warmHitsMap,
                coldRec10: acc.coldRec10Map,
                warmRec10: acc.warmRec10Map
              }
            }
          ];
        })
      )
    };
  }

  return {
    maskFrac,
    maskSeed,
    maskedCount: maskedIds.size,
    datasets: outDatasets
  };
}

function averageUserMaps(maps = []) {
  const sums = {};
  const counts = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m || {})) {
      if (Number.isFinite(v)) {
        sums[k] = (sums[k] || 0) + v;
        counts[k] = (counts[k] || 0) + 1;
      }
    }
  }
  const out = {};
  for (const k of Object.keys(sums)) {
    out[k] = sums[k] / counts[k];
  }
  return out;
}

function aggregateMaskGroup(runsForMask = [], cohortLabel, quotas = COLD_QUOTA_VALUES) {
  const rowsByQuota = {};
  for (const q of quotas) {
    const quotaRuns = runsForMask.map(r => r.datasets[cohortLabel].byQuota[q]);
    const userNdcg = averageUserMaps(quotaRuns.map(x => x.perUser.ndcg10));
    const userRec10 = averageUserMaps(quotaRuns.map(x => x.perUser.recall10));
    const userColdHits = averageUserMaps(quotaRuns.map(x => x.perUser.coldHits));
    const userWarmHits = averageUserMaps(quotaRuns.map(x => x.perUser.warmHits));
    const userColdRec10 = averageUserMaps(quotaRuns.map(x => x.perUser.coldRec10));
    const userWarmRec10 = averageUserMaps(quotaRuns.map(x => x.perUser.warmRec10));

    const sumColdHits = quotaRuns.reduce((s, x) => s + x.coldHitsTotal, 0);
    const sumWarmHits = quotaRuns.reduce((s, x) => s + x.warmHitsTotal, 0);
    const sumColdPos = quotaRuns.reduce((s, x) => s + x.totalColdPos, 0);
    const sumWarmPos = quotaRuns.reduce((s, x) => s + x.totalWarmPos, 0);
    const sumHoldoutPos = quotaRuns.reduce((s, x) => s + x.totalHoldoutPos, 0);

    rowsByQuota[q] = {
      quota: q,
      seeds: runsForMask.length,
      evaluatedUsers: quotaRuns[0].evaluatedUsers,
      meanColdSlots: meanArr(quotaRuns.map(x => x.meanColdSlots)) ?? 0,
      ndcg10: meanArr(quotaRuns.map(x => x.ndcg10Mean)) ?? 0,
      recall10: meanArr(quotaRuns.map(x => x.recall10Mean)) ?? 0,
      coldHitsSumAcrossSeeds: sumColdHits,
      meanColdHitsPerSeed: sumColdHits / quotaRuns.length,
      warmHitsSumAcrossSeeds: sumWarmHits,
      meanWarmHitsPerSeed: sumWarmHits / quotaRuns.length,
      totalColdPosSumAcrossSeeds: sumColdPos,
      totalWarmPosSumAcrossSeeds: sumWarmPos,
      totalHoldoutPosSumAcrossSeeds: sumHoldoutPos,
      coldRecall10Macro: meanArr(quotaRuns.map(x => x.coldRecall10Macro)),
      coldRecall10Micro: sumColdPos > 0 ? sumColdHits / sumColdPos : null,
      warmRecall10Macro: meanArr(quotaRuns.map(x => x.warmRecall10Macro)),
      warmRecall10Micro: sumWarmPos > 0 ? sumWarmHits / sumWarmPos : null,
      userMaps: {
        ndcg10: userNdcg,
        recall10: userRec10,
        coldHits: userColdHits,
        warmHits: userWarmHits,
        coldRec10: userColdRec10,
        warmRec10: userWarmRec10
      }
    };
  }

  const base = rowsByQuota[0];
  const cells = [];
  for (const q of quotas) {
    const cur = rowsByQuota[q];
    const vsN0 = q === 0
      ? null
      : {
          ndcg10: pairedBootstrapCI(cur.userMaps.ndcg10, base.userMaps.ndcg10),
          recall10: pairedBootstrapCI(cur.userMaps.recall10, base.userMaps.recall10),
          warmRecall10: pairedBootstrapCI(cur.userMaps.warmRec10, base.userMaps.warmRec10),
          coldHitsPerUser: pairedBootstrapCI(cur.userMaps.coldHits, base.userMaps.coldHits),
          warmHitsPerUser: pairedBootstrapCI(cur.userMaps.warmHits, base.userMaps.warmHits),
          meanColdHitsDeltaPerSeed: cur.meanColdHitsPerSeed - base.meanColdHitsPerSeed,
          meanWarmHitsDeltaPerSeed: cur.meanWarmHitsPerSeed - base.meanWarmHitsPerSeed
        };
    const { userMaps, ...clean } = cur;
    cells.push({ ...clean, vsN0 });
  }
  return cells;
}

function buildMarkdownReport(report) {
  const fmt = (v, d = 4) => (v !== null && v !== undefined && Number.isFinite(v) ? v.toFixed(d) : "n/a");
  const lines = [
    "# Cold Quota in Final Top-10 Evaluation (`clean2` Index)",
    "",
    `- Generated: \`${report.generatedAt}\``,
    "- Protocol: Ranks the full candidate pool with production `rankCandidatePool` (unreserved), then selects the final Top-10 with harness-only `selectTopKWithColdQuota(ordered, N, 10)` where cold is keyed strictly on `collabSim === 0` (`N ∈ {0, 2, 3, 5}`), ranked within cold candidates by `rankerProbability`.",
    "",
    "## Overall `NDCG@10`, `Recall@10`, Cold Hits, and Cost to Warm Recall (vs `N=0` at Same Mask)",
    "",
    "| Cohort | Mask | `N` Cold Slots | Avg Cold Slots | `NDCG@10` (d vs N=0, 95% CI) | `Recall@10` (d vs N=0, 95% CI) | Cold Hits/Seed (vs N=0) | Warm Hits/Seed (vs N=0) | Cold Rec@10 Micro (Macro) | Warm Rec@10 Macro (d vs N=0, 95% CI) |",
    "| :--- | :---: | :---: | :---: | :--- | :--- | :---: | :---: | :---: | :--- |"
  ];

  for (const ds of report.datasets) {
    for (const m of ds.byMask) {
      for (const r of m.quotas) {
        const ndcgCi = r.vsN0 ? ` (${formatCI(r.vsN0.ndcg10)})` : "";
        const recCi = r.vsN0 ? ` (${formatCI(r.vsN0.recall10)})` : "";
        const warmCi = r.vsN0 ? ` (${formatCI(r.vsN0.warmRecall10)})` : "";
        const cHitDelta = r.vsN0
          ? ` (${r.vsN0.meanColdHitsDeltaPerSeed >= 0 ? "+" : ""}${r.vsN0.meanColdHitsDeltaPerSeed.toFixed(1)})`
          : "";
        const wHitDelta = r.vsN0
          ? ` (${r.vsN0.meanWarmHitsDeltaPerSeed >= 0 ? "+" : ""}${r.vsN0.meanWarmHitsDeltaPerSeed.toFixed(1)})`
          : "";
        lines.push(
          `| ${ds.label} | ${(m.maskFrac * 100).toFixed(0)}% | ${r.quota} | ${r.meanColdSlots.toFixed(2)} | ${fmt(r.ndcg10)}${ndcgCi} | ${fmt(r.recall10)}${recCi} | ${r.meanColdHitsPerSeed.toFixed(1)}${cHitDelta} | ${r.meanWarmHitsPerSeed.toFixed(1)}${wHitDelta} | ${fmt(r.coldRecall10Micro)} (${fmt(r.coldRecall10Macro)}) | ${fmt(r.warmRecall10Macro)}${warmCi} |`
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[k] = true;
    else { args[k] = next; i++; }
  }
  return args;
}

function spawnWorker(cfg, rawDir) {
  return new Promise((resolve, reject) => {
    const selfPath = fileURLToPath(import.meta.url);
    const child = spawn(
      process.execPath,
      [
        selfPath,
        "--worker-tag", cfg.tag,
        "--mask-frac", String(cfg.maskFrac),
        "--mask-seed", String(cfg.maskSeed),
        "--raw-dir", rawDir
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", c => { stdout += c.toString(); });
    child.stderr.on("data", c => { stderr += c.toString(); });
    child.on("close", code => {
      if (code === 0) resolve({ tag: cfg.tag, stdout });
      else reject(new Error(`cold_quota worker failed (tag=${cfg.tag}, code=${code}): ${stderr || stdout}`));
    });
  });
}

async function runPool(tasks, concurrency = 4) {
  const out = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      out[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return out;
}

const isDirectMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectMain) {
  const args = parseArgs(process.argv);

  if (args["worker-tag"]) {
    const t0 = Date.now();
    const { catalog, users328, users300 } = loadDatasets();
    const embClean2 = loadEmb(".data/item_embeddings_clean2_f16.bin");
    const specs = [
      { label: "328 >=8★", users: users328, minPos: 8 },
      { label: "328 >=9★", users: users328, minPos: 9 },
      { label: "fresh_300 >=8★", users: users300, minPos: 8 },
      { label: "fresh_300 >=9★", users: users300, minPos: 9 }
    ];
    const maskFrac = Number(args["mask-frac"] ?? 0);
    const maskSeed = Number(args["mask-seed"] ?? 1);
    const res = await evaluateColdQuotaConfig({
      maskFrac,
      maskSeed,
      quotas: COLD_QUOTA_VALUES,
      specs,
      catalog,
      emb: embClean2
    });
    const outFile = path.join(String(args["raw-dir"]), `quota_${args["worker-tag"]}.json`);
    fs.writeFileSync(outFile, JSON.stringify(res));
    console.log(`Worker ${args["worker-tag"]} finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } else {
    const t0 = Date.now();
    const reuse = Boolean(args.reuse);
    const concurrency = Math.max(1, Number(args.concurrency || 4));
    const rawDir = path.join(ROOT, ".data/ablation_results/cold_quota_runs");
    const outDir = path.join(ROOT, "scripts/experiments/results");
    fs.mkdirSync(rawDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    const pending = RUN_CONFIGS.filter(cfg => {
      const f = path.join(rawDir, `quota_${cfg.tag}.json`);
      return !(reuse && fs.existsSync(f));
    });
    if (pending.length > 0) {
      console.log(`Running ${pending.length} cold-quota workers (concurrency=${concurrency})...`);
      await runPool(pending.map(cfg => () => spawnWorker(cfg, rawDir)), concurrency);
    }

    const runsByTag = new Map();
    for (const cfg of RUN_CONFIGS) {
      const f = path.join(rawDir, `quota_${cfg.tag}.json`);
      runsByTag.set(cfg.tag, JSON.parse(fs.readFileSync(f, "utf8")));
    }

    const cohortLabels = ["328 >=8★", "328 >=9★", "fresh_300 >=8★", "fresh_300 >=9★"];
    const maskGroups = [
      { maskFrac: 0, tags: ["m0_s1"] },
      { maskFrac: 0.15, tags: ["m15_s1", "m15_s2", "m15_s3"] },
      { maskFrac: 0.30, tags: ["m30_s1", "m30_s2", "m30_s3"] }
    ];

    const datasets = cohortLabels.map(label => ({
      label,
      byMask: maskGroups.map(mg => ({
        maskFrac: mg.maskFrac,
        seeds: mg.tags.length,
        quotas: aggregateMaskGroup(mg.tags.map(t => runsByTag.get(t)), label, COLD_QUOTA_VALUES)
      }))
    }));

    const report = {
      generatedAt: new Date().toISOString(),
      embeddingIndexPath: ".data/item_embeddings_clean2_f16.bin",
      quotas: COLD_QUOTA_VALUES,
      maskFracs: [0, 0.15, 0.30],
      datasets
    };

    const jsonOut = path.join(outDir, "cold_quota_eval.json");
    const mdOut = path.join(outDir, "cold_quota_eval.md");
    const md = buildMarkdownReport(report);
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
    fs.writeFileSync(mdOut, md);
    console.log(md);
    console.log(`Completed all cold-quota evaluations in ${((Date.now() - t0) / 1000).toFixed(1)}s. Saved ${jsonOut} and ${mdOut}`);
  }
}
