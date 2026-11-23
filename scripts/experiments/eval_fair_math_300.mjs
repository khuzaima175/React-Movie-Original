#!/usr/bin/env node
/**
 * Popularity-Controlled, Coverage-Audited Math Evaluation on 300 Unseen MovieLens 32M Users.
 * Tracks BOTH overall accuracy (NDCG@10, NDCG@20, HR@20, HR@100) AND personalization health
 * (Long-Tail Hits@20 outside top-200 popular films, Unique Catalog Coverage, Mean Top-20 Votes).
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

function solveImplicitRidge(weightedRatings, index, { lambda = 8, negWeight = -0.5 } = {}) {
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
  for (let i = 0; i < dim; i++) for (let j = 0; j < i; j++) A[i * dim + j] = A[j * dim + i];
  for (let col = 0; col < dim; col++) {
    let pivotRow = col, maxVal = Math.abs(A[col * dim + col]);
    for (let r = col + 1; r < dim; r++) {
      const v = Math.abs(A[r * dim + col]);
      if (v > maxVal) { maxVal = v; pivotRow = r; }
    }
    if (maxVal < 1e-12) return null;
    if (pivotRow !== col) {
      for (let k = col; k < dim; k++) { const t = A[col * dim + k]; A[col * dim + k] = A[pivotRow * dim + k]; A[pivotRow * dim + k] = t; }
      const tb = b[col]; b[col] = b[pivotRow]; b[pivotRow] = tb;
    }
    const diag = A[col * dim + col];
    for (let r = col + 1; r < dim; r++) {
      const f = A[r * dim + col] / diag;
      if (f === 0) continue;
      for (let k = col; k < dim; k++) A[r * dim + k] -= f * A[col * dim + k];
      b[r] -= f * b[col];
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
  if (mode === "impridge_knn_50") {
    const u = solveImplicitRidge(weightedRatings, index, { lambda: 10 });
    const knnMap = buildItemPowerMap(weightedRatings, index, { power: 3 });
    const rArr = new Float32Array(count), kArr = new Float32Array(count);
    let maxR = 1e-6, maxK = 1e-6;
    for (let i = 0; i < count; i++) {
      let rv = 0;
      if (u) { const base = i * dim; for (let d = 0; d < dim; d++) rv += u[d] * vectors[base + d]; }
      const kv = knnMap.get(ids[i]) || 0;
      rArr[i] = rv; kArr[i] = kv;
      if (rv > maxR) maxR = rv;
      if (kv > maxK) maxK = kv;
    }
    const map = new Map();
    for (let i = 0; i < count; i++) map.set(ids[i], 0.5 * (rArr[i] / maxR) + 0.5 * (kArr[i] / maxK));
    return map;
  }
  if (mode === "prod_impridge_50") {
    const prodMap = buildCollabSimMapFromIndex(weightedRatings, index);
    const u = solveImplicitRidge(weightedRatings, index, { lambda: 8 });
    const pArr = new Float32Array(count), rArr = new Float32Array(count);
    let maxP = 1e-6, maxR = 1e-6;
    for (let i = 0; i < count; i++) {
      const pv = prodMap.get(ids[i]) || 0;
      let rv = 0;
      if (u) { const base = i * dim; for (let d = 0; d < dim; d++) rv += u[d] * vectors[base + d]; }
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

function evalRun(prepared, index, top200PopSet, catalogById, scorerMode = "prod") {
  const n = prepared.length;
  const ndcg10 = new Float64Array(n), ndcg20 = new Float64Array(n);
  const hits10 = new Float64Array(n), hits20 = new Float64Array(n), tailHits20 = new Float64Array(n), hits100 = new Float64Array(n);
  const hr20 = new Float64Array(n), hr100 = new Float64Array(n);
  const uniqueTop20 = new Set();
  let voteSum = 0, voteCount = 0;

  for (let i = 0; i < n; i++) {
    const u = prepared[i];
    const collabSimMap = buildScorerMap(u.profile.weightedRatings, index, scorerMode);
    const repulsionMap = buildRepulsionMapFromIndex(u.profile.weightedRatings, index);
    const ranked = rankCandidatePool(u.pool, { profile: u.profile, collabSimMap, repulsionMap }, DEFAULT_RANKER_WEIGHTS, 100);
    const ids = ranked.map(r => String(r.tmdbId));
    ndcg10[i] = computeNDCGAtK(ids, u.holdoutRelevance, 10);
    ndcg20[i] = computeNDCGAtK(ids, u.holdoutRelevance, 20);
    let h10 = 0, h20 = 0, th20 = 0, h100 = 0;
    for (let k = 0; k < ids.length; k++) {
      if (k < 20) {
        uniqueTop20.add(ids[k]);
        voteSum += Number(catalogById.get(Number(ids[k]))?.vote_count || 0);
        voteCount++;
      }
      if (u.holdoutPositives.has(ids[k])) {
        if (k < 10) h10++;
        if (k < 20) {
          h20++;
          if (!top200PopSet.has(ids[k])) th20++;
        }
        if (k < 100) h100++;
      }
    }
    hits10[i] = h10; hits20[i] = h20; tailHits20[i] = th20; hits100[i] = h100;
    hr20[i] = h20 > 0 ? 1 : 0; hr100[i] = h100 > 0 ? 1 : 0;
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  return {
    ndcg10, ndcg20, tailHits20,
    summary: {
      ndcg10: Number(mean(ndcg10).toFixed(4)),
      ndcg20: Number(mean(ndcg20).toFixed(4)),
      hits20: Number(mean(hits20).toFixed(3)),
      tailHits20: Number(mean(tailHits20).toFixed(3)),
      hr20: Number((mean(hr20) * 100).toFixed(1)),
      hr100: Number((mean(hr100) * 100).toFixed(1)),
      hits100: Number(mean(hits100).toFixed(2)),
      cov: uniqueTop20.size,
      avgVotes: Math.round(voteSum / Math.max(1, voteCount))
    }
  };
}

function fmt(label, r, base) {
  const b20 = base ? pairedBootstrap(r.ndcg20, base.ndcg20) : { sig: false };
  const bt = base ? pairedBootstrap(r.tailHits20, base.tailHits20) : { sig: false };
  const d20 = base ? ` (${((r.summary.ndcg20 / base.summary.ndcg20 - 1) * 100) >= 0 ? "+" : ""}${((r.summary.ndcg20 / base.summary.ndcg20 - 1) * 100).toFixed(1)}%${b20.sig ? "*" : " "})` : "";
  const dt = base ? ` (${((r.summary.tailHits20 / Math.max(1e-6, base.summary.tailHits20) - 1) * 100) >= 0 ? "+" : ""}${((r.summary.tailHits20 / Math.max(1e-6, base.summary.tailHits20) - 1) * 100).toFixed(1)}%${bt.sig ? "*" : " "})` : "";
  return `${label.padEnd(26)} NDCG@10=${r.summary.ndcg10.toFixed(4)} | NDCG@20=${r.summary.ndcg20.toFixed(4)}${d20} | Hits@20=${r.summary.hits20.toFixed(3)} | Tail@20=${r.summary.tailHits20.toFixed(3)}${dt} | Cov=${String(r.summary.cov).padStart(4)} | AvgV=${r.summary.avgVotes}`;
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
    };
    catalog.push(cand);
    catalogById.set(id, cand);
  }
  const top200PopSet = new Set([...catalog].sort((a, b) => b.vote_count - a.vote_count).slice(0, 200).map(c => String(c.tmdbId)));

  const rawUsers = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/fresh_300_users.json"), "utf8")).users;
  const prepared = [];
  for (const u of rawUsers) {
    const enriched = u.ratings
      .map(r => { const m = catalogById.get(Number(r.tmdbId)); return m ? { ...m, userRating: Number(r.userRating), dateWatched: r.ts ? new Date(r.ts).toISOString() : undefined } : null; })
      .filter(Boolean);
    const split = temporalHoldoutSplit(enriched, 10, 8);
    if (split.trainWatched.length < 15 || split.holdoutPositives.size < 5) continue;
    let maxTs = 0;
    for (const m of split.trainWatched) { const ts = Date.parse(m.dateWatched || ""); if (Number.isFinite(ts) && ts > maxTs) maxTs = ts; }
    const maxYear = Math.max(...enriched.map(r => Number(r.year) || 0), maxTs > 0 ? new Date(maxTs).getUTCFullYear() : 2024);
    const trainIds = new Set(split.trainWatched.map(m => Number(m.tmdbId)));
    const pool = catalog.filter(c => !trainIds.has(c.tmdbId) && Number(c.year) <= maxYear);
    const profile = await extractTasteProfile(split.trainWatched, [], { now: split.holdoutStartTs || Date.now(), anchorCutoff: Infinity });
    prepared.push({ uid: u.uid, holdoutPositives: split.holdoutPositives, holdoutRelevance: split.holdoutRelevance, pool, profile });
  }

  const dev = prepared.slice(0, 150);
  const val = prepared.slice(150);
  const basePath = path.join(ROOT, ".data/item_embeddings_clean2_f16.bin");
  const fairDir = path.join(ROOT, ".data/math_lab_fair");
  const bins = fs.readdirSync(fairDir).filter(f => f.endsWith(".bin")).sort();

  console.log("=== DEV-150 POPULARITY-FAIR SHOWDOWN (IDENTICAL p90 NORM = 0.619!) ===");
  const baseDev = evalRun(dev, loadSubIndex(basePath, catalogById), top200PopSet, catalogById, "prod");
  console.log(fmt("baseline_svd64_p050", baseDev, null));

  const res = [];
  for (const f of bins) {
    const idx = loadSubIndex(path.join(fairDir, f), catalogById);
    const r = evalRun(dev, idx, top200PopSet, catalogById, "prod");
    console.log(fmt(f.replace(".bin", ""), r, baseDev));
    res.push({ name: f.replace(".bin", ""), path: path.join(fairDir, f), r });
  }

  res.sort((a, b) => b.r.summary.ndcg20 - a.r.summary.ndcg20);
  const best = res[0];
  console.log(`\n=== DEV-150 STACKING CLIENT MATH ON ${best.name} ===`);
  const bestIdx = loadSubIndex(best.path, catalogById);
  const rStack1 = evalRun(dev, bestIdx, top200PopSet, catalogById, "impridge_knn_50");
  console.log(fmt(`${best.name}+imp+knn`, rStack1, baseDev));
  const rStack2 = evalRun(dev, bestIdx, top200PopSet, catalogById, "prod_impridge_50");
  console.log(fmt(`${best.name}+prod+imp`, rStack2, baseDev));

  console.log("\n=== UNTOUCHED HOLDOUT-150 & ALL-300 VERIFICATION ===");
  const baseVal = evalRun(val, loadSubIndex(basePath, catalogById), top200PopSet, catalogById, "prod");
  console.log("[HOLDOUT-150]");
  console.log(fmt("baseline_svd64_p050", baseVal, null));
  console.log(fmt(`${best.name}+prod`, evalRun(val, bestIdx, top200PopSet, catalogById, "prod"), baseVal));
  console.log(fmt(`${best.name}+imp+knn`, evalRun(val, bestIdx, top200PopSet, catalogById, "impridge_knn_50"), baseVal));
  console.log(fmt(`${best.name}+prod+imp`, evalRun(val, bestIdx, top200PopSet, catalogById, "prod_impridge_50"), baseVal));

  console.log("\n[ALL-300]");
  const baseAll = evalRun(prepared, loadSubIndex(basePath, catalogById), top200PopSet, catalogById, "prod");
  console.log(fmt("baseline_svd64_p050", baseAll, null));
  console.log(fmt(`${best.name}+prod`, evalRun(prepared, bestIdx, top200PopSet, catalogById, "prod"), baseAll));
  console.log(fmt(`${best.name}+imp+knn`, evalRun(prepared, bestIdx, top200PopSet, catalogById, "impridge_knn_50"), baseAll));
  console.log(fmt(`${best.name}+prod+imp`, evalRun(prepared, bestIdx, top200PopSet, catalogById, "prod_impridge_50"), baseAll));
}

main();
