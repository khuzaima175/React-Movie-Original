import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDatasets,
  loadEmb,
  pairedBootstrapCI,
  formatCI,
  evalCohort,
  evalBenchmarks,
  printCohortComparison
} from "./run_ablation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const VARIANTS = [
  {
    name: "legacy",
    desc: "Current pure exp(-0.002*d), floor=0",
    profileOptions: { decayMode: "legacy" }
  },
  {
    name: "uniform_025",
    desc: "Uniform floor 0.25",
    profileOptions: { decayMode: "uniform", decayFloor: 0.25 }
  },
  {
    name: "uniform_035",
    desc: "Uniform floor 0.35",
    profileOptions: { decayMode: "uniform", decayFloor: 0.35 }
  },
  {
    name: "uniform_050",
    desc: "Uniform floor 0.50",
    profileOptions: { decayMode: "uniform", decayFloor: 0.50 }
  },
  {
    name: "no_decay",
    desc: "Zero decay (floor=1.0)",
    profileOptions: { decayMode: "uniform", decayFloor: 1.0 }
  },
  {
    name: "tiered_gentle",
    desc: "10*:0.65, 9*:0.45, 8*:0.25, <=4*:0.25, mid:0.10",
    profileOptions: {
      decayMode: "tiered",
      tierFloors: { masterpiece: 0.65, exceptional: 0.45, great: 0.25, disliked: 0.25, neutral: 0.10 }
    }
  },
  {
    name: "tiered_balanced",
    desc: "10*:0.75, 9*:0.50, 8*:0.30, <=4*:0.35, mid:0.10",
    profileOptions: {
      decayMode: "tiered",
      tierFloors: { masterpiece: 0.75, exceptional: 0.50, great: 0.30, disliked: 0.35, neutral: 0.10 }
    }
  },
  {
    name: "tiered_strong",
    desc: "10*:0.85, 9*:0.60, 8*:0.35, <=4*:0.40, mid:0.15",
    profileOptions: {
      decayMode: "tiered",
      tierFloors: { masterpiece: 0.85, exceptional: 0.60, great: 0.35, disliked: 0.40, neutral: 0.15 }
    }
  }
];

async function main() {
  const t0 = Date.now();
  const { catalog, users328, users300, bench } = loadDatasets();
  const embClean2 = loadEmb(".data/item_embeddings_clean2_f16.bin");

  const results = {};
  for (const v of VARIANTS) {
    const vt0 = Date.now();
    const evalOpts = { profileOptions: v.profileOptions };
    const c328_ge8 = await evalCohort(users328, catalog, embClean2, 8, evalOpts);
    const c328_ge9 = await evalCohort(users328, catalog, embClean2, 9, evalOpts);
    const c300_ge8 = await evalCohort(users300, catalog, embClean2, 8, evalOpts);
    const c300_ge9 = await evalCohort(users300, catalog, embClean2, 9, evalOpts);
    const bench_clean2 = await evalBenchmarks(bench, embClean2, evalOpts);

    results[v.name] = {
      desc: v.desc,
      profileOptions: v.profileOptions,
      c328_ge8,
      c328_ge9,
      c300_ge8,
      c300_ge9,
      bench_clean2
    };
    console.log(`[${v.name}] finished in ${((Date.now() - vt0) / 1000).toFixed(1)}s`);
  }

  const base = results.legacy;
  console.log("\n================================================================================");
  console.log("DECAY FLOOR ABLATION SUMMARY (vs legacy pure exp(-0.002 * days))");
  console.log("================================================================================");

  for (const v of VARIANTS) {
    const cur = results[v.name];
    console.log(`\n### ${v.name} — ${v.desc}`);
    const refs328_8 = v.name === "legacy" ? [] : [["legacy", base.c328_ge8]];
    const refs328_9 = v.name === "legacy" ? [] : [["legacy", base.c328_ge9]];
    const refs300_8 = v.name === "legacy" ? [] : [["legacy", base.c300_ge8]];
    const refs300_9 = v.name === "legacy" ? [] : [["legacy", base.c300_ge9]];

    printCohortComparison("328 >=8*", cur.c328_ge8, refs328_8);
    printCohortComparison("328 >=9*", cur.c328_ge9, refs328_9);
    printCohortComparison("fresh_300 >=8*", cur.c300_ge8, refs300_8);
    printCohortComparison("fresh_300 >=9*", cur.c300_ge9, refs300_9);

    const b8 = cur.bench_clean2.ge8.MEAN_ROLLING;
    const b9 = cur.bench_clean2.ge9.MEAN_ROLLING;
    const rb8 = base.bench_clean2.ge8.MEAN_ROLLING;
    const rb9 = base.bench_clean2.ge9.MEAN_ROLLING;
    console.log(
      `\n--- 4 Bench MEAN_ROLLING ---\n  >=8*: NDCG=${b8.ndcg10.toFixed(4)} (${(b8.ndcg10 - rb8.ndcg10 >= 0 ? "+" : "")}${(b8.ndcg10 - rb8.ndcg10).toFixed(4)}) | Rec20=${b8.rec20.toFixed(4)} | AUC9v7=${b8.auc9v7.toFixed(4)} (${(b8.auc9v7 - rb8.auc9v7 >= 0 ? "+" : "")}${(b8.auc9v7 - rb8.auc9v7).toFixed(4)})`
    );
    console.log(
      `  >=9*: NDCG=${b9.ndcg10.toFixed(4)} (${(b9.ndcg10 - rb9.ndcg10 >= 0 ? "+" : "")}${(b9.ndcg10 - rb9.ndcg10).toFixed(4)}) | Rec20=${b9.rec20.toFixed(4)} | AUC9v7=${b9.auc9v7.toFixed(4)} (${(b9.auc9v7 - rb9.auc9v7 >= 0 ? "+" : "")}${(b9.auc9v7 - rb9.auc9v7).toFixed(4)})`
    );
  }

  const outDir = path.join(ROOT, ".data/ablation_results");
  fs.mkdirSync(outDir, { recursive: true });
  const compactOut = {};
  for (const [k, val] of Object.entries(results)) {
    compactOut[k] = {
      desc: val.desc,
      profileOptions: val.profileOptions,
      c328_ge8: val.c328_ge8.means,
      c328_ge9: val.c328_ge9.means,
      c300_ge8: val.c300_ge8.means,
      c300_ge9: val.c300_ge9.means,
      bench_ge8: val.bench_clean2.ge8.MEAN_ROLLING,
      bench_ge9: val.bench_clean2.ge9.MEAN_ROLLING
    };
  }
  const outPath = path.join(outDir, "eval_decay_floor_ablation.json");
  fs.writeFileSync(outPath, JSON.stringify(compactOut, null, 2));
  console.log(`\nSaved summary to ${outPath} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
