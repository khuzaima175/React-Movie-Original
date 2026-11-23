#!/usr/bin/env node
/**
 * Evaluates .data/math_lab_sweep/*.bin on Dev-150 + Holdout-150, then stacks
 * client-side math upgrades (ImplicitRidge + Item-Item KNN) on top of the best Spectral EASE binary!
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
const { temporalHoldoutSplit, computeNDCGAtK } = await imp("src/services/evalHarness.js");
const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await imp("src/services/rankerService.js");
const { extractTasteProfile } = await imp("src/services/tmdbService.js");

function pairedBootstrap(cand, base, seed = 42, resamples = 1000) {
  const n = cand.length;
  const diffs = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { diffs[i] = cand[i] - base[i]; sum += diffs[i]; }
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const boots = new Float64Array(resamples);
  for (let b = 0; b < resamples; b++) {
    let acc = 0;
    for (let i = 0; i < n; i++) acc += diffs[Math.floor(rnd() * n)];
    boots[b] = acc / n;
  }
  boots.sort();
  const lo = boots[Math.floor(0.025 * resamples)];
  const hi = boots[Math.floor(0.975 * resamples)];
  return { meanDiff: sum / n, lo, hi, sig: (lo > 0 && hi > 0) || (lo < 0 && hi < 0) };
}

function loadSubIndex(binPath, catalogById) {
  const buf = fs.readFileSync(binPath);
  const full = parseEmbeddingBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const subIndices = [];
  for (let i = 0; i < full.count; i++) {
    if (catalogById.has(full.ids[i])) subIndices.push(i);
  }
  const subCount = subIndices.length;
  const subDim = full.dim;
  const subIds = new Uint32Array(subCount);
  const subVecs = new Float32Array(subCount * subDim);
  const subIdToIdx = new Map();
  for (let j = 0; j < subCount; j++) {
    const srcIdx = subIndices[j];
    const id = full.ids[srcIdx];
    subIds[j] = id;
    subIdToIdx.set(id, j);
    subVecs.set(full.vectors.subarray(srcIdx * subDim, (srcIdx + 1) * subDim), j * subDim);
  }
  return { count: subCount, dim: subDim, ids: subIds, vectors: subVecs, idToIndex: subIdToIdx };
}

function solveImplicitRidge(weightedRatings, index, { lambda = 10, negWeight = -0.5 } = {}) {
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
    let y;
    if (r >= 7) y = 0.7 + 0.8 * ((r - 6) / 4);
    else if (r >= 6) y = 0.25;
    else y = negWeight * ((6 - r) / 5);
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
  return u;
}

function buildItemPowerMap(weightedRatings, index, { power = 3 } = {}) {
  const { count, dim, ids, vectors, idToIndex } = index;
  const liked = [];
  for (const e of weightedRatings) {
    const id = Number(e?.movie?.tmdbId ?? e?.tmdbId ?? e?.movie?.id ?? 0);
    const idx = id ? idToIndex.get(id) : undefined;
    if (idx === undefined) continue;
    const r = Number(e?.rating ?? e?.movie?.userRating ?? NaN);
    if (!Number.isFinite(r) || r < 7) continue;
    liked.push({ idx, w: 0.5 + 0.5 * ((r - 6) / 4) });
  }
  const map = new Map();
  if (liked.length === 0) return map;
  const L = liked.length;
  const lVecs = new Float32Array(L * dim);
  const lWeights = new Float32Array(L);
  let wTotal = 0;
  for (let j = 0; j < L; j++) {
    lVecs.set(vectors.subarray(liked[j].idx * dim, (liked[j].idx + 1) * dim), j * dim);
    lWeights[j] = liked[j].w;
    wTotal += liked[j].w;
  }
  const denom = Math.sqrt(wTotal);
  for (let i = 0; i < count; i++) {
    const base = i * dim;
    let score = 0;
    for (let j = 0; j < L; j++) {
      let dot = 0;
      const lb = j * dim;
      for (let d = 0; d < dim; d++) dot += vectors[base + d] * lVecs[lb + d];
      if (dot > 0) score += lWeights[j] * Math.pow(dot, power);
    }
    map.set(ids[i], score / denom);
  }
  return map;
}

function buildScorerMap(weightedRatings, index, mode = "prod") {
  if (mode === "prod") return buildCollabSimMapFromIndex(weightedRatings, index);
  const { count, dim, ids, vectors } = index;
  if (mode === "impridge_4" || mode === "impridge_10") {
    const lam = mode === "impridge_4" ? 4 : 10;
    const u = solveImplicitRidge(weightedRatings, index, { lambda: lam });
    if (!u) return buildCollabSimMapFromIndex(weightedRatings, index);
    const map = new Map();
    for (let i = 0; i < count; i++) {
      const base = i * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += u[d] * vectors[base + d];
      map.set(ids[i], dot);
    }
    return map;
  }
  if (mode.startsWith("blend_ridge_knn")) {
    const lam = mode.includes("_4") ? 4 : 10;
    const u = solveImplicitRidge(weightedRatings, index, { lambda: lam });
    const knnMap = buildItemPowerMap(weightedRatings, index, { power: 3 });
    const rArr = new Float32Array(count);
    const kArr = new Float32Array(count);
    let maxR = 1e-6, maxK = 1e-6;
    for (let i = 0; i < count; i++) {
      let rv = 0;
      if (u) {
        const base = i * dim;
        for (let d = 0; d < dim; d++) rv += u[d] * vectors[base + d];
      }
      const kv = knnMap.get(ids[i]) || 0;
      rArr[i] = rv; kArr[i] = kv;
      if (rv > maxR) maxR = rv;
      if (kv > maxK) maxK = kv;
    }
    const alpha = mode.includes("a65") ? 0.65 : 0.50;
    const map = new Map();
    for (let i = 0; i < count; i++) {
      map.set(ids[i], alpha * (rArr[i] / maxR) + (1 - alpha) * (kArr[i] / maxK));
    }
    return map;
  }
  if (mode === "blend_prod_impridge_50") {
    const prodMap = buildCollabSimMapFromIndex(weightedRatings, index);
    const u = solveImplicitRidge(weightedRatings, index, { lambda: 6 });
    const pArr = new Float32Array(count);
    const rArr = new Float32Array(count);
    let maxP = 1e-6, maxR = 1e-6;
    for (let i = 0; i < count; i++) {
      const pv = prodMap.get(ids[i]) || 0;
      let rv = 0;
      if (u) {
        const base = i * dim;
        for (let d = 0; d < dim; d++) rv += u[d] * vectors[base + d];
      }
      pArr[i] = pv; rArr[i] = rv;
      if (pv > maxP) maxP = pv;
      if (rv > maxR) maxR = rv;
    }
    const map = new Map();
    for (let i = 0; i < count; i++) map.set(ids[i], 0.5 * (pArr[i] / maxP) + 0.5 * (rArr[i] / maxR));
    return map;
  }
  return buildCollabSimMapFromIndex(weightedRatings, index);
}

function evalRun(prepared, index, scorerMode = "prod") {
  const n = prepared.length;
  const ndcg10 = new Float64Array(n);
  const ndcg20 = new Float64Array(n);
  const hits1 = new Float64Array(n);
  const hits10 = new Float64Array(n);
  const hits20 = new Float64Array(n);
  const hits100 = new Float64Array(n);
  const hr10 = new Float64Array(n);
  const hr20 = new Float64Array(n);
  const hr100 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const u = prepared[i];
    const collabSimMap = buildScorerMap(u.profile.weightedRatings, index, scorerMode);
    const repulsionMap = buildRepulsionMapFromIndex(u.profile.weightedRatings, index);
    const ranked = rankCandidatePool(u.pool, { profile: u.profile, collabSimMap, repulsionMap }, DEFAULT_RANKER_WEIGHTS, 100);
    const ids = ranked.map(r => String(r.tmdbId));
    ndcg10[i] = computeNDCGAtK(ids, u.holdoutRelevance, 10);
    ndcg20[i] = computeNDCGAtK(ids, u.holdoutRelevance, 20);
    let h1 = 0, h10 = 0, h20 = 0, h100 = 0;
    for (let k = 0; k < ids.length; k++) {
      if (u.holdoutPositives.has(ids[k])) {
        if (k < 1) h1++;
        if (k < 10) h10++;
        if (k < 20) h20++;
        if (k < 100) h100++;
      }
    }
    hits1[i] = h1; hits10[i] = h10; hits20[i] = h20; hits100[i] = h100;
    hr10[i] = h10 > 0 ? 1 : 0; hr20[i] = h20 > 0 ? 1 : 0; hr100[i] = h100 > 0 ? 1 : 0;
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  return {
    ndcg10, ndcg20, hits1, hits10, hits20, hits100,
    summary: {
      hr1: Number((mean(hits1) * 100).toFixed(1)),
      hr10: Number((mean(hr10) * 100).toFixed(1)),
      hits10: Number(mean(hits10).toFixed(3)),
      ndcg10: Number(mean(ndcg10).toFixed(4)),
      hr20: Number((mean(hr20) * 100).toFixed(1)),
      hits20: Number(mean(hits20).toFixed(3)),
      ndcg20: Number(mean(ndcg20).toFixed(4)),
      hr100: Number((mean(hr100) * 100).toFixed(1)),
      hits100: Number(mean(hits100).toFixed(3))
    }
  };
}

function fmtLine(label, r, base) {
  const b10 = base ? pairedBootstrap(r.ndcg10, base.ndcg10) : { sig: false };
  const b20 = base ? pairedBootstrap(r.ndcg20, base.ndcg20) : { sig: false };
  const d10 = base ? ` (${((r.summary.ndcg10 / base.summary.ndcg10 - 1) * 100) >= 0 ? "+" : ""}${((r.summary.ndcg10 / base.summary.ndcg10 - 1) * 100).toFixed(1)}%${b10.sig ? "*" : " "})` : "";
  const d20 = base ? ` (${((r.summary.ndcg20 / base.summary.ndcg20 - 1) * 100) >= 0 ? "+" : ""}${((r.summary.ndcg20 / base.summary.ndcg20 - 1) * 100).toFixed(1)}%${b20.sig ? "*" : " "})` : "";
  return `${label.padEnd(28)} HR@1=${String(r.summary.hr1).padStart(4)}% | NDCG@10=${r.summary.ndcg10.toFixed(4)}${d10} | NDCG@20=${r.summary.ndcg20.toFixed(4)}${d20} | Hits@20=${r.summary.hits20.toFixed(3)} | HR@20=${r.summary.hr20}% | HR@100=${r.summary.hr100}% (${r.summary.hits100.toFixed(2)})`;
}

async function main() {
  const tmdbEnriched = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/tmdb_enriched.json"), "utf8"));
  const catalog = [];
  const catalogById = new Map();
  for (const [k, m] of Object.entries(tmdbEnriched.items || {})) {
    const id = Number(m.tmdbId ?? m.id ?? k);
    if (!id) continue;
    const year = Number(String(m.year ?? m.release_date ?? "").slice(0, 4)) || 2000;
    const cand = {
      id, tmdbId: id, title: m.title || String(id), year: String(year),
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

  const rawUsers = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/fresh_300_users.json"), "utf8")).users;
  const prepared = [];
  for (const u of rawUsers) {
    const enriched = u.ratings
      .map(r => {
        const meta = catalogById.get(Number(r.tmdbId));
        return meta ? { ...meta, userRating: Number(r.userRating), dateWatched: r.ts ? new Date(r.ts).toISOString() : undefined } : null;
      })
      .filter(Boolean);
    const split = temporalHoldoutSplit(enriched, 10, 8);
    if (split.trainWatched.length < 15 || split.holdoutPositives.size < 5) continue;
    let maxTs = 0;
    for (const m of split.trainWatched) {
      const ts = Date.parse(m.dateWatched || "");
      if (Number.isFinite(ts) && ts > maxTs) maxTs = ts;
    }
    const maxYear = Math.max(...enriched.map(r => Number(r.year) || 0), maxTs > 0 ? new Date(maxTs).getUTCFullYear() : 2024);
    const trainIds = new Set(split.trainWatched.map(m => Number(m.tmdbId)));
    const pool = catalog.filter(c => !trainIds.has(c.tmdbId) && Number(c.year) <= maxYear);
    const profile = await extractTasteProfile(split.trainWatched, [], { now: split.holdoutStartTs || Date.now(), anchorCutoff: Infinity });
    prepared.push({ uid: u.uid, holdoutPositives: split.holdoutPositives, holdoutRelevance: split.holdoutRelevance, pool, profile });
  }

  const dev = prepared.slice(0, 150);
  const val = prepared.slice(150);

  const basePath = path.join(ROOT, ".data/item_embeddings_clean2_f16.bin");
  const sweepDir = path.join(ROOT, ".data/math_lab_sweep");
  const bins = fs.readdirSync(sweepDir).filter(f => f.endsWith(".bin")).sort();

  console.log("=== PART 1: DEV-150 SPECTRAL EASE SWEEP (prod client scorer) ===");
  const baseDev = evalRun(dev, loadSubIndex(basePath, catalogById), "prod");
  console.log(fmtLine("baseline_svd64_p050", baseDev, null));

  const sweepResults = [];
  for (const f of bins) {
    const idx = loadSubIndex(path.join(sweepDir, f), catalogById);
    const r = evalRun(dev, idx, "prod");
    console.log(fmtLine(f.replace(".bin", ""), r, baseDev));
    sweepResults.push({ name: f.replace(".bin", ""), path: path.join(sweepDir, f), r });
  }

  sweepResults.sort((a, b) => b.r.summary.ndcg20 - a.r.summary.ndcg20);
  const best128 = sweepResults.find(x => x.name.startsWith("ease128"));
  const best64 = sweepResults.find(x => x.name.startsWith("ease64"));

  console.log(`\n=== PART 2: DEV-150 STACKING CLIENT MATH ON ${best128.name} ===`);
  const bestIdx = loadSubIndex(best128.path, catalogById);
  const stackModes = ["prod", "impridge_4", "impridge_10", "blend_prod_impridge_50", "blend_ridge_knn_4", "blend_ridge_knn_10", "blend_ridge_knn_10_a65"];
  const stackRes = [];
  for (const mode of stackModes) {
    const r = evalRun(dev, bestIdx, mode);
    console.log(fmtLine(`${best128.name}+${mode}`, r, baseDev));
    stackRes.push({ mode, r });
  }
  stackRes.sort((a, b) => b.r.summary.ndcg20 - a.r.summary.ndcg20);

  console.log("\n=== PART 3: UNTOUCHED HOLDOUT-150 + ALL-300 FINAL VERIFICATION ===");
  const baseVal = evalRun(val, loadSubIndex(basePath, catalogById), "prod");
  console.log("[HOLDOUT-150]");
  console.log(fmtLine("baseline_svd64_p050", baseVal, null));
  if (best64) {
    const r64v = evalRun(val, loadSubIndex(best64.path, catalogById), "prod");
    console.log(fmtLine(`${best64.name} (3.1MB)`, r64v, baseVal));
  }
  const r128ProdVal = evalRun(val, bestIdx, "prod");
  console.log(fmtLine(`${best128.name}+prod`, r128ProdVal, baseVal));
  const bestStackMode = stackRes[0].mode;
  if (bestStackMode !== "prod") {
    const r128StackVal = evalRun(val, bestIdx, bestStackMode);
    console.log(fmtLine(`${best128.name}+${bestStackMode}`, r128StackVal, baseVal));
  }
  const secondStackMode = stackRes[1]?.mode;
  if (secondStackMode && secondStackMode !== "prod" && secondStackMode !== bestStackMode) {
    const r128Stack2Val = evalRun(val, bestIdx, secondStackMode);
    console.log(fmtLine(`${best128.name}+${secondStackMode}`, r128Stack2Val, baseVal));
  }

  console.log("\n[ALL-300 COMBINED]");
  const baseAll = evalRun(prepared, loadSubIndex(basePath, catalogById), "prod");
  console.log(fmtLine("baseline_svd64_p050", baseAll, null));
  const bestProdAll = evalRun(prepared, bestIdx, "prod");
  console.log(fmtLine(`${best128.name}+prod`, bestProdAll, baseAll));
  if (bestStackMode !== "prod") {
    const bestStackAll = evalRun(prepared, bestIdx, bestStackMode);
    console.log(fmtLine(`${best128.name}+${bestStackMode}`, bestStackAll, baseAll));
  }
}

main();
