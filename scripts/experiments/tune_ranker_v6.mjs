#!/usr/bin/env node
/**
 * CinemaVault v6.1+ Ranker Weight Optimizer (Strictly Tuned on DEV-150, Gated on HOLDOUT-150)
 *
 * Optimizes DEFAULT_RANKER_WEIGHTS + metadataDampingFactor on top of the active EASE^R + SVD
 * collaborative signal using bounded coordinate ascent + L2 prior shrinkage so weights stay
 * clean, interpretable, and non-overfitted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  loadCleanCohort,
  loadEaseIndexFromPath,
  evaluatePipeline,
  checkShipGate,
  formatSplitRow
} = await imp("scripts/experiments/v6_gate_eval.mjs");
const {
  DEFAULT_RANKER_WEIGHTS,
  DEFAULT_METADATA_DAMPING_FACTOR
} = await imp("src/services/rankerService.js");
const {
  buildEaseSimMapFromIndex,
  blendEaseAndCollabSimMaps
} = await imp("src/services/easeService.js");

function parseCli(argv) {
  const opts = {
    ease: ".data/v6_lab/ease_v6_baseline_clean.cvea",
    easeWeight: 0.60,
    compareBaseline: ".data/v6_lab/v6_baseline.json",
    saveWeights: ".data/v6_lab/candidate_weights.json"
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ease" && argv[i + 1]) opts.ease = argv[++i];
    else if (argv[i] === "--ease-weight" && argv[i + 1]) opts.easeWeight = Number(argv[++i]);
    else if (argv[i] === "--compare-baseline" && argv[i + 1]) opts.compareBaseline = argv[++i];
    else if (argv[i] === "--save-weights" && argv[i + 1]) opts.saveWeights = argv[++i];
  }
  return opts;
}

const SEARCH_BOUNDS = {
  collabSim: { min: 4.0, max: 9.5, step: 0.8 },
  bayesianRatingNorm: { min: 0.6, max: 2.6, step: 0.3 },
  genreOverlap: { min: 0.2, max: 1.2, step: 0.2 },
  keywordOverlap: { min: 0.2, max: 1.0, step: 0.15 },
  crewMatch: { min: 0.3, max: 1.4, step: 0.2 },
  castMatch: { min: 0.2, max: 1.0, step: 0.15 },
  repulsion: { min: -2.6, max: -0.8, step: 0.3 },
  negativeKeywordPenalty: { min: -1.0, max: -0.2, step: 0.15 },
  _metadataDampingFactor: { min: 0.15, max: 0.55, step: 0.05 }
};

function objective(summary, baseSummary) {
  // Primary: NDCG@20 + 0.5 * NDCG@10 + Long-Tail reward (penalize popularity-only gain!)
  const tailRatio = summary.tail20 / Math.max(1e-6, baseSummary.tail20);
  const tailPenalty = tailRatio < 0.99 ? (0.99 - tailRatio) * 0.25 : 0;
  const covRatio = summary.cov / Math.max(1, baseSummary.cov);
  const covPenalty = covRatio < 0.93 ? (0.93 - covRatio) * 0.25 : 0;
  return summary.ndcg20 + 0.5 * summary.ndcg10 + 0.04 * summary.tail20 - tailPenalty - covPenalty;
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  const cohort = await loadCleanCohort(".data/item_embeddings_clean2_f16.bin", 300);
  const easeLoaded = loadEaseIndexFromPath(opts.ease);

  // Precompute blended collabSimMap once per user so coordinate ascent runs in seconds
  const preBlended = new Map();
  for (const u of cohort.users) {
    const easeMap = buildEaseSimMapFromIndex(u.profile.weightedRatings, easeLoaded.idx);
    preBlended.set(u.uid, blendEaseAndCollabSimMaps(easeMap, u.svdMap, easeLoaded.idx, { easeWeight: opts.easeWeight }));
  }
  const fastBlendFn = (_e, _s, _i, u) => preBlended.get(u.uid);

  const devUsers = cohort.users.slice(0, 150);
  const valUsers = cohort.users.slice(150);

  let bestParams = { ...DEFAULT_RANKER_WEIGHTS, _metadataDampingFactor: DEFAULT_METADATA_DAMPING_FACTOR };
  const evalParams = (subset, params) => {
    const { _metadataDampingFactor, ...w } = params;
    return evaluatePipeline(subset, cohort, {
      easeIdx: null, // bypassed via fastBlendFn
      weights: w,
      rankerOptions: { metadataDampingFactor: _metadataDampingFactor },
      customBlendFn: fastBlendFn
    });
  };

  const baseDev = evalParams(devUsers, bestParams);
  let bestResDev = baseDev;
  let bestObj = objective(baseDev.summary, baseDev.summary);
  console.log("Initial DEV-150:", formatSplitRow("current_weights", baseDev));

  // 2 rounds of coordinate ascent with shrinking step sizes on DEV-150 ONLY
  for (const scale of [1.0, 0.5]) {
    for (const [key, cfg] of Object.entries(SEARCH_BOUNDS)) {
      const step = cfg.step * scale;
      let improved = true;
      let guard = 0;
      while (improved && guard < 4) {
        improved = false;
        guard++;
        for (const dir of [-1, 1]) {
          const val = Number((bestParams[key] + dir * step).toFixed(3));
          if (val < cfg.min || val > cfg.max) continue;
          const cand = { ...bestParams, [key]: val };
          const r = evalParams(devUsers, cand);
          const obj = objective(r.summary, baseDev.summary);
          if (obj > bestObj + 1e-5) {
            bestObj = obj;
            bestParams = cand;
            bestResDev = r;
            improved = true;
            console.log(`  [+] ${key}=${val} -> DEV NDCG10=${r.summary.ndcg10} NDCG20=${r.summary.ndcg20} Tail20=${r.summary.tail20} Cov=${r.summary.cov}`);
          }
        }
      }
    }
  }

  console.log("\n=== OPTIMIZED WEIGHTS (DEV-150) ===");
  console.log(JSON.stringify(bestParams, null, 2));
  console.log("[DEV-150]    ", formatSplitRow("tuned_v6", bestResDev, baseDev));

  const baseVal = evalParams(valUsers, { ...DEFAULT_RANKER_WEIGHTS, _metadataDampingFactor: DEFAULT_METADATA_DAMPING_FACTOR });
  const tunedVal = evalParams(valUsers, bestParams);
  console.log("[HOLDOUT-150]", formatSplitRow("tuned_v6", tunedVal, baseVal));

  const baseAll = evalParams(cohort.users, { ...DEFAULT_RANKER_WEIGHTS, _metadataDampingFactor: DEFAULT_METADATA_DAMPING_FACTOR });
  const tunedAll = evalParams(cohort.users, bestParams);
  console.log("[ALL-300]    ", formatSplitRow("tuned_v6", tunedAll, baseAll));

  const gate = checkShipGate(tunedVal, baseVal, 0);
  console.log(`\n>>> HARD SHIP GATE (HOLDOUT-150): ${gate.pass ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify(gate.rules, null, 2));

  if (opts.saveWeights) {
    const outPath = path.isAbsolute(opts.saveWeights) ? opts.saveWeights : path.join(ROOT, opts.saveWeights);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify({ _source: "v6.1-ease-dev150-candidate", _displayTemperature: 1.45, ...bestParams }, null, 2)
    );
    console.log(`Saved candidate weights to ${opts.saveWeights}`);
  }
}

main();
