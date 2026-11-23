#!/usr/bin/env node
/**
 * CinemaVault 300-User Leakage-Clean Math Lab
 * Evaluates embedding binaries & client-side scoring formulas on Dev-150 / Holdout-150 / All-300
 * from .data/fresh_300_users.json with paired bootstrap 95% CIs.
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
  l2NormalizeInPlace
} = await imp("src/services/embeddingService.js");
const { temporalHoldoutSplit, computeNDCGAtK } = await imp("src/services/evalHarness.js");
const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await imp("src/services/rankerService.js");
const { extractTasteProfile } = await imp("src/services/tmdbService.js");

function parseArgs(argv) {
  const opts = {
    bin: ".data/item_embeddings_clean2_f16.bin",
    mode: "client_ablation", // "baseline" | "client_ablation" | "single"
    limit: 300
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--bin" && argv[i + 1]) opts.bin = argv[++i];
    else if (argv[i] === "--mode" && argv[i + 1]) opts.mode = argv[++i];
    else if (argv[i] === "--limit" && argv[i + 1]) opts.limit = Number(argv[++i]) || 300;
  }
  return opts;
}

function pairedBootstrap(cand, base, seed = 42, resamples = 1000) {
  const n = cand.length;
  const diffs = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    diffs[i] = cand[i] - base[i];
    sum += diffs[i];
  }
  const meanDiff = sum / n;
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const boots = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += diffs[Math.floor(rnd() * n)];
    boots[b] = acc / n;
  }
  boots.sort();
  const lo = boots[Math.floor(0.025 * resamples)];
  const hi = boots[Math.floor(0.975 * resamples)];
  return { meanDiff, lo, hi, sig: (lo > 0 && hi > 0) || (lo < 0 && hi < 0) };
}

/**
 * Implicit-aware closed-form Ridge in embedding space:
 * Solves (E^T C E + lambda I) u = E^T C y where y keeps implicit watch signal (+1 for liked, mild + for 6, neg for <=5).
 */
function solveImplicitRidge(weightedRatings, index, { lambda = 8, negWeight = -0.5, normalize = false, ratingPower = 1.0 } = {}) {
  const { dim, vectors, idToIndex } = index;
  const entries = [];
  let maxW = 0;
  for (const e of weightedRatings) {
    const id = Number(e?.movie?.tmdbId ?? e?.tmdbId ?? e?.movie?.id ?? 0);
    const idx = id ? idToIndex.get(id) : undefined;
    if (idx === undefined) continue;
    const rating = Number(e?.rating ?? e?.movie?.userRating ?? NaN);
    const weight = Number(e?.weight ?? e?.finalWeight ?? 0);
    if (Number.isFinite(weight) && Math.abs(weight) > maxW) maxW = Math.abs(weight);
    entries.push({ idx, rating, weight });
  }
  if (entries.length < 3) return null;

  const A = new Float64Array(dim * dim);
  const b = new Float64Array(dim);
  for (let d = 0; d < dim; d++) A[d * dim + d] = lambda;

  for (const item of entries) {
    const r = Number.isFinite(item.rating) ? item.rating : 7;
    // Implicit + explicit target: liked watches are strongly positive, mediocre slight positive, disliked negative
    let y;
    if (r >= 7) {
      const bonus = Math.pow((r - 6) / 4, ratingPower); // 7->0.25, 8->0.5, 9->0.75, 10->1.0
      y = 0.7 + 0.8 * bonus;
    } else if (r >= 6) {
      y = 0.25;
    } else {
      y = negWeight * ((6 - r) / 5);
    }
    const c = maxW > 0 ? Math.max(0.6, Math.min(1.6, 0.85 + 0.4 * (Math.abs(item.weight) / maxW))) : 1.0;
    const base = item.idx * dim;
    for (let i = 0; i < dim; i++) {
      const ei = vectors[base + i];
      const cei = c * ei;
      b[i] += cei * y;
      const rowOff = i * dim;
      for (let j = i; j < dim; j++) A[rowOff + j] += cei * vectors[base + j];
    }
  }

  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < i; j++) A[i * dim + j] = A[j * dim + i];
  }

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < dim; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(A[col * dim + col]);
    for (let r = col + 1; r < dim; r++) {
      const v = Math.abs(A[r * dim + col]);
      if (v > maxVal) { maxVal = v; pivotRow = r; }
    }
    if (maxVal < 1e-12) return null;
    if (pivotRow !== col) {
      for (let k = col; k < dim; k++) {
        const tmp = A[col * dim + k];
        A[col * dim + k] = A[pivotRow * dim + k];
        A[pivotRow * dim + k] = tmp;
      }
      const tmpB = b[col]; b[col] = b[pivotRow]; b[pivotRow] = tmpB;
    }
    const diag = A[col * dim + col];
    for (let r = col + 1; r < dim; r++) {
      const factor = A[r * dim + col] / diag;
      if (factor === 0) continue;
      for (let k = col; k < dim; k++) A[r * dim + k] -= factor * A[col * dim + k];
      b[r] -= factor * b[col];
    }
  }

  const u = new Float32Array(dim);
  for (let i = dim - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < dim; j++) sum -= A[i * dim + j] * u[j];
    u[i] = sum / A[i * dim + i];
  }
  if (normalize) l2NormalizeInPlace(u, 0, dim);
  return u;
}

