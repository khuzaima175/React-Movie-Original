#!/usr/bin/env node
/**
 * CinemaVault v6.2 Task 4 Cold-Start Evaluator (100%-Cold Masked Holdout: Dev-150 -> Holdout-150)
 *
 * Masks collabSim = 0 on all candidates (matching Experiment 7's exact 100%-cold protocol where
 * v6.1 MiniLM-128D scored Holdout-150 NDCG@10=0.0589, NDCG@20=0.0716, HR@20=46.7%) and compares:
 *   0. Lexical TF-IDF fallback (0 MB)
 *   1. v6.1 single-mean MiniLM-128D (baseline, production & 9620-item reference)
 *   2. rating >= 7 guard + catalog-mean centering + Multi-Persona Spherical K-Means + top3Loved + catalog-max (0 extra MB)
 *   3. 5-fold Out-of-Fold (OOF) cross-space 64-D Ridge cold projector (.data/v6_lab/cold_proj_64_clean.bin)
 *      in both cold-to-cold and warm-SVD-to-OOF-64D modes, plus hybrid blends.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  parseEmbeddingBinary,
  getRelativeWeightCutoff,
  l2NormalizeInPlace,
  computePersonaDetails,
  getCollabCatalogMax,
  buildCollabSimMapFromIndex
} = await imp("src/services/embeddingService.js");
const { buildContentSimMap } = await imp("src/services/contentSimService.js");
const {
  rankCandidatePool,
  DEFAULT_RANKER_WEIGHTS,
  DEFAULT_METADATA_DAMPING_FACTOR
} = await imp("src/services/rankerService.js");
const { computeNDCGAtK } = await imp("src/services/evalHarness.js");
const { loadCleanCohort, pairedBootstrap } = await imp("scripts/experiments/v6_gate_eval.mjs");

function parseCli(argv) {
  const opts = {
    content: "public/models/content_embeddings_f16.bin",
    refContent: ".data/v6_lab/content_128_f16.bin",
    proj: ".data/v6_lab/cold_proj_64_clean.bin",
    svd: ".data/item_embeddings_clean2_f16.bin",
    skipLexical: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--content" && argv[i + 1]) opts.content = argv[++i];
    else if (a === "--ref-content" && argv[i + 1]) opts.refContent = argv[++i];
    else if (a === "--proj" && argv[i + 1]) opts.proj = argv[++i];
    else if (a === "--svd" && argv[i + 1]) opts.svd = argv[++i];
    else if (a === "--skip-lexical") opts.skipLexical = true;
  }
  return opts;
}

function loadCvemIndex(relPath) {
  if (!relPath) return null;
  const fullPath = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  const buf = fs.readFileSync(fullPath);
  return {
    idx: parseEmbeddingBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    sizeMb: buf.length / (1024 * 1024)
  };
}

/**
 * Builds a catalog-mean-centered unit-normalized copy of a CVEM index to remove
 * embedding-cone anisotropy when contentIndex.count >= 50.
 */
function buildMeanCenteredIndex(contentIndex) {
  if (!contentIndex || !contentIndex.count || !contentIndex.dim || contentIndex.count < 50) {
    return contentIndex;
  }
  const { count, dim, ids, idToIndex, vectors } = contentIndex;
  const mean = new Float64Array(dim);
  const unitVecs = new Float32Array(count * dim);

  for (let i = 0; i < count; i++) {
    const base = i * dim;
    let sumSq = 0;
    for (let d = 0; d < dim; d++) sumSq += vectors[base + d] * vectors[base + d];
    const inv = sumSq > 1e-12 ? 1 / Math.sqrt(sumSq) : 0;
    for (let d = 0; d < dim; d++) {
      const u = vectors[base + d] * inv;
      unitVecs[base + d] = u;
      mean[d] += u;
    }
  }
  for (let d = 0; d < dim; d++) mean[d] /= count;

  const centered = new Float32Array(count * dim);
  for (let i = 0; i < count; i++) {
    const base = i * dim;
    for (let d = 0; d < dim; d++) {
      centered[base + d] = unitVecs[base + d] - mean[d];
    }
    l2NormalizeInPlace(centered, base, dim);
  }
  return { count, dim, ids, idToIndex, vectors: centered };
}

