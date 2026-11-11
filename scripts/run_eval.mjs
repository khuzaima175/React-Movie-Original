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
      "Usage: node scripts/run_eval.mjs --synthetic | --benchmark FILE | --vault FILE --catalog FILE [--embeddings FILE] [--weights FILE] [--folds N] [--out FILE]"
    );
    process.exit(2);
  }

  let embeddingIndex = null;
  if (args.embeddings) {
    const buf = fs.readFileSync(path.resolve(args.embeddings));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    embeddingIndex = parseEmbeddingBinary(ab);
    console.log(`Loaded embedding index: ${embeddingIndex.count} items, dim=${embeddingIndex.dim}`);
  }

  let weights = undefined;
  if (args.weights) {
    weights = readJson(args.weights);
  }

  const output = { generatedAt: new Date().toISOString(), folds, vaults: {} };

  for (const vault of benchmark.vaults) {
    const rolling = await evaluateRankerRolling({
      watched: vault.watched,
      catalog: benchmark.catalog,
      embeddingIndex,
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
          { status: res.status, reason: res.reason, foldsUsed: res.foldsUsed, mean: res.mean, std: res.std }
        ])
      )
    };
    const covStr = firstFoldCov
      ? `, vault emb cov ${firstFoldCov.vaultCovered}/${firstFoldCov.vaultTotal}, catalog cov ${firstFoldCov.catalogCovered}/${firstFoldCov.catalogTotal}`
      : "";
    console.log(`\n== ${vault.name} (${vault.watched.length} ratings, catalog ${benchmark.catalog.length}${covStr}) ==`);
    console.log(formatEvalReport(rolling));
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