/**
 * Full-vault Item-Item similarity kernel:
 * Scores candidate i by sum_j w_j * max(0, dot(e_i, e_j))^power across ALL positively rated movies (not capped at 25/top-3).
 */
function buildItemItemPowerMap(weightedRatings, index, { power = 2, topK = 0, minRating = 7, includeImplicit6 = false } = {}) {
  const { count, dim, ids, vectors, idToIndex } = index;
  const liked = [];
  for (const e of weightedRatings) {
    const id = Number(e?.movie?.tmdbId ?? e?.tmdbId ?? e?.movie?.id ?? 0);
    const idx = id ? idToIndex.get(id) : undefined;
    if (idx === undefined) continue;
    const r = Number(e?.rating ?? e?.movie?.userRating ?? NaN);
    if (!Number.isFinite(r)) continue;
    if (r >= minRating) {
      const w = 0.5 + 0.5 * ((r - 6) / 4); // 7->0.625, 8->0.75, 9->0.875, 10->1.0
      liked.push({ idx, w });
    } else if (includeImplicit6 && r >= 6) {
      liked.push({ idx, w: 0.25 });
    }
  }
  const map = new Map();
  if (liked.length === 0) return map;

  // Pre-pack liked vectors into contiguous Float32Array for cache locality
  const L = liked.length;
  const lVecs = new Float32Array(L * dim);
  const lWeights = new Float32Array(L);
  let wTotal = 0;
  for (let j = 0; j < L; j++) {
    const srcBase = liked[j].idx * dim;
    lVecs.set(vectors.subarray(srcBase, srcBase + dim), j * dim);
    lWeights[j] = liked[j].w;
    wTotal += liked[j].w;
  }

  const sims = topK > 0 ? new Float32Array(L) : null;
  for (let i = 0; i < count; i++) {
    const base = i * dim;
    let score = 0;
    if (topK > 0) {
      for (let j = 0; j < L; j++) {
        let dot = 0;
        const lb = j * dim;
        for (let d = 0; d < dim; d++) dot += vectors[base + d] * lVecs[lb + d];
        sims[j] = dot > 0 ? lWeights[j] * Math.pow(dot, power) : 0;
      }
      // Partial topK sum
      sims.sort();
      const start = Math.max(0, L - topK);
      for (let j = start; j < L; j++) score += sims[j];
      score /= Math.min(topK, L);
    } else {
      for (let j = 0; j < L; j++) {
        let dot = 0;
        const lb = j * dim;
        for (let d = 0; d < dim; d++) dot += vectors[base + d] * lVecs[lb + d];
        if (dot > 0) score += lWeights[j] * Math.pow(dot, power);
      }
      score /= Math.pow(wTotal, 0.5);
    }
    map.set(ids[i], score);
  }
  return map;
}