/**
 * Configurable candidate scorer for contentSimService ablations:
 * - minPositiveRating: 7 (fixes harsh-rater <=5★ positive-z pollution) vs 0 (legacy)
 * - meanCenter: subtract catalog mean (count >= 50)
 * - multiPersona: Spherical K-Means mixture + top3Loved
 * - catalogMaxNorm: normalize positive scores by catalog max (count >= 50)
 */
function buildAblatedContentSimMap(weightedRatings, rawContentIndex, options = {}) {
  const map = new Map();
  if (!rawContentIndex || !rawContentIndex.count || !Array.isArray(weightedRatings) || weightedRatings.length === 0) {
    return map;
  }
  const weightCutoff = getRelativeWeightCutoff(weightedRatings);
  if (weightCutoff === null) return map;

  const contentIndex = options.meanCenter ? options.centeredIndex || buildMeanCenteredIndex(rawContentIndex) : rawContentIndex;
  const minPositiveRating = options.minPositiveRating ?? 7;
  const { count, dim, ids, vectors, idToIndex } = contentIndex;

  if (!options.multiPersona) {
    const accum = new Float32Array(dim);
    let matched = 0;
    for (const entry of weightedRatings) {
      const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
      const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
      if (!Number.isFinite(weight) || weight <= weightCutoff) continue;
      if (Number.isFinite(rating) && rating < minPositiveRating) continue;
      const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
      const idx = tmdbId ? idToIndex.get(tmdbId) : undefined;
      if (idx === undefined) continue;
      const base = idx * dim;
      for (let d = 0; d < dim; d++) accum[d] += weight * vectors[base + d];
      matched++;
    }
    if (matched === 0) return map;
    if (l2NormalizeInPlace(accum, 0, dim) <= 1e-12) return map;

    for (let i = 0; i < count; i++) {
      const base = i * dim;
      let dot = 0;
      let normSq = 0;
      for (let d = 0; d < dim; d++) {
        const val = vectors[base + d];
        dot += accum[d] * val;
        normSq += val * val;
      }
      if (normSq > 1e-12) map.set(ids[i], dot / Math.sqrt(normSq));
    }
  } else {
    const { centroids: personas, masses: personaMasses } = computePersonaDetails(weightedRatings, contentIndex, {
      minPositiveRating,
      splitThreshold: options.splitThreshold ?? 0.25,
      k: options.k
    });
    if (personas.length === 0) return map;

    const beta = Math.max(0.1, Number(options.personaBeta ?? 20));
    const logMasses = personas.length > 1 ? personaMasses.map((m) => Math.log(Math.max(1e-6, m))) : null;
    const personaDots = logMasses ? new Float64Array(personas.length) : null;
    const personaBlend = options.personaBlend ?? (personas.length === 1 ? 1.0 : 0.70);

    const loved = [];
    for (const entry of weightedRatings) {
      const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
      const weight = Number(entry?.weight ?? entry?.finalWeight ?? 0);
      const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
      if (!tmdbId || !Number.isFinite(weight) || weight <= weightCutoff) continue;
      if (Number.isFinite(rating) && rating < minPositiveRating) continue;
      const idx = idToIndex.get(tmdbId);
      if (idx === undefined) continue;
      loved.push({ weight, idx });
    }
    loved.sort((a, b) => b.weight - a.weight);
    const topLovedPool = loved.slice(0, 25);
    const L = topLovedPool.length;
    const lVecs = new Float32Array(L * dim);
    const lWeights = new Float32Array(L);
    for (let j = 0; j < L; j++) {
      const lBase = topLovedPool[j].idx * dim;
      lVecs.set(vectors.subarray(lBase, lBase + dim), j * dim);
      lWeights[j] = topLovedPool[j].weight;
    }

    for (let i = 0; i < count; i++) {
      const base = i * dim;
      let bestPersonaSim = -Infinity;
      if (logMasses) {
        let maxLogit = -Infinity;
        for (let k = 0; k < personas.length; k++) {
          const p = personas[k];
          let dot = 0;
          for (let d = 0; d < dim; d++) dot += p[d] * vectors[base + d];
          const logit = beta * dot + logMasses[k];
          personaDots[k] = logit;
          if (logit > maxLogit) maxLogit = logit;
        }
        let sumExp = 0;
        for (let k = 0; k < personas.length; k++) sumExp += Math.exp(personaDots[k] - maxLogit);
        bestPersonaSim = (maxLogit + Math.log(sumExp)) / beta;
      } else {
        for (const p of personas) {
          let dot = 0;
          for (let d = 0; d < dim; d++) dot += p[d] * vectors[base + d];
          if (dot > bestPersonaSim) bestPersonaSim = dot;
        }
      }

      let score = bestPersonaSim;
      if (L > 1 && personaBlend < 1) {
        let s1 = -Infinity, w1 = 0, s2 = -Infinity, w2 = 0, s3 = -Infinity, w3 = 0;
        for (let j = 0; j < L; j++) {
          const lBase = j * dim;
          let dot = 0;
          for (let d = 0; d < dim; d++) dot += lVecs[lBase + d] * vectors[base + d];
          const w = lWeights[j];
          if (dot > s1) { s3 = s2; w3 = w2; s2 = s1; w2 = w1; s1 = dot; w1 = w; }
          else if (dot > s2) { s3 = s2; w3 = w2; s2 = dot; w2 = w; }
          else if (dot > s3) { s3 = dot; w3 = w; }
        }
        let wSum = w1;
        let wSim = w1 * s1;
        if (s2 > -Infinity) { wSum += w2; wSim += w2 * s2; }
        if (s3 > -Infinity) { wSum += w3; wSim += w3 * s3; }
        const topLovedSim = wSum > 0 ? wSim / wSum : bestPersonaSim;
        score = personaBlend * bestPersonaSim + (1 - personaBlend) * topLovedSim;
      }
      map.set(ids[i], score);
    }
  }

  if (options.catalogMaxNorm && count >= 50) {
    const cMax = getCollabCatalogMax(map, 50);
    if (cMax !== null && cMax > 0.05) {
      for (const [id, val] of map.entries()) {
        map.set(id, Math.max(-1, Math.min(1, val / cMax)));
      }
    }
  }

  return map;
}

