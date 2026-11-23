#!/usr/bin/env node
/**
 * Benchmarks Exact Sparse EASE^R (CVEA v1) & EASE^R + SVD Hybrid against current SVD-64 baseline
 * on all 300 completely unseen MovieLens 32M users (Dev-150 + untouched Holdout-150 + All-300),
 * with full popularity-fair auditing (Long-Tail Hits@20, Catalog Coverage, Mean Top-20 Votes, and 3-user top picks!).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  float16ToFloat32,
  parseEmbeddingBinary,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex
} = await imp("src/services/embeddingService.js");
const { temporalHoldoutSplit, computeNDCGAtK } = await imp("src/services/evalHarness.js");
const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await imp("src/services/rankerService.js");
const { extractTasteProfile } = await imp("src/services/tmdbService.js");

function parseCveaBinary(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const view = new DataView(ab);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "CVEA") throw new Error(`Bad CVEA magic: ${magic}`);
  const version = view.getUint32(4, true);
  const count = view.getUint32(8, true);
  const K = view.getUint32(12, true);
  if (version !== 1) throw new Error(`Unsupported CVEA version: ${version}`);

  const ids = new Uint32Array(count);
  const idToIndex = new Map();
  let off = 16;
  for (let i = 0; i < count; i++) {
    const id = view.getUint32(off, true);
    ids[i] = id;
    idToIndex.set(id, i);
    off += 4;
  }
  const totalEdges = count * K;
  const nbrIdx = new Uint16Array(totalEdges);
  for (let i = 0; i < totalEdges; i++) {
    nbrIdx[i] = view.getUint16(off, true);
    off += 2;
  }
  const nbrW = new Float32Array(totalEdges);
  for (let i = 0; i < totalEdges; i++) {
    nbrW[i] = float16ToFloat32(view.getUint16(off, true));
    off += 2;
  }
  return { count, K, ids, idToIndex, nbrIdx, nbrW };
}

/**
 * Scores all items in < 1ms using sparse EASE^R top-K outgoing weights!
 * Optionally applies rating weighting & recency weighting from profile.weightedRatings.
 */
function buildEaseSimMap(weightedRatings, easeIdx, { ratingMode = "implicit_explicit", negWeight = -0.35, useRecency = false } = {}) {
  const { count, K, ids, idToIndex, nbrIdx, nbrW } = easeIdx;
  const scores = new Float32Array(count);
  let maxAbsW = 0;
  for (const e of weightedRatings) {
    const w = Math.abs(Number(e?.weight ?? e?.finalWeight ?? 0));
    if (Number.isFinite(w) && w > maxAbsW) maxAbsW = w;
  }

  let touched = 0;
  for (const e of weightedRatings) {
    const id = Number(e?.movie?.tmdbId ?? e?.tmdbId ?? e?.movie?.id ?? 0);
    const idx = id ? idToIndex.get(id) : undefined;
    if (idx === undefined) continue;
    const r = Number(e?.rating ?? e?.movie?.userRating ?? NaN);
    const rawW = Number(e?.weight ?? e?.finalWeight ?? 0);
    let x = 0;
    if (ratingMode === "binary_7") {
      x = r >= 7 ? 1.0 : (r <= 4 ? negWeight : 0);
    } else if (ratingMode === "implicit_explicit") {
      if (r >= 7) x = 0.7 + 0.6 * ((r - 6) / 4); // 7->0.85, 8->1.0, 9->1.15, 10->1.30
      else if (r >= 6) x = 0.25;
      else if (r <= 4) x = negWeight;
    } else if (ratingMode === "sharp_high") {
      if (r >= 8) x = 0.8 + 0.8 * ((r - 7) / 3); // 8->1.07, 9->1.33, 10->1.60
      else if (r >= 7) x = 0.55;
      else if (r >= 6) x = 0.15;
      else if (r <= 4) x = negWeight;
    }
    if (useRecency && maxAbsW > 0 && x > 0) {
      const recScale = 0.7 + 0.6 * Math.min(1, Math.abs(rawW) / maxAbsW);
      x *= recScale;
    }
    if (x === 0) continue;
    touched++;
    const base = idx * K;
    for (let k = 0; k < K; k++) {
      scores[nbrIdx[base + k]] += x * nbrW[base + k];
    }
  }

  const map = new Map();
  if (touched === 0) return map;
  for (let i = 0; i < count; i++) {
    if (scores[i] !== 0) map.set(ids[i], scores[i]);
  }
  return map;
}

