#!/usr/bin/env node
/**
 * CinemaVault v6.1+ Canonical Leakage-Clean Hard-Gate Evaluator
 *
 * Evaluates any EASE^R (.cvea) + SVD (.bin) + client blend + ranker weights combo
 * across 300 completely unseen MovieLens 32M users (.data/fresh_300_users.json):
 *   - DEV-150     (users 0..149)   : tuning / ablation split
 *   - HOLDOUT-150 (users 150..299) : untouched verification & 4-part Hard Ship Gate
 *   - ALL-300     (users 0..299)   : combined reporting
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
  buildRepulsionMapFromIndex
} = await imp("src/services/embeddingService.js");
const {
  parseEaseBinary,
  buildEaseSimMapFromIndex,
  blendEaseAndCollabSimMaps
} = await imp("src/services/easeService.js");
const {
  temporalHoldoutSplit,
  computeNDCGAtK
} = await imp("src/services/evalHarness.js");
const {
  rankCandidatePool,
  DEFAULT_RANKER_WEIGHTS,
  DEFAULT_METADATA_DAMPING_FACTOR
} = await imp("src/services/rankerService.js");
const { extractTasteProfile } = await imp("src/services/tmdbService.js");

export function pairedBootstrap(cand, base, seed = 42, resamples = 1000) {
  const n = Math.min(cand.length, base.length);
  const diffs = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    diffs[i] = cand[i] - base[i];
    sum += diffs[i];
  }
  const meanDiff = sum / Math.max(1, n);
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const boots = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += diffs[Math.floor(rnd() * n)];
    boots[b] = acc / Math.max(1, n);
  }
  boots.sort();
  const ciLower = boots[Math.floor(0.025 * resamples)];
  const ciUpper = boots[Math.floor(0.975 * resamples)];
  const isSignificant = (ciLower > 0 && ciUpper > 0) || (ciLower < 0 && ciUpper < 0);
  return { meanDiff, ciLower, ciUpper, isSignificant, positiveSig: ciLower > 0, negativeSig: ciUpper < 0 };
}

function computeWithinUserAuc(scoresMap, holdoutRelevance, minPos = 8, maxNeg = 7) {
  const pos = [];
  const neg = [];
  for (const [idStr, rating] of holdoutRelevance.entries()) {
    const sc = scoresMap.get(Number(idStr)) ?? -Infinity;
    if (rating >= minPos) pos.push(sc);
    else if (rating <= maxNeg) neg.push(sc);
  }
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  let total = 0;
  for (const p of pos) {
    for (const q of neg) {
      total++;
      if (p > q) wins += 1;
      else if (p === q) wins += 0.5;
    }
  }
  return wins / total;
}

export async function loadCleanCohort(svdRelPath = ".data/item_embeddings_clean2_f16.bin", limit = 300) {
  const tmdbEnriched = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/tmdb_enriched.json"), "utf8"));
  const catalog = [];
  const catalogById = new Map();
  for (const [k, m] of Object.entries(tmdbEnriched.items || {})) {
    const id = Number(m.tmdbId ?? m.id ?? k);
    if (!id) continue;
    const year = Number(String(m.year ?? m.release_date ?? "").slice(0, 4)) || 2000;
    const cand = {
      id,
      tmdbId: id,
      title: m.title || String(id),
      year: String(year),
      release_date: m.release_date || `${year}-01-01`,
      tmdbGenreIds: m.tmdbGenreIds || m.genre_ids || [],
      genre_ids: m.tmdbGenreIds || m.genre_ids || [],
      tmdbKeywords: m.tmdbKeywords || [],
      crewPersonId: m.crewPersonId || null,
      castIds: m.castIds || [],
      vote_average: Number(m.vote_average ?? 7.0),
      vote_count: Number(m.vote_count ?? 200)
    };
    catalog.push(cand);
    catalogById.set(id, cand);
  }
  const top200PopSet = new Set(
    [...catalog].sort((a, b) => b.vote_count - a.vote_count).slice(0, 200).map((c) => String(c.tmdbId))
  );

  const svdPath = path.isAbsolute(svdRelPath) ? svdRelPath : path.join(ROOT, svdRelPath);
  const svdBuf = fs.readFileSync(svdPath);
  const fullSvd = parseEmbeddingBinary(svdBuf.buffer.slice(svdBuf.byteOffset, svdBuf.byteOffset + svdBuf.byteLength));
  // Slice SVD to catalog IDs for fast scoring (exact parity on catalog items)
  const subIndices = [];
  for (let i = 0; i < fullSvd.count; i++) if (catalogById.has(fullSvd.ids[i])) subIndices.push(i);
  const subIds = new Uint32Array(subIndices.length);
  const subVecs = new Float32Array(subIndices.length * fullSvd.dim);
  const subMap = new Map();
  for (let j = 0; j < subIndices.length; j++) {
    const si = subIndices[j];
    subIds[j] = fullSvd.ids[si];
    subMap.set(subIds[j], j);
    subVecs.set(fullSvd.vectors.subarray(si * fullSvd.dim, (si + 1) * fullSvd.dim), j * fullSvd.dim);
  }
  const svdIdx = { count: subIndices.length, dim: fullSvd.dim, ids: subIds, vectors: subVecs, idToIndex: subMap };

  const rawUsers = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/fresh_300_users.json"), "utf8")).users;
  const users = [];
  for (const u of rawUsers.slice(0, limit)) {
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
    const trainIds = new Set(split.trainWatched.map((m) => Number(m.tmdbId)));
    const pool = catalog.filter((c) => !trainIds.has(c.tmdbId) && Number(c.year) <= maxYear);
    const profile = await extractTasteProfile(split.trainWatched, [], {
      now: split.holdoutStartTs || Date.now(),
      anchorCutoff: Infinity
    });
    const svdMap = buildCollabSimMapFromIndex(profile.weightedRatings, svdIdx);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, svdIdx);
    users.push({
      uid: u.uid,
      trainCount: split.trainWatched.length,
      holdoutPositives: split.holdoutPositives,
      holdoutRelevance: split.holdoutRelevance,
      pool,
      profile,
      svdMap,
      repulsionMap
    });
  }
  return { catalog, catalogById, top200PopSet, svdIdx, users };
}

export function loadEaseIndexFromPath(easeRelPath) {
  if (!easeRelPath) return null;
  const p = path.isAbsolute(easeRelPath) ? easeRelPath : path.join(ROOT, easeRelPath);
  const buf = fs.readFileSync(p);
  return {
    idx: parseEaseBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    sizeMb: buf.length / (1024 * 1024)
  };
}

export function evaluatePipeline(
  users,
  { catalogById, top200PopSet },
  {
    easeIdx = null,
    weights = DEFAULT_RANKER_WEIGHTS,
    rankerOptions = { metadataDampingFactor: DEFAULT_METADATA_DAMPING_FACTOR },
    easeOptions = {},
    blendOptions = {},
    customEaseBuilder = null,
    customBlendFn = null
  } = {}
) {
  const n = users.length;
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
  const auc8 = [];
  const covSet = new Set();
  let vSum = 0;
  let vCnt = 0;

  let clientMsSum = 0;
  for (let i = 0; i < n; i++) {
    const u = users[i];
    const t0 = performance.now();
    const easeMap = easeIdx
      ? (customEaseBuilder
          ? customEaseBuilder(u.profile.weightedRatings, easeIdx, easeOptions)
          : buildEaseSimMapFromIndex(u.profile.weightedRatings, easeIdx, easeOptions))
      : null;
    const collabSimMap = customBlendFn
      ? customBlendFn(easeMap, u.svdMap, easeIdx, u, blendOptions)
      : blendEaseAndCollabSimMaps(easeMap, u.svdMap, easeIdx, blendOptions);
    clientMsSum += performance.now() - t0;

    const ranked = rankCandidatePool(
      u.pool,
      { profile: u.profile, collabSimMap, repulsionMap: u.repulsionMap },
      weights,
      100,
      rankerOptions
    );
    const ids = ranked.map((r) => String(r.tmdbId));
    ndcg10[i] = computeNDCGAtK(ids, u.holdoutRelevance, 10);
    ndcg20[i] = computeNDCGAtK(ids, u.holdoutRelevance, 20);

    // Collaborative within-user AUC (measures raw collabSimMap discrimination over held-out ratings)
    const a8 = computeWithinUserAuc(collabSimMap, u.holdoutRelevance, 8, 7);
    if (a8 !== null) auc8.push(a8);

    let h1 = 0, h10 = 0, h20 = 0, t20 = 0, h100 = 0;
    for (let k = 0; k < ids.length; k++) {
      if (k < 20) {
        covSet.add(ids[k]);
        vSum += Number(catalogById.get(Number(ids[k]))?.vote_count || 0);
        vCnt++;
      }
      if (u.holdoutPositives.has(ids[k])) {
        if (k < 1) h1++;
        if (k < 10) h10++;
        if (k < 20) {
          h20++;
          if (!top200PopSet.has(ids[k])) t20++;
        }
        if (k < 100) h100++;
      }
    }
    hits1[i] = h1;
    hits10[i] = h10;
    hits20[i] = h20;
    tail20[i] = t20;
    hits100[i] = h100;
    hr10[i] = h10 > 0 ? 1 : 0;
    hr20[i] = h20 > 0 ? 1 : 0;
    hr100[i] = h100 > 0 ? 1 : 0;
  }

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
      auc8: Number(mean(auc8).toFixed(4)),
      msPerUser: Number((clientMsSum / Math.max(1, n)).toFixed(2))
    }
  };
}

export function checkShipGate(candHoldout, baseHoldout, extraMb = 0) {
  const b10 = pairedBootstrap(candHoldout.perUser.ndcg10, baseHoldout.perUser.ndcg10);
  const b20 = pairedBootstrap(candHoldout.perUser.ndcg20, baseHoldout.perUser.ndcg20);
  const bt = pairedBootstrap(candHoldout.perUser.tail20, baseHoldout.perUser.tail20);

  const rel = (a, b) => (a / Math.max(1e-9, b) - 1) * 100;
  const d10Pct = rel(candHoldout.summary.ndcg10, baseHoldout.summary.ndcg10);
  const d20Pct = rel(candHoldout.summary.ndcg20, baseHoldout.summary.ndcg20);
  const dTailPct = rel(candHoldout.summary.tail20, baseHoldout.summary.tail20);
  const dAvgVPct = rel(candHoldout.summary.avgV, baseHoldout.summary.avgV);
  const covRatio = candHoldout.summary.cov / Math.max(1, baseHoldout.summary.cov);

  const rule1Primary = (b20.positiveSig && !b10.negativeSig) || (b10.positiveSig && !b20.negativeSig);
  const rule2Pop = dTailPct >= -1.0 && (dAvgVPct <= 12.0 || dTailPct > 0);
  const rule3Cov = covRatio >= 0.92;
  const minLiftForSize = extraMb > 0 ? extraMb : 0; // +2.0% per +2 MB == +1.0% per +1 MB
  const rule4Perf = candHoldout.summary.msPerUser < 25.0 && d20Pct >= minLiftForSize;

  return {
    pass: rule1Primary && rule2Pop && rule3Cov && rule4Perf,
    rules: {
      rule1_primarySig: { pass: rule1Primary, d10Pct: Number(d10Pct.toFixed(2)), sig10: b10.positiveSig, d20Pct: Number(d20Pct.toFixed(2)), sig20: b20.positiveSig },
      rule2_noPopCheat: { pass: rule2Pop, dTailPct: Number(dTailPct.toFixed(2)), sigTail: bt.isSignificant, dAvgVPct: Number(dAvgVPct.toFixed(2)) },
      rule3_coverage: { pass: rule3Cov, covRatio: Number(covRatio.toFixed(3)), cov: candHoldout.summary.cov, baseCov: baseHoldout.summary.cov },
      rule4_perfAndSize: { pass: rule4Perf, msPerUser: candHoldout.summary.msPerUser, extraMb: Number(extraMb.toFixed(2)), requiredD20Pct: Number(minLiftForSize.toFixed(2)) }
    }
  };
}

export function formatSplitRow(label, res, base = null) {
  const s = res.summary;
  let d10 = "", d20 = "", dt = "";
  if (base) {
    const b10 = pairedBootstrap(res.perUser.ndcg10, base.perUser.ndcg10);
    const b20 = pairedBootstrap(res.perUser.ndcg20, base.perUser.ndcg20);
    const bt = pairedBootstrap(res.perUser.tail20, base.perUser.tail20);
    const p = (a, b) => { const d = (a / Math.max(1e-9, b) - 1) * 100; return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`; };
    d10 = ` (${p(s.ndcg10, base.summary.ndcg10)}${b10.isSignificant ? "*" : " "})`;
    d20 = ` (${p(s.ndcg20, base.summary.ndcg20)}${b20.isSignificant ? "*" : " "})`;
    dt = ` (${p(s.tail20, base.summary.tail20)}${bt.isSignificant ? "*" : " "})`;
  }
  return `${label.padEnd(28)} HR1=${String(s.hr1).padStart(4)}% | NDCG10=${s.ndcg10.toFixed(4)}${d10} | NDCG20=${s.ndcg20.toFixed(4)}${d20} | Hits20=${s.hits20.toFixed(3)} | Tail20=${s.tail20.toFixed(3)}${dt} | HR20=${s.hr20}% | HR100=${s.hr100}%(${s.hits100}) | Cov=${String(s.cov).padStart(4)} | AvgV=${s.avgV} | AUC8=${s.auc8} | ${s.msPerUser}ms`;
}

function parseCli(argv) {
  const opts = {
    ease: ".data/v6_lab/ease_v6_baseline_clean.cvea",
    svd: ".data/item_embeddings_clean2_f16.bin",
    easeWeight: 0.60,
    weightsJson: null,
    saveBaseline: null,
    compareBaseline: null,
    label: "candidate"
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ease" && argv[i + 1]) opts.ease = argv[++i];
    else if (a === "--svd" && argv[i + 1]) opts.svd = argv[++i];
    else if (a === "--ease-weight" && argv[i + 1]) opts.easeWeight = Number(argv[++i]);
    else if (a === "--weights-json" && argv[i + 1]) opts.weightsJson = argv[++i];
    else if (a === "--save-baseline" && argv[i + 1]) opts.saveBaseline = argv[++i];
    else if (a === "--compare-baseline" && argv[i + 1]) opts.compareBaseline = argv[++i];
    else if (a === "--label" && argv[i + 1]) opts.label = argv[++i];
  }
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = parseCli(process.argv.slice(2));
  const cohort = await loadCleanCohort(opts.svd, 300);
  const easeLoaded = opts.ease === "none" ? null : loadEaseIndexFromPath(opts.ease);

  let weights = DEFAULT_RANKER_WEIGHTS;
  let damping = DEFAULT_METADATA_DAMPING_FACTOR;
  if (opts.weightsJson) {
    const wRaw = JSON.parse(fs.readFileSync(path.isAbsolute(opts.weightsJson) ? opts.weightsJson : path.join(ROOT, opts.weightsJson), "utf8"));
    if (Number.isFinite(Number(wRaw._metadataDampingFactor))) damping = Number(wRaw._metadataDampingFactor);
    weights = { ...DEFAULT_RANKER_WEIGHTS };
    for (const k of Object.keys(DEFAULT_RANKER_WEIGHTS)) {
      if (Number.isFinite(Number(wRaw[k]))) weights[k] = Number(wRaw[k]);
    }
  }

  const devUsers = cohort.users.slice(0, 150);
  const valUsers = cohort.users.slice(150);
  const runOpts = {
    easeIdx: easeLoaded?.idx || null,
    weights,
    rankerOptions: { metadataDampingFactor: damping },
    blendOptions: { easeWeight: opts.easeWeight }
  };

  const dev = evaluatePipeline(devUsers, cohort, runOpts);
  const val = evaluatePipeline(valUsers, cohort, runOpts);
  const all = evaluatePipeline(cohort.users, cohort, runOpts);

  let base = null;
  if (opts.compareBaseline) {
    base = JSON.parse(fs.readFileSync(path.isAbsolute(opts.compareBaseline) ? opts.compareBaseline : path.join(ROOT, opts.compareBaseline), "utf8"));
  }

  console.log(`\n=== ${opts.label} (ease=${opts.ease}, size=${easeLoaded ? easeLoaded.sizeMb.toFixed(2) : "0"}MB, easeW=${opts.easeWeight}) ===`);
  console.log("[DEV-150]    ", formatSplitRow(opts.label, dev, base?.dev || null));
  console.log("[HOLDOUT-150]", formatSplitRow(opts.label, val, base?.val || null));
  console.log("[ALL-300]    ", formatSplitRow(opts.label, all, base?.all || null));

  if (base) {
    const extraMb = Math.max(0, (easeLoaded?.sizeMb || 0) - (base.meta?.easeSizeMb || 0));
    const gate = checkShipGate(val, base.val, extraMb);
    console.log(`\n>>> HARD SHIP GATE (HOLDOUT-150): ${gate.pass ? "PASS" : "FAIL"}`);
    console.log(JSON.stringify(gate.rules, null, 2));
  }

  if (opts.saveBaseline) {
    const outPath = path.isAbsolute(opts.saveBaseline) ? opts.saveBaseline : path.join(ROOT, opts.saveBaseline);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify({ meta: { label: opts.label, ease: opts.ease, easeSizeMb: easeLoaded?.sizeMb || 0, easeWeight: opts.easeWeight }, dev, val, all }, null, 2)
    );
    console.log(`Saved baseline snapshot to ${opts.saveBaseline}`);
  }
}