/**
 * Cross-space 64-D Ridge scoring: user personas / query vector in clean2 SVD space
 * scored against strictly out-of-fold (OOF) projected 64-D candidate vectors.
 */
function buildCrossSpaceSvdToOOfMap(weightedRatings, svdIdx, projOOfIdx, options = {}) {
  const map = new Map();
  if (!svdIdx || !projOOfIdx || svdIdx.dim !== projOOfIdx.dim) return map;

  // Build user query centroids in clean2 SVD space (same persona math, candidate vectors from OOF projector!)
  const { centroids: personas, masses: personaMasses } = computePersonaDetails(weightedRatings, svdIdx, {
    minPositiveRating: 7,
    splitThreshold: options.splitThreshold ?? 0.05
  });
  if (personas.length === 0) return map;

  const { count, dim, ids, vectors } = projOOfIdx;
  const beta = 20;
  const logMasses = personas.length > 1 ? personaMasses.map((m) => Math.log(Math.max(1e-6, m))) : null;
  const personaDots = logMasses ? new Float64Array(personas.length) : null;

  for (let i = 0; i < count; i++) {
    const base = i * dim;
    let bestSim = -Infinity;
    if (logMasses) {
      let maxLogit = -Infinity;
      for (let k = 0; k < personas.length; k++) {
        const p = personas[k];
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += p[d] * vectors[base + d];
        const logit = beta * dot + logMasses[k];
        personaDots[k] = logit;
        if (logit > maxLogit) maxLogit = logit;
      }
      let sumExp = 0;
      for (let k = 0; k < personas.length; k++) sumExp += Math.exp(personaDots[k] - maxLogit);
      bestSim = (maxLogit + Math.log(sumExp)) / beta;
    } else {
      for (const p of personas) {
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += p[d] * vectors[base + d];
        if (dot > bestSim) bestSim = dot;
      }
    }
    map.set(ids[i], bestSim);
  }

  if (options.catalogMaxNorm && count >= 50) {
    const cMax = getCollabCatalogMax(map, 50);
    if (cMax !== null && cMax > 0.05) {
      for (const [id, val] of map.entries()) {
        map.set(id, Math.max(-1, Math.min(1, val / cMax)));
      }
    }
  }
  return map;
}