function buildBlendedEaseSvdMap(weightedRatings, easeIdx, svdIdx, { easeWeight = 0.75, easeOpts = {} } = {}) {
  const easeMap = buildEaseSimMap(weightedRatings, easeIdx, easeOpts);
  const svdMap = buildCollabSimMapFromIndex(weightedRatings, svdIdx);
  let maxE = 1e-6, maxS = 1e-6;
  for (const v of easeMap.values()) if (v > maxE) maxE = v;
  for (const v of svdMap.values()) if (v > maxS) maxS = v;

  const out = new Map();
  for (const [id, sv] of svdMap.entries()) {
    const ev = easeMap.get(id) || 0;
    const eNorm = ev / maxE;
    const sNorm = sv / maxS;
    // If item exists in EASE index, blend; if ultra-rare cold-for-EASE item, keep scaled SVD fallback!
    if (easeIdx.idToIndex.has(id)) {
      out.set(id, easeWeight * eNorm + (1 - easeWeight) * sNorm);
    } else {
      out.set(id, (1 - easeWeight * 0.5) * sNorm);
    }
  }
  for (const [id, ev] of easeMap.entries()) {
    if (!out.has(id)) out.set(id, easeWeight * (ev / maxE));
  }
  return out;
}

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

function evalUsers(prepared, svdIdx, easeIdx, top200PopSet, catalogById, cfg) {
  const n = prepared.length;
  const ndcg10 = new Float64Array(n), ndcg20 = new Float64Array(n);
  const hits1 = new Float64Array(n), hits10 = new Float64Array(n), hits20 = new Float64Array(n), tailHits20 = new Float64Array(n), hits100 = new Float64Array(n);
  const hr10 = new Float64Array(n), hr20 = new Float64Array(n), hr100 = new Float64Array(n);
  const uniqueTop20 = new Set();
  let voteSum = 0, voteCnt = 0;
  const t0 = performance.now();

  for (let i = 0; i < n; i++) {
    const u = prepared[i];
    let collabSimMap;
    if (cfg.kind === "svd") {
      collabSimMap = buildCollabSimMapFromIndex(u.profile.weightedRatings, svdIdx);
    } else if (cfg.kind === "ease") {
      collabSimMap = buildEaseSimMap(u.profile.weightedRatings, easeIdx, cfg.easeOpts);
    } else {
      collabSimMap = buildBlendedEaseSvdMap(u.profile.weightedRatings, easeIdx, svdIdx, cfg);
    }
    const repulsionMap = buildRepulsionMapFromIndex(u.profile.weightedRatings, svdIdx);
    const ranked = rankCandidatePool(u.pool, { profile: u.profile, collabSimMap, repulsionMap }, DEFAULT_RANKER_WEIGHTS, 100);
    const ids = ranked.map(r => String(r.tmdbId));
    ndcg10[i] = computeNDCGAtK(ids, u.holdoutRelevance, 10);
    ndcg20[i] = computeNDCGAtK(ids, u.holdoutRelevance, 20);
    let h1 = 0, h10 = 0, h20 = 0, th20 = 0, h100 = 0;
    for (let k = 0; k < ids.length; k++) {
      if (k < 20) {
        uniqueTop20.add(ids[k]);
        voteSum += Number(catalogById.get(Number(ids[k]))?.vote_count || 0);
        voteCnt++;
      }
      if (u.holdoutPositives.has(ids[k])) {
        if (k < 1) h1++;
        if (k < 10) h10++;
        if (k < 20) { h20++; if (!top200PopSet.has(ids[k])) th20++; }
        if (k < 100) h100++;
      }
    }
    hits1[i] = h1; hits10[i] = h10; hits20[i] = h20; tailHits20[i] = th20; hits100[i] = h100;
    hr10[i] = h10 > 0 ? 1 : 0; hr20[i] = h20 > 0 ? 1 : 0; hr100[i] = h100 > 0 ? 1 : 0;
  }
  const msPerUser = (performance.now() - t0) / Math.max(1, n);
  const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  return {
    ndcg10, ndcg20, hits20, tailHits20,
    summary: {
      hr1: Number((mean(hits1) * 100).toFixed(1)),
      hr10: Number((mean(hr10) * 100).toFixed(1)),
      hits10: Number(mean(hits10).toFixed(3)),
      ndcg10: Number(mean(ndcg10).toFixed(4)),
      hr20: Number((mean(hr20) * 100).toFixed(1)),
      hits20: Number(mean(hits20).toFixed(3)),
      ndcg20: Number(mean(ndcg20).toFixed(4)),
      tailHits20: Number(mean(tailHits20).toFixed(3)),
      hr100: Number((mean(hr100) * 100).toFixed(1)),
      hits100: Number(mean(hits100).toFixed(2)),
      cov: uniqueTop20.size,
      avgVotes: Math.round(voteSum / Math.max(1, voteCnt)),
      msPerUser: Number(msPerUser.toFixed(1))
    }
  };
}

