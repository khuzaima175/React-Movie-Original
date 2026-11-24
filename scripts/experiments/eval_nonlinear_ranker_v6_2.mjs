#!/usr/bin/env node
/**
 * CinemaVault v6.2 Task 5 Non-Linear Ranker Calibration Evaluator
 *
 * Ablates 3 non-linear ranker calibration terms individually and combined across
 * Dev-150 -> untouched Holdout-150 (`.data/fresh_300_users.json`):
 *   1. User-calibrated popularity match:
 *      popMatch = exp(-0.5 * ((log10(votes) - meanLogVotes) / max(stdLogVotes, 0.45))^2)
 *   2. Empirical vault-size shrinkage on collabSim:
 *      collabShrink = nIndexed / (nIndexed + k0)  (k0 in {0, 3, 5, 8})
 *   3. Cold-conditioned auteur/cast boost:
 *      crewBoost = 1 + gammaCrew * (1 - smoothT)  (gammaCrew in {0, 0.75, 1.25, 1.75})
 *
 * Evaluates across 3 strata:
 *   - Full cohort (Dev-150 -> Holdout-150, 4-part Hard Gate vs .data/v6_lab/v6_2_best.json)
 *   - Small-vault synthetic slice (3..10 subsampled ratings per user)
 *   - 100%-cold holdout slice (collabSim=0, public/models/content_embeddings_f16.bin, coldOnly=true)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  parseEmbeddingBinary,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  getCollabCatalogMax
} = await imp("src/services/embeddingService.js");
const {
  buildEaseSimMapFromIndex,
  blendEaseAndCollabSimMaps
} = await imp("src/services/easeService.js");
const { buildContentSimMap } = await imp("src/services/contentSimService.js");
const {
  temporalHoldoutSplit,
  computeNDCGAtK
} = await imp("src/services/evalHarness.js");
const {
  extractCandidateFeatures,
  rankCandidatePool,
  DEFAULT_RANKER_WEIGHTS,
  DEFAULT_METADATA_DAMPING_FACTOR
} = await imp("src/services/rankerService.js");
const { extractTasteProfile } = await imp("src/services/tmdbService.js");
const {
  loadCleanCohort,
  loadEaseIndexFromPath,
  pairedBootstrap,
  checkShipGate,
  formatSplitRow
} = await imp("scripts/experiments/v6_gate_eval.mjs");

function parseCli(argv) {
  const opts = {
    baseline: ".data/v6_lab/v6_2_best.json",
    ease: ".data/v6_lab/ease_v6_baseline_clean.cvea",
    svd: ".data/item_embeddings_clean2_f16.bin",
    content: "public/models/content_embeddings_f16.bin",
    easeWeight: 0.60
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline" && argv[i + 1]) opts.baseline = argv[++i];
    else if (a === "--ease" && argv[i + 1]) opts.ease = argv[++i];
    else if (a === "--svd" && argv[i + 1]) opts.svd = argv[++i];
    else if (a === "--content" && argv[i + 1]) opts.content = argv[++i];
    else if (a === "--ease-weight" && argv[i + 1]) opts.easeWeight = Number(argv[++i]);
  }
  return opts;
}

/**
 * Computes user's preferred popularity distribution in log10(vote_count) space
 * from positively weighted/rated films (falling back to all valid films if needed).
 */
export function computeUserPopularityStats(weightedRatings = []) {
  if (!Array.isArray(weightedRatings) || weightedRatings.length === 0) {
    return { meanLogVotes: Math.log10(1000), stdLogVotes: 0.7, count: 0 };
  }

  const collect = (positiveOnly) => {
    let sumW = 0;
    let sumWX = 0;
    let sumWX2 = 0;
    let count = 0;
    for (const entry of weightedRatings) {
      const m = entry?.movie || entry;
      const rawVotes = Number(m?.vote_count ?? m?.votes ?? NaN);
      if (!Number.isFinite(rawVotes) || rawVotes <= 0) continue;
      const w = Number(entry?.weight ?? entry?.finalWeight ?? 1);
      const r = Number(entry?.rating ?? m?.userRating ?? m?.UserRating ?? NaN);
      if (positiveOnly) {
        if (!Number.isFinite(w) || w <= 0) continue;
        if (Number.isFinite(r) && r > 0 && r < 7) continue;
      }
      const effW = positiveOnly ? w : 1.0;
      const logV = Math.log10(Math.max(10, rawVotes));
      sumW += effW;
      sumWX += effW * logV;
      sumWX2 += effW * logV * logV;
      count++;
    }
    if (count === 0 || sumW <= 0) return null;
    const mean = sumWX / sumW;
    const variance = Math.max(0, sumWX2 / sumW - mean * mean);
    return { meanLogVotes: mean, stdLogVotes: Math.sqrt(variance), count };
  };

  return collect(true) || collect(false) || { meanLogVotes: Math.log10(1000), stdLogVotes: 0.7, count: 0 };
}

