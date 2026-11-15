import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const { pairedBootstrapCI, formatCI } = await imp("scripts/experiments/run_ablation.mjs");

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

function runAblationProcess({ maskFrac, maskSeed, tag, outDir }) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(ROOT, "scripts/experiments/run_ablation.mjs");
    const child = spawn(
      process.execPath,
      [
        scriptPath,
        "--tag", tag,
        "--out-dir", outDir,
        "--mask-frac", String(maskFrac),
        "--mask-seed", String(maskSeed),
        "--include-300"
      ],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("close", code => {
      if (code === 0) {
        resolve({ tag, maskFrac, maskSeed, stdout });
      } else {
        reject(new Error(`run_ablation failed (code=${code}, tag=${tag}): ${stderr || stdout}`));
      }
    });
  });
}

async function runPool(tasks, concurrency = 4) {
  const results = new Array(tasks.length);
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= tasks.length) return;
      results[idx] = await tasks[idx]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function averageUserMetricMaps(maps = []) {
  const out = {};
  if (!maps.length) return out;
  const keys = Object.keys(maps[0] || {});
  for (const k of keys) {
    let sum = 0;
    let cnt = 0;
    for (const m of maps) {
      if (m && Object.prototype.hasOwnProperty.call(m, k) && Number.isFinite(m[k])) {
        sum += m[k];
        cnt++;
      }
    }
    if (cnt === maps.length && cnt > 0) {
      out[k] = sum / cnt;
    }
  }
  return out;
}

function meanNullable(vals = []) {
  const clean = vals.filter(v => v !== null && v !== undefined && Number.isFinite(v));
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;
}

function aggregateCohortAcrossSeeds(seedDatasets = [], baseDataset = null) {
  const means = {
    ndcg10: meanNullable(seedDatasets.map(d => d.means.ndcg10)),
    rec20: meanNullable(seedDatasets.map(d => d.means.rec20)),
    prec10: meanNullable(seedDatasets.map(d => d.means.prec10)),
    neg20: meanNullable(seedDatasets.map(d => d.means.neg20)),
    auc8v7: meanNullable(seedDatasets.map(d => d.means.auc8v7)),
    auc9v7: meanNullable(seedDatasets.map(d => d.means.auc9v7))
  };

  let vsMask0 = null;
  if (baseDataset) {
    const avgNdcg = averageUserMetricMaps(seedDatasets.map(d => d.perUser.ndcg));
    const avgRec = averageUserMetricMaps(seedDatasets.map(d => d.perUser.rec));
    const avgPrec = averageUserMetricMaps(seedDatasets.map(d => d.perUser.prec));
    const avgNeg = averageUserMetricMaps(seedDatasets.map(d => d.perUser.neg));
    vsMask0 = {
      ndcg10: pairedBootstrapCI(avgNdcg, baseDataset.perUser.ndcg),
      rec20: pairedBootstrapCI(avgRec, baseDataset.perUser.rec),
      prec10: pairedBootstrapCI(avgPrec, baseDataset.perUser.prec),
      neg20: pairedBootstrapCI(avgNeg, baseDataset.perUser.neg)
    };
  }

  const wcs = seedDatasets.map(d => d.warmCold).filter(Boolean);
  const warmCold = wcs.length
    ? {
        nUsers: wcs[0].nUsers,
        meanUsersWithColdPos: meanNullable(wcs.map(w => w.nUsersWithColdPos)),
        meanUsersWithMaskedPos: meanNullable(wcs.map(w => w.nUsersWithMaskedPos)),
        meanUsersWithWarmPos: meanNullable(wcs.map(w => w.nUsersWithWarmPos)),
        macroColdRecall20: meanNullable(wcs.map(w => w.macroColdRecall20)),
        macroMaskedRecall20: meanNullable(wcs.map(w => w.macroMaskedRecall20)),
        macroWarmRecall20: meanNullable(wcs.map(w => w.macroWarmRecall20)),
        totalColdPosSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalColdPos, 0),
        totalColdHitsSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalColdHits, 0),
        meanColdPosPerSeed: meanNullable(wcs.map(w => w.totalColdPos)),
        microColdRecall20: (() => {
          const pos = wcs.reduce((s, w) => s + w.totalColdPos, 0);
          const hits = wcs.reduce((s, w) => s + w.totalColdHits, 0);
          return pos > 0 ? hits / pos : null;
        })(),
        totalMaskedPosSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalMaskedPos, 0),
        totalMaskedHitsSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalMaskedHits, 0),
        meanMaskedPosPerSeed: meanNullable(wcs.map(w => w.totalMaskedPos)),
        microMaskedRecall20: (() => {
          const pos = wcs.reduce((s, w) => s + w.totalMaskedPos, 0);
          const hits = wcs.reduce((s, w) => s + w.totalMaskedHits, 0);
          return pos > 0 ? hits / pos : null;
        })(),
        totalWarmPosSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalWarmPos, 0),
        totalWarmHitsSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalWarmHits, 0),
        meanWarmPosPerSeed: meanNullable(wcs.map(w => w.totalWarmPos)),
        microWarmRecall20: (() => {
          const pos = wcs.reduce((s, w) => s + w.totalWarmPos, 0);
          const hits = wcs.reduce((s, w) => s + w.totalWarmHits, 0);
          return pos > 0 ? hits / pos : null;
        })(),
        top20ColdShare: meanNullable(wcs.map(w => w.top20ColdShare)),
        top20MaskedShare: meanNullable(wcs.map(w => w.top20MaskedShare)),
        poolColdShare: meanNullable(wcs.map(w => w.poolColdShare)),
        poolMaskedShare: meanNullable(wcs.map(w => w.poolMaskedShare)),
        holdoutColdShare: meanNullable(wcs.map(w => w.holdoutColdShare)),
        holdoutMaskedShare: meanNullable(wcs.map(w => w.holdoutMaskedShare)),
        top20MinusPoolColdShare: meanNullable(wcs.map(w => w.top20MinusPoolColdShare))
      }
    : null;

  return {
    n: seedDatasets[0]?.n ?? 0,
    totalUsers: seedDatasets[0]?.totalUsers ?? 0,
    seeds: seedDatasets.length,
    means,
    vsMask0,
    warmCold,
    perSeedMeans: seedDatasets.map(d => ({
      ndcg10: d.means.ndcg10,
      rec20: d.means.rec20,
      prec10: d.means.prec10,
      warmCold: d.warmCold
    }))
  };
}

