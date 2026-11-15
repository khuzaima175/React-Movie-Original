import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  getCollabCatalogMax,
  retrieveAlignedEmbeddingNeighbors
} = await imp("src/services/embeddingService.js");
const { buildContentSimMap } = await imp("src/services/contentSimService.js");
const { DEFAULT_RANKER_WEIGHTS, rankCandidatePool } = await imp("src/services/rankerService.js");
const { extractTasteProfile, getRecentReleaseDateFloor } = await imp("src/services/tmdbService.js");
const {
  RECENT_RELEASE_RESERVE_COUNT,
  RECENT_RELEASE_RESERVE_MONTHS,
  RECENT_RELEASE_MIN_PROB_PERCENTILE
} = await imp("src/services/geminiService.js");
const {
  temporalHoldoutSplit,
  computeRecallAtK,
  computeNDCGAtK
} = await imp("src/services/evalHarness.js");
const {
  loadDatasets,
  loadEmb,
  pairedBootstrapCI,
  formatCI
} = await imp("scripts/experiments/run_ablation.mjs");

export const BUCKET_E_K_GRID = [30, 60, 80];

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

function meanArr(vals = []) {
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

/**
 * Evaluates Bucket E (`retrieveAlignedEmbeddingNeighbors`) top-K alone passed directly
 * through production `rankCandidatePool` (with production `collabNormalization`,
 * `DEFAULT_RANKER_WEIGHTS`, `topK = 30`, and recent-release reserve config).
 *
 * Slices top-K from the full 25k embedding index BEFORE mapping to `catalogByTmdb` so the
 * offline candidate pool reflects the exact production top-K window (note that neighbors
 * outside the enriched `ml-latest-small` catalog cannot be metadata-enriched or judged
 * against offline holdout ratings, so unenriched non-catalog neighbors are dropped here
 * and we report mean mapped pool size alongside `K`).
 */
export async function evaluateBucketEPoolCohort(
  users,
  catalogByTmdb,
  emb,
  minPos = 8,
  kGrid = BUCKET_E_K_GRID
) {
  const sortedKs = [...kGrid].sort((a, b) => a - b);
  const maxK = sortedKs[sortedKs.length - 1];
  const baseK = sortedKs[0];
  const repulsionWeight =
    Math.abs(DEFAULT_RANKER_WEIGHTS.repulsion) / DEFAULT_RANKER_WEIGHTS.collabSim;

  const perK = Object.fromEntries(
    sortedKs.map(k => [
      k,
      {
        ndcg10ByUser: {},
        recall10ByUser: {},
        hits10ByUser: {},
        mappedSizes: [],
        posInPoolCounts: [],
        poolCeilings: []
      }
    ])
  );

  let validUsers = 0;
  let totalHoldoutPos = 0;

  for (const u of users) {
    const split = temporalHoldoutSplit(u.ratings, 10, minPos);
    if (split.trainWatched.length < 10 || split.holdoutPositives.size < 3) continue;

    validUsers++;
    totalHoldoutPos += split.holdoutPositives.size;

    const holdoutKeys = new Set(split.holdoutRelevance.keys());
    const excludeNumericIds = new Set();
    const excludeStrings = [];
    for (const m of u.ratings) {
      const key = getMovieKey(m);
      if (key && holdoutKeys.has(key)) continue;
      if (key) excludeStrings.push(key);
      const tid = Number(m?.tmdbId ?? m?.id ?? 0);
      if (Number.isFinite(tid) && tid > 0) excludeNumericIds.add(tid);
    }

    const profile = await extractTasteProfile(split.trainWatched, [], {
      now: split.holdoutStartTs ?? undefined,
      anchorCutoff: Infinity
    });
    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, emb);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, emb);
    const catalogMax = getCollabCatalogMax(collabSimMap);

    // Mirror production Bucket E caller (`src/services/geminiService.js`)
    const neighbors = retrieveAlignedEmbeddingNeighbors(
      profile.weightedRatings,
      emb,
      excludeNumericIds,
      {
        collabSimMap,
        repulsionMap,
        catalogMax,
        repulsionWeight,
        topK: maxK
      }
    );

    const reserveConfig = {
      count: RECENT_RELEASE_RESERVE_COUNT,
      minReleaseDate: getRecentReleaseDateFloor(
        RECENT_RELEASE_RESERVE_MONTHS,
        split.holdoutStartTs ?? Date.now()
      ),
      minProbabilityPercentile: RECENT_RELEASE_MIN_PROB_PERCENTILE
    };

    for (const k of sortedKs) {
      const topSlice = neighbors.slice(0, k);
      const bucketCandidates = [];
      const seen = new Set();
      for (const n of topSlice) {
        const cat = catalogByTmdb.get(Number(n.tmdbId));
        if (!cat) continue;
        const cKey = getMovieKey(cat);
        if (!cKey || seen.has(cKey)) continue;
        seen.add(cKey);
        bucketCandidates.push({
          ...cat,
          sourceBucket: "Bucket E (Embedding)"
        });
      }

      const contentSimMap = buildContentSimMap(profile.weightedRatings, null, bucketCandidates, {
        collabIndex: emb,
        collabSimMap,
        enableStructuredFallback: true,
        coldOnly: true
      });

      const ranked =
        bucketCandidates.length > 0
          ? rankCandidatePool(
              bucketCandidates,
              {
                profile,
                mood: "any",
                excludeIds: excludeStrings,
                collabSimMap,
                contentSimMap,
                repulsionMap,
                dnaSimMap: null,
                anchorKeywords: profile?.lovedKeywordIds,
                userProviders: []
              },
              DEFAULT_RANKER_WEIGHTS,
              Math.max(10, 30),
              {},
              reserveConfig
            )
          : [];

      const top10Ids = ranked.slice(0, 10).map(getMovieKey);
      const ndcg10 = computeNDCGAtK(top10Ids, split.holdoutRelevance, 10);
      const recall10 = computeRecallAtK(top10Ids, split.holdoutPositives, 10);
      const hit10 = top10Ids.some(id => split.holdoutPositives.has(id)) ? 1 : 0;
      const posInPool = bucketCandidates.filter(c => split.holdoutPositives.has(getMovieKey(c))).length;

      perK[k].ndcg10ByUser[u.uid] = ndcg10;
      perK[k].recall10ByUser[u.uid] = recall10;
      perK[k].hits10ByUser[u.uid] = hit10;
      perK[k].mappedSizes.push(bucketCandidates.length);
      perK[k].posInPoolCounts.push(posInPool);
      perK[k].poolCeilings.push(posInPool / split.holdoutPositives.size);
    }
  }

  const base = perK[baseK];
  const summaryByK = {};
  for (const k of sortedKs) {
    const cur = perK[k];
    const ndcgVals = Object.values(cur.ndcg10ByUser);
    const recVals = Object.values(cur.recall10ByUser);
    const hitVals = Object.values(cur.hits10ByUser);
    const ndcgCI =
      k === baseK ? null : pairedBootstrapCI(cur.ndcg10ByUser, base.ndcg10ByUser, 2000, 100 + k);
    const recCI =
      k === baseK ? null : pairedBootstrapCI(cur.recall10ByUser, base.recall10ByUser, 2000, 200 + k);
    summaryByK[k] = {
      k,
      validUsers,
      totalHoldoutPos,
      meanMappedPoolSize: meanArr(cur.mappedSizes),
      meanPosInPool: meanArr(cur.posInPoolCounts),
      meanPoolCeiling: meanArr(cur.poolCeilings),
      meanNDCG10: meanArr(ndcgVals),
      meanRecall10: meanArr(recVals),
      hitRate10: meanArr(hitVals),
      deltaVsK30:
        k === baseK
          ? null
          : {
              ndcg10: ndcgCI,
              recall10: recCI
            }
    };
  }

  return {
    minPos,
    baseK,
    kGrid: sortedKs,
    validUsers,
    totalHoldoutPos,
    summaryByK
  };
}