function buildHybridMap(weightedRatings, index, cfg) {
  if (cfg.type === "baseline") {
    return buildCollabSimMapFromIndex(weightedRatings, index);
  }
  if (cfg.type === "prod_opts") {
    return buildCollabSimMapFromIndex(weightedRatings, index, cfg.opts);
  }
  if (cfg.type === "implicit_ridge") {
    const u = solveImplicitRidge(weightedRatings, index, cfg);
    const map = new Map();
    if (!u) return buildCollabSimMapFromIndex(weightedRatings, index);
    const { count, dim, ids, vectors } = index;
    for (let i = 0; i < count; i++) {
      const base = i * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += u[d] * vectors[base + d];
      map.set(ids[i], dot);
    }
    return map;
  }
  if (cfg.type === "item_power") {
    return buildItemItemPowerMap(weightedRatings, index, cfg);
  }
  if (cfg.type === "blend_ridge_knn") {
    const u = solveImplicitRidge(weightedRatings, index, cfg.ridge);
    const knnMap = buildItemItemPowerMap(weightedRatings, index, cfg.knn);
    const { count, dim, ids, vectors } = index;
    const ridgeArr = new Float32Array(count);
    const knnArr = new Float32Array(count);
    let maxR = 1e-6, maxK = 1e-6;
    for (let i = 0; i < count; i++) {
      let rVal = 0;
      if (u) {
        const base = i * dim;
        for (let d = 0; d < dim; d++) rVal += u[d] * vectors[base + d];
      }
      const kVal = knnMap.get(ids[i]) || 0;
      ridgeArr[i] = rVal;
      knnArr[i] = kVal;
      if (rVal > maxR) maxR = rVal;
      if (kVal > maxK) maxK = kVal;
    }
    const alpha = cfg.alpha ?? 0.5;
    const map = new Map();
    for (let i = 0; i < count; i++) {
      const rNorm = ridgeArr[i] > 0 ? ridgeArr[i] / maxR : ridgeArr[i] / maxR;
      const kNorm = knnArr[i] / maxK;
      map.set(ids[i], alpha * rNorm + (1 - alpha) * kNorm);
    }
    return map;
  }
  if (cfg.type === "blend_prod_implicit_ridge") {
    const prodMap = buildCollabSimMapFromIndex(weightedRatings, index);
    const u = solveImplicitRidge(weightedRatings, index, cfg.ridge);
    const { count, dim, ids, vectors } = index;
    let maxP = 1e-6, maxR = 1e-6;
    const pArr = new Float32Array(count);
    const rArr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const pVal = prodMap.get(ids[i]) || 0;
      let rVal = 0;
      if (u) {
        const base = i * dim;
        for (let d = 0; d < dim; d++) rVal += u[d] * vectors[base + d];
      }
      pArr[i] = pVal;
      rArr[i] = rVal;
      if (pVal > maxP) maxP = pVal;
      if (rVal > maxR) maxR = rVal;
    }
    const alpha = cfg.alpha ?? 0.5;
    const map = new Map();
    for (let i = 0; i < count; i++) {
      map.set(ids[i], alpha * (rArr[i] / maxR) + (1 - alpha) * (pArr[i] / maxP));
    }
    return map;
  }
  return buildCollabSimMapFromIndex(weightedRatings, index);
}

async function loadDataset(binRelPath, limit) {
  const binPath = path.isAbsolute(binRelPath) ? binRelPath : path.join(ROOT, binRelPath);
  const buf = fs.readFileSync(binPath);
  const fullIndex = parseEmbeddingBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  const tmdbEnriched = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/tmdb_enriched.json"), "utf8"));
  const items = tmdbEnriched.items || {};
  const catalog = [];
  const catalogById = new Map();
  for (const [k, m] of Object.entries(items)) {
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
      vote_count: Number(m.vote_count ?? 200),
      collectionId: m.collectionId || null
    };
    catalog.push(cand);
    catalogById.set(id, cand);
  }

  // Slice embedding index to catalog items for ~2.6x faster evaluation
  const subIndices = [];
  for (let i = 0; i < fullIndex.count; i++) {
    if (catalogById.has(fullIndex.ids[i])) subIndices.push(i);
  }
  const subCount = subIndices.length;
  const subDim = fullIndex.dim;
  const subIds = new Uint32Array(subCount);
  const subVecs = new Float32Array(subCount * subDim);
  const subIdToIdx = new Map();
  for (let j = 0; j < subCount; j++) {
    const srcIdx = subIndices[j];
    const id = fullIndex.ids[srcIdx];
    subIds[j] = id;
    subIdToIdx.set(id, j);
    subVecs.set(fullIndex.vectors.subarray(srcIdx * subDim, (srcIdx + 1) * subDim), j * subDim);
  }
  const index = { count: subCount, dim: subDim, ids: subIds, vectors: subVecs, idToIndex: subIdToIdx };

  const rawUsers = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/fresh_300_users.json"), "utf8")).users;
  const prepared = [];
  for (const u of rawUsers.slice(0, limit)) {
    const enrichedRatings = u.ratings
      .map(r => {
        const meta = catalogById.get(Number(r.tmdbId));
        if (!meta) return null;
        return {
          ...meta,
          userRating: Number(r.userRating),
          dateWatched: r.ts ? new Date(r.ts).toISOString() : undefined
        };
      })
      .filter(Boolean);

    const split = temporalHoldoutSplit(enrichedRatings, 10, 8);
    if (split.trainWatched.length < 15 || split.holdoutPositives.size < 5) continue;

    let maxTs = 0;
    for (const m of split.trainWatched) {
      const ts = Date.parse(m.dateWatched || "");
      if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;
    }
    const maxYear = Math.max(
      ...enrichedRatings.map(r => Number(r.year) || 0),
      maxTs > 0 ? new Date(maxTs).getUTCFullYear() : 2024
    );
    const trainIds = new Set(split.trainWatched.map(m => Number(m.tmdbId)));
    const pool = catalog.filter(c => !trainIds.has(c.tmdbId) && Number(c.year) <= maxYear);
    const profile = await extractTasteProfile(split.trainWatched, [], {
      now: split.holdoutStartTs || Date.now(),
      anchorCutoff: Infinity
    });

    prepared.push({
      uid: u.uid,
      ml32m_userId: u.ml32m_userId,
      trainWatched: split.trainWatched,
      holdoutPositives: split.holdoutPositives,
      holdoutRelevance: split.holdoutRelevance,
      pool,
      profile
    });
  }

  return { index, catalog, prepared };
}