function aggregateBenchAcrossSeeds(seedBenchThresholds = [], baseBenchThreshold = null) {
  const rollings = seedBenchThresholds.map(b => b.MEAN_ROLLING).filter(Boolean);
  const means = {
    vaultsUsed: rollings[0]?.vaultsUsed ?? 0,
    ndcg10: meanNullable(rollings.map(r => r.ndcg10)),
    rec20: meanNullable(rollings.map(r => r.rec20)),
    prec10: meanNullable(rollings.map(r => r.prec10)),
    neg20: meanNullable(rollings.map(r => r.neg20)),
    auc8v7: meanNullable(rollings.map(r => r.auc8v7)),
    auc9v7: meanNullable(rollings.map(r => r.auc9v7))
  };

  let vsMask0 = null;
  if (baseBenchThreshold?.MEAN_ROLLING) {
    const extractVaultMap = (bObj, metric) => {
      const m = {};
      for (const [k, v] of Object.entries(bObj)) {
        if (k === "MEAN_ROLLING" || k === "MEAN_FOLD0") continue;
        if (v?.status === "ok" && Number.isFinite(v?.rolling?.[metric])) m[k] = v.rolling[metric];
      }
      return m;
    };
    const baseNdcg = extractVaultMap(baseBenchThreshold, "ndcg10");
    const baseRec = extractVaultMap(baseBenchThreshold, "rec20");
    const basePrec = extractVaultMap(baseBenchThreshold, "prec10");
    vsMask0 = {
      ndcg10: pairedBootstrapCI(averageUserMetricMaps(seedBenchThresholds.map(b => extractVaultMap(b, "ndcg10"))), baseNdcg),
      rec20: pairedBootstrapCI(averageUserMetricMaps(seedBenchThresholds.map(b => extractVaultMap(b, "rec20"))), baseRec),
      prec10: pairedBootstrapCI(averageUserMetricMaps(seedBenchThresholds.map(b => extractVaultMap(b, "prec10"))), basePrec)
    };
  }

  const wcs = rollings.map(r => r.warmCold).filter(Boolean);
  const warmCold = wcs.length
    ? {
        macroColdRecall20: meanNullable(wcs.map(w => w.macroColdRecall20)),
        macroMaskedRecall20: meanNullable(wcs.map(w => w.macroMaskedRecall20)),
        macroWarmRecall20: meanNullable(wcs.map(w => w.macroWarmRecall20)),
        totalColdPosSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalColdPos, 0),
        totalColdHitsSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalColdHits, 0),
        meanColdPosPerSeed: meanNullable(wcs.map(w => w.totalColdPos)),
        microColdRecall20: (() => {
          const pos = wcs.reduce((s, w) => s + w.totalColdPos, 0);
          const hits = wcs.reduce((s, w) => s + w.totalColdHits, 0);
          return pos > 0 ? hits / pos : null;
        })(),
        totalMaskedPosSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalMaskedPos, 0),
        totalMaskedHitsSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalMaskedHits, 0),
        meanMaskedPosPerSeed: meanNullable(wcs.map(w => w.totalMaskedPos)),
        microMaskedRecall20: (() => {
          const pos = wcs.reduce((s, w) => s + w.totalMaskedPos, 0);
          const hits = wcs.reduce((s, w) => s + w.totalMaskedHits, 0);
          return pos > 0 ? hits / pos : null;
        })(),
        totalWarmPosSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalWarmPos, 0),
        totalWarmHitsSumAcrossSeeds: wcs.reduce((s, w) => s + w.totalWarmHits, 0),
        meanWarmPosPerSeed: meanNullable(wcs.map(w => w.totalWarmPos)),
        microWarmRecall20: (() => {
          const pos = wcs.reduce((s, w) => s + w.totalWarmPos, 0);
          const hits = wcs.reduce((s, w) => s + w.totalWarmHits, 0);
          return pos > 0 ? hits / pos : null;
        })(),
        top20ColdShare: meanNullable(wcs.map(w => w.top20ColdShare)),
        poolColdShare: meanNullable(wcs.map(w => w.poolColdShare)),
        holdoutColdShare: meanNullable(wcs.map(w => w.holdoutColdShare)),
        top20MinusPoolColdShare: meanNullable(wcs.map(w => w.top20MinusPoolColdShare))
      }
    : null;

  return { vaultsUsed: means.vaultsUsed, seeds: seedBenchThresholds.length, means, vsMask0, warmCold };
}

