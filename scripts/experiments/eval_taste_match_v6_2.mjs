#!/usr/bin/env node
/**
 * CinemaVault v6.2 Task 3 Hard-Gate Evaluator:
 * Support-Gated Bidirectional EASE^R Residual in Universal Taste Match (predictMovieMatch)
 *
 * Evaluates Control (pure dense SVD-64, easeIndex = null) vs Treatment:
 *   dense SVD-64 + easeResidual = alpha * max(0, bidirEaseNorm - normCollab) when supportCount > 0
 * across Dev-150 (alpha in {0.4, 0.7, 1.0, 1.4}) -> untouched Holdout-150.
 *
 * Metrics (per-user ROC-AUC, paired bootstrap seed=42, 1000 resamples):
 *   - withinAUC:    held-out >= 8 vs held-out <= 7
 *   - vsCatalogAUC: held-out >= 8 vs 400 deterministically sampled unseen catalog items
 *   - vsPoolAUC:    held-out >= 8 vs unseen top-200 popular pool (Explore/Search high-exposure pool)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  loadCleanCohort,
  loadEaseIndexFromPath,
  pairedBootstrap
} = await imp("scripts/experiments/v6_gate_eval.mjs");
const { buildEaseSimMapFromIndex } = await imp("src/services/easeService.js");
const { getCollabCatalogMax } = await imp("src/services/embeddingService.js");
const { computeZScoredWeights } = await imp("src/services/scoringUtils.js");
const { extractTmdbNumericId } = await imp("src/services/movieIdentity.js");
const { candidateMatchesAvoidRule, candidateMatchesPreferRule } = await imp("src/services/tasteRulesService.js");
const {
  buildTasteMatchContext,
  predictMovieMatch,
  calibratePredictedRating
} = await imp("src/services/tasteMatchService.js");

function parseCli(argv) {
  const opts = {
    ease: ".data/v6_lab/ease_v6_baseline_clean.cvea",
    svd: ".data/item_embeddings_clean2_f16.bin",
    reverseAlpha: 0.30,
    catalogSample: 400
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ease" && argv[i + 1]) opts.ease = argv[++i];
    else if (a === "--svd" && argv[i + 1]) opts.svd = argv[++i];
    else if (a === "--reverse-alpha" && argv[i + 1]) opts.reverseAlpha = Number(argv[++i]);
    else if (a === "--catalog-sample" && argv[i + 1]) opts.catalogSample = Number(argv[++i]);
  }
  return opts;
}

function buildWatchedWeightByIdx(weightedRatings = [], easeIndex = null, options = {}) {
  if (!easeIndex || !easeIndex.count || !easeIndex.idToIndex) return null;
  const negWeight = Number.isFinite(Number(options.negWeight)) ? Number(options.negWeight) : -0.35;
  const out = new Float32Array(easeIndex.count);
  for (const entry of weightedRatings) {
    const tmdbId = Number(entry?.movie?.tmdbId ?? entry?.tmdbId ?? entry?.movie?.id ?? 0);
    if (!tmdbId) continue;
    const idx = easeIndex.idToIndex.get(tmdbId);
    if (idx === undefined) continue;

    const rating = Number(entry?.rating ?? entry?.movie?.userRating ?? entry?.movie?.UserRating ?? NaN);
    const rawW = Number(entry?.weight ?? entry?.finalWeight ?? 0);

    let x = 0;
    if (Number.isFinite(rating) && rating > 0) {
      if (rating >= 7) x = 0.7 + 0.6 * ((rating - 6) / 4);
      else if (rating >= 6) x = 0.25;
      else if (rating <= 4) x = negWeight;
    } else if (Number.isFinite(rawW) && rawW !== 0) {
      x = rawW > 0 ? Math.min(1.3, Math.max(0.4, rawW)) : Math.max(negWeight, rawW);
    }
    if (x !== 0) out[idx] += x;
  }
  return out;
}

export function computeBidirectionalEaseScoreForItem(
  tmdbId,
  watchedWeightByIdx,
  easeIndex,
  options = {}
) {
  if (!tmdbId || !easeIndex || !easeIndex.idToIndex || !watchedWeightByIdx) {
    return { forward: 0, reverse: 0, supportCount: 0, combined: 0 };
  }
  const id = Number(tmdbId);
  const idx = easeIndex.idToIndex.get(id);
  if (idx === undefined) {
    return { forward: 0, reverse: 0, supportCount: 0, combined: 0 };
  }

  const forward = options.easeSimMap ? Number(options.easeSimMap.get(id) || 0) : 0;
  const reverseAlpha = Number.isFinite(Number(options.reverseAlpha)) ? Number(options.reverseAlpha) : 0.30;
  const { count, K, nbrIdx, nbrW } = easeIndex;
  const base = idx * K;
  let reverse = 0;
  let supportCount = forward !== 0 ? 1 : 0;

  for (let k = 0; k < K; k++) {
    const target = nbrIdx[base + k];
    if (target < count) {
      const w = watchedWeightByIdx[target];
      const weight = nbrW[base + k];
      if (w !== 0 && weight !== 0) {
        reverse += w * weight;
        supportCount += 1;
      }
    }
  }

  const combined = forward + reverseAlpha * reverse;
  return { forward, reverse, supportCount, combined };
}

function buildTreatmentContext({ watched, embeddingIndex, easeIndex, now }) {
  const ctx = buildTasteMatchContext({ watched, embeddingIndex, now });
  if (!ctx?.ready || !easeIndex) return ctx;

  const normalizedEntries = computeZScoredWeights(ctx.watched, { now });
  const weightedRatings = normalizedEntries.map((entry) => ({
    movie: entry.movie,
    weight: entry.weight,
    finalWeight: entry.weight,
    zScore: entry.zScore,
    rating: entry.rating,
    tmdbId: Number(entry.movie?.tmdbId || 0) || null
  }));

  const easeSimMap = buildEaseSimMapFromIndex(weightedRatings, easeIndex);
  const easeCatalogMax = getCollabCatalogMax(easeSimMap) ?? 0.35;
  const watchedWeightByIdx = buildWatchedWeightByIdx(weightedRatings, easeIndex);

  return {
    ...ctx,
    easeIndex,
    easeSimMap,
    easeCatalogMax,
    watchedWeightByIdx
  };
}

function resolveMovieTmdbId(movie) {
  if (!movie || typeof movie !== "object") return 0;
  return (
    extractTmdbNumericId(movie.tmdbId) ||
    extractTmdbNumericId(movie.id) ||
    extractTmdbNumericId(movie.imdbID) ||
    0
  );
}

const GENRE_NAME_ALIASES = {
  "sci-fi": "science fiction",
  "scifi": "science fiction",
  "sci fi": "science fiction"
};
function canonicalGenreName(name) {
  const lower = String(name || "").trim().toLowerCase();
  return GENRE_NAME_ALIASES[lower] || lower;
}
function normalizeNameKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function parseGenreNames(movie) {
  const raw = movie?.genre || movie?.Genre || "";
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(/[,•/|]+/).map((g) => g.trim()).filter((g) => g && g.toLowerCase() !== "n/a");
  }
  return [];
}
function parseGenreIds(movie) {
  const arr = Array.isArray(movie?.tmdbGenreIds)
    ? movie.tmdbGenreIds
    : Array.isArray(movie?.genre_ids)
      ? movie.genre_ids
      : [];
  return arr.map(Number).filter((n) => Number.isFinite(n) && n > 0);
}
function parseDirectorNames(movie) {
  if (Array.isArray(movie?.directorDetails) && movie.directorDetails.length > 0) {
    return movie.directorDetails.map((d) => String(d?.name || "").trim()).filter(Boolean);
  }
  const raw = String(movie?.director || movie?.Director || "").trim();
  if (!raw || raw.toLowerCase() === "n/a" || raw.toLowerCase() === "unknown") return [];
  return raw.split(/[,&]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Exact mirror of predictMovieMatch's scoring path with optional support-gated
 * bidirectional EASE^R residual:
 *   easeResidual = alpha * max(0, bidirEaseNorm - normCollab) when supportCount > 0.
 * When alpha <= 0 or !ctx.easeIndex, delegates straight to predictMovieMatch.
 */
