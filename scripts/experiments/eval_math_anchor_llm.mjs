#!/usr/bin/env node
/**
 * Task 7: n = 50 Leakage-Clean LLM Holdout Benchmark (`100 -> 20` vs. `100 -> 25 Over-Pitch -> 20 Logit Fusion + ProtectTop-2 + Kernel MMR`)
 *
 * Evaluates on 50 completely unseen Holdout-150 MovieLens 32M users (`users[150..299]`, evenly spaced):
 *   - Pure Math Top-20 (ceiling reference)
 *   - Control A (100 -> 20): Production unbiased prompt + discrete-diversity shortlist + mergeGeminiExplanationsWithRanker
 *   - Control A + ProtectTop-2 (post-hoc reference on Control A's 20 picks)
 *   - Treatment (Kernel MMR + 100 -> 25 Over-Pitch -> 20 Logit Fusion + ProtectTop-2):
 *       1) Kernel MMR outlier selection over normalized SVD-64 warm + MiniLM-128D cold cosine similarity
 *       2) Unbiased prompt asking Gemini for 25 curated picks + 2-sentence pitches (zero score/rank tags)
 *       3) Post-hoc Logit Fusion (`rankerLogit + alpha * geminiOrderBonus`) + ProtectTop-2 (`"any"` vibe only),
 *          preserving Gemini-authored pitches & anchorTitles while enforcing maxPerDirector: 2, maxPerCollection: 1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  loadCleanCohort,
  loadEaseIndexFromPath,
  pairedBootstrap
} = await imp("scripts/experiments/v6_gate_eval.mjs");
const {
  parseEmbeddingBinary
} = await imp("src/services/embeddingService.js");
const {
  buildEaseSimMapFromIndex,
  blendEaseAndCollabSimMaps
} = await imp("src/services/easeService.js");
const {
  rankCandidatePool,
  buildDiversifiedGeminiShortlist,
  DEFAULT_RANKER_WEIGHTS,
  DEFAULT_SHORTLIST_DIVERSITY_CONFIG
} = await imp("src/services/rankerService.js");
const {
  buildGeminiReRankPrompt,
  mergeGeminiExplanationsWithRanker,
  getModelThinkingConfig,
  sanitizeAndParseJSON
} = await imp("src/services/geminiService.js");
const {
  compileActiveTasteRules,
  candidateMatchesAvoidRule
} = await imp("src/services/tasteRulesService.js");
const { computeNDCGAtK } = await imp("src/services/evalHarness.js");

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCvemIndex(relPath) {
  if (!relPath) return null;
  const fullPath = path.isAbsolute(relPath) ? relPath : path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return null;
  const buf = fs.readFileSync(fullPath);
  return parseEmbeddingBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function buildSchema() {
  return {
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        tasteProfile: {
          type: Type.OBJECT,
          properties: {
            favoriteGenres: { type: Type.ARRAY, items: { type: Type.STRING } },
            preferredEra: { type: Type.STRING },
            ratingStyle: { type: Type.STRING }
          },
          required: ["favoriteGenres", "preferredEra", "ratingStyle"]
        },
        recommendations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              tmdbId: { type: Type.NUMBER },
              title: { type: Type.STRING },
              year: { type: Type.STRING },
              anchorTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
              reason: { type: Type.STRING }
            },
            required: ["tmdbId", "title", "year", "reason"]
          }
        }
      },
      required: ["tasteProfile", "recommendations"]
    }
  };
}

// ---------- Kernel MMR Shortlist Prototype ----------

function getNormalizedEmbedding(index, tmdbId, cache) {
  const numId = Number(tmdbId);
  if (!index?.idToIndex || !index?.vectors || !index?.dim || !Number.isFinite(numId)) return null;
  if (cache.has(numId)) return cache.get(numId);
  const row = index.idToIndex.get(numId);
  if (row === undefined) {
    cache.set(numId, null);
    return null;
  }
  const dim = index.dim;
  const base = row * dim;
  let normSq = 0;
  for (let d = 0; d < dim; d++) {
    const v = index.vectors[base + d];
    normSq += v * v;
  }
  if (normSq <= 1e-12) {
    cache.set(numId, null);
    return null;
  }
  const inv = 1 / Math.sqrt(normSq);
  const unit = new Float32Array(dim);
  for (let d = 0; d < dim; d++) unit[d] = index.vectors[base + d] * inv;
  cache.set(numId, unit);
  return unit;
}

function dotFloat32(a, b) {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

function extractMetaFeatures(c = {}) {
  const dir = String(c?.director || "").trim().toLowerCase();
  const cleanDir = dir && dir !== "unknown" && dir !== "n/a" ? dir : "";
  const genreIds = Array.isArray(c?.tmdbGenreIds) && c.tmdbGenreIds.length > 0
    ? c.tmdbGenreIds.map(Number).filter(Number.isFinite)
    : Array.isArray(c?.genre_ids)
      ? c.genre_ids.map(Number).filter(Number.isFinite)
      : [];
  const yrMatch = String(c?.release_date || c?.year || "").match(/\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/);
  const decade = yrMatch ? Math.floor(Number(yrMatch[1]) / 10) * 10 : null;
  return { dir: cleanDir, genres: new Set(genreIds), decade };
}

function metaKernelSim(metaA, metaB) {
  const dirSim = metaA.dir && metaB.dir && metaA.dir === metaB.dir ? 1 : 0;
  let inter = 0;
  for (const g of metaA.genres) if (metaB.genres.has(g)) inter++;
  const union = metaA.genres.size + metaB.genres.size - inter;
  const genreSim = union > 0 ? inter / union : 0;
  const decadeSim = metaA.decade !== null && metaB.decade !== null && metaA.decade === metaB.decade ? 1 : 0;
  return 0.45 * dirSim + 0.35 * genreSim + 0.20 * decadeSim;
}

function buildKernelMmrShortlist(
  candidates = [],
  context = {},
  weights = DEFAULT_RANKER_WEIGHTS,
  options = {},
  reserve = undefined
) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const cfg = { ...DEFAULT_SHORTLIST_DIVERSITY_CONFIG, ...(options || {}) };
  const shortlistLimit = Math.max(1, Math.floor(Number(options?.shortlistLimit ?? cfg.shortlistLimit) || 100));
  const coreLimit = Math.min(Math.max(1, Number(cfg.coreLimit) || 72), shortlistLimit);
  const coldLimit = Math.max(0, Number(cfg.coldLimit) || 14);
  const outlierLimit = Math.max(0, Number(cfg.outlierLimit) || 14);
  const mmrLambda = Number.isFinite(Number(options?.mmrLambda)) ? Number(options.mmrLambda) : 0.65;

  const coreRanked = rankCandidatePool(candidates, context, weights, coreLimit, options, reserve);
  const fullRanked = rankCandidatePool(
    candidates,
    context,
    weights,
    candidates.length,
    { ...(options || {}), onDiagnostics: undefined },
    null
  );
  if (fullRanked.length === 0) return [];

  const getKey = (c) => String(c?.tmdbId ?? c?.id ?? c?.title ?? "");
  const selected = [...coreRanked];
  const selectedKeys = new Set(selected.map(getKey));
  const isCold = (c) => Number(c?.features?.rawCollabSim ?? c?.collabSim ?? 0) === 0;
  const passesQuality = (c, minRating = cfg.minColdVoteAverage) => {
    const r = Number(c?.vote_average ?? c?.imdbRating);
    if (Number.isFinite(r) && r < minRating) return false;
    const v = Number(c?.vote_count ?? 0);
    if (Number.isFinite(v) && v > 0 && v < cfg.minColdVoteCount) return false;
    return true;
  };
  const { avoidRules } = Array.isArray(context?.tasteRules) && context.tasteRules.length > 0
    ? compileActiveTasteRules(context.tasteRules)
    : { avoidRules: [] };
  const passesAvoid = (c) => avoidRules.length === 0 || !candidateMatchesAvoidRule(c, avoidRules).matched;

  // Slice 2: Quality Cold 2024-2026
  const coldCap = Math.min(coldLimit, Math.max(0, shortlistLimit - selected.length));
  if (coldCap > 0) {
    const remainingCold = fullRanked.filter(
      (c) => !selectedKeys.has(getKey(c)) && isCold(c) && passesQuality(c, cfg.minColdVoteAverage) && passesAvoid(c)
    );
    const recentCold = [];
    const olderCold = [];
    for (const c of remainingCold) {
      const yr = Number(String(c?.release_date || c?.year || "").slice(0, 4));
      if (Number.isFinite(yr) && yr >= cfg.coldMinYear && yr <= cfg.coldMaxYear) recentCold.push(c);
      else olderCold.push(c);
    }
    for (const pick of [...recentCold, ...olderCold].slice(0, coldCap)) {
      selected.push(pick);
      selectedKeys.add(getKey(pick));
    }
  }

  // Slice 3: Kernel MMR Outliers (normalized SVD-64 warm + MiniLM-128D cold cosine similarity)
  const outlierCap = Math.min(outlierLimit, Math.max(0, shortlistLimit - selected.length));
  if (outlierCap > 0) {
    const poolCap = Math.max(outlierCap * 30, 450);
    const candidateOutliers = [];
    for (const c of fullRanked) {
      if (selectedKeys.has(getKey(c)) || !passesAvoid(c)) continue;
      const r = Number(c?.vote_average ?? c?.imdbRating);
      if (Number.isFinite(r) && r < 6.5) continue;
      if (isCold(c) && !passesQuality(c, 6.5)) continue;
      candidateOutliers.push(c);
      if (candidateOutliers.length >= poolCap) break;
    }

    const svdIdx = context?.embeddingIndex || null;
    const contentIdx = context?.contentIndex || null;
    const svdCache = new Map();
    const contentCache = new Map();

    const prepItem = (c) => {
      const id = Number(c?.tmdbId ?? c?.id);
      return {
        svd: getNormalizedEmbedding(svdIdx, id, svdCache),
        content: getNormalizedEmbedding(contentIdx, id, contentCache),
        meta: extractMetaFeatures(c)
      };
    };
    const kernelSim = (pA, pB) => {
      if (pA.svd && pB.svd) return Math.max(0, dotFloat32(pA.svd, pB.svd));
      if (pA.content && pB.content) return Math.max(0, dotFloat32(pA.content, pB.content));
      return metaKernelSim(pA.meta, pB.meta);
    };

    const selPrepped = selected.map(prepItem);
    const candPrepped = candidateOutliers.map(prepItem);
    const maxSim = new Float32Array(candidateOutliers.length);
    for (let i = 0; i < candidateOutliers.length; i++) {
      let bestS = 0;
      const pI = candPrepped[i];
      for (let j = 0; j < selPrepped.length; j++) {
        const s = kernelSim(pI, selPrepped[j]);
        if (s > bestS) bestS = s;
      }
      maxSim[i] = bestS;
    }

    const chosen = new Uint8Array(candidateOutliers.length);
    for (let step = 0; step < outlierCap; step++) {
      let bestIdx = -1;
      let bestMmr = -Infinity;
      let bestProb = -Infinity;
      for (let i = 0; i < candidateOutliers.length; i++) {
        if (chosen[i]) continue;
        const prob = Number(candidateOutliers[i]?.rankerProbability ?? 0);
        const mmr = mmrLambda * prob - (1 - mmrLambda) * maxSim[i];
        if (mmr > bestMmr || (mmr === bestMmr && prob > bestProb)) {
          bestMmr = mmr;
          bestProb = prob;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;
      chosen[bestIdx] = 1;
      const winner = candidateOutliers[bestIdx];
      selected.push(winner);
      selectedKeys.add(getKey(winner));
      const winPrepped = candPrepped[bestIdx];
      for (let i = 0; i < candidateOutliers.length; i++) {
        if (chosen[i]) continue;
        const s = kernelSim(candPrepped[i], winPrepped);
        if (s > maxSim[i]) maxSim[i] = s;
      }
    }
  }

  if (selected.length < Math.min(shortlistLimit, fullRanked.length)) {
    for (const c of fullRanked) {
      const k = getKey(c);
      if (selectedKeys.has(k) || !passesAvoid(c)) continue;
      selected.push(c);
      selectedKeys.add(k);
      if (selected.length >= shortlistLimit) break;
    }
  }

  return selected.slice(0, shortlistLimit);
}

// ---------- Post-hoc 25 -> 20 Logit Fusion + ProtectTop-2 Prototype ----------

const BOILERPLATE_RE = /^(Selected by your calibrated taste profile|Selected by the CinemaVault calibrated taste ranker|Pairs closely with your top-rated films)/i;

function getRankerLogit(cand = {}) {
  if (Number.isFinite(Number(cand?.rankerLogit))) return Number(cand.rankerLogit);
  const p = Number(cand?.rankerProbability);
  if (Number.isFinite(p) && p > 0 && p < 1) return Math.log(p / (1 - p));
  const ms = Number(cand?.matchScore ?? 72);
  return ((ms - 50) / 49) * 4 - 2;
}

function fuseOverPitchRecommendations(
  geminiResult,
  rankedCandidates = [],
  profile = {},
  {
    mood = "any",
    watched = [],
    tasteRules = [],
    targetCount = 20,
    protectTopK = 2,
    fusionAlpha = 0.8
  } = {}
) {
  const recs = Array.isArray(geminiResult?.recommendations) ? geminiResult.recommendations : [];
  const { avoidRules } = Array.isArray(tasteRules) && tasteRules.length > 0
    ? compileActiveTasteRules(tasteRules)
    : { avoidRules: [] };
  const passesAvoid = (c) => avoidRules.length === 0 || !candidateMatchesAvoidRule(c, avoidRules).matched;

  const byId = new Map();
  const byTitle = new Map();
  for (const c of rankedCandidates) {
    const id = Number(c?.tmdbId ?? c?.id);
    if (Number.isFinite(id) && !byId.has(id)) byId.set(id, c);
    const t = String(c?.title || "").trim().toLowerCase();
    if (t && !byTitle.has(t)) byTitle.set(t, c);
  }

  const geminiPickById = new Map();
  const geminiMatchedList = [];
  const totalGemini = Math.max(1, recs.length);
  for (let idx = 0; idx < recs.length; idx++) {
    const rec = recs[idx];
    const cand = byId.get(Number(rec?.tmdbId)) || byTitle.get(String(rec?.title || "").trim().toLowerCase());
    if (!cand || !passesAvoid(cand)) continue;
    const cid = Number(cand.tmdbId ?? cand.id);
    if (geminiPickById.has(cid)) continue;

    const orderBonus = (totalGemini - idx) / totalGemini;
    const logit = getRankerLogit(cand);
    const fusionScore = logit + fusionAlpha * orderBonus;
    const hasReason = typeof rec?.reason === "string" && rec.reason.trim().length >= 10;
    const item = {
      ...cand,
      reason: hasReason ? rec.reason.trim() : "Selected by your calibrated taste profile and current mood filter.",
      anchorTitles: Array.isArray(rec?.anchorTitles) ? rec.anchorTitles : [],
      _fusionScore: fusionScore,
      _hasGeminiPitch: hasReason,
      _geminiIdx: idx
    };
    geminiPickById.set(cid, item);
    geminiMatchedList.push(item);
  }

  // Sort non-protected Gemini picks by fusionScore descending
  const fusedSorted = [...geminiMatchedList].sort(
    (a, b) => b._fusionScore - a._fusionScore || a._geminiIdx - b._geminiIdx
  );

  // Protected top-K math picks under "any" vibe only (reusing Gemini's pitch if present in the 25)
  const effectiveProtect = mood === "any" ? Math.max(0, protectTopK) : 0;
  const protectedEntries = [];
  const placedIds = new Set();
  const sortedMath = [...rankedCandidates]
    .filter(passesAvoid)
    .sort((a, b) => getRankerLogit(b) - getRankerLogit(a));

  for (const cand of sortedMath) {
    if (protectedEntries.length >= effectiveProtect) break;
    const cid = Number(cand.tmdbId ?? cand.id);
    if (placedIds.has(cid)) continue;
    placedIds.add(cid);
    const geminiItem = geminiPickById.get(cid);
    if (geminiItem) {
      protectedEntries.push(geminiItem);
    } else {
      protectedEntries.push({
        ...cand,
        reason: "Selected by your calibrated taste profile and current mood filter.",
        anchorTitles: [],
        _fusionScore: getRankerLogit(cand),
        _hasGeminiPitch: false,
        _geminiIdx: null
      });
    }
  }

  const remainingFused = fusedSorted.filter((item) => !placedIds.has(Number(item.tmdbId ?? item.id)));
  for (const item of remainingFused) placedIds.add(Number(item.tmdbId ?? item.id));

  const backfill = sortedMath
    .filter((c) => !placedIds.has(Number(c.tmdbId ?? c.id)))
    .map((c) => ({
      ...c,
      reason: "Selected by your calibrated taste profile and current mood filter.",
      anchorTitles: [],
      _fusionScore: getRankerLogit(c),
      _hasGeminiPitch: false,
      _geminiIdx: null
    }));

  // Apply soft maxPerDirector: 2 and maxPerCollection: 1 (same rules as production)
  const pool = [...protectedEntries, ...remainingFused, ...backfill];
  const selected = [];
  const overflow = [];
  const dirCounts = new Map();
  const colCounts = new Map();
  for (const item of pool) {
    if (selected.length >= targetCount) break;
    const rawDir = String(item?.director || "").trim().toLowerCase();
    const dirKey = rawDir && rawDir !== "unknown" && rawDir !== "n/a" ? rawDir.replace(/\s+/g, " ") : "";
    const colId = Number(item?.collectionId ?? 0);
    const colKey = Number.isSafeInteger(colId) && colId > 0 ? String(colId) : "";
    const dc = dirKey ? (dirCounts.get(dirKey) || 0) : 0;
    const cc = colKey ? (colCounts.get(colKey) || 0) : 0;
    if ((dirKey && dc >= 2) || (colKey && cc >= 1)) {
      overflow.push(item);
      continue;
    }
    selected.push(item);
    if (dirKey) dirCounts.set(dirKey, dc + 1);
    if (colKey) colCounts.set(colKey, cc + 1);
  }
  for (const item of overflow) {
    if (selected.length >= targetCount) break;
    selected.push(item);
  }

  // Keep calibrated matchScore descending order, breaking ties by fusionScore
  selected.sort(
    (a, b) =>
      (b.matchScore ?? -1) - (a.matchScore ?? -1) ||
      (b._fusionScore ?? -Infinity) - (a._fusionScore ?? -Infinity)
  );
  return selected.slice(0, targetCount);
}

// ---------- Gemini API & Scoring Helpers ----------

async function callGeminiWithRetry(ai, model, contents, maxRetries = 3) {
  const thinkingConfig = getModelThinkingConfig(model, "curation");
  const config = { ...buildSchema(), ...(thinkingConfig ? { thinkingConfig } : {}) };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await ai.models.generateContent({ model, contents, config });
      return sanitizeAndParseJSON(res.text);
    } catch (err) {
      const msg = String(err?.message || err);
      if (attempt < maxRetries && /503|504|429|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|timeout/i.test(msg)) {
        const waitMs = /429|RESOURCE_EXHAUSTED/i.test(msg)
          ? Math.min(20000, 3000 * Math.pow(2, attempt))
          : 1500 * Math.pow(2, attempt);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

async function runPairedUserCalls(ai, primaryModel, fallbackModel, promptA, promptT, skipPrimary = false) {
  const modelsToTry = [];
  if (!skipPrimary) modelsToTry.push(primaryModel);
  if (fallbackModel && fallbackModel !== "none" && fallbackModel !== primaryModel) {
    modelsToTry.push(fallbackModel);
  }
  let lastErr = null;
  let primaryFailedTransient = false;
  for (const m of modelsToTry) {
    try {
      const resA = await callGeminiWithRetry(ai, m, promptA, m === primaryModel ? 1 : 3);
      await sleep(500);
      const resT = await callGeminiWithRetry(ai, m, promptT, m === primaryModel ? 1 : 3);
      await sleep(500);
      return { modelUsed: m, resA, resT, primaryFailedTransient };
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      if (m === primaryModel && /503|504|429|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|timeout/i.test(msg)) {
        primaryFailedTransient = true;
        continue;
      }
      if (/503|504|429|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|timeout/i.test(msg)) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function scoreRecs(recs, u, top200PopSet, catalogById) {
  const top20 = recs.slice(0, 20);
  const ids = top20.map((r) => String(r.tmdbId ?? r.id));
  const ndcg10 = computeNDCGAtK(ids, u.holdoutRelevance, 10);
  const ndcg20 = computeNDCGAtK(ids, u.holdoutRelevance, 20);
  let hits10 = 0, hits20 = 0, tail20 = 0, vSum = 0, boilerplateCount = 0;
  for (let k = 0; k < top20.length; k++) {
    const id = ids[k];
    vSum += Number(catalogById.get(Number(id))?.vote_count || 0);
    const reason = String(top20[k]?.reason || "");
    if (!reason || reason.length < 10 || BOILERPLATE_RE.test(reason) || top20[k]?._hasGeminiPitch === false) {
      boilerplateCount++;
    }
    if (u.holdoutPositives.has(id)) {
      if (k < 10) hits10++;
      if (k < 20) {
        hits20++;
        if (!top200PopSet.has(id)) tail20++;
      }
    }
  }
  return {
    ndcg10,
    ndcg20,
    hits10,
    hits20,
    tail20,
    hr20: hits20 > 0 ? 1 : 0,
    avgV: top20.length > 0 ? vSum / top20.length : 0,
    boilerplateCount,
    pickCount: top20.length,
    ids
  };
}

function compactRawRecs(raw) {
  return (Array.isArray(raw?.recommendations) ? raw.recommendations : []).map((r) => ({
    tmdbId: Number(r?.tmdbId),
    title: String(r?.title || ""),
    year: String(r?.year || ""),
    anchorTitles: Array.isArray(r?.anchorTitles) ? r.anchorTitles.slice(0, 3) : [],
    reason: String(r?.reason || "")
  }));
}

function buildCohortEnrichMap() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/tmdb_enriched.json"), "utf8"));
  const metaById = new Map();
  for (const [k, m] of Object.entries(raw.items || {})) {
    const id = Number(m?.tmdbId ?? m?.id ?? k);
    if (!id) continue;
    metaById.set(id, {
      director: m.director || "",
      genre: m.genre || "",
      popularity: Number(m.popularity ?? 0)
    });
  }
  return metaById;
}

function enrichUserMetadata(u, metaById) {
  const enrichItem = (item) => {
    const m = metaById.get(Number(item?.tmdbId ?? item?.id));
    if (!m) return item;
    return {
      ...item,
      director: item.director || m.director,
      genre: item.genre || m.genre,
      popularity: item.popularity ?? m.popularity
    };
  };
  const pool = u.pool.map(enrichItem);
  const weightedRatings = u.profile.weightedRatings.map((w) => ({
    ...w,
    movie: w.movie ? enrichItem(w.movie) : w.movie
  }));
  const dirCounts = new Map();
  for (const w of weightedRatings) {
    if (Number(w.rating) < 8) continue;
    const d = String(w.movie?.director || "").trim();
    if (!d || d === "Unknown" || d === "N/A") continue;
    dirCounts.set(d, (dirCounts.get(d) || 0) + Number(w.weight || 1));
  }
  const topDirectors = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name);
  return {
    ...u,
    pool,
    profile: {
      ...u.profile,
      weightedRatings,
      topDirectors: u.profile.topDirectors?.length ? u.profile.topDirectors : topDirectors
    }
  };
}

function summarizeSplit(rows, key) {
  const n = Math.max(1, rows.length);
  const m = (f) => rows.reduce((a, r) => a + r[key][f], 0) / n;
  const covSet = new Set();
  let totalBoilerplate = 0;
  let totalPicks = 0;
  for (const r of rows) {
    for (const id of r[key].ids) covSet.add(id);
    totalBoilerplate += r[key].boilerplateCount || 0;
    totalPicks += r[key].pickCount || 20;
  }
  return {
    n: rows.length,
    ndcg10: Number(m("ndcg10").toFixed(4)),
    ndcg20: Number(m("ndcg20").toFixed(4)),
    hits10: Number(m("hits10").toFixed(3)),
    hits20: Number(m("hits20").toFixed(3)),
    tail20: Number(m("tail20").toFixed(3)),
    hr20: Number((m("hr20") * 100).toFixed(1)),
    cov: covSet.size,
    avgV: Math.round(m("avgV")),
    boilerplatePct: Number(((totalBoilerplate / Math.max(1, totalPicks)) * 100).toFixed(2)),
    boilerplateCount: totalBoilerplate,
    totalPicks
  };
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  loadDotEnv(path.join(ROOT, ".env.local"));

  const args = process.argv.slice(2);
  let userCount = 50;
  let easePath = ".data/v6_lab/ease_v6_baseline_clean.cvea";
  let contentPath = "public/models/content_embeddings_f16.bin";
  let ckptRel = ".data/v6_lab/v6_2_overpitch_ckpt.json";
  let model = "gemini-3.5-flash-lite";
  let fallbackModel = "gemini-2.5-flash";
  let alpha = 0.8;
  let mmrLambda = 0.65;
  let dryRun = false;
  let rescoreOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--users" && args[i + 1]) userCount = Number(args[++i]);
    else if (args[i] === "--ease" && args[i + 1]) easePath = args[++i];
    else if (args[i] === "--content" && args[i + 1]) contentPath = args[++i];
    else if (args[i] === "--ckpt" && args[i + 1]) ckptRel = args[++i];
    else if (args[i] === "--model" && args[i + 1]) model = args[++i];
    else if (args[i] === "--fallback-model" && args[i + 1]) fallbackModel = args[++i];
    else if (args[i] === "--alpha" && args[i + 1]) alpha = Number(args[++i]);
    else if (args[i] === "--mmr-lambda" && args[i + 1]) mmrLambda = Number(args[++i]);
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--rescore-only") rescoreOnly = true;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_KEY;
  if (!dryRun && !rescoreOnly && !apiKey) throw new Error("Missing GEMINI_API_KEY / VITE_GEMINI_KEY");
  const ai = !dryRun && !rescoreOnly ? new GoogleGenAI({ apiKey }) : null;

  const cohort = await loadCleanCohort(".data/item_embeddings_clean2_f16.bin", 300);
  const easeLoaded = loadEaseIndexFromPath(easePath);
  const contentIdx = loadCvemIndex(contentPath);
  const metaById = buildCohortEnrichMap();

  const holdoutUsers = cohort.users.slice(150);
  if (holdoutUsers.length < userCount) {
    throw new Error(`Holdout-150 only has ${holdoutUsers.length} users, requested ${userCount}`);
  }
  const selected = [];
  for (let i = 0; i < userCount; i++) {
    const rawUser = holdoutUsers[Math.floor((i * holdoutUsers.length) / userCount)];
    selected.push(enrichUserMetadata(rawUser, metaById));
  }

  const ckptPath = path.isAbsolute(ckptRel) ? ckptRel : path.join(ROOT, ckptRel);
  const ckpt = fs.existsSync(ckptPath)
    ? JSON.parse(fs.readFileSync(ckptPath, "utf8"))
    : { meta: { model, alpha, mmrLambda, easePath }, users: {} };

  let mmrMsSum = 0;
  let quotaStopped = false;
  let primarySkipRemaining = 0;
  let consecutivePrimaryFails = 0;

  for (let i = 0; i < selected.length; i++) {
    const u = selected[i];
    const key = String(u.uid);
    const easeMap = buildEaseSimMapFromIndex(u.profile.weightedRatings, easeLoaded.idx);
    const collabSimMap = blendEaseAndCollabSimMaps(easeMap, u.svdMap, easeLoaded.idx);
    const rankerCtx = { profile: u.profile, collabSimMap, repulsionMap: u.repulsionMap };

    const shortlistA = buildDiversifiedGeminiShortlist(
      u.pool,
      rankerCtx,
      DEFAULT_RANKER_WEIGHTS,
      { shortlistLimit: 100 },
      null
    );
    const t0 = performance.now();
    const shortlistT = buildKernelMmrShortlist(
      u.pool,
      { ...rankerCtx, embeddingIndex: cohort.svdIdx, contentIndex: contentIdx },
      DEFAULT_RANKER_WEIGHTS,
      { shortlistLimit: 100, mmrLambda },
      null
    );
    mmrMsSum += performance.now() - t0;

    const watched = u.profile.weightedRatings.map((w) => w.movie);
    const promptA = buildGeminiReRankPrompt(u.profile, "any", shortlistA, {
      watched,
      watchlist: [],
      targetCount: 20
    });
    const promptT = buildGeminiReRankPrompt(u.profile, "any", shortlistT, {
      watched,
      watchlist: [],
      targetCount: 25
    });

    if (dryRun) {
      if (/\[Strong Vault Signal\]/i.test(promptT)) {
        throw new Error("Treatment prompt must not contain [Strong Vault Signal]");
      }
      if (shortlistA.length !== 100 || shortlistT.length !== 100) {
        throw new Error(`Shortlist length mismatch: A=${shortlistA.length}, T=${shortlistT.length}`);
      }
      const outlierDiff = shortlistT.slice(86).filter((c, k) => c.tmdbId !== shortlistA[86 + k]?.tmdbId).length;
      if (i < 5 || i === selected.length - 1) {
        console.log(
          `[DRY ${i + 1}/${selected.length}] uid=${key} lenA=${promptA.length} lenT=${promptT.length} outlierDiff=${outlierDiff}/14`
        );
      }
      continue;
    }

    const existing = ckpt.users[key];
    let rawA = existing?.rawA || null;
    let rawT = existing?.rawT || null;
    let modelUsed = existing?.modelUsed || model;

    if (!rawA || !rawT) {
      if (rescoreOnly) continue;
      process.stdout.write(`[${i + 1}/${selected.length}] User ${key} ... `);
      try {
        const skipPrimary = primarySkipRemaining > 0;
        if (skipPrimary) primarySkipRemaining -= 1;
        const paired = await runPairedUserCalls(ai, model, fallbackModel, promptA, promptT, skipPrimary);
        if (paired.primaryFailedTransient) {
          consecutivePrimaryFails += 1;
          if (consecutivePrimaryFails >= 2) primarySkipRemaining = 8;
        } else if (paired.modelUsed === model) {
          consecutivePrimaryFails = 0;
          primarySkipRemaining = 0;
        }
        modelUsed = paired.modelUsed;
        rawA = { tasteProfile: paired.resA.tasteProfile, recommendations: compactRawRecs(paired.resA) };
        rawT = { tasteProfile: paired.resT.tasteProfile, recommendations: compactRawRecs(paired.resT) };
      } catch (err) {
        const msg = String(err?.message || err);
        console.log(`STOPPED/ERROR: ${msg.slice(0, 140)}`);
        if (/429|503|RESOURCE_EXHAUSTED|UNAVAILABLE|QUOTA/i.test(msg)) {
          quotaStopped = true;
          break;
        }
        throw err;
      }
    }

    const mathTop20 = scoreRecs(shortlistA.slice(0, 20), u, cohort.top200PopSet, cohort.catalogById);
    const mergedA = mergeGeminiExplanationsWithRanker(rawA, shortlistA, u.profile, { watched }, 20).recommendations;
    const mergedAProt = fuseOverPitchRecommendations(rawA, shortlistA, u.profile, {
      mood: "any",
      watched,
      targetCount: 20,
      protectTopK: 2,
      fusionAlpha: 0.0
    });
    const mergedT = fuseOverPitchRecommendations(rawT, shortlistT, u.profile, {
      mood: "any",
      watched,
      targetCount: 20,
      protectTopK: 2,
      fusionAlpha: alpha
    });

    const scA = scoreRecs(mergedA, u, cohort.top200PopSet, cohort.catalogById);
    const scAP = scoreRecs(mergedAProt, u, cohort.top200PopSet, cohort.catalogById);
    const scT = scoreRecs(mergedT, u, cohort.top200PopSet, cohort.catalogById);

    ckpt.users[key] = { modelUsed, rawA, rawT, mathTop20, controlA: scA, controlAProt2: scAP, treatment: scT };
    fs.mkdirSync(path.dirname(ckptPath), { recursive: true });
    fs.writeFileSync(ckptPath, JSON.stringify(ckpt, null, 2));

    if (!existing?.rawA || !existing?.rawT) {
      console.log(
        `[${modelUsed}] Math=${mathTop20.hits20}(${mathTop20.ndcg20.toFixed(3)}) | A=${scA.hits20}(${scA.ndcg20.toFixed(3)}) | T=${scT.hits20}(${scT.ndcg20.toFixed(3)}) bp=${scT.boilerplateCount}`
      );
    }
  }

  if (dryRun) {
    console.log(`\nDRY RUN OK across ${selected.length} users. Avg Kernel MMR shortlist time: ${(mmrMsSum / selected.length).toFixed(2)} ms/user`);
    return;
  }

  const rows = selected.map((u) => ckpt.users[String(u.uid)]).filter((r) => r?.controlA && r?.treatment);
  const modelBreakdown = {};
  for (const r of rows) {
    const m = r.modelUsed || model;
    modelBreakdown[m] = (modelBreakdown[m] || 0) + 1;
  }
  console.log(`\n=== ${rows.length}/${selected.length} USER LLM CURATION BENCHMARK (${JSON.stringify(modelBreakdown)}, alpha=${alpha}, mmrLambda=${mmrLambda}) ===`);
  if (quotaStopped) console.log("NOTE: Stopped early due to API quota exhaustion.");

  if (rows.length === 0) {
    console.log("No completed user rows to summarize.");
    return;
  }

  const sM = summarizeSplit(rows, "mathTop20");
  const sA = summarizeSplit(rows, "controlA");
  const sAP = summarizeSplit(rows, "controlAProt2");
  const sT = summarizeSplit(rows, "treatment");

  const bT10 = pairedBootstrap(rows.map((r) => r.treatment.ndcg10), rows.map((r) => r.controlA.ndcg10));
  const bT20 = pairedBootstrap(rows.map((r) => r.treatment.ndcg20), rows.map((r) => r.controlA.ndcg20));
  const bTTail = pairedBootstrap(rows.map((r) => r.treatment.tail20), rows.map((r) => r.controlA.tail20));

  const bAP10 = pairedBootstrap(rows.map((r) => r.controlAProt2.ndcg10), rows.map((r) => r.controlA.ndcg10));
  const bAP20 = pairedBootstrap(rows.map((r) => r.controlAProt2.ndcg20), rows.map((r) => r.controlA.ndcg20));

  console.log("Pure Math Top-20:     ", sM);
  console.log("Control A (100->20):  ", sA);
  console.log(
    "Control A + ProtTop2: ",
    sAP,
    `ci10=[${bAP10.ciLower.toFixed(4)}, ${bAP10.ciUpper.toFixed(4)}]`,
    `ci20=[${bAP20.ciLower.toFixed(4)}, ${bAP20.ciUpper.toFixed(4)}]`
  );
  console.log(
    "Treatment (25->20+MMR):",
    sT,
    `ci10=[${bT10.ciLower.toFixed(4)}, ${bT10.ciUpper.toFixed(4)}] sig10=${bT10.positiveSig}`,
    `ci20=[${bT20.ciLower.toFixed(4)}, ${bT20.ciUpper.toFixed(4)}] sig20=${bT20.positiveSig}`,
    `ciTail=[${bTTail.ciLower.toFixed(4)}, ${bTTail.ciUpper.toFixed(4)}]`
  );

  const rel = (a, b) => (a / Math.max(1e-9, b) - 1) * 100;
  const tailDeltaPct = rel(sT.tail20, sA.tail20);
  const sigPrimary = (bT20.positiveSig && !bT10.negativeSig) || (bT10.positiveSig && !bT20.negativeSig);
  const tailOk = tailDeltaPct >= -1.0;
  const bpOk = sT.boilerplatePct <= 2.0;
  const fullSampleOk = rows.length >= userCount;
  const gatePass = fullSampleOk && sigPrimary && tailOk && bpOk;

  console.log(`\n>>> GATE: ${gatePass ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify({
    nCompleted: rows.length,
    nTarget: userCount,
    ndcg10LiftPct: Number(rel(sT.ndcg10, sA.ndcg10).toFixed(2)),
    ndcg20LiftPct: Number(rel(sT.ndcg20, sA.ndcg20).toFixed(2)),
    tail20DeltaPct: Number(tailDeltaPct.toFixed(2)),
    boilerplatePct: sT.boilerplatePct,
    ci10: [Number(bT10.ciLower.toFixed(4)), Number(bT10.ciUpper.toFixed(4))],
    ci20: [Number(bT20.ciLower.toFixed(4)), Number(bT20.ciUpper.toFixed(4))],
    sigPrimary,
    tailOk,
    bpOk,
    fullSampleOk
  }, null, 2));
}

main();