function fmt(v, digits = 4) {
  return v !== null && v !== undefined && Number.isFinite(v) ? v.toFixed(digits) : "n/a";
}

function fmtPct(v) {
  return v !== null && v !== undefined && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "n/a";
}

function buildMarkdownReport(summary) {
  const lines = [
    "# Partial-Mask Warm vs. Cold Evaluation (`clean2` Index)",
    "",
    `- Generated: \`${summary.generatedAt}\``,
    `- Protocol: Candidate-side deterministic masking of \`${summary.maskFracs.join(", ")}\` across seeds \`{1, 2, 3}\` (\`maskFrac = 0\` single deterministic baseline). User vectors & \`collabSimMap\` / \`repulsionMap\` are built from the **full** \`item_embeddings_clean2_f16.bin\` index before deleting masked candidate IDs so masked candidates get \`collabSim === 0\` and enter \`coldOnly\` structured fallback.`,
    `- \`mask-frac 0\` vs \`eval_final.json\` max abs diff: \`${summary.mask0Parity.maxAbsDiff.toExponential(2)}\` (\`${summary.mask0Parity.matched ? "MATCH" : "MISMATCH"}\`, \`fresh_300 >=9★ NDCG@10 = ${fmt(summary.cells.find(c => c.dataset === "fresh_300 >=9★" && c.maskFrac === 0)?.means?.ndcg10)}\`)`,
    "",
    "## Cold-Path Verification (`maskFrac > 0` sample check)",
    "",
    "| Mask | Seed | Candidates | Masked in Pool | `collabSim === 0` | Structured `contentSim > 0` | Warm Cold-Leak |",
    "| :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
  ];

  for (const chk of summary.coldPathChecks) {
    lines.push(
      `| ${(chk.maskFrac * 100).toFixed(0)}% | ${chk.maskSeed} | ${chk.candidatesCount} | ${chk.maskedCandCount} | ${chk.maskedCollabZeroCount} | ${chk.maskedContentNonZeroCount} | ${chk.warmColdLeakCount} |`
    );
  }

  lines.push(
    "",
    "## Overall Accuracy & Paired-Bootstrap Delta vs. `mask = 0`",
    "",
    "| Cohort | Mask | Seeds | NDCG@10 (d vs 0, 95% CI) | Recall@20 (d vs 0, 95% CI) | P@10 (d vs 0, 95% CI) |",
    "| :--- | :---: | :---: | :--- | :--- | :--- |"
  );

  for (const c of summary.cells) {
    const ciStr = ci => (ci ? ` (${formatCI(ci)})` : "");
    lines.push(
      `| ${c.dataset} | ${(c.maskFrac * 100).toFixed(0)}% | ${c.seeds} | ${fmt(c.means.ndcg10)}${ciStr(c.vsMask0?.ndcg10)} | ${fmt(c.means.rec20)}${ciStr(c.vsMask0?.rec20)} | ${fmt(c.means.prec10)}${ciStr(c.vsMask0?.prec10)} |`
    );
  }

  lines.push(
    "",
    "## Cold vs. Warm Holdout Positives Recall@20 & Top-20 / Pool / Holdout Cold Shares",
    "",
    "Note: `Cold` = `collabSim === 0` (`masked ∪ naturally unindexed`), matching production `coldOnly` routing. `Masked-Only` excludes the few naturally unindexed positives (`~1.4%` in `328`, `~0.03%` in `fresh_300`) so random counterfactual cold vs. warm comparison is distribution-matched. Micro Recall = pooled `hits / totalPos` across seeds (`n_pos` total across runs); Macro Recall = mean per user/fold with `>=1` such positive (`mean n_users/seed`).",
    "",
    "| Cohort | Mask | Cold Rec@20 Micro (hits/n) | Cold Rec@20 Macro (n_u) | Masked Rec@20 Micro (hits/n) | Warm Rec@20 Micro (hits/n) | Warm Rec@20 Macro (n_u) | Cold Share Top-20 | Cold Share Pool | Cold Share Holdout | Top-20 minus Pool |",
    "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
  );

  for (const c of summary.cells) {
    const wc = c.warmCold;
    if (!wc) continue;
    const microStr = (hits, pos, rate) =>
      pos > 0 ? `${fmt(rate)} (${hits}/${pos})` : "n/a (0)";
    const macroStr = (rate, nu) =>
      rate !== null && rate !== undefined ? `${fmt(rate)} (${Number(nu).toFixed(1)})` : "n/a (0)";
    const coldPos = wc.totalColdPosSumAcrossSeeds ?? 0;
    const coldHits = wc.totalColdHitsSumAcrossSeeds ?? 0;
    const maskedPos = wc.totalMaskedPosSumAcrossSeeds ?? 0;
    const maskedHits = wc.totalMaskedHitsSumAcrossSeeds ?? 0;
    const warmPos = wc.totalWarmPosSumAcrossSeeds ?? 0;
    const warmHits = wc.totalWarmHitsSumAcrossSeeds ?? 0;
    lines.push(
      `| ${c.dataset} | ${(c.maskFrac * 100).toFixed(0)}% | ${microStr(coldHits, coldPos, wc.microColdRecall20)} | ${macroStr(wc.macroColdRecall20, wc.meanUsersWithColdPos ?? c.means.vaultsUsed ?? "")} | ${microStr(maskedHits, maskedPos, wc.microMaskedRecall20)} | ${microStr(warmHits, warmPos, wc.microWarmRecall20)} | ${macroStr(wc.macroWarmRecall20, wc.meanUsersWithWarmPos ?? c.means.vaultsUsed ?? "")} | ${fmtPct(wc.top20ColdShare)} | ${fmtPct(wc.poolColdShare)} | ${fmtPct(wc.holdoutColdShare)} | ${(wc.top20MinusPoolColdShare >= 0 ? "+" : "") + fmtPct(wc.top20MinusPoolColdShare)} |`
    );
  }

  return `${lines.join("\n")}\n`;
}