function scoreMovieMatch(movie, ctx, { alpha = 0, reverseAlpha = 0.30 } = {}) {
  if (!ctx?.easeIndex || alpha <= 0) {
    return predictMovieMatch({ movie, cachedContext: ctx }).matchPct;
  }

  const tmdbId = resolveMovieTmdbId(movie);
  const hasCollabEntry = Boolean(tmdbId && ctx.collabSimMap && ctx.collabSimMap.has(tmdbId));
  const rawCollab = hasCollabEntry ? Number(ctx.collabSimMap.get(tmdbId) || 0) : 0;
  const catalogMax = Number(ctx.collabCatalogMax) || 0.35;
  const normCollab = hasCollabEntry
    ? Math.max(-1, Math.min(1, rawCollab / Math.max(0.08, catalogMax)))
    : 0;
  const repulsion = tmdbId && ctx.repulsionMap ? Number(ctx.repulsionMap.get(tmdbId) || 0) : 0;

  let easeResidual = 0;
  if (tmdbId && ctx.easeIndex && ctx.watchedWeightByIdx) {
    const bidir = computeBidirectionalEaseScoreForItem(tmdbId, ctx.watchedWeightByIdx, ctx.easeIndex, {
      easeSimMap: ctx.easeSimMap,
      reverseAlpha
    });
    if (bidir.supportCount > 0) {
      const easeMax = Math.max(0.08, Number(ctx.easeCatalogMax) || 0.35);
      const bidirEaseNorm = Math.max(-1, Math.min(1, bidir.combined / easeMax));
      easeResidual = alpha * Math.max(0, bidirEaseNorm - normCollab);
    }
  }

  const gIds = parseGenreIds(movie);
  const gNames = parseGenreNames(movie);
  let genreSum = 0;
  let genreHits = 0;
  for (const gid of gIds) {
    if (ctx.genreScoreById.has(gid)) {
      genreSum += ctx.genreScoreById.get(gid);
      genreHits += 1;
    }
  }
  const useNameScores = genreHits === 0;
  for (const gname of gNames) {
    const key = canonicalGenreName(gname);
    if (useNameScores && ctx.genreScoreByName.has(key)) {
      genreSum += ctx.genreScoreByName.get(key);
      genreHits += 1;
    }
  }
  const genreAffinity = genreHits > 0 ? Math.tanh(genreSum / (genreHits * 2.2)) : 0;

  let directorScore = 0;
  for (const dir of parseDirectorNames(movie)) {
    const key = normalizeNameKey(dir);
    if (ctx.directorAffinity.has(key)) {
      const val = ctx.directorAffinity.get(key);
      if (Math.abs(val) > Math.abs(directorScore)) directorScore = val;
    }
  }
  const normDirector = Math.tanh(directorScore / 1.8);

  const rawVote = Number(movie.imdbRating ?? movie.vote_average ?? 0);
  const voteCount = Number(movie.vote_count ?? 0);
  const acclaimSignal =
    Number.isFinite(rawVote) && rawVote > 0
      ? Math.max(-0.5, Math.min(0.8, (rawVote - 6.8) / 2.2)) * (voteCount >= 50 || movie.imdbRating ? 1 : 0.6)
      : 0;

  let ruleShift = 0;
  if (ctx.compiledRules?.activeRules?.length > 0) {
    if (candidateMatchesAvoidRule(movie, ctx.compiledRules.avoidRules).matched) ruleShift -= 1.4;
    else if (candidateMatchesPreferRule(movie, ctx.compiledRules.preferRules).matched) ruleShift += 0.55;
  }

  let logit = 0;
  if (hasCollabEntry) {
    logit =
      0.25 +
      normCollab * 2.35 +
      easeResidual -
      Math.max(0, repulsion) * 1.9 +
      genreAffinity * 0.65 +
      normDirector * 0.75 +
      acclaimSignal * 0.55 +
      ruleShift;
  } else {
    logit =
      0.1 +
      easeResidual +
      genreAffinity * 1.35 +
      normDirector * 1.45 +
      acclaimSignal * 0.9 +
      ruleShift;
  }

  const prob = 1 / (1 + Math.exp(-logit));
  return Math.max(50, Math.min(99, Math.round(50 + prob * 49)));
}