function countIndexedRatings(weightedRatings = [], svdIdx = null, easeIdx = null) {
  let n = 0;
  for (const entry of weightedRatings || []) {
    const id = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    if (!id) continue;
    if (svdIdx?.idToIndex?.has(id) || easeIdx?.idToIndex?.has(id)) n++;
  }
  return n;
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildPreparedUserEntries(u, collabSimMap, contentSimMap, repulsionMap, svdIdx, easeIdx, weights = DEFAULT_RANKER_WEIGHTS) {
  const catalogMax = collabSimMap && collabSimMap.size > 0 ? getCollabCatalogMax(collabSimMap) : null;
  const maxPoolCollab = (() => {
    let m = 0;
    if (collabSimMap && typeof collabSimMap.get === "function") {
      for (const c of u.pool) {
        const val = Number(collabSimMap.get(Number(c.tmdbId ?? c.id ?? 0)) ?? c.collabSim ?? 0);
        if (val > m) m = val;
      }
    }
    return m;
  })();
  const collabScale = maxPoolCollab > 0.05 ? maxPoolCollab : 1.0;

  const popStats = computeUserPopularityStats(u.profile.weightedRatings);
  const nIndexed = countIndexedRatings(u.profile.weightedRatings, svdIdx, easeIdx);

  const m = u.pool.length;
  const ids = new Int32Array(m);
  const votes = new Float32Array(m);
  const baseLogit = new Float64Array(m);
  const collabTerm = new Float64Array(m);
  const crewTerm = new Float64Array(m);
  const castTerm = new Float64Array(m);
  const smoothTArr = new Float64Array(m);
  const popMatchArr = new Float64Array(m);

  const denomStd = Math.max(popStats.stdLogVotes, 0.45);
  const damping = DEFAULT_METADATA_DAMPING_FACTOR;
  const rampMax = 0.02;

  for (let i = 0; i < m; i++) {
    const cand = u.pool[i];
    const feats = extractCandidateFeatures(cand, {
      profile: u.profile,
      collabSimMap,
      contentSimMap,
      repulsionMap
    });
    const rawCollabSim = feats.collabSim;
    let normCollab = feats.collabSim;
    if (normCollab > 0) {
      if (catalogMax !== null) {
        normCollab = Math.min(1.0, normCollab / Math.max(0.05, catalogMax));
      } else if (maxPoolCollab > 0.05) {
        normCollab = Math.min(1.0, normCollab / collabScale);
      }
    }

    const rawCollabMag = Math.abs(rawCollabSim);
    const t = Math.min(1, rawCollabMag / rampMax);
    const smoothT = t * t * (3 - 2 * t);
    const effectiveDamping = 1.0 + smoothT * (damping - 1.0);

    const cTerm = weights.collabSim * normCollab;
    const crTerm = weights.crewMatch * feats.crewMatch;
    const caTerm = weights.castMatch * feats.castMatch;
    const restLogit =
      Number(weights.bias || 0) +
      weights.contentSim * feats.contentSim +
      weights.genreOverlap * feats.genreOverlap * effectiveDamping +
      weights.keywordOverlap * feats.keywordOverlap +
      weights.bayesianRatingNorm * feats.bayesianRatingNorm * effectiveDamping +
      weights.noveltyBonus * feats.noveltyBonus +
      weights.negativeKeywordPenalty * feats.negativeKeywordPenalty +
      weights.repulsion * feats.repulsion +
      weights.providerMatch * feats.providerMatch +
      (weights.dnaSim || 0) * feats.dnaSim;

    ids[i] = cand.tmdbId;
    const v = Math.max(10, Number(cand.vote_count || 200));
    votes[i] = v;
    baseLogit[i] = restLogit;
    collabTerm[i] = cTerm;
    crewTerm[i] = crTerm;
    castTerm[i] = caTerm;
    smoothTArr[i] = smoothT;

    if (popStats.count >= 3) {
      const z = (Math.log10(v) - popStats.meanLogVotes) / denomStd;
      popMatchArr[i] = Math.exp(-0.5 * z * z);
    } else {
      popMatchArr[i] = 0;
    }
  }

  return {
    uid: u.uid,
    nIndexed,
    popCount: popStats.count,
    holdoutPositives: u.holdoutPositives,
    holdoutRelevance: u.holdoutRelevance,
    m,
    ids,
    votes,
    baseLogit,
    collabTerm,
    crewTerm,
    castTerm,
    smoothTArr,
    popMatchArr
  };
}

function evaluatePrepared(preparedUsers, { top200PopSet }, cfg = {}) {
  const {
    popWeight = 0,
    k0 = 0,
    gammaCrew = 0,
    crewMode = "crewOnly" // "crewOnly" | "crewAndCast"
  } = cfg;

  const n = preparedUsers.length;
  const ndcg10 = new Array(n);
  const ndcg20 = new Array(n);
  const hits1 = new Array(n);
  const hits10 = new Array(n);
  const hits20 = new Array(n);
  const tail20 = new Array(n);
  const hits100 = new Array(n);
  const hr10 = new Array(n);
  const hr20 = new Array(n);
  const hr100 = new Array(n);
  const covSet = new Set();
  let vSum = 0;
  let vCnt = 0;

  const tStart = performance.now();

  for (let ui = 0; ui < n; ui++) {
    const u = preparedUsers[ui];
    const m = u.m;
    const collabShrink = k0 > 0 ? u.nIndexed / (u.nIndexed + k0) : 1.0;

    // Maintain top-100 indices via partial selection or sorted array
    // Since m ~ 9600, sorting indices or partial insertion for top 100 is very fast.
    // Partial top-100 min-heap / linear insertion is ~5x faster than full sort of 9600 items,
    // while breaking ties identically by lower index (stable order).
    const topK = 100;
    const topScores = new Float64Array(topK);
    const topIndices = new Int32Array(topK);
    let filled = 0;
    let minScore = Infinity;
    let minPos = 0;

    const baseLogit = u.baseLogit;
    const collabTerm = u.collabTerm;
    const crewTerm = u.crewTerm;
    const castTerm = u.castTerm;
    const smoothTArr = u.smoothTArr;
    const popMatchArr = u.popMatchArr;
    const boostCast = crewMode === "crewAndCast";

    for (let i = 0; i < m; i++) {
      const crewBoost = gammaCrew !== 0 ? 1 + gammaCrew * (1 - smoothTArr[i]) : 1;
      const logit =
        baseLogit[i] +
        collabTerm[i] * collabShrink +
        crewTerm[i] * crewBoost +
        (boostCast ? castTerm[i] * crewBoost : castTerm[i]) +
        (popWeight !== 0 ? popWeight * popMatchArr[i] : 0);

      if (filled < topK) {
        topScores[filled] = logit;
        topIndices[filled] = i;
        if (logit < minScore) {
          minScore = logit;
          minPos = filled;
        }
        filled++;
      } else if (logit > minScore) {
        topScores[minPos] = logit;
        topIndices[minPos] = i;
        // Re-find min (or last-index on exact tie to preserve stable earlier-index preference)
        let newMin = Infinity;
        let newPos = 0;
        for (let j = 0; j < topK; j++) {
          if (topScores[j] < newMin || (topScores[j] === newMin && topIndices[j] > topIndices[newPos])) {
            newMin = topScores[j];
            newPos = j;
          }
        }
        minScore = newMin;
        minPos = newPos;
      }
    }

    const order = Array.from({ length: filled }, (_, j) => j);
    order.sort((a, b) => {
      const diff = topScores[b] - topScores[a];
      return diff !== 0 ? diff : topIndices[a] - topIndices[b];
    });

    const rankedIds = new Array(filled);
    for (let k = 0; k < filled; k++) {
      const idx = topIndices[order[k]];
      rankedIds[k] = String(u.ids[idx]);
      if (k < 20) {
        covSet.add(rankedIds[k]);
        vSum += u.votes[idx];
        vCnt++;
      }
    }

    ndcg10[ui] = computeNDCGAtK(rankedIds, u.holdoutRelevance, 10);
    ndcg20[ui] = computeNDCGAtK(rankedIds, u.holdoutRelevance, 20);

    let h1 = 0, h10 = 0, h20 = 0, t20 = 0, h100 = 0;
    for (let k = 0; k < rankedIds.length; k++) {
      if (u.holdoutPositives.has(rankedIds[k])) {
        if (k < 1) h1++;
        if (k < 10) h10++;
        if (k < 20) {
          h20++;
          if (!top200PopSet.has(rankedIds[k])) t20++;
        }
        if (k < 100) h100++;
      }
    }
    hits1[ui] = h1;
    hits10[ui] = h10;
    hits20[ui] = h20;
    tail20[ui] = t20;
    hits100[ui] = h100;
    hr10[ui] = h10 > 0 ? 1 : 0;
    hr20[ui] = h20 > 0 ? 1 : 0;
    hr100[ui] = h100 > 0 ? 1 : 0;
  }

  const elapsedMs = performance.now() - tStart;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return {
    perUser: { ndcg10, ndcg20, tail20, hits20 },
    summary: {
      n,
      hr1: Number((mean(hits1) * 100).toFixed(1)),
      hr10: Number((mean(hr10) * 100).toFixed(1)),
      hits10: Number(mean(hits10).toFixed(3)),
      ndcg10: Number(mean(ndcg10).toFixed(4)),
      hr20: Number((mean(hr20) * 100).toFixed(1)),
      hits20: Number(mean(hits20).toFixed(3)),
      ndcg20: Number(mean(ndcg20).toFixed(4)),
      tail20: Number(mean(tail20).toFixed(3)),
      hr100: Number((mean(hr100) * 100).toFixed(1)),
      hits100: Number(mean(hits100).toFixed(2)),
      cov: covSet.size,
      avgV: Math.round(vSum / Math.max(1, vCnt)),
      auc8: 0,
      msPerUser: Number((elapsedMs / Math.max(1, n)).toFixed(2))
    }
  };
}

function fmtBootstrapRow(label, res, base) {
  const s = res.summary;
  if (!base) {
    return `${label.padEnd(32)} HR1=${String(s.hr1).padStart(4)}% | NDCG10=${s.ndcg10.toFixed(4)} | NDCG20=${s.ndcg20.toFixed(4)} | Hits20=${s.hits20.toFixed(3)} | Tail20=${s.tail20.toFixed(3)} | HR20=${s.hr20}% | HR100=${s.hr100}% | Cov=${String(s.cov).padStart(4)} | AvgV=${s.avgV} | ${s.msPerUser}ms`;
  }
  const b10 = pairedBootstrap(res.perUser.ndcg10, base.perUser.ndcg10, 42, 1000);
  const b20 = pairedBootstrap(res.perUser.ndcg20, base.perUser.ndcg20, 42, 1000);
  const bt = pairedBootstrap(res.perUser.tail20, base.perUser.tail20, 42, 1000);
  const fmtD = (a, b, boot) => {
    const d = (a / Math.max(1e-9, b) - 1) * 100;
    const sig = boot.positiveSig ? "*+" : boot.negativeSig ? "*-" : "  ";
    return `${d >= 0 ? "+" : ""}${d.toFixed(2)}%${sig}`;
  };
  return `${label.padEnd(32)} HR1=${String(s.hr1).padStart(4)}% | NDCG10=${s.ndcg10.toFixed(4)} (${fmtD(s.ndcg10, base.summary.ndcg10, b10)}) | NDCG20=${s.ndcg20.toFixed(4)} (${fmtD(s.ndcg20, base.summary.ndcg20, b20)}) | Tail20=${s.tail20.toFixed(3)} (${fmtD(s.tail20, base.summary.tail20, bt)}) | HR20=${s.hr20}% | Cov=${String(s.cov).padStart(4)} | AvgV=${s.avgV} | ${s.msPerUser}ms`;
}

async function loadSmallVaultSlice(cohort, easeIdx, easeWeight) {
  const catalogById = cohort.catalogById;
  const rawUsers = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/fresh_300_users.json"), "utf8")).users;
  const smallUsers = [];

  let userOrderIdx = 0;
  for (const u of rawUsers.slice(0, 300)) {
    const enriched = u.ratings
      .map((r) => {
        const m = catalogById.get(Number(r.tmdbId));
        return m ? { ...m, userRating: Number(r.userRating), dateWatched: r.ts ? new Date(r.ts).toISOString() : undefined } : null;
      })
      .filter(Boolean);
    const split = temporalHoldoutSplit(enriched, 10, 8);
    if (split.trainWatched.length < 15 || split.holdoutPositives.size < 5) continue;

    let maxTs = 0;
    for (const m of split.trainWatched) {
      const ts = Date.parse(m.dateWatched || "");
      if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;
    }
    const maxYear = Math.max(
      ...enriched.map((r) => Number(r.year) || 0),
      maxTs > 0 ? new Date(maxTs).getUTCFullYear() : 2024
    );
    const fullTrainIds = new Set(split.trainWatched.map((m) => Number(m.tmdbId)));
    const pool = cohort.catalog.filter((c) => !fullTrainIds.has(c.tmdbId) && Number(c.year) <= maxYear);

    const kSmall = 3 + (userOrderIdx % 8); // 3..10 ratings
    userOrderIdx++;
    const rng = makeRng(10000 + Number(u.uid || userOrderIdx));
    const indices = Array.from({ length: split.trainWatched.length }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const subTrain = indices.slice(0, kSmall).map((idx) => split.trainWatched[idx]);

    const profileSmall = await extractTasteProfile(subTrain, [], {
      now: split.holdoutStartTs || Date.now(),
      anchorCutoff: Infinity
    });
    const svdMap = buildCollabSimMapFromIndex(profileSmall.weightedRatings, cohort.svdIdx);
    const repulsionMap = buildRepulsionMapFromIndex(profileSmall.weightedRatings, cohort.svdIdx);
    const easeMap = easeIdx ? buildEaseSimMapFromIndex(profileSmall.weightedRatings, easeIdx) : null;
    const collabSimMap = blendEaseAndCollabSimMaps(easeMap, svdMap, easeIdx, { easeWeight });

    smallUsers.push(
      buildPreparedUserEntries(
        {
          uid: u.uid,
          holdoutPositives: split.holdoutPositives,
          holdoutRelevance: split.holdoutRelevance,
          pool,
          profile: profileSmall
        },
        collabSimMap,
        null,
        repulsionMap,
        cohort.svdIdx,
        easeIdx
      )
    );
  }
  return smallUsers;
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  const baselineJson = JSON.parse(
    fs.readFileSync(path.isAbsolute(opts.baseline) ? opts.baseline : path.join(ROOT, opts.baseline), "utf8")
  );
  console.log("Loading 300-user clean cohort + EASE^R + SVD + Content embeddings...");
  const cohort = await loadCleanCohort(opts.svd, 300);
  const easeLoaded = loadEaseIndexFromPath(opts.ease);
  const contentBuf = fs.readFileSync(path.isAbsolute(opts.content) ? opts.content : path.join(ROOT, opts.content));
  const contentIdx = parseEmbeddingBinary(
    contentBuf.buffer.slice(contentBuf.byteOffset, contentBuf.byteOffset + contentBuf.byteLength)
  );

  // 1. Pre-prepare Full Cohort
  const fullPrepared = [];
  for (let i = 0; i < cohort.users.length; i++) {
    const u = cohort.users[i];
    const easeMap = buildEaseSimMapFromIndex(u.profile.weightedRatings, easeLoaded.idx);
    const collabSimMap = blendEaseAndCollabSimMaps(easeMap, u.svdMap, easeLoaded.idx, { easeWeight: opts.easeWeight });
    fullPrepared.push(buildPreparedUserEntries(u, collabSimMap, null, u.repulsionMap, cohort.svdIdx, easeLoaded.idx));

    // Spot-check parity on first 3 users against real rankCandidatePool
    if (i < 3) {
      const ref = rankCandidatePool(
        u.pool,
        { profile: u.profile, collabSimMap, repulsionMap: u.repulsionMap },
        DEFAULT_RANKER_WEIGHTS,
        100,
        { metadataDampingFactor: DEFAULT_METADATA_DAMPING_FACTOR }
      ).map((r) => String(r.tmdbId));
      const fast = evaluatePrepared([fullPrepared[i]], cohort, { popWeight: 0, k0: 0, gammaCrew: 0 });
      // Quick parity check via NDCG@20
      const refNdcg = computeNDCGAtK(ref, u.holdoutRelevance, 20);
      if (Math.abs(refNdcg - fast.perUser.ndcg20[0]) > 1e-12) {
        throw new Error(`Parity mismatch on user ${u.uid}: ref=${refNdcg}, fast=${fast.perUser.ndcg20[0]}`);
      }
    }
  }

  const fullDev = fullPrepared.slice(0, 150);
  const fullVal = fullPrepared.slice(150);

  // Verify exact parity against v6_2_best.json
  const baseFullDev = evaluatePrepared(fullDev, cohort, {});
  const baseFullVal = evaluatePrepared(fullVal, cohort, {});
  console.log("\n=== PARITY CHECK vs v6_2_best.json ===");
  console.log("[DEV-150]    ", formatSplitRow("fast_baseline", baseFullDev, baselineJson.dev));
  console.log("[HOLDOUT-150]", formatSplitRow("fast_baseline", baseFullVal, baselineJson.val));

  // Define ablation grid
  const configs = [
    { name: "baseline", popWeight: 0, k0: 0, gammaCrew: 0, crewMode: "crewOnly" },
    // Term 1: popMatch
    ...[0.3, 0.6, 1.0, 1.4].map((w) => ({ name: `popMatch(w=${w})`, popWeight: w, k0: 0, gammaCrew: 0, crewMode: "crewOnly" })),
    // Term 2: collabShrink
    ...[3, 5, 8].map((k0) => ({ name: `collabShrink(k0=${k0})`, popWeight: 0, k0, gammaCrew: 0, crewMode: "crewOnly" })),
    // Term 3: crewBoost (crewOnly + crewAndCast)
    ...[0.75, 1.25, 1.75].map((g) => ({ name: `crewBoost(g=${g},crew)`, popWeight: 0, k0: 0, gammaCrew: g, crewMode: "crewOnly" })),
    ...[0.75, 1.25, 1.75].map((g) => ({ name: `crewBoost(g=${g},crew+cast)`, popWeight: 0, k0: 0, gammaCrew: g, crewMode: "crewAndCast" }))
  ];

  // Run Full DEV-150
  console.log("\n=== FULL COHORT DEV-150 ABLATIONS (N=150) ===");
  console.log("[DEV-150]    ", fmtBootstrapRow("baseline", baseFullDev, null));
  const fullDevRes = new Map([["baseline", baseFullDev]]);
  for (const cfg of configs.slice(1)) {
    const r = evaluatePrepared(fullDev, cohort, cfg);
    fullDevRes.set(cfg.name, r);
    console.log("[DEV-150]    ", fmtBootstrapRow(cfg.name, r, baseFullDev));
  }

  // Pick best from each family on Full DEV-150 and test combined
  const bestPop = configs.filter((c) => c.popWeight > 0).sort((a, b) =>
    (fullDevRes.get(b.name).summary.ndcg20 + 0.5 * fullDevRes.get(b.name).summary.ndcg10) -
    (fullDevRes.get(a.name).summary.ndcg20 + 0.5 * fullDevRes.get(a.name).summary.ndcg10)
  )[0];
  const bestK0 = configs.filter((c) => c.k0 > 0).sort((a, b) =>
    (fullDevRes.get(b.name).summary.ndcg20 + 0.5 * fullDevRes.get(b.name).summary.ndcg10) -
    (fullDevRes.get(a.name).summary.ndcg20 + 0.5 * fullDevRes.get(a.name).summary.ndcg10)
  )[0];
  const bestCrew = configs.filter((c) => c.gammaCrew > 0).sort((a, b) =>
    (fullDevRes.get(b.name).summary.ndcg20 + 0.5 * fullDevRes.get(b.name).summary.ndcg10) -
    (fullDevRes.get(a.name).summary.ndcg20 + 0.5 * fullDevRes.get(a.name).summary.ndcg10)
  )[0];

  const combinedConfigs = [
    { name: `combo(${bestPop.name}+${bestK0.name})`, popWeight: bestPop.popWeight, k0: bestK0.k0, gammaCrew: 0, crewMode: "crewOnly" },
    { name: `combo(${bestPop.name}+${bestCrew.name})`, popWeight: bestPop.popWeight, k0: 0, gammaCrew: bestCrew.gammaCrew, crewMode: bestCrew.crewMode },
    { name: `combo(${bestK0.name}+${bestCrew.name})`, popWeight: 0, k0: bestK0.k0, gammaCrew: bestCrew.gammaCrew, crewMode: bestCrew.crewMode },
    { name: `combo(all3_dev_top)`, popWeight: bestPop.popWeight, k0: bestK0.k0, gammaCrew: bestCrew.gammaCrew, crewMode: bestCrew.crewMode }
  ];
  for (const cfg of combinedConfigs) {
    const r = evaluatePrepared(fullDev, cohort, cfg);
    fullDevRes.set(cfg.name, r);
    console.log("[DEV-150]    ", fmtBootstrapRow(cfg.name, r, baseFullDev));
  }

  // 2. Small-vault slice (3..10 ratings)
  console.log("\n=== SMALL-VAULT SLICE (3..10 subsampled ratings) ===");
  const smallPrepared = await loadSmallVaultSlice(cohort, easeLoaded.idx, opts.easeWeight);
  const smallDev = smallPrepared.slice(0, 150);
  const smallVal = smallPrepared.slice(150);
  const baseSmallDev = evaluatePrepared(smallDev, cohort, {});
  const baseSmallVal = evaluatePrepared(smallVal, cohort, {});
  console.log("[SMALL-DEV]  ", fmtBootstrapRow("baseline", baseSmallDev, null));
  const smallDevRes = new Map([["baseline", baseSmallDev]]);
  for (const cfg of [...configs.slice(1), ...combinedConfigs]) {
    const r = evaluatePrepared(smallDev, cohort, cfg);
    smallDevRes.set(cfg.name, r);
    console.log("[SMALL-DEV]  ", fmtBootstrapRow(cfg.name, r, baseSmallDev));
  }

  // 3. 100%-Cold slice (collabSim=0, content_embeddings_f16.bin, coldOnly=true)
  console.log("\n=== 100%-COLD SLICE (collabSim=0, content_embeddings_f16.bin, coldOnly=true) ===");
  const emptyMap = new Map();
  const coldPrepared = [];
  for (const u of cohort.users) {
    const contentSimMap = buildContentSimMap(u.profile.weightedRatings, contentIdx, u.pool, {
      collabIndex: null,
      collabSimMap: emptyMap,
      enableStructuredFallback: false,
      coldOnly: true
    });
    coldPrepared.push(buildPreparedUserEntries(u, emptyMap, contentSimMap, emptyMap, cohort.svdIdx, easeLoaded.idx));
  }
  const coldDev = coldPrepared.slice(0, 150);
  const coldVal = coldPrepared.slice(150);
  const baseColdDev = evaluatePrepared(coldDev, cohort, {});
  const baseColdVal = evaluatePrepared(coldVal, cohort, {});
  console.log("[COLD-DEV]   ", fmtBootstrapRow("baseline", baseColdDev, null));
  const coldDevRes = new Map([["baseline", baseColdDev]]);
  for (const cfg of [...configs.slice(1), ...combinedConfigs]) {
    if (cfg.k0 > 0 && cfg.popWeight === 0 && cfg.gammaCrew === 0) continue; // k0 has no effect when collabSim=0
    const r = evaluatePrepared(coldDev, cohort, cfg);
    coldDevRes.set(cfg.name, r);
    console.log("[COLD-DEV]   ", fmtBootstrapRow(cfg.name, r, baseColdDev));
  }

  // Select top candidates per slice/family from DEV-150 to gate on untouched HOLDOUT-150
  const allSweep = [...configs.slice(1), ...combinedConfigs];
  const pickTop = (resMap, pred) =>
    allSweep
      .filter((c) => pred(c) && resMap.has(c.name))
      .sort((a, b) => {
        const ra = resMap.get(a.name).summary;
        const rb = resMap.get(b.name).summary;
        return (rb.ndcg20 + 0.5 * rb.ndcg10) - (ra.ndcg20 + 0.5 * ra.ndcg10);
      })[0];

  const holdoutCandidatesMap = new Map();
  for (const c of [
    pickTop(fullDevRes, (x) => x.popWeight > 0 && x.k0 === 0 && x.gammaCrew === 0),
    pickTop(fullDevRes, (x) => x.k0 > 0 && x.popWeight === 0 && x.gammaCrew === 0),
    pickTop(fullDevRes, (x) => x.gammaCrew > 0 && x.popWeight === 0 && x.k0 === 0),
    pickTop(fullDevRes, (x) => x.name.startsWith("combo(")),
    pickTop(smallDevRes, (x) => x.k0 > 0 && x.popWeight === 0 && x.gammaCrew === 0),
    pickTop(smallDevRes, () => true),
    pickTop(coldDevRes, (x) => x.gammaCrew > 0 && x.popWeight === 0 && x.k0 === 0),
    pickTop(coldDevRes, () => true),
    ...configs.filter((c) => c.popWeight > 0 && c.k0 === 0 && c.gammaCrew === 0),
    ...configs.filter((c) => c.k0 > 0 && c.popWeight === 0 && c.gammaCrew === 0),
    ...configs.filter((c) => c.gammaCrew > 0 && c.popWeight === 0 && c.k0 === 0)
  ]) {
    if (c) holdoutCandidatesMap.set(c.name, c);
  }
  const holdoutCandidates = [...holdoutCandidatesMap.values()];

  console.log("\n=== UNTOUCHED HOLDOUT-150 GATING: FULL COHORT (vs .data/v6_lab/v6_2_best.json) ===");
  console.log("[HOLDOUT-150]", fmtBootstrapRow("baseline", baseFullVal, null));
  for (const cfg of holdoutCandidates) {
    const res = evaluatePrepared(fullVal, cohort, cfg);
    const gate = checkShipGate(res, baselineJson.val, 0);
    console.log("[HOLDOUT-150]", fmtBootstrapRow(cfg.name, res, baselineJson.val), `| GATE=${gate.pass ? "PASS" : "FAIL"}`);
    if (gate.pass) {
      console.log("  PASS RULES:", JSON.stringify(gate.rules));
    }
  }

  console.log("\n=== UNTOUCHED HOLDOUT-150 GATING: SMALL-VAULT SLICE (3..10 ratings) ===");
  console.log("[SMALL-VAL]  ", fmtBootstrapRow("baseline", baseSmallVal, null));
  for (const cfg of holdoutCandidates) {
    const res = evaluatePrepared(smallVal, cohort, cfg);
    const b10 = pairedBootstrap(res.perUser.ndcg10, baseSmallVal.perUser.ndcg10, 42, 1000);
    const b20 = pairedBootstrap(res.perUser.ndcg20, baseSmallVal.perUser.ndcg20, 42, 1000);
    console.log(
      "[SMALL-VAL]  ",
      fmtBootstrapRow(cfg.name, res, baseSmallVal),
      `| ci10=[${b10.ciLower.toFixed(4)},${b10.ciUpper.toFixed(4)}] ci20=[${b20.ciLower.toFixed(4)},${b20.ciUpper.toFixed(4)}]`
    );
  }

  console.log("\n=== UNTOUCHED HOLDOUT-150 GATING: 100%-COLD SLICE ===");
  console.log("[COLD-VAL]   ", fmtBootstrapRow("baseline", baseColdVal, null));
  for (const cfg of holdoutCandidates) {
    if (cfg.k0 > 0 && cfg.popWeight === 0 && cfg.gammaCrew === 0) continue;
    const res = evaluatePrepared(coldVal, cohort, cfg);
    const b10 = pairedBootstrap(res.perUser.ndcg10, baseColdVal.perUser.ndcg10, 42, 1000);
    const b20 = pairedBootstrap(res.perUser.ndcg20, baseColdVal.perUser.ndcg20, 42, 1000);
    console.log(
      "[COLD-VAL]   ",
      fmtBootstrapRow(cfg.name, res, baseColdVal),
      `| ci10=[${b10.ciLower.toFixed(4)},${b10.ciUpper.toFixed(4)}] ci20=[${b20.ciLower.toFixed(4)},${b20.ciUpper.toFixed(4)}]`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