const args = parseArgs(process.argv);
const reuse = Boolean(args.reuse);
const concurrency = Math.max(1, Number(args.concurrency || 4));
const rawDir = path.join(ROOT, ".data/ablation_results/partial_mask_runs");
const outResultsDir = path.join(ROOT, "scripts/experiments/results");
fs.mkdirSync(rawDir, { recursive: true });
fs.mkdirSync(outResultsDir, { recursive: true });

const configs = [
  { maskFrac: 0, maskSeed: 1, tag: "mask0_s1" },
  { maskFrac: 0.15, maskSeed: 1, tag: "mask15_s1" },
  { maskFrac: 0.15, maskSeed: 2, tag: "mask15_s2" },
  { maskFrac: 0.15, maskSeed: 3, tag: "mask15_s3" },
  { maskFrac: 0.3, maskSeed: 1, tag: "mask30_s1" },
  { maskFrac: 0.3, maskSeed: 2, tag: "mask30_s2" },
  { maskFrac: 0.3, maskSeed: 3, tag: "mask30_s3" }
];

const tasks = configs
  .filter(cfg => {
    const file = path.join(rawDir, `eval_${cfg.tag}.json`);
    return !(reuse && fs.existsSync(file));
  })
  .map(cfg => () => runAblationProcess({ ...cfg, outDir: rawDir }));