function computeRocAuc(posScores, negScores) {
  if (posScores.length === 0 || negScores.length === 0) return null;
  let wins = 0;
  let total = 0;
  for (let i = 0; i < posScores.length; i++) {
    const p = posScores[i];
    for (let j = 0; j < negScores.length; j++) {
      const q = negScores[j];
      total += 1;
      if (p > q) wins += 1;
      else if (p === q) wins += 0.5;
    }
  }
  return wins / total;
}

function prepareEvalSamples(users, cohort, catalogSampleSize) {
  const pop200 = [...cohort.catalog]
    .sort((a, b) => b.vote_count - a.vote_count)
    .slice(0, 200);

  let s = 42;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  return users.map((u) => {
    const trainWatched = u.profile.weightedRatings.map((e) => e.movie);
    const trainIds = new Set(trainWatched.map((m) => Number(m.tmdbId)));
    const posMovies = [];
    const negMovies = [];
    for (const [idStr, rating] of u.holdoutRelevance.entries()) {
      const m = cohort.catalogById.get(Number(idStr));
      if (!m) continue;
      if (rating >= 8) posMovies.push(m);
      else if (rating <= 7) negMovies.push(m);
    }

    const unseenPool = u.pool.filter((c) => !u.holdoutRelevance.has(String(c.tmdbId)));
    const catalogSample = [];
    for (let k = 0; k < catalogSampleSize && unseenPool.length > 0; k++) {
      catalogSample.push(unseenPool[Math.floor(rnd() * unseenPool.length)]);
    }

    const popPool = pop200.filter(
      (m) => !trainIds.has(m.tmdbId) && !u.holdoutRelevance.has(String(m.tmdbId))
    );

    return {
      uid: u.uid,
      trainWatched,
      posMovies,
      negMovies,
      catalogSample,
      popPool
    };
  });
}