function fmt(label, r, base) {
  const b10 = base ? pairedBootstrap(r.ndcg10, base.ndcg10) : { sig: false };
  const b20 = base ? pairedBootstrap(r.ndcg20, base.ndcg20) : { sig: false };
  const bt = base ? pairedBootstrap(r.tailHits20, base.tailHits20) : { sig: false };
  const p = (a, b) => { const d = (a / Math.max(1e-9, b) - 1) * 100; return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`; };
  const d10 = base ? ` (${p(r.summary.ndcg10, base.summary.ndcg10)}${b10.sig ? "*" : " "})` : "";
  const d20 = base ? ` (${p(r.summary.ndcg20, base.summary.ndcg20)}${b20.sig ? "*" : " "})` : "";
  const dt = base ? ` (${p(r.summary.tailHits20, base.summary.tailHits20)}${bt.sig ? "*" : " "})` : "";
  return `${label.padEnd(28)} HR1=${String(r.summary.hr1).padStart(4)}% | NDCG10=${r.summary.ndcg10.toFixed(4)}${d10} | NDCG20=${r.summary.ndcg20.toFixed(4)}${d20} | Hits20=${r.summary.hits20.toFixed(3)} | Tail20=${r.summary.tailHits20.toFixed(3)}${dt} | HR20=${r.summary.hr20}% | HR100=${r.summary.hr100}%(${r.summary.hits100}) | Cov=${String(r.summary.cov).padStart(4)} | AvgV=${r.summary.avgVotes}`;
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

  const svdBuf = fs.readFileSync(path.join(ROOT, ".data/item_embeddings_clean2_f16.bin"));
  const fullSvd = parseEmbeddingBinary(svdBuf.buffer.slice(svdBuf.byteOffset, svdBuf.byteOffset + svdBuf.byteLength));
  // Sub-index SVD to catalog for speed
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
    prepared.push({ uid: u.uid, ml32m_userId: u.ml32m_userId, holdoutPositives: split.holdoutPositives, holdoutRelevance: split.holdoutRelevance, pool, profile });
  }

  const dev = prepared.slice(0, 150);
  const val = prepared.slice(150);

  const easeDir = path.join(ROOT, ".data/math_lab_ease");
  const easeFiles = fs.readdirSync(easeDir).filter(f => f.endsWith(".cvea")).sort();

  console.log("=== DEV-150: EXACT SPARSE EASE^R (FULL-RANK) vs SVD-64 BASELINE ===");
  const baseDev = evalUsers(dev, svdIdx, null, top200PopSet, catalogById, { kind: "svd" });
  console.log(fmt("baseline_svd64", baseDev, null));

  const devResults = [];
  for (const f of easeFiles) {
    const easeIdx = parseCveaBinary(fs.readFileSync(path.join(easeDir, f)));
    const name = f.replace(".cvea", "");
    for (const [tag, cfg] of [
      [`${name}_pure`, { kind: "ease", easeOpts: { ratingMode: "implicit_explicit", useRecency: false } }],
      [`${name}_recency`, { kind: "ease", easeOpts: { ratingMode: "implicit_explicit", useRecency: true } }],
      [`${name}+svd(75/25)`, { kind: "blend", easeWeight: 0.75, easeOpts: { ratingMode: "implicit_explicit", useRecency: false } }],
      [`${name}+svd(50/50)`, { kind: "blend", easeWeight: 0.50, easeOpts: { ratingMode: "implicit_explicit", useRecency: false } }],
    ]) {
      const r = evalUsers(dev, svdIdx, easeIdx, top200PopSet, catalogById, cfg);
      console.log(fmt(tag, r, baseDev));
      devResults.push({ tag, f, cfg, r });
    }
  }

  devResults.sort((a, b) => b.r.summary.ndcg20 - a.r.summary.ndcg20);
  const top2 = devResults.slice(0, 2);

  console.log("\n=== UNTOUCHED HOLDOUT-150 VERIFICATION ===");
  const baseVal = evalUsers(val, svdIdx, null, top200PopSet, catalogById, { kind: "svd" });
  console.log(fmt("baseline_svd64", baseVal, null));
  for (const w of top2) {
    const easeIdx = parseCveaBinary(fs.readFileSync(path.join(easeDir, w.f)));
    const rv = evalUsers(val, svdIdx, easeIdx, top200PopSet, catalogById, w.cfg);
    console.log(fmt(w.tag, rv, baseVal));
  }

  console.log("\n=== ALL-300 COMBINED FINAL VERIFICATION ===");
  const baseAll = evalUsers(prepared, svdIdx, null, top200PopSet, catalogById, { kind: "svd" });
  console.log(fmt("baseline_svd64", baseAll, null));
  const best = top2[0];
  const bestEaseIdx = parseCveaBinary(fs.readFileSync(path.join(easeDir, best.f)));
  const bestAll = evalUsers(prepared, svdIdx, bestEaseIdx, top200PopSet, catalogById, best.cfg);
  console.log(fmt(best.tag, bestAll, baseAll));

  // Qualitative sanity check on our 3 manual test users (53506, 81804, 111675)!
  console.log("\n=== QUALITATIVE SANITY CHECK ON USERS 53506, 81804, 111675 ===");
  for (const uid of ["53506", "81804", "111675"]) {
    const u = prepared.find(x => String(x.ml32m_userId) === uid || String(x.uid) === uid);
    if (!u) continue;
    const cs = best.cfg.kind === "ease"
      ? buildEaseSimMap(u.profile.weightedRatings, bestEaseIdx, best.cfg.easeOpts)
      : buildBlendedEaseSvdMap(u.profile.weightedRatings, bestEaseIdx, svdIdx, best.cfg);
    const rp = buildRepulsionMapFromIndex(u.profile.weightedRatings, svdIdx);
    const ranked = rankCandidatePool(u.pool, { profile: u.profile, collabSimMap: cs, repulsionMap: rp }, DEFAULT_RANKER_WEIGHTS, 20);
    const ids = ranked.map(r => String(r.tmdbId));
    const hits = ids.filter(id => u.holdoutPositives.has(id)).length;
    const ndcg20 = computeNDCGAtK(ids, u.holdoutRelevance, 20).toFixed(4);
    const hitNames = ids.map((id, idx) => u.holdoutPositives.has(id) ? `#${idx+1} ${catalogById.get(Number(id))?.title}(${u.holdoutRelevance.get(id)})` : null).filter(Boolean);
    console.log(`User ${uid}: hits@20=${hits}, ndcg@20=${ndcg20} | hits:`, hitNames, `| top5:`, ranked.slice(0, 5).map(r => r.title));
  }
}

main();
