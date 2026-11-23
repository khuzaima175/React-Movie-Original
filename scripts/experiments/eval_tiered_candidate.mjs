import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDatasets,
  loadEmb,
  evalCohort,
  evalBenchmarks,
  printCohortComparison
} from "./run_ablation.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cohortArg = process.argv[2] || "all";
const modeArg = process.argv[3] || "tiered_smooth";

const CONFIGS = {
  tiered_smooth: {
    decayMode: "tiered",
    tierFloors: { masterpiece: 0.35, exceptional: 0.25, great: 0.15, disliked: 0.20, neutral: 0.08 }
  },
  tiered_mild: {
    decayMode: "tiered",
    tierFloors: { masterpiece: 0.45, exceptional: 0.30, great: 0.20, disliked: 0.25, neutral: 0.10 }
  }
};

async function main() {
  const t0 = Date.now();
  const { catalog, users328, users300, bench } = loadDatasets();
  const emb = loadEmb(".data/item_embeddings_clean2_f16.bin");
  const profileOptions = CONFIGS[modeArg];
  const opts = { profileOptions };

  const out = { mode: modeArg, profileOptions, datasets: {} };
  if (cohortArg === "328" || cohortArg === "all") {
    out.datasets.c328_ge8 = await evalCohort(users328, catalog, emb, 8, opts);
    out.datasets.c328_ge9 = await evalCohort(users328, catalog, emb, 9, opts);
    printCohortComparison(`${modeArg} 328 >=8*`, out.datasets.c328_ge8, []);
    printCohortComparison(`${modeArg} 328 >=9*`, out.datasets.c328_ge9, []);
  }
  if (cohortArg === "300" || cohortArg === "all") {
    out.datasets.c300_ge8 = await evalCohort(users300, catalog, emb, 8, opts);
    out.datasets.c300_ge9 = await evalCohort(users300, catalog, emb, 9, opts);
    printCohortComparison(`${modeArg} fresh_300 >=8*`, out.datasets.c300_ge8, []);
    printCohortComparison(`${modeArg} fresh_300 >=9*`, out.datasets.c300_ge9, []);
  }
  if (cohortArg === "bench" || cohortArg === "all") {
    out.datasets.bench = await evalBenchmarks(bench, emb, opts);
  }
  const outPath = path.join(ROOT, `.data/ablation_results/eval_${modeArg}_${cohortArg}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Saved ${outPath} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