function evalSplit(preparedUsers, cohort, easeIdx, { alpha = 0, reverseAlpha = 0.30, now }) {
  const within = [];
  const vsCatalog = [];
  const vsPool = [];
  const withinIdx = [];

  const t0 = performance.now();
  for (let i = 0; i < preparedUsers.length; i++) {
    const u = preparedUsers[i];
    const ctx =
      alpha > 0 && easeIdx
        ? buildTreatmentContext({
            watched: u.trainWatched,
            embeddingIndex: cohort.svdIdx,
            easeIndex: easeIdx,
            now
          })
        : buildTasteMatchContext({
            watched: u.trainWatched,
            embeddingIndex: cohort.svdIdx,
            now
          });

    const posScores = u.posMovies.map((m) => scoreMovieMatch(m, ctx, { alpha, reverseAlpha }));
    const negScores = u.negMovies.map((m) => scoreMovieMatch(m, ctx, { alpha, reverseAlpha }));
    const catScores = u.catalogSample.map((m) => scoreMovieMatch(m, ctx, { alpha, reverseAlpha }));
    const popScores = u.popPool.map((m) => scoreMovieMatch(m, ctx, { alpha, reverseAlpha }));

    const wAuc = computeRocAuc(posScores, negScores);
    if (wAuc !== null) {
      within.push(wAuc);
      withinIdx.push(i);
    }
    const cAuc = computeRocAuc(posScores, catScores);
    if (cAuc !== null) vsCatalog.push(cAuc);
    const pAuc = computeRocAuc(posScores, popScores);
    if (pAuc !== null) vsPool.push(pAuc);
  }
  const elapsedMs = performance.now() - t0;
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);

  return {
    perUser: { within, vsCatalog, vsPool, withinIdx },
    summary: {
      nUsers: preparedUsers.length,
      nWithin: within.length,
      withinAUC: Number(mean(within).toFixed(4)),
      vsCatalogAUC: Number(mean(vsCatalog).toFixed(4)),
      vsPoolAUC: Number(mean(vsPool).toFixed(4)),
      msTotal: Math.round(elapsedMs)
    }
  };
}

function fmtDelta(boot) {
  const sign = boot.meanDiff >= 0 ? "+" : "";
  const sig = boot.positiveSig ? "*+" : boot.negativeSig ? "*-" : "  ";
  return `${sign}${boot.meanDiff.toFixed(4)} [${boot.ciLower.toFixed(4)}, ${boot.ciUpper.toFixed(4)}]${sig}`;
}

