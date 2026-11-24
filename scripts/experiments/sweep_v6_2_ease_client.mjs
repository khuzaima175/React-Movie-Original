#!/usr/bin/env node
/**
 * CinemaVault v6.2 Client-Side EASE^R Sweep (Dev-150 tuning -> Holdout-150 Hard Ship Gate)
 *
 * Tests:
 *  1. Reverse-edge recovery across reverseAlpha in {0.0, 0.10, 0.20, 0.30, 0.45}
 *     (both unscaled and degree-damped 1 / sqrt(inDegree[c] + 10)).
 *  2. Calibrated z-score + time-decay input curve:
 *     x_i = b + a * sigmoid(z_i) * (0.7 + 0.3 * timeDecay)
 *     across (b, a) in {(0.50, 0.70), (0.60, 0.65), (0.65, 0.55)},
 *     retaining x_i = negWeight when rating <= 4 or (rating <= 5 && zScore < -0.9).
 *  3. Combined best Dev-150 pair, then 4-Part Hard Ship Gate on untouched Holdout-150.
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

function parseCli(argv) {
  const opts = {
    baseline: ".data/v6_lab/v6_baseline.json",
    ease: ".data/v6_lab/ease_v6_baseline_clean.cvea",
    svd: ".data/item_embeddings_clean2_f16.bin",
    easeWeight: 0.60
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline" && argv[i + 1]) opts.baseline = argv[++i];
    else if (a === "--ease" && argv[i + 1]) opts.ease = argv[++i];
    else if (a === "--svd" && argv[i + 1]) opts.svd = argv[++i];
    else if (a === "--ease-weight" && argv[i + 1]) opts.easeWeight = Number(argv[++i]);
  }
  return opts;
}

const inDegreeCache = new WeakMap();
function getInDegree(easeIdx) {
  let cached = inDegreeCache.get(easeIdx);
  if (cached) return cached;
  const { count, K, nbrIdx, nbrW } = easeIdx;
  const deg = new Uint32Array(count);
  const total = count * K;
  for (let i = 0; i < total; i++) {
    const target = nbrIdx[i];
    if (target < count && nbrW[i] !== 0) {
      deg[target]++;
    }
  }
  inDegreeCache.set(easeIdx, deg);
  return deg;
}

function sigmoid(z) {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function buildCandidateEaseMap(weightedRatings = [], easeIndex = null, options = {}) {
  const map = new Map();
  if (!easeIndex || !easeIndex.count || !easeIndex.K || !Array.isArray(weightedRatings) || weightedRatings.length === 0) {
    return map;
  }

  const { count, K, ids, idToIndex, nbrIdx, nbrW } = easeIndex;
  const negWeight = Number.isFinite(Number(options.negWeight)) ? Number(options.negWeight) : -0.35;
  const reverseAlpha = Number(options.reverseAlpha ?? 0);
  const degreeDamped = Boolean(options.degreeDamped);
  const useCalibratedZ = Boolean(options.useCalibratedZ);
  const curveB = Number(options.curveB ?? 0.60);
  const curveA = Number(options.curveA ?? 0.65);

  const scores = new Float32Array(count);
  const watchedWeightByIdx = reverseAlpha > 0 ? new Float32Array(count) : null;
  let touched = 0;

  for (const entry of weightedRatings) {
    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    if (!tmdbId) continue;
    const idx = idToIndex.get(tmdbId);
    if (idx === undefined) continue;

    const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
    const rawW = Number(entry?.weight ?? entry?.finalWeight ?? 0);
    const zScore = Number(entry?.zScore ?? NaN);
    const rawDecay = Number(entry?.timeDecay ?? 1);
    const timeDecay = Number.isFinite(rawDecay) ? Math.max(0, Math.min(1, rawDecay)) : 1;

    let x = 0;
    if (Number.isFinite(rating) && rating > 0) {
      if (rating <= 4 || (useCalibratedZ && rating <= 5 && Number.isFinite(zScore) && zScore < -0.9)) {
        x = negWeight;
      } else if (rating >= 7) {
        if (useCalibratedZ && Number.isFinite(zScore)) {
          x = curveB + curveA * sigmoid(zScore) * (0.7 + 0.3 * timeDecay);
        } else {
          x = 0.7 + 0.6 * ((rating - 6) / 4);
        }
      } else if (rating >= 6) {
        x = 0.25;
      }
    } else if (Number.isFinite(rawW) && rawW !== 0) {
      x = rawW > 0 ? Math.min(1.3, Math.max(0.4, rawW)) : Math.max(negWeight, rawW);
    }

    if (x === 0) continue;
    touched++;
    if (watchedWeightByIdx) {
      watchedWeightByIdx[idx] += x;
    }

    const base = idx * K;
    for (let k = 0; k < K; k++) {
      const target = nbrIdx[base + k];
      if (target < count) {
        scores[target] += x * nbrW[base + k];
      }
    }
  }

  if (touched === 0) return map;

  if (watchedWeightByIdx && reverseAlpha > 0) {
    const inDeg = degreeDamped ? getInDegree(easeIndex) : null;
    for (let c = 0; c < count; c++) {
      const base = c * K;
      let rev = 0;
      for (let k = 0; k < K; k++) {
        const target = nbrIdx[base + k];
        if (target < count) {
          const w = watchedWeightByIdx[target];
          if (w !== 0) {
            rev += w * nbrW[base + k];
          }
        }
      }
      if (rev !== 0) {
        const scale = inDeg ? reverseAlpha / Math.sqrt(inDeg[c] + 10) : reverseAlpha;
        scores[c] += scale * rev;
      }
    }
  }

  for (let i = 0; i < count; i++) {
    const s = scores[i];
    if (s !== 0 && Number.isFinite(s)) {
      map.set(ids[i], s);
    }
  }
  return map;
}

function devScore(res, baseDev) {
  const s = res.summary;
  const b = baseDev.summary;
  const tailOk = s.tail20 >= b.tail20 * 0.99;
  const covOk = s.cov >= b.cov * 0.92;
  const perfOk = s.msPerUser < 25.0;
  const eligible = tailOk && covOk && perfOk;
  return {
    eligible,
    score: s.ndcg20 + 0.5 * s.ndcg10
  };
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  const basePath = path.isAbsolute(opts.baseline) ? opts.baseline : path.join(ROOT, opts.baseline);
  const base = JSON.parse(fs.readFileSync(basePath, "utf8"));

  console.log(`Loading clean 300-user cohort & EASE^R index (${opts.ease})...`);
  const cohort = await loadCleanCohort(opts.svd, 300);
  const easeLoaded = loadEaseIndexFromPath(opts.ease);
  const devUsers = cohort.users.slice(0, 150);
  const valUsers = cohort.users.slice(150);

  // Warm up inDegree cache before timing
  getInDegree(easeLoaded.idx);

  const runSplit = (users, easeOptions) =>
    evaluatePipeline(users, cohort, {
      easeIdx: easeLoaded.idx,
      easeOptions,
      blendOptions: { easeWeight: opts.easeWeight },
      customEaseBuilder: buildCandidateEaseMap
    });

  console.log("\n=== BASELINE CHECK (DEV-150) ===");
  const devBase = runSplit(devUsers, { reverseAlpha: 0, useCalibratedZ: false });
  console.log("[DEV-150]    ", formatSplitRow("baseline_repro", devBase, base.dev));

  // 1. Reverse-edge sweep on DEV-150
  console.log("\n=== PHASE 1: REVERSE-EDGE RECOVERY SWEEP (DEV-150) ===");
  const revConfigs = [];
  for (const alpha of [0.0, 0.10, 0.20, 0.30, 0.45]) {
    if (alpha === 0) {
      revConfigs.push({ label: "rev=0.00_unscaled", reverseAlpha: 0, degreeDamped: false, useCalibratedZ: false });
    } else {
      revConfigs.push({ label: `rev=${alpha.toFixed(2)}_unscaled`, reverseAlpha: alpha, degreeDamped: false, useCalibratedZ: false });
      revConfigs.push({ label: `rev=${alpha.toFixed(2)}_degDamp`, reverseAlpha: alpha, degreeDamped: true, useCalibratedZ: false });
    }
  }

  const revResults = [];
  for (const cfg of revConfigs) {
    const res = runSplit(devUsers, cfg);
    console.log("[DEV-150]    ", formatSplitRow(cfg.label, res, base.dev));
    revResults.push({ cfg, res, ...devScore(res, base.dev) });
  }
  revResults.sort((a, b) => (b.eligible - a.eligible) || (b.score - a.score));
  const bestRev = revResults[0];
  console.log(`-> Best Phase 1 (DEV-150): ${bestRev.cfg.label} (NDCG10=${bestRev.res.summary.ndcg10}, NDCG20=${bestRev.res.summary.ndcg20})`);

  // 2. Calibrated Z-score input curve sweep on DEV-150
  console.log("\n=== PHASE 2: CALIBRATED Z-SCORE CURVE SWEEP (DEV-150) ===");
  const zPairs = [
    [0.50, 0.70],
    [0.60, 0.65],
    [0.65, 0.55]
  ];
  const zResults = [];
  for (const [b, a] of zPairs) {
    const cfg = {
      label: `z_${b.toFixed(2)}_${a.toFixed(2)}`,
      reverseAlpha: 0,
      degreeDamped: false,
      useCalibratedZ: true,
      curveB: b,
      curveA: a
    };
    const res = runSplit(devUsers, cfg);
    console.log("[DEV-150]    ", formatSplitRow(cfg.label, res, base.dev));
    zResults.push({ cfg, res, ...devScore(res, base.dev) });
  }
  zResults.sort((a, b) => (b.eligible - a.eligible) || (b.score - a.score));
  const bestZ = zResults[0];
  console.log(`-> Best Phase 2 (DEV-150): ${bestZ.cfg.label} (NDCG10=${bestZ.res.summary.ndcg10}, NDCG20=${bestZ.res.summary.ndcg20})`);

  // 3. Combined best Dev-150 pair
  console.log("\n=== PHASE 3: COMBINED BEST DEV-150 PAIR ===");
  const combinedCfg = {
    label: `${bestRev.cfg.label}+${bestZ.cfg.label}`,
    reverseAlpha: bestRev.cfg.reverseAlpha,
    degreeDamped: bestRev.cfg.degreeDamped,
    useCalibratedZ: true,
    curveB: bestZ.cfg.curveB,
    curveA: bestZ.cfg.curveA
  };
  const combinedDev = runSplit(devUsers, combinedCfg);
  console.log("[DEV-150]    ", formatSplitRow(combinedCfg.label, combinedDev, base.dev));

  // Pick overall Dev-150 winner across bestRev, bestZ, and combined
  const poolWinners = [
    bestRev,
    bestZ,
    { cfg: combinedCfg, res: combinedDev, ...devScore(combinedDev, base.dev) }
  ].sort((a, b) => (b.eligible - a.eligible) || (b.score - a.score));
  const devWinner = poolWinners[0];
  console.log(`\n-> Overall DEV-150 Winner: ${devWinner.cfg.label} (NDCG10=${devWinner.res.summary.ndcg10}, NDCG20=${devWinner.res.summary.ndcg20})`);

  // 4. Untouched HOLDOUT-150 Hard Ship Gate evaluation
  console.log("\n=== UNTOUCHED HOLDOUT-150 HARD SHIP GATE ===");
  const holdoutRes = runSplit(valUsers, devWinner.cfg);
  const allRes = runSplit(cohort.users, devWinner.cfg);
  console.log("[DEV-150]    ", formatSplitRow(devWinner.cfg.label, devWinner.res, base.dev));
  console.log("[HOLDOUT-150]", formatSplitRow(devWinner.cfg.label, holdoutRes, base.val));
  console.log("[ALL-300]    ", formatSplitRow(devWinner.cfg.label, allRes, base.all));

  const gate = checkShipGate(holdoutRes, base.val, 0);
  console.log(`\n>>> HARD SHIP GATE (HOLDOUT-150): ${gate.pass ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify({ winner: devWinner.cfg, gate: gate.rules }, null, 2));
}

main();
