#!/usr/bin/env node
/**
 * Evaluates all candidate clean CVEM binaries in .data/math_lab_bins/ vs baseline .data/item_embeddings_clean2_f16.bin
 * on Dev-150 first, then verifies top winners on untouched Holdout-150 with paired bootstrap 95% CIs!
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

function evalBin(prepared, index) {
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
    const collabSimMap = buildCollabSimMapFromIndex(u.profile.weightedRatings, index);
    const repulsionMap = buildRepulsionMapFromIndex(u.profile.weightedRatings, index);
    const ranked = rankCandidatePool(
      u.pool,
      { profile: u.profile, collabSimMap, repulsionMap },
      DEFAULT_RANKER_WEIGHTS,
      100
    );
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
    ndcg10, ndcg20, hits20, hits100,
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
  const binDir = path.join(ROOT, ".data/math_lab_bins");
  const candidates = fs.readdirSync(binDir).filter(f => f.endsWith(".bin")).sort().map(f => ({
    name: f.replace(".bin", ""),
    path: path.join(binDir, f)
  }));

  console.log("=== DEV-150 EMBEDDING BINARY SHOWDOWN (using exact prod client ranker) ===");
  const baseDev = evalBin(dev, loadSubIndex(basePath, catalogById));
  console.log(`baseline_svd64_p050      NDCG@10=${baseDev.summary.ndcg10.toFixed(4)} | NDCG@20=${baseDev.summary.ndcg20.toFixed(4)} | Hits@20=${baseDev.summary.hits20.toFixed(3)} | HR@20=${baseDev.summary.hr20}% | HR@100=${baseDev.summary.hr100}% | Hits@100=${baseDev.summary.hits100.toFixed(3)}`);

  const results = [];
  for (const c of candidates) {
    const idx = loadSubIndex(c.path, catalogById);
    const r = evalBin(dev, idx);
    const b10 = pairedBootstrap(r.ndcg10, baseDev.ndcg10);
    const b20 = pairedBootstrap(r.ndcg20, baseDev.ndcg20);
    const d10 = ((r.summary.ndcg10 / baseDev.summary.ndcg10 - 1) * 100).toFixed(1);
    const d20 = ((r.summary.ndcg20 / baseDev.summary.ndcg20 - 1) * 100).toFixed(1);
    console.log(
      `${c.name.padEnd(24)} NDCG@10=${r.summary.ndcg10.toFixed(4)} (${d10 >= 0 ? "+" : ""}${d10}%${b10.sig ? "*" : " "}) | ` +
      `NDCG@20=${r.summary.ndcg20.toFixed(4)} (${d20 >= 0 ? "+" : ""}${d20}%${b20.sig ? "*" : " "}) | ` +
      `Hits@20=${r.summary.hits20.toFixed(3)} | HR@20=${r.summary.hr20}% | HR@100=${r.summary.hr100}% | Hits@100=${r.summary.hits100.toFixed(3)}`
    );
    results.push({ ...c, r });
  }

  results.sort((a, b) => b.r.summary.ndcg20 - a.r.summary.ndcg20);
  console.log("\n=== HOLDOUT-150 VERIFICATION (TOP 3 EMBEDDING MODELS ON UNTOUCHED USERS) ===");
  const baseVal = evalBin(val, loadSubIndex(basePath, catalogById));
  console.log(`baseline_svd64_p050      NDCG@10=${baseVal.summary.ndcg10.toFixed(4)} | NDCG@20=${baseVal.summary.ndcg20.toFixed(4)} | Hits@20=${baseVal.summary.hits20.toFixed(3)} | HR@20=${baseVal.summary.hr20}% | HR@100=${baseVal.summary.hr100}% | Hits@100=${baseVal.summary.hits100.toFixed(3)}`);
  for (const top of results.slice(0, 3)) {
    const rv = evalBin(val, loadSubIndex(top.path, catalogById));
    const b10 = pairedBootstrap(rv.ndcg10, baseVal.ndcg10);
    const b20 = pairedBootstrap(rv.ndcg20, baseVal.ndcg20);
    const d10 = ((rv.summary.ndcg10 / baseVal.summary.ndcg10 - 1) * 100).toFixed(1);
    const d20 = ((rv.summary.ndcg20 / baseVal.summary.ndcg20 - 1) * 100).toFixed(1);
    console.log(
      `${top.name.padEnd(24)} NDCG@10=${rv.summary.ndcg10.toFixed(4)} (${d10 >= 0 ? "+" : ""}${d10}%${b10.sig ? "*" : " "}) | ` +
      `NDCG@20=${rv.summary.ndcg20.toFixed(4)} (${d20 >= 0 ? "+" : ""}${d20}%${b20.sig ? "*" : " "}) | ` +
      `Hits@20=${rv.summary.hits20.toFixed(3)} | HR@20=${rv.summary.hr20}% | HR@100=${rv.summary.hr100}% | Hits@100=${rv.summary.hits100.toFixed(3)}`
    );
  }
}

main();