if (tasks.length > 0) {
  console.log(`Running ${tasks.length} partial-mask evaluations (concurrency=${concurrency})...`);
  const t0 = Date.now();
  await runPool(tasks, concurrency);
  console.log(`Completed ${tasks.length} evaluations in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

const loadedByTag = new Map();
for (const cfg of configs) {
  const file = path.join(rawDir, `eval_${cfg.tag}.json`);
  loadedByTag.set(cfg.tag, JSON.parse(fs.readFileSync(file, "utf8")));
}

// Step 4 parity check against eval_final.json
const evalFinalPath = path.join(ROOT, ".data/ablation_results/eval_final.json");
const evalFinal = JSON.parse(fs.readFileSync(evalFinalPath, "utf8"));
const run0 = loadedByTag.get("mask0_s1");
let maxAbsDiff = 0;
const cmpFields = [
  ["c328_clean2_ge8", "means"],
  ["c328_clean2_ge9", "means"],
  ["c300_clean2_ge8", "means"],
  ["c300_clean2_ge9", "means"]
];
for (const [ds, field] of cmpFields) {
  for (const [m, v] of Object.entries(evalFinal.datasets[ds][field])) {
    if (typeof v === "number") {
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(v - run0.datasets[ds][field][m]));
    }
  }
}
for (const thr of ["ge8", "ge9"]) {
  for (const [m, v] of Object.entries(evalFinal.datasets.bench_clean2[thr].MEAN_ROLLING)) {
    if (typeof v === "number") {
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(v - run0.datasets.bench_clean2[thr].MEAN_ROLLING[m]));
    }
  }
}
const mask0Parity = { maxAbsDiff, matched: maxAbsDiff < 1e-12 };
if (!mask0Parity.matched) {
  throw new Error(`mask-frac 0 failed parity vs eval_final.json (maxAbsDiff=${maxAbsDiff})`);
}

const maskGroups = [
  { maskFrac: 0, tags: ["mask0_s1"] },
  { maskFrac: 0.15, tags: ["mask15_s1", "mask15_s2", "mask15_s3"] },
  { maskFrac: 0.3, tags: ["mask30_s1", "mask30_s2", "mask30_s3"] }
];

const cells = [];
const cohortSpecs = [
  { label: "328 >=8★", key: "c328_clean2_ge8", type: "cohort" },
  { label: "328 >=9★", key: "c328_clean2_ge9", type: "cohort" },
  { label: "fresh_300 >=8★", key: "c300_clean2_ge8", type: "cohort" },
  { label: "fresh_300 >=9★", key: "c300_clean2_ge9", type: "cohort" },
  { label: "bench >=8★ (roll)", key: "ge8", type: "bench" },
  { label: "bench >=9★ (roll)", key: "ge9", type: "bench" }
];

for (const spec of cohortSpecs) {
  for (const grp of maskGroups) {
    if (spec.type === "cohort") {
      const dsList = grp.tags.map(t => loadedByTag.get(t).datasets[spec.key]);
      const baseDs = grp.maskFrac === 0 ? null : run0.datasets[spec.key];
      const agg = aggregateCohortAcrossSeeds(dsList, baseDs);
      cells.push({ dataset: spec.label, maskFrac: grp.maskFrac, ...agg });
    } else {
      const dsList = grp.tags.map(t => loadedByTag.get(t).datasets.bench_clean2[spec.key]);
      const baseDs = grp.maskFrac === 0 ? null : run0.datasets.bench_clean2[spec.key];
      const agg = aggregateBenchAcrossSeeds(dsList, baseDs);
      cells.push({ dataset: spec.label, maskFrac: grp.maskFrac, ...agg });
    }
  }
}

const coldPathChecks = configs
  .filter(c => c.maskFrac > 0)
  .map(c => ({
    maskFrac: c.maskFrac,
    maskSeed: c.maskSeed,
    ...loadedByTag.get(c.tag).coldPathCheck
  }));

const summary = {
  generatedAt: new Date().toISOString(),
  maskFracs: [0, 0.15, 0.3],
  seeds: [1, 2, 3],
  mask0Parity,
  coldPathChecks,
  cells
};

const jsonOut = path.join(outResultsDir, "partial_mask_eval.json");
const mdOut = path.join(outResultsDir, "partial_mask_eval.md");
const md = buildMarkdownReport(summary);
fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2));
fs.writeFileSync(mdOut, md);
console.log(md);
console.log(`Saved ${jsonOut} and ${mdOut}`);