function fmtNum(v, digits = 4) {
  return v == null || !Number.isFinite(v) ? "N/A" : Number(v).toFixed(digits);
}

function buildMarkdownReport(results) {
  const lines = [
    "# Bucket E Alone (`rankCandidatePool`) Evaluation (`clean2` Index)",
    "",
    `- Generated: \`${results.generatedAt}\``,
    `- Index: \`${results.indexPath}\``,
    `- Protocol: Calls \`retrieveAlignedEmbeddingNeighbors\` with production \`catalogMax\` and \`repulsionWeight = |repulsion| / collabSim\`, takes Bucket E's top-\`K\` alone (\`K ∈ {30, 60, 80}\`), maps onto the enriched offline catalog (no Buckets A–D), and ranks with production \`rankCandidatePool\` (\`DEFAULT_RANKER_WEIGHTS\`, \`topK = 30\`, \`coldOnly: true\` structured fallback, recent-release reserve).`,
    "",
    "| Cohort | Valid Users | `K` | Mean Mapped Pool | Mean Pool Ceiling | `NDCG@10` | `NDCG@10` d vs `K=30` (95% CI) | `Recall@10` | `Recall@10` d vs `K=30` (95% CI) | `Hit@10` (>=1) |",
    "| :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: | :--- | :---: |"
  ];

  for (const row of results.cohorts) {
    for (const k of row.kGrid) {
      const s = row.summaryByK[k];
      const ndcgDeltaStr = k === 30 ? "baseline" : formatCI(s.deltaVsK30.ndcg10);
      const recDeltaStr = k === 30 ? "baseline" : formatCI(s.deltaVsK30.recall10);
      lines.push(
        `| ${row.cohortLabel} | ${row.validUsers} | ${k} | ${fmtNum(s.meanMappedPoolSize, 2)} | ${fmtNum(s.meanPoolCeiling)} | ${fmtNum(s.meanNDCG10)} | ${ndcgDeltaStr} | ${fmtNum(s.meanRecall10)} | ${recDeltaStr} | ${fmtNum(s.hitRate10)} |`
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const t0 = Date.now();
  const { catalog, users328, users300 } = loadDatasets();
  const catalogByTmdb = new Map(catalog.map(c => [Number(c.tmdbId ?? c.id), c]));
  const emb = loadEmb(".data/item_embeddings_clean2_f16.bin");

  const tasks = [
    { cohortLabel: "328 >=8★", users: users328, minPos: 8 },
    { cohortLabel: "328 >=9★", users: users328, minPos: 9 },
    { cohortLabel: "fresh_300 >=8★", users: users300, minPos: 8 },
    { cohortLabel: "fresh_300 >=9★", users: users300, minPos: 9 }
  ];

  const cohorts = [];
  for (const t of tasks) {
    const res = await evaluateBucketEPoolCohort(t.users, catalogByTmdb, emb, t.minPos, BUCKET_E_K_GRID);
    cohorts.push({
      cohortLabel: t.cohortLabel,
      ...res
    });
  }

  const results = {
    generatedAt: new Date().toISOString(),
    indexPath: ".data/item_embeddings_clean2_f16.bin",
    kGrid: BUCKET_E_K_GRID,
    elapsedSeconds: (Date.now() - t0) / 1000,
    cohorts
  };

  const outDir = path.join(ROOT, "scripts/experiments/results");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "bucket_e_pool_eval.json");
  const mdPath = path.join(outDir, "bucket_e_pool_eval.md");
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  const md = buildMarkdownReport(results);
  fs.writeFileSync(mdPath, md);

  console.log(md);
  console.log(`Completed in ${results.elapsedSeconds.toFixed(1)}s. Saved ${jsonPath} and ${mdPath}`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  await main();
}