function evaluateColdUsers(users, { catalogById, top200PopSet }, buildMapFn) {
  const n = users.length;
  const ndcg10 = new Array(n);
  const ndcg20 = new Array(n);
  const hits20 = new Array(n);
  const tail20 = new Array(n);
  const hr20 = new Array(n);
  const hr100 = new Array(n);
  const covSet = new Set();
  let vSum = 0;
  let vCnt = 0;
  let msSum = 0;
  const emptyMap = new Map();

  for (let i = 0; i < n; i++) {
    const u = users[i];
    const t0 = performance.now();
    const contentSimMap = buildMapFn(u);
    msSum += performance.now() - t0;

    const ranked = rankCandidatePool(
      u.pool,
      { profile: u.profile, collabSimMap: emptyMap, contentSimMap, repulsionMap: emptyMap },
      DEFAULT_RANKER_WEIGHTS,
      100,
      { metadataDampingFactor: DEFAULT_METADATA_DAMPING_FACTOR }
    );
    const ids = ranked.map((r) => String(r.tmdbId));
    ndcg10[i] = computeNDCGAtK(ids, u.holdoutRelevance, 10);
    ndcg20[i] = computeNDCGAtK(ids, u.holdoutRelevance, 20);

    let h20 = 0, t20 = 0, h100 = 0;
    for (let k = 0; k < ids.length; k++) {
      if (k < 20) {
        covSet.add(ids[k]);
        vSum += Number(catalogById.get(Number(ids[k]))?.vote_count || 0);
        vCnt++;
      }
      if (u.holdoutPositives.has(ids[k])) {
        if (k < 20) {
          h20++;
          if (!top200PopSet.has(ids[k])) t20++;
        }
        if (k < 100) h100++;
      }
    }
    hits20[i] = h20;
    tail20[i] = t20;
    hr20[i] = h20 > 0 ? 1 : 0;
    hr100[i] = h100 > 0 ? 1 : 0;
  }

  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
  return {
    perUser: { ndcg10, ndcg20, tail20, hits20 },
    summary: {
      n,
      ndcg10: Number(mean(ndcg10).toFixed(4)),
      ndcg20: Number(mean(ndcg20).toFixed(4)),
      hits20: Number(mean(hits20).toFixed(3)),
      tail20: Number(mean(tail20).toFixed(3)),
      hr20: Number((mean(hr20) * 100).toFixed(1)),
      hr100: Number((mean(hr100) * 100).toFixed(1)),
      cov: covSet.size,
      avgV: Math.round(vSum / Math.max(1, vCnt)),
      msPerUser: Number((msSum / Math.max(1, n)).toFixed(2))
    }
  };
}