function formatRow(label, res, base = null) {
  const s = res.summary;
  if (!base) {
    return `${label.padEnd(24)} within=${s.withinAUC.toFixed(4)} (n=${s.nWithin}) | vsCatalog=${s.vsCatalogAUC.toFixed(4)} | vsPool=${s.vsPoolAUC.toFixed(4)} | ${s.msTotal}ms`;
  }
  const bw = pairedBootstrap(res.perUser.within, base.perUser.within, 42, 1000);
  const bc = pairedBootstrap(res.perUser.vsCatalog, base.perUser.vsCatalog, 42, 1000);
  const bp = pairedBootstrap(res.perUser.vsPool, base.perUser.vsPool, 42, 1000);
  return `${label.padEnd(24)} within=${s.withinAUC.toFixed(4)} (${fmtDelta(bw)}) | vsCatalog=${s.vsCatalogAUC.toFixed(4)} (${fmtDelta(bc)}) | vsPool=${s.vsPoolAUC.toFixed(4)} (${fmtDelta(bp)}) | ${s.msTotal}ms`;
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  const now = Date.now();

  console.log(`Loading clean 300-user cohort & EASE^R index (${opts.ease})...`);
  const cohort = await loadCleanCohort(opts.svd, 300);
  const easeLoaded = loadEaseIndexFromPath(opts.ease);

  const devPrepared = prepareEvalSamples(cohort.users.slice(0, 150), cohort, opts.catalogSample);
  const valPrepared = prepareEvalSamples(cohort.users.slice(150), cohort, opts.catalogSample);

  console.log("\n=== DEV-150 ALPHA SWEEP (Support-Gated Bidirectional EASE^R Residual) ===");
  const devControl = evalSplit(devPrepared, cohort, null, { alpha: 0, now });
  console.log("[DEV-150]    ", formatRow("control_svd64", devControl));

  const alphas = [0.4, 0.7, 1.0, 1.4];
  const devTreatments = [];
  for (const alpha of alphas) {
    const label = `alpha=${alpha.toFixed(1)}_rev=${opts.reverseAlpha.toFixed(2)}`;
    const res = evalSplit(devPrepared, cohort, easeLoaded.idx, {
      alpha,
      reverseAlpha: opts.reverseAlpha,
      now
    });
    console.log("[DEV-150]    ", formatRow(label, res, devControl));
    const bw = pairedBootstrap(res.perUser.within, devControl.perUser.within, 42, 1000);
    const bc = pairedBootstrap(res.perUser.vsCatalog, devControl.perUser.vsCatalog, 42, 1000);
    const bp = pairedBootstrap(res.perUser.vsPool, devControl.perUser.vsPool, 42, 1000);
    devTreatments.push({
      alpha,
      label,
      res,
      bw,
      bc,
      bp,
      eligible: !bc.negativeSig && (bw.positiveSig || bp.positiveSig),
      score: bw.meanDiff + bp.meanDiff - Math.max(0, -bc.meanDiff) * 2
    });
  }

  devTreatments.sort((a, b) => (b.eligible - a.eligible) || (b.score - a.score));
  const winner = devTreatments[0];
  console.log(`\n-> Best DEV-150 Candidate: ${winner.label} (eligible=${winner.eligible})`);

  console.log("\n=== UNTOUCHED HOLDOUT-150 HARD SHIP GATE ===");
  const valControl = evalSplit(valPrepared, cohort, null, { alpha: 0, now });
  const valWinner = evalSplit(valPrepared, cohort, easeLoaded.idx, {
    alpha: winner.alpha,
    reverseAlpha: opts.reverseAlpha,
    now
  });
  console.log("[HOLDOUT-150]", formatRow("control_svd64", valControl));
  console.log("[HOLDOUT-150]", formatRow(winner.label, valWinner, valControl));

  const bw = pairedBootstrap(valWinner.perUser.within, valControl.perUser.within, 42, 1000);
  const bc = pairedBootstrap(valWinner.perUser.vsCatalog, valControl.perUser.vsCatalog, 42, 1000);
  const bp = pairedBootstrap(valWinner.perUser.vsPool, valControl.perUser.vsPool, 42, 1000);

  const gatePass = (bw.positiveSig || bp.positiveSig) && !bc.negativeSig;
  console.log(`\n>>> HARD SHIP GATE (HOLDOUT-150): ${gatePass ? "PASS" : "FAIL"}`);
  console.log(
    JSON.stringify(
      {
        winner: { alpha: winner.alpha, reverseAlpha: opts.reverseAlpha },
        gatePass,
        holdout: {
          control: valControl.summary,
          treatment: valWinner.summary,
          withinDiff: bw,
          vsCatalogDiff: bc,
          vsPoolDiff: bp
        }
      },
      null,
      2
    )
  );
}

main();