function evalConfig(prepared, index, cfg, weights = DEFAULT_RANKER_WEIGHTS, rankerOpts = {}) {
  const n = prepared.length;
  const ndcg10 = new Float64Array(n);
  const ndcg20 = new Float64Array(n);
  const hits1 = new Float64Array(n);
  const hits10 = new Float64Array(n);
  const hits20 = new Float64Array(n);
  const hits60 = new Float64Array(n);
  const hits100 = new Float64Array(n);
  const hr10 = new Float64Array(n);
  const hr20 = new Float64Array(n);
  const hr60 = new Float64Array(n);
  const hr100 = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const u = prepared[i];
    const collabSimMap = buildHybridMap(u.profile.weightedRatings, index, cfg);
    const repulsionMap = buildRepulsionMapFromIndex(u.profile.weightedRatings, index);
    const ranked = rankCandidatePool(
      u.pool,
      { profile: u.profile, collabSimMap, repulsionMap },
      weights,
      100,
      rankerOpts
    );
    const ids = ranked.map(r => String(r.tmdbId));
    ndcg10[i] = computeNDCGAtK(ids, u.holdoutRelevance, 10);
    ndcg20[i] = computeNDCGAtK(ids, u.holdoutRelevance, 20);

    let h1 = 0, h10 = 0, h20 = 0, h60 = 0, h100 = 0;
    for (let k = 0; k < ids.length; k++) {
      if (u.holdoutPositives.has(ids[k])) {
        if (k < 1) h1++;
        if (k < 10) h10++;
        if (k < 20) h20++;
        if (k < 60) h60++;
        if (k < 100) h100++;
      }
    }
    hits1[i] = h1;
    hits10[i] = h10;
    hits20[i] = h20;
    hits60[i] = h60;
    hits100[i] = h100;
    hr10[i] = h10 > 0 ? 1 : 0;
    hr20[i] = h20 > 0 ? 1 : 0;
    hr60[i] = h60 > 0 ? 1 : 0;
    hr100[i] = h100 > 0 ? 1 : 0;
  }

  const mean = arr => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
  return {
    ndcg10, ndcg20, hits1, hits10, hits20, hits60, hits100, hr10, hr20, hr60, hr100,
    summary: {
      hr1: Number((mean(hits1) * 100).toFixed(1)),
      hr10: Number((mean(hr10) * 100).toFixed(1)),
      hits10: Number(mean(hits10).toFixed(3)),
      ndcg10: Number(mean(ndcg10).toFixed(4)),
      hr20: Number((mean(hr20) * 100).toFixed(1)),
      hits20: Number(mean(hits20).toFixed(3)),
      ndcg20: Number(mean(ndcg20).toFixed(4)),
      hr60: Number((mean(hr60) * 100).toFixed(1)),
      hits60: Number(mean(hits60).toFixed(3)),
      hr100: Number((mean(hr100) * 100).toFixed(1)),
      hits100: Number(mean(hits100).toFixed(3))
    }
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const { index, prepared } = await loadDataset(opts.bin, opts.limit);
  console.log(`Loaded ${index.count} embeddings (dim=${index.dim}) from ${opts.bin}`);
  console.log(`Prepared ${prepared.length} leakage-clean users in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const dev = prepared.slice(0, Math.min(150, prepared.length));
  const val = prepared.slice(150);

  if (opts.mode === "single") {
    const res = evalConfig(prepared, index, { type: "baseline" });
    console.log("\nALL-300 SUMMARY:", JSON.stringify(res.summary, null, 2));
    return;
  }

  console.log("\n--- DEV-150 CLIENT-SIDE ABLATION ---");
  const baseDev = evalConfig(dev, index, { type: "baseline" });
  console.log("Baseline (prod):       ", baseDev.summary);

  const experiments = [
    ["ridgeBlend=0.50", { type: "prod_opts", opts: { ridgeBlend: 0.50, ridgeLambda: 20 } }],
    ["ridgeBlend=0.75", { type: "prod_opts", opts: { ridgeBlend: 0.75, ridgeLambda: 20 } }],
    ["ImplicitRidge L=4", { type: "implicit_ridge", lambda: 4, normalize: false }],
    ["ImplicitRidge L=10", { type: "implicit_ridge", lambda: 10, normalize: false }],
    ["ImplicitRidge L=20", { type: "implicit_ridge", lambda: 20, normalize: false }],
    ["ImplicitRidge L=10 norm", { type: "implicit_ridge", lambda: 10, normalize: true }],
    ["ItemPower p=2 all", { type: "item_power", power: 2, topK: 0 }],
    ["ItemPower p=3 all", { type: "item_power", power: 3, topK: 0 }],
    ["ItemPower p=2 top10", { type: "item_power", power: 2, topK: 10 }],
    ["Blend ImpRidge(10)+Prod 0.5", { type: "blend_prod_implicit_ridge", alpha: 0.5, ridge: { lambda: 10, normalize: false } }],
    ["Blend ImpRidge(10)+Prod 0.7", { type: "blend_prod_implicit_ridge", alpha: 0.7, ridge: { lambda: 10, normalize: false } }],
    ["Blend ImpRidge(10)+KNN(p2) 0.5", { type: "blend_ridge_knn", alpha: 0.5, ridge: { lambda: 10, normalize: false }, knn: { power: 2, topK: 0 } }],
    ["Blend ImpRidge(10)+KNN(p3) 0.5", { type: "blend_ridge_knn", alpha: 0.5, ridge: { lambda: 10, normalize: false }, knn: { power: 3, topK: 0 } }],
  ];

  const scored = [];
  for (const [name, cfg] of experiments) {
    const r = evalConfig(dev, index, cfg);
    const boot20 = pairedBootstrap(r.ndcg20, baseDev.ndcg20);
    const boot10 = pairedBootstrap(r.ndcg10, baseDev.ndcg10);
    const delta20 = ((r.summary.ndcg20 / baseDev.summary.ndcg20 - 1) * 100).toFixed(1);
    const delta10 = ((r.summary.ndcg10 / baseDev.summary.ndcg10 - 1) * 100).toFixed(1);
    console.log(
      `${name.padEnd(32)} NDCG@10=${r.summary.ndcg10.toFixed(4)} (${delta10 >= 0 ? "+" : ""}${delta10}%${boot10.sig ? "*" : " "}) | ` +
      `NDCG@20=${r.summary.ndcg20.toFixed(4)} (${delta20 >= 0 ? "+" : ""}${delta20}%${boot20.sig ? "*" : " "}) | ` +
      `Hits@20=${r.summary.hits20.toFixed(3)} | HR@20=${r.summary.hr20}% | HR@100=${r.summary.hr100}%`
    );
    scored.push({ name, cfg, r, boot20 });
  }

  // Validate top 2 winners on untouched Holdout-150!
  scored.sort((a, b) => b.r.summary.ndcg20 - a.r.summary.ndcg20);
  if (val.length > 0) {
    console.log("\n--- HOLDOUT-150 VERIFICATION (UNTOUCHED USERS) ---");
    const baseVal = evalConfig(val, index, { type: "baseline" });
    console.log("Baseline (prod):       ", baseVal.summary);
    for (const item of scored.slice(0, 3)) {
      const rv = evalConfig(val, index, item.cfg);
      const boot20 = pairedBootstrap(rv.ndcg20, baseVal.ndcg20);
      const boot10 = pairedBootstrap(rv.ndcg10, baseVal.ndcg10);
      const delta20 = ((rv.summary.ndcg20 / baseVal.summary.ndcg20 - 1) * 100).toFixed(1);
      const delta10 = ((rv.summary.ndcg10 / baseVal.summary.ndcg10 - 1) * 100).toFixed(1);
      console.log(
        `${item.name.padEnd(32)} NDCG@10=${rv.summary.ndcg10.toFixed(4)} (${delta10 >= 0 ? "+" : ""}${delta10}%${boot10.sig ? "*" : " "}) | ` +
        `NDCG@20=${rv.summary.ndcg20.toFixed(4)} (${delta20 >= 0 ? "+" : ""}${delta20}%${boot20.sig ? "*" : " "}) | ` +
        `Hits@20=${rv.summary.hits20.toFixed(3)} | HR@20=${rv.summary.hr20}% | HR@100=${rv.summary.hr100}%`
      );
    }
  }
}

main();
