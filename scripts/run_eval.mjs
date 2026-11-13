#!/usr/bin/env node
/**
 * CinemaVault evaluation runner.
 *
 * Scores the real logistic ranker against fixed baselines (popularity, toy formula, random) on a
 * rolling-origin temporal holdout and prints a comparable table.
 *
 *   node scripts/run_eval.mjs --synthetic
 *   node scripts/run_eval.mjs --vault my_vault.json --catalog catalog.json
 *   node scripts/run_eval.mjs --benchmark .data/benchmark_vaults.json --embeddings public/models/item_embeddings_f16.bin
 *   add --out baseline.json to save the raw results, --folds N to change the fold count
 */
import fs from "node:fs";
import path from "node:path";
import { evaluateRankerRolling, formatEvalReport } from "../src/services/evalHarness.js";
import { parseEmbeddingBinary } from "../src/services/embeddingService.js";
import { parseDnaBinary } from "../src/services/dnaService.js";
import { DEFAULT_RANKER_WEIGHTS } from "../src/services/rankerService.js";
import { buildSyntheticBenchmark } from "../tests/fixtures/syntheticVaults.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function loadBinary(file, parser) {
  if (!file) return null;
  const buf = fs.readFileSync(path.resolve(file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return parser(ab);
}

function pairedBootstrapCI(candScores, baseScores, numResamples = 1000, seed = 42) {
  const n = candScores.length;
  if (n === 0) return { meanDiff: 0, ciLower: 0, ciUpper: 0, significantWin: false };
  const diffs = candScores.map((c, i) => c - baseScores[i]);
  const meanDiff = diffs.reduce((a, b) => a + b, 0) / n;

  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const boot = new Float64Array(numResamples);
  for (let b = 0; b < numResamples; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += diffs[Math.floor(rnd() * n)];
    boot[b] = sum / n;
  }
  boot.sort();
  const ciLower = boot[Math.floor(0.025 * numResamples)];
  const ciUpper = boot[Math.floor(0.975 * numResamples)];
  return { meanDiff, ciLower, ciUpper, significantWin: meanDiff > 0 && ciLower > 0 };
}

async function runGateSuite(benchmark, opts = {}) {
  const {
    folds = 3,
    embeddingIndex = null,
    halfNormIndex = null,
    contentIndex = null,
    dnaIndex = null,
    weights = DEFAULT_RANKER_WEIGHTS
  } = opts;

  const baselineWeights = { ...DEFAULT_RANKER_WEIGHTS, ...(weights || {}), repulsion: -1.5, negativeKeywordPenalty: -0.5 };
  const variants = [
    { name: "baseline", profileOptions: { dualClock: false }, embeddingIndex, contentIndex: null, dnaIndex: null, contentOptions: {} },
    { name: "dualClock", profileOptions: { dualClock: true }, embeddingIndex, contentIndex: null, dnaIndex: null, contentOptions: {} },
    { name: "overviewTfIdf", profileOptions: { dualClock: false }, embeddingIndex, contentIndex: null, dnaIndex: null, contentOptions: { enableOverviewTfIdf: true } }
  ];
  if (contentIndex) {
    variants.push({ name: "contentIndex", profileOptions: { dualClock: false }, embeddingIndex, contentIndex, dnaIndex: null, contentOptions: {} });
  }
  if (dnaIndex) {
    variants.push({
      name: "dnaIndex",
      profileOptions: { dualClock: false },
      embeddingIndex,
      contentIndex: null,
      dnaIndex,
      weights: { ...baselineWeights, dnaSim: 0.8 },
      contentOptions: {}
    });
  }
  if (halfNormIndex) {
    variants.push({ name: "halfNorm", profileOptions: { dualClock: false }, embeddingIndex: halfNormIndex, contentIndex: null, dnaIndex: null, contentOptions: {} });
  }

  const perVariant = new Map();
  for (const v of variants) {
    const ndcgs = [];
    const negHits = [];
    const uniqueSet = new Set();
    const voteMedians = [];

    for (const vault of benchmark.vaults) {
      const rolling = await evaluateRankerRolling({
        watched: vault.watched,
        catalog: benchmark.catalog,
        embeddingIndex: v.embeddingIndex,
        contentIndex: v.contentIndex,
        contentOptions: v.contentOptions,
        dnaIndex: v.dnaIndex,
        profileOptions: v.profileOptions,
        weights: v.weights || baselineWeights,
        folds,
        strategies: ["ranker"],
        seed: 1
      });
      const r = rolling.strategies.ranker;
      if (r?.status !== "ok") continue;
      ndcgs.push(r.mean.ndcgAt10 ?? 0);
      negHits.push(r.mean.negHitAt20 ?? 0);
      voteMedians.push(r.medianVoteCount ?? 0);
      for (const f of r.folds || []) {
        for (const id of f.top30Ids || []) uniqueSet.add(id);
      }
    }

    const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    perVariant.set(v.name, {
      ndcgs,
      negHits,
      meanNdcg: avg(ndcgs),
      meanNegHit: avg(negHits),
      uniqueTop30: uniqueSet.size,
      meanMedianVotes: avg(voteMedians)
    });
  }

  const base = perVariant.get("baseline");
  console.log("\n=== Clean1/Clean2 Promotion Gate ===");
  console.log("variant | NDCG@10 | NegHit@20 | Unique@30 | MedianVotes | dNDCG@10 [95% CI] | Gate");
  const summary = {};
  for (const [name, row] of perVariant.entries()) {
    const boot = pairedBootstrapCI(row.ndcgs, base.ndcgs);
    const dNeg = row.meanNegHit - base.meanNegHit;
    const passed = name === "baseline" ? true : (boot.meanDiff > 0 && boot.significantWin && dNeg <= 0);
    summary[name] = {
      meanNdcg: row.meanNdcg,
      meanNegHit: row.meanNegHit,
      uniqueTop30: row.uniqueTop30,
      meanMedianVotes: row.meanMedianVotes,
      deltaNdcg: boot.meanDiff,
      ci95: [boot.ciLower, boot.ciUpper],
      deltaNegHit: dNeg,
      promote: passed
    };
    const gateStr = name === "baseline" ? "REF" : (passed ? "PASS" : "HOLD");
    console.log(
      `${name} | ${row.meanNdcg.toFixed(4)} | ${row.meanNegHit.toFixed(4)} | ${row.uniqueTop30} | ${Math.round(row.meanMedianVotes)} | ${boot.meanDiff >= 0 ? "+" : ""}${boot.meanDiff.toFixed(4)} [${boot.ciLower.toFixed(4)}, ${boot.ciUpper.toFixed(4)}] | ${gateStr}`
    );
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const folds = Number(args.folds) > 0 ? Number(args.folds) : 3;

  let benchmark;
  if (args.synthetic) {
    benchmark = buildSyntheticBenchmark();
  } else if (args.benchmark) {
    benchmark = readJson(args.benchmark);
  } else if (args.vault && args.catalog) {
    const vault = readJson(args.vault);
    benchmark = {
      catalog: readJson(args.catalog),
      vaults: [{ name: path.basename(String(args.vault)), watched: Array.isArray(vault) ? vault : vault.watched }]
    };
  } else {
    console.error(
      "Usage: node scripts/run_eval.mjs --synthetic | --benchmark FILE | --vault FILE --catalog FILE [--embeddings FILE] [--embeddings-half-norm FILE] [--content-embeddings FILE] [--dna FILE] [--weights FILE] [--dual-clock] [--overview-tfidf] [--gate] [--folds N] [--out FILE]"
    );
    process.exit(2);
  }

  const embeddingIndex = loadBinary(args.embeddings, parseEmbeddingBinary);
  if (embeddingIndex) {
    console.log(`Loaded embedding index: ${embeddingIndex.count} items, dim=${embeddingIndex.dim}`);
  }
  const halfNormIndex = loadBinary(args["embeddings-half-norm"], parseEmbeddingBinary);
  const contentIndex = loadBinary(args["content-embeddings"], parseEmbeddingBinary);
  const dnaIndex = loadBinary(args.dna, parseDnaBinary);

  const weights = args.weights ? readJson(args.weights) : undefined;
  const output = { generatedAt: new Date().toISOString(), folds, vaults: {} };

  if (args.gate) {
    output.gate = await runGateSuite(benchmark, {
      folds,
      embeddingIndex,
      halfNormIndex,
      contentIndex,
      dnaIndex,
      weights
    });
  } else {
    for (const vault of benchmark.vaults) {
      const rolling = await evaluateRankerRolling({
        watched: vault.watched,
        catalog: benchmark.catalog,
        embeddingIndex,
        contentIndex,
        dnaIndex,
        profileOptions: { dualClock: Boolean(args["dual-clock"]) },
        contentOptions: { enableOverviewTfIdf: Boolean(args["overview-tfidf"]) },
        weights,
        folds,
        seed: 1
      });
      const firstFoldCov = rolling.strategies.ranker?.folds?.[0]?.coverage;
      output.vaults[vault.name] = {
        ratings: vault.watched.length,
        coverage: firstFoldCov || null,
        strategies: Object.fromEntries(
          Object.entries(rolling.strategies).map(([name, res]) => [
            name,
            {
              status: res.status,
              reason: res.reason,
              foldsUsed: res.foldsUsed,
              mean: res.mean,
              std: res.std,
              uniqueTop30: res.uniqueTop30,
              medianVoteCount: res.medianVoteCount
            }
          ])
        )
      };
      const covStr = firstFoldCov
        ? `, vault emb cov ${firstFoldCov.vaultCovered}/${firstFoldCov.vaultTotal}, catalog cov ${firstFoldCov.catalogCovered}/${firstFoldCov.catalogTotal}`
        : "";
      console.log(`\n== ${vault.name} (${vault.watched.length} ratings, catalog ${benchmark.catalog.length}${covStr}) ==`);
      console.log(formatEvalReport(rolling));
    }
  }

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(path.resolve(args.out), JSON.stringify(output, null, 2));
    console.log(`\nSaved ${args.out}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