function fmtPctDelta(cand, base, boot) {
  const d = (cand / Math.max(1e-9, base) - 1) * 100;
  const sig = boot.positiveSig ? "*+" : boot.negativeSig ? "*-" : "  ";
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}% [${boot.ciLower >= 0 ? "+" : ""}${boot.ciLower.toFixed(4)},${boot.ciUpper >= 0 ? "+" : ""}${boot.ciUpper.toFixed(4)}]${sig}`;
}

function formatRow(label, res, base = null) {
  const s = res.summary;
  if (!base) {
    return `${label.padEnd(36)} NDCG10=${s.ndcg10.toFixed(4)} | NDCG20=${s.ndcg20.toFixed(4)} | Hits20=${s.hits20.toFixed(3)} | Tail20=${s.tail20.toFixed(3)} | HR20=${s.hr20}% | HR100=${s.hr100}% | Cov=${String(s.cov).padStart(4)} | AvgV=${s.avgV} | ${s.msPerUser}ms`;
  }
  const b10 = pairedBootstrap(res.perUser.ndcg10, base.perUser.ndcg10, 42, 1000);
  const b20 = pairedBootstrap(res.perUser.ndcg20, base.perUser.ndcg20, 42, 1000);
  return `${label.padEnd(36)} NDCG10=${s.ndcg10.toFixed(4)} (${fmtPctDelta(s.ndcg10, base.summary.ndcg10, b10)}) | NDCG20=${s.ndcg20.toFixed(4)} (${fmtPctDelta(s.ndcg20, base.summary.ndcg20, b20)}) | Hits20=${s.hits20.toFixed(3)} | HR20=${s.hr20}% | HR100=${s.hr100}% | Cov=${s.cov} | ${s.msPerUser}ms`;
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  console.log("Loading clean 300-user cohort (100%-cold simulation, collabSim=0 on all candidates)...");
  const cohort = await loadCleanCohort(opts.svd, 300);
  const devUsers = cohort.users.slice(0, 150);
  const valUsers = cohort.users.slice(150);

  const prodContent = loadCvemIndex(opts.content);
  const refContent = loadCvemIndex(opts.refContent);
  const projContent = loadCvemIndex(opts.proj);

  const prodCentered = prodContent ? buildMeanCenteredIndex(prodContent.idx) : null;
  const refCentered = refContent ? buildMeanCenteredIndex(refContent.idx) : null;
  const projCentered = projContent ? buildMeanCenteredIndex(projContent.idx) : null;

  console.log(`Content binary: ${opts.content} (${prodContent?.idx.count} x ${prodContent?.idx.dim}, ${prodContent?.sizeMb.toFixed(2)} MB)`);
  if (refContent) console.log(`Ref binary:     ${opts.refContent} (${refContent.idx.count} x ${refContent.idx.dim}, ${refContent.sizeMb.toFixed(2)} MB)`);
  if (projContent) console.log(`OOF Proj-64D:   ${opts.proj} (${projContent.idx.count} x ${projContent.idx.dim}, ${projContent.sizeMb.toFixed(2)} MB)`);

  const buildConfigs = (cWrap, cCentered, prefix) => [
    {
      name: `${prefix}:v6.1_single_mean`,
      extraMb: 0,
      build: (u) => buildContentSimMap(u.profile.weightedRatings, cWrap.idx, u.pool, { collabIndex: null, collabSimMap: new Map(), enableStructuredFallback: false, coldOnly: true })
    },
    {
      name: `${prefix}:guard7_only`,
      extraMb: 0,
      build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, cWrap.idx, { minPositiveRating: 7, meanCenter: false, multiPersona: false, catalogMaxNorm: false })
    },
    {
      name: `${prefix}:guard7+center`,
      extraMb: 0,
      build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, cWrap.idx, { centeredIndex: cCentered, minPositiveRating: 7, meanCenter: true, multiPersona: false, catalogMaxNorm: false })
    },
    {
      name: `${prefix}:guard7+catmax`,
      extraMb: 0,
      build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, cWrap.idx, { minPositiveRating: 7, meanCenter: false, multiPersona: false, catalogMaxNorm: true })
    },
    {
      name: `${prefix}:guard7+center+catmax`,
      extraMb: 0,
      build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, cWrap.idx, { centeredIndex: cCentered, minPositiveRating: 7, meanCenter: true, multiPersona: false, catalogMaxNorm: true })
    },
    {
      name: `${prefix}:guard7+multiP(s0.20)`,
      extraMb: 0,
      build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, cWrap.idx, { minPositiveRating: 7, meanCenter: false, multiPersona: true, splitThreshold: 0.20, personaBlend: 0.70, catalogMaxNorm: false })
    },
    {
      name: `${prefix}:guard7+center+multiP(s0.20,pB1.0)`,
      extraMb: 0,
      build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, cWrap.idx, { centeredIndex: cCentered, minPositiveRating: 7, meanCenter: true, multiPersona: true, splitThreshold: 0.20, personaBlend: 1.0, catalogMaxNorm: false })
    },
    {
      name: `${prefix}:guard7+center+multiP(s0.20)+catmax`,
      extraMb: 0,
      build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, cWrap.idx, { centeredIndex: cCentered, minPositiveRating: 7, meanCenter: true, multiPersona: true, splitThreshold: 0.20, personaBlend: 0.70, catalogMaxNorm: true })
    },
    {
      name: `${prefix}:guard7+center+multiP(s0.15)+catmax`,
      extraMb: 0,
      build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, cWrap.idx, { centeredIndex: cCentered, minPositiveRating: 7, meanCenter: true, multiPersona: true, splitThreshold: 0.15, personaBlend: 0.70, catalogMaxNorm: true })
    },
    {
      name: `${prefix}:guard7+center+multiP(s0.25)+catmax`,
      extraMb: 0,
      build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, cWrap.idx, { centeredIndex: cCentered, minPositiveRating: 7, meanCenter: true, multiPersona: true, splitThreshold: 0.25, personaBlend: 0.70, catalogMaxNorm: true })
    }
  ];

  const allConfigs = [];
  if (!opts.skipLexical) {
    allConfigs.push({
      name: "lexical_tfidf_0MB",
      extraMb: 0,
      build: (u) => buildContentSimMap(u.profile.weightedRatings, null, u.pool, { collabIndex: null, collabSimMap: new Map(), enableStructuredFallback: true, coldOnly: true })
    });
  }
  if (prodContent) allConfigs.push(...buildConfigs(prodContent, prodCentered, "prod11k"));
  if (refContent) {
    allConfigs.push({
      name: "ref9.6k:v6.1_single_mean",
      extraMb: 0,
      build: (u) => buildContentSimMap(u.profile.weightedRatings, refContent.idx, u.pool, { collabIndex: null, collabSimMap: new Map(), enableStructuredFallback: false, coldOnly: true })
    });
  }
  if (projContent) {
    const projSizeMb = projContent.sizeMb;
    allConfigs.push(
      {
        name: "proj64_oof:single_mean",
        extraMb: projSizeMb,
        build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, projContent.idx, { minPositiveRating: 7, meanCenter: false, multiPersona: false, catalogMaxNorm: false })
      },
      {
        name: "proj64_oof:center+multiP+catmax",
        extraMb: projSizeMb,
        build: (u) => buildAblatedContentSimMap(u.profile.weightedRatings, projContent.idx, { centeredIndex: projCentered, minPositiveRating: 7, meanCenter: true, multiPersona: true, splitThreshold: 0.15, personaBlend: 0.70, catalogMaxNorm: true })
      },
      {
        name: "proj64_oof:cross_svd_to_oof",
        extraMb: projSizeMb,
        build: (u) => buildCrossSpaceSvdToOOfMap(u.profile.weightedRatings, cohort.svdIdx, projContent.idx, { splitThreshold: 0.05, catalogMaxNorm: false })
      },
      {
        name: "proj64_oof:cross_svd_to_oof_catmax",
        extraMb: projSizeMb,
        build: (u) => buildCrossSpaceSvdToOOfMap(u.profile.weightedRatings, cohort.svdIdx, projContent.idx, { splitThreshold: 0.05, catalogMaxNorm: true })
      }
    );
    if (prodContent) {
      allConfigs.push({
        name: "hybrid:prod11k_50+cross_oof_50",
        extraMb: projSizeMb,
        build: (u) => {
          const m1 = buildAblatedContentSimMap(u.profile.weightedRatings, prodContent.idx, { minPositiveRating: 7, meanCenter: false, multiPersona: false, catalogMaxNorm: true });
          const m2 = buildCrossSpaceSvdToOOfMap(u.profile.weightedRatings, cohort.svdIdx, projContent.idx, { splitThreshold: 0.05, catalogMaxNorm: true });
          const out = new Map();
          for (const [id, v1] of m1.entries()) {
            const v2 = m2.get(id) ?? 0;
            out.set(id, 0.5 * v1 + 0.5 * v2);
          }
          return out;
        }
      });
    }
  }

  console.log("\n=== DEV-150 COLD-START BENCHMARK ===");
  const devResults = new Map();
  let devProdBase = null;
  for (const cfg of allConfigs) {
    const res = evaluateColdUsers(devUsers, cohort, cfg.build);
    devResults.set(cfg.name, res);
    if (cfg.name === "prod11k:v6.1_single_mean") devProdBase = res;
    console.log("[DEV-150]    ", formatRow(cfg.name, res, cfg.name === "prod11k:v6.1_single_mean" ? null : devProdBase));
  }

  // Select top 0-extra-MB prod11k upgrade + top proj64_oof candidate from DEV-150
  const zeroMbCands = allConfigs.filter((c) => c.name.startsWith("prod11k:") && c.name !== "prod11k:v6.1_single_mean");
  zeroMbCands.sort((a, b) => {
    const ra = devResults.get(a.name).summary;
    const rb = devResults.get(b.name).summary;
    return (rb.ndcg20 + 0.5 * rb.ndcg10) - (ra.ndcg20 + 0.5 * ra.ndcg10);
  });

  const projCands = allConfigs.filter((c) => c.name.startsWith("proj64_oof:") || c.name.startsWith("hybrid:"));
  projCands.sort((a, b) => {
    const ra = devResults.get(a.name).summary;
    const rb = devResults.get(b.name).summary;
    return (rb.ndcg20 + 0.5 * rb.ndcg10) - (ra.ndcg20 + 0.5 * ra.ndcg10);
  });

  const holdoutSet = [
    ...(opts.skipLexical ? [] : [allConfigs.find((c) => c.name === "lexical_tfidf_0MB")]),
    allConfigs.find((c) => c.name === "prod11k:v6.1_single_mean"),
    allConfigs.find((c) => c.name === "ref9.6k:v6.1_single_mean"),
    ...zeroMbCands.slice(0, 2),
    ...projCands.slice(0, 2)
  ].filter(Boolean);

  // Also test matching ref9.6k config if top zeroMbCand exists
  if (zeroMbCands[0] && refContent) {
    const refMatchName = zeroMbCands[0].name.replace("prod11k:", "ref9.6k:");
    const refCfg = allConfigs.find((c) => c.name === refMatchName);
    if (refCfg && !holdoutSet.includes(refCfg)) holdoutSet.push(refCfg);
  }

  console.log("\n=== UNTOUCHED HOLDOUT-150 COLD-START GATE ===");
  const valResults = new Map();
  let valProdBase = null;
  let valRefBase = null;
  for (const cfg of holdoutSet) {
    const res = evaluateColdUsers(valUsers, cohort, cfg.build);
    valResults.set(cfg.name, res);
    if (cfg.name === "prod11k:v6.1_single_mean") valProdBase = res;
    if (cfg.name === "ref9.6k:v6.1_single_mean") valRefBase = res;
  }

  for (const cfg of holdoutSet) {
    const res = valResults.get(cfg.name);
    const base = cfg.name.startsWith("ref9.6k:") ? valRefBase : valProdBase;
    console.log("[HOLDOUT-150]", formatRow(cfg.name, res, cfg.name === "prod11k:v6.1_single_mean" || cfg.name === "ref9.6k:v6.1_single_mean" ? null : base));
  }

  console.log("\n=== GATE SUMMARY ON HOLDOUT-150 (vs prod11k:v6.1_single_mean) ===");
  for (const cfg of holdoutSet) {
    if (cfg.name === "prod11k:v6.1_single_mean" || cfg.name === "lexical_tfidf_0MB" || cfg.name === "ref9.6k:v6.1_single_mean") continue;
    const res = valResults.get(cfg.name);
    const base = cfg.name.startsWith("ref9.6k:") ? valRefBase : valProdBase;
    const b10 = pairedBootstrap(res.perUser.ndcg10, base.perUser.ndcg10, 42, 1000);
    const b20 = pairedBootstrap(res.perUser.ndcg20, base.perUser.ndcg20, 42, 1000);
    const d20Pct = (res.summary.ndcg20 / Math.max(1e-9, base.summary.ndcg20) - 1) * 100;
    const d10Pct = (res.summary.ndcg10 / Math.max(1e-9, base.summary.ndcg10) - 1) * 100;
    const sizePass = cfg.extraMb <= 0 ? true : (d20Pct >= 2.0 * cfg.extraMb);
    const sigPass = (b20.positiveSig && !b10.negativeSig) || (b10.positiveSig && !b20.negativeSig);
    console.log(
      `${cfg.name.padEnd(36)} | extraMB=${cfg.extraMb.toFixed(2)} | d10=${d10Pct.toFixed(2)}% (ciLo=${b10.ciLower.toFixed(4)}) | d20=${d20Pct.toFixed(2)}% (ciLo=${b20.ciLower.toFixed(4)}) | sig=${sigPass} | sizeGate=${sizePass} | VERDICT=${sigPass && sizePass ? "PASS" : "FAIL"}`
    );
  }
}

main();
