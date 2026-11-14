import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "g:/Important Projects/movie-ratings";
const importSrc = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { parseEmbeddingBinary, buildCollabSimMapFromIndex, buildRepulsionMapFromIndex, computeUserPersonas, computeUserEmbedding } = await importSrc("src/services/embeddingService.js");
const { computeRecallAtK, computeNDCGAtK, computeNovelty } = await importSrc("src/services/evalHarness.js");
const { rankCandidatePool, extractCandidateFeatures, DEFAULT_RANKER_WEIGHTS } = await importSrc("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await importSrc("src/services/tmdbService.js");
const { computeBayesianScore, computeZScoredWeights, computeUserRatingStats } = await importSrc("src/services/scoringUtils.js");

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

console.log("==========================================================================");
console.log("CINEMAVAULT RIGOROUS OFFLINE EXPERIMENTAL SUITE - PHASE 2");
console.log("==========================================================================");

// 1. Load Base Embeddings
const embBuffer = fs.readFileSync(path.join(root, "public/models/item_embeddings_f16.bin"));
const ab = embBuffer.buffer.slice(embBuffer.byteOffset, embBuffer.byteOffset + embBuffer.byteLength);
const embeddingIndex = parseEmbeddingBinary(ab);
const { count: embCount, dim: embDim, ids: embIds, vectors: embVectors, idToIndex: embIdToIndex } = embeddingIndex;
console.log(`Loaded item_embeddings_f16.bin: ${embCount} items, dim=${embDim}`);

// 2. Load MovieLens ml-latest-small
const linksLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/links.csv"), "utf8").split("\n").filter(Boolean).slice(1);
const movieIdToTmdbId = new Map();
const tmdbIdToMovieId = new Map();
linksLines.forEach(l => {
  const [mid, imdb, tmdb] = l.trim().split(",");
  if (tmdb) {
    const tid = Number(tmdb);
    movieIdToTmdbId.set(mid, tid);
    tmdbIdToMovieId.set(tid, mid);
  }
});

const moviesLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/movies.csv"), "utf8").split("\n").filter(Boolean).slice(1);
const movieMeta = new Map();
moviesLines.forEach(l => {
  const commaIdx = l.indexOf(",");
  const lastComma = l.lastIndexOf(",");
  if (commaIdx === -1) return;
  const mid = l.slice(0, commaIdx).trim();
  const genres = l.slice(lastComma + 1).trim();
  const title = l.slice(commaIdx + 1, lastComma).trim().replace(/^"|"$/g, "");
  movieMeta.set(mid, { title, genres });
});

// Load TMDB Cache
const tmdbCache = fs.existsSync(path.join(root, ".data/tmdb_cache.json"))
  ? JSON.parse(fs.readFileSync(path.join(root, ".data/tmdb_cache.json"), "utf8"))
  : {};

// Helper: map MovieLens genres to TMDB IDs
function mapMovieLensGenresToTmdb(genresStr = "") {
  if (!genresStr || genresStr === "(no genres listed)") return [];
  const normalized = genresStr
    .replace(/\|/g, ",")
    .replace(/\bchildren\b/gi, "Family")
    .replace(/\bsci-fi\b/gi, "Sci-Fi");
  return mapOmdbToTmdbGenreIds(normalized);
}

const ratingsLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/ratings.csv"), "utf8").split("\n").filter(Boolean).slice(1);
const ratingsByUser = new Map();
const movieRatingCounts = new Map();
const movieRatingSums = new Map();

ratingsLines.forEach(l => {
  const [uid, mid, rStr, tsStr] = l.trim().split(",");
  if (!movieIdToTmdbId.has(mid)) return;
  const tmdbId = movieIdToTmdbId.get(mid);
  const r = Number(rStr) * 2; // scale 0.5-5.0 -> 1-10
  const ts = Number(tsStr);

  const meta = movieMeta.get(mid) || { title: "Unknown", genres: "" };
  const tmdbGenreIds = mapMovieLensGenresToTmdb(meta.genres);
  const cached = tmdbCache[tmdbId] || {};

  if (!ratingsByUser.has(uid)) ratingsByUser.set(uid, []);
  ratingsByUser.get(uid).push({
    id: tmdbId,
    tmdbId,
    movieId: mid,
    title: meta.title,
    userRating: r,
    dateWatched: new Date(ts * 1000).toISOString(),
    ts: ts * 1000,
    genre: meta.genres,
    tmdbGenreIds,
    genre_ids: tmdbGenreIds,
    tmdbKeywords: cached.tmdbKeywords || [],
    castIds: cached.castIds || [],
    crewPersonId: cached.crewPersonId || null
  });

  movieRatingCounts.set(tmdbId, (movieRatingCounts.get(tmdbId) || 0) + 1);
  movieRatingSums.set(tmdbId, (movieRatingSums.get(tmdbId) || 0) + r);
});

// Construct catalogs: base (feature-poor) and hybrid (enriched with mapped genres and cached metadata)
const baseMlCatalog = [];
const hybridMlCatalog = [];

for (const [mid, tmdbId] of movieIdToTmdbId.entries()) {
  const meta = movieMeta.get(mid) || { title: "Unknown", genres: "" };
  const cnt = movieRatingCounts.get(tmdbId) || 1;
  const sum = movieRatingSums.get(tmdbId) || 7.0;
  const avg = cnt > 0 ? sum / cnt : 7.0;
  const cached = tmdbCache[tmdbId] || {};

  // Base: no mapped genre IDs, no keywords/cast/crew
  baseMlCatalog.push({
    id: tmdbId,
    tmdbId,
    title: meta.title,
    genre: meta.genres,
    tmdbGenreIds: [],
    genre_ids: [],
    vote_average: Number(avg.toFixed(1)),
    vote_count: cnt
  });

  // Hybrid: mapped TMDB genre IDs + cached metadata
  const tmdbGenreIds = mapMovieLensGenresToTmdb(meta.genres);
  hybridMlCatalog.push({
    id: tmdbId,
    tmdbId,
    title: meta.title,
    genre: meta.genres,
    tmdbGenreIds,
    genre_ids: tmdbGenreIds,
    vote_average: Number(avg.toFixed(1)),
    vote_count: cnt,
    tmdbKeywords: cached.tmdbKeywords || [],
    castIds: cached.castIds || [],
    crewPersonId: cached.crewPersonId || null
  });
}
console.log(`Constructed catalog: ${hybridMlCatalog.length} movies.`);

// Filter 328 eligible active users (>= 60 ratings, >= 15 positive ratings)
const benchmarkUserIds = new Set(["89", "263", "409", "561"]);
const allEligibleUsers = [];
for (const [uid, ratings] of ratingsByUser.entries()) {
  if (benchmarkUserIds.has(uid)) continue;
  if (ratings.length < 60) continue;
  ratings.sort((a, b) => a.ts - b.ts);
  const pos = ratings.filter(r => r.userRating >= 8);
  if (pos.length >= 15) {
    allEligibleUsers.push({ uid, ratings, posCount: pos.length });
  }
}
allEligibleUsers.sort((a, b) => Number(a.uid) - Number(b.uid));

const tuningUsers = allEligibleUsers.slice(0, 160);
const lockedTestUsers = allEligibleUsers.slice(160, 328);
console.log(`Partitioned users: Total = ${allEligibleUsers.length}, Tuning = ${tuningUsers.length}, Locked Test = ${lockedTestUsers.length}`);

// Pre-calculate user splits for reproducibility
function getUserSplit(user) {
  const sorted = [...user.ratings].sort((a, b) => a.ts - b.ts);
  let pCount = 0;
  let splitIdx = sorted.length;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].userRating >= 8) {
      pCount++;
      if (pCount === 10) { splitIdx = i; break; }
    }
  }

  const trainWatched = sorted.slice(0, splitIdx);
  const holdoutSlice = sorted.slice(splitIdx);
  const holdoutStartTs = sorted[splitIdx]?.ts;

  const holdoutPositives = new Set();
  const holdoutRelevance = new Map();
  for (const m of holdoutSlice) {
    const key = getMovieKey(m);
    holdoutRelevance.set(key, m.userRating);
    if (m.userRating >= 8) holdoutPositives.add(key);
  }

  return { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs };
}

// Paired Bootstrap CI calculation
function pairedBootstrapCI(candScores, baseScores, numResamples = 1000, seed = 42) {
  const n = candScores.length;
  const diffs = new Float64Array(n);
  for (let i = 0; i < n; i++) diffs[i] = candScores[i] - baseScores[i];

  let sumDiff = 0;
  for (let i = 0; i < n; i++) sumDiff += diffs[i];
  const meanDiff = sumDiff / n;

  let s = seed >>> 0;
  function rnd() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  }

  const bootMeans = new Float64Array(numResamples);
  for (let b = 0; b < numResamples; b++) {
    let bSum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rnd() * n);
      bSum += diffs[idx];
    }
    bootMeans[b] = bSum / n;
  }

  bootMeans.sort();
  const lowerIdx = Math.floor(0.025 * numResamples);
  const upperIdx = Math.floor(0.975 * numResamples);

  const ciLower = bootMeans[lowerIdx];
  const ciUpper = bootMeans[upperIdx];
  const isSignificant = (ciLower > 0 && ciUpper > 0) || (ciLower < 0 && ciUpper < 0);

  return {
    meanDiff,
    ciLower,
    ciUpper,
    isSignificant
  };
}

function stats(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  const m = s / (arr.length || 1);
  let varSum = 0;
  for (let i = 0; i < arr.length; i++) varSum += (arr[i] - m) ** 2;
  return { mean: m, std: Math.sqrt(varSum / (arr.length || 1)) };
}

const experimentResults = {
  metadata: {
    totalEligibleUsers: allEligibleUsers.length,
    tuningUsers: tuningUsers.length,
    lockedTestUsers: lockedTestUsers.length,
    catalogSize: hybridMlCatalog.length,
    timestamp: new Date().toISOString()
  },
  task1: {},
  task2: {},
  task3: {},
  task4: {},
  task5: {}
};

// ==========================================================================
// PRE-COMPUTE PROFILES AND BASE CANDIDATES FOR ALL 328 USERS
// ==========================================================================
console.log("\nPre-computing user taste profiles and collaborative similarity maps for all 328 users...");
const userContexts = [];

for (let u = 0; u < allEligibleUsers.length; u++) {
  const user = allEligibleUsers[u];
  const { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs } = getUserSplit(user);
  const trainKeys = new Set(trainWatched.map(getMovieKey));

  // Feature-poor profile (no genre IDs)
  const baseTrainWatched = trainWatched.map(m => ({ ...m, tmdbGenreIds: [] }));
  const baseProfile = await extractTasteProfile(baseTrainWatched, [], { now: holdoutStartTs, anchorCutoff: Infinity });
  const baseCollabMap = buildCollabSimMapFromIndex(baseProfile.weightedRatings, embeddingIndex);
  const baseRepulsionMap = buildRepulsionMapFromIndex(baseProfile.weightedRatings, embeddingIndex);

  // Hybrid profile (with mapped genre IDs and cached metadata)
  const hybProfile = await extractTasteProfile(trainWatched, [], { now: holdoutStartTs, anchorCutoff: Infinity });
  const hybCollabMap = buildCollabSimMapFromIndex(hybProfile.weightedRatings, embeddingIndex);
  const hybRepulsionMap = buildRepulsionMapFromIndex(hybProfile.weightedRatings, embeddingIndex);

  // Candidate pool excluding training watched
  const candidatesBase = baseMlCatalog.filter(c => !trainKeys.has(getMovieKey(c)));
  const candidatesHyb = hybridMlCatalog.filter(c => !trainKeys.has(getMovieKey(c)));

  userContexts.push({
    user,
    trainWatched,
    holdoutPositives,
    holdoutRelevance,
    holdoutStartTs,
    candidatesBase,
    candidatesHyb,
    baseProfile,
    baseCollabMap,
    baseRepulsionMap,
    hybProfile,
    hybCollabMap,
    hybRepulsionMap
  });
}
console.log(`Pre-computation complete for all ${userContexts.length} users.`);

// ==========================================================================
// TASK 1: GENRE SIGNAL ON ALL 328 USERS (GRID EVALUATION)
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 1: GENRE SIGNAL ON ALL 328 USERS (GRID EVALUATION)");
console.log("==========================================================================");

// 1. Evaluate Feature-Poor Baseline (genreOverlap = 0, damping = 0.20)
const baseRankerAll = {
  ndcg: new Float64Array(allEligibleUsers.length),
  recall: new Float64Array(allEligibleUsers.length)
};

for (let u = 0; u < userContexts.length; u++) {
  const ctx = userContexts[u];
  const ranked = rankCandidatePool(
    ctx.candidatesBase,
    {
      profile: ctx.baseProfile,
      collabSimMap: ctx.baseCollabMap,
      contentSimMap: new Map(),
      repulsionMap: ctx.baseRepulsionMap,
      anchorKeywords: [],
      userProviders: []
    },
    DEFAULT_RANKER_WEIGHTS,
    ctx.candidatesBase.length,
    { metadataDampingFactor: 0.20 }
  );
  const ids = ranked.map(getMovieKey);
  baseRankerAll.ndcg[u] = computeNDCGAtK(ids, ctx.holdoutRelevance, 10);
  baseRankerAll.recall[u] = computeRecallAtK(ids, ctx.holdoutPositives, 20);
}

const baseTunNdcg = stats(baseRankerAll.ndcg.slice(0, 160));
const baseTunRec = stats(baseRankerAll.recall.slice(0, 160));
const baseTstNdcg = stats(baseRankerAll.ndcg.slice(160, 328));
const baseTstRec = stats(baseRankerAll.recall.slice(160, 328));
const baseAllNdcg = stats(baseRankerAll.ndcg);
const baseAllRec = stats(baseRankerAll.recall);

console.log(`Feature-Poor Baseline (genreOverlap = 0, damping = 0.20):`);
console.log(`  Tuning (160): NDCG@10 = ${baseTunNdcg.mean.toFixed(4)}, Recall@20 = ${baseTunRec.mean.toFixed(4)}`);
console.log(`  Test   (168): NDCG@10 = ${baseTstNdcg.mean.toFixed(4)}, Recall@20 = ${baseTstRec.mean.toFixed(4)}`);
console.log(`  All    (328): NDCG@10 = ${baseAllNdcg.mean.toFixed(4)}, Recall@20 = ${baseAllRec.mean.toFixed(4)}`);

// Grid: damping in {0.20, 0.50, 1.00} x genreMultiplier in {0.5x, 1x, 2x}
const dampingsT1 = [0.20, 0.50, 1.00];
const multipliersT1 = [0.5, 1.0, 2.0];
const gridResults = [];

for (const damping of dampingsT1) {
  for (const mult of multipliersT1) {
    const effGenreWeight = DEFAULT_RANKER_WEIGHTS.genreOverlap * mult;
    const weights = { ...DEFAULT_RANKER_WEIGHTS, genreOverlap: effGenreWeight };

    const ndcgAll = new Float64Array(allEligibleUsers.length);
    const recallAll = new Float64Array(allEligibleUsers.length);

    for (let u = 0; u < userContexts.length; u++) {
      const ctx = userContexts[u];
      const ranked = rankCandidatePool(
        ctx.candidatesHyb,
        {
          profile: ctx.hybProfile,
          collabSimMap: ctx.hybCollabMap,
          contentSimMap: new Map(),
          repulsionMap: ctx.hybRepulsionMap,
          anchorKeywords: ctx.hybProfile.lovedKeywordIds || [],
          userProviders: []
        },
        weights,
        ctx.candidatesHyb.length,
        { metadataDampingFactor: damping }
      );
      const ids = ranked.map(getMovieKey);
      ndcgAll[u] = computeNDCGAtK(ids, ctx.holdoutRelevance, 10);
      recallAll[u] = computeRecallAtK(ids, ctx.holdoutPositives, 20);
    }

    const tunN = stats(ndcgAll.slice(0, 160)).mean;
    const tunR = stats(recallAll.slice(0, 160)).mean;
    const tstN = stats(ndcgAll.slice(160, 328)).mean;
    const tstR = stats(recallAll.slice(160, 328)).mean;
    const allN = stats(ndcgAll).mean;
    const allR = stats(recallAll).mean;

    // Paired bootstrap CI on all 328 users vs feature-poor baseline
    const bootN = pairedBootstrapCI(ndcgAll, baseRankerAll.ndcg);
    const bootR = pairedBootstrapCI(recallAll, baseRankerAll.recall);

    // Delta on tuning and test halves
    const deltaTunN = tunN - baseTunNdcg.mean;
    const deltaTstN = tstN - baseTstNdcg.mean;

    let concordance = "Concordant";
    if ((deltaTunN > 0 && deltaTstN < 0) || (deltaTunN < 0 && deltaTstN > 0)) {
      concordance = `Discordant (Tun ${deltaTunN >= 0 ? "+" : ""}${deltaTunN.toFixed(4)}, Tst ${deltaTstN >= 0 ? "+" : ""}${deltaTstN.toFixed(4)})`;
    }

    gridResults.push({
      damping,
      multiplier: mult,
      genreWeight: effGenreWeight,
      tunN,
      tunR,
      tstN,
      tstR,
      allN,
      allR,
      deltaTunN,
      deltaTstN,
      bootN,
      bootR,
      concordance,
      ndcgScores: Array.from(ndcgAll),
      recallScores: Array.from(recallAll)
    });
  }
}

console.log("\nTASK 1: Full 3x3 Grid Results vs. Feature-Poor Baseline across 328 Users:");
console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
console.log("Damping | GenreMult (Weight) | Tuning NDCG | Test NDCG  | All328 NDCG | Delta NDCG@10 (All 328) [95% CI]      | All328 Rec  | Delta Rec@20 [95% CI]           | Sig? | Sign Concordance");
console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");
for (const r of gridResults) {
  const dStr = r.damping.toFixed(2).padEnd(7);
  const mStr = `${r.multiplier.toFixed(1)}x (${r.genreWeight.toFixed(2)})`.padEnd(18);
  const tunNStr = r.tunN.toFixed(4).padEnd(11);
  const tstNStr = r.tstN.toFixed(4).padEnd(10);
  const allNStr = r.allN.toFixed(4).padEnd(11);
  const deltaNStr = `${r.bootN.meanDiff >= 0 ? "+" : ""}${r.bootN.meanDiff.toFixed(4)} [${r.bootN.ciLower >= 0 ? "+" : ""}${r.bootN.ciLower.toFixed(4)}, ${r.bootN.ciUpper >= 0 ? "+" : ""}${r.bootN.ciUpper.toFixed(4)}]`.padEnd(37);
  const allRStr = r.allR.toFixed(4).padEnd(11);
  const deltaRStr = `${r.bootR.meanDiff >= 0 ? "+" : ""}${r.bootR.meanDiff.toFixed(4)} [${r.bootR.ciLower >= 0 ? "+" : ""}${r.bootR.ciLower.toFixed(4)}, ${r.bootR.ciUpper >= 0 ? "+" : ""}${r.bootR.ciUpper.toFixed(4)}]`.padEnd(31);
  const sigStr = (r.bootN.isSignificant ? "YES" : "NO").padEnd(4);
  console.log(`${dStr} | ${mStr} | ${tunNStr} | ${tstNStr} | ${allNStr} | ${deltaNStr} | ${allRStr} | ${deltaRStr} | ${sigStr} | ${r.concordance}`);
}
console.log("------------------------------------------------------------------------------------------------------------------------------------------------------");

experimentResults.task1 = {
  baseline: {
    damping: 0.20,
    genreOverlap: 0,
    tuningNDCG: baseTunNdcg.mean,
    testNDCG: baseTstNdcg.mean,
    allNDCG: baseAllNdcg.mean,
    tuningRecall: baseTunRec.mean,
    testRecall: baseTstRec.mean,
    allRecall: baseAllRec.mean,
    ndcgScores: Array.from(baseRankerAll.ndcg),
    recallScores: Array.from(baseRankerAll.recall)
  },
  grid: gridResults.map(r => ({
    damping: r.damping,
    multiplier: r.multiplier,
    genreWeight: r.genreWeight,
    tunN: r.tunN,
    tunR: r.tunR,
    tstN: r.tstN,
    tstR: r.tstR,
    allN: r.allN,
    allR: r.allR,
    bootN: {
      meanDiff: r.bootN.meanDiff,
      ciLower: r.bootN.ciLower,
      ciUpper: r.bootN.ciUpper,
      isSignificant: r.bootN.isSignificant
    },
    bootR: {
      meanDiff: r.bootR.meanDiff,
      ciLower: r.bootR.ciLower,
      ciUpper: r.bootR.ciUpper,
      isSignificant: r.bootR.isSignificant
    },
    concordance: r.concordance,
    ndcgScores: r.ndcgScores,
    recallScores: r.recallScores
  }))
};

// ==========================================================================
// TASK 2: LEAKAGE SPLIT (OVERLAP VS. NO-OVERLAP IN ML-32M)
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 2: LEAKAGE SPLIT (OVERLAP VS. NO-OVERLAP IN ML-32M)");
console.log("==========================================================================");

const overlapData = JSON.parse(fs.readFileSync(path.join(root, ".data/overlap_users.json"), "utf8"));
const overlapSet = new Set(overlapData.overlapUserIds);
console.log(`Overlap Audit: ${overlapData.matchedUsersCount} users with ratings in ml-32m, ${overlapData.noOverlapUserIds.length} users with NO ratings in ml-32m.`);
console.log(`Total matched ratings in 32M: ${overlapData.matchedRatingsCount} / ${overlapData.totalRatings} (${(overlapData.matchedRatingsCount / overlapData.totalRatings * 100).toFixed(2)}%)`);

// Evaluate 4 systems across all 328 users:
// (a) Popularity baseline
// (b) collabSim alone (raw dot)
// (c) Feature-poor ranker (damping 0.20, genreOverlap = 0)
// (d) Current ranker (damping 0.20, 1x genreOverlap)

const t2_systems = {
  popularity: { ndcg: new Float64Array(allEligibleUsers.length), recall: new Float64Array(allEligibleUsers.length) },
  collab_dot: { ndcg: new Float64Array(allEligibleUsers.length), recall: new Float64Array(allEligibleUsers.length) },
  feature_poor: { ndcg: baseRankerAll.ndcg, recall: baseRankerAll.recall },
  current_ranker: { ndcg: new Float64Array(allEligibleUsers.length), recall: new Float64Array(allEligibleUsers.length) }
};

for (let u = 0; u < userContexts.length; u++) {
  const ctx = userContexts[u];

  // (a) Popularity baseline
  const popRanked = [...ctx.candidatesHyb].sort((a, b) => {
    const sA = computeBayesianScore(a.vote_average, a.vote_count);
    const sB = computeBayesianScore(b.vote_average, b.vote_count);
    return sB - sA;
  });
  const popIds = popRanked.map(getMovieKey);
  t2_systems.popularity.ndcg[u] = computeNDCGAtK(popIds, ctx.holdoutRelevance, 10);
  t2_systems.popularity.recall[u] = computeRecallAtK(popIds, ctx.holdoutPositives, 20);

  // (b) collabSim alone (raw dot)
  const dotRanked = [...ctx.candidatesHyb].sort((a, b) => {
    const sA = Number(ctx.hybCollabMap.get(Number(a.tmdbId)) ?? -999);
    const sB = Number(ctx.hybCollabMap.get(Number(b.tmdbId)) ?? -999);
    return sB - sA;
  });
  const dotIds = dotRanked.map(getMovieKey);
  t2_systems.collab_dot.ndcg[u] = computeNDCGAtK(dotIds, ctx.holdoutRelevance, 10);
  t2_systems.collab_dot.recall[u] = computeRecallAtK(dotIds, ctx.holdoutPositives, 20);

  // (d) Current ranker (damping 0.20, 1x genreOverlap)
  const curRanked = rankCandidatePool(
    ctx.candidatesHyb,
    {
      profile: ctx.hybProfile,
      collabSimMap: ctx.hybCollabMap,
      contentSimMap: new Map(),
      repulsionMap: ctx.hybRepulsionMap,
      anchorKeywords: ctx.hybProfile.lovedKeywordIds || [],
      userProviders: []
    },
    DEFAULT_RANKER_WEIGHTS,
    ctx.candidatesHyb.length,
    { metadataDampingFactor: 0.20 }
  );
  const curIds = curRanked.map(getMovieKey);
  t2_systems.current_ranker.ndcg[u] = computeNDCGAtK(curIds, ctx.holdoutRelevance, 10);
  t2_systems.current_ranker.recall[u] = computeRecallAtK(curIds, ctx.holdoutPositives, 20);
}

// Split metrics by overlap vs no-overlap
const overlapIndices = [];
const noOverlapIndices = [];
for (let u = 0; u < allEligibleUsers.length; u++) {
  if (overlapSet.has(allEligibleUsers[u].uid)) {
    overlapIndices.push(u);
  } else {
    noOverlapIndices.push(u);
  }
}

function computeSubsetStats(arr, indices) {
  const sub = indices.map(i => arr[i]);
  return stats(sub);
}

console.log("\nTASK 2: Performance Breakdown by 32M Overlap Group:");
console.log("-----------------------------------------------------------------------------------------------------------------------------");
console.log("System                   | Overlap (N=321) NDCG@10 | No-Overlap (N=7) NDCG@10 | Overlap Recall@20  | No-Overlap Recall@20");
console.log("-----------------------------------------------------------------------------------------------------------------------------");
const sysKeys = ["popularity", "collab_dot", "feature_poor", "current_ranker"];
const sysLabels = {
  popularity: "1. Popularity Baseline",
  collab_dot: "2. collabSim Alone (raw dot)",
  feature_poor: "3. Feature-Poor Ranker",
  current_ranker: "4. Current Ranker (Hybrid 0.20)"
};

const task2Out = {};

for (const k of sysKeys) {
  const oN = computeSubsetStats(t2_systems[k].ndcg, overlapIndices);
  const noN = computeSubsetStats(t2_systems[k].ndcg, noOverlapIndices);
  const oR = computeSubsetStats(t2_systems[k].recall, overlapIndices);
  const noR = computeSubsetStats(t2_systems[k].recall, noOverlapIndices);

  const label = sysLabels[k].padEnd(24);
  const oNStr = `${oN.mean.toFixed(4)} ± ${oN.std.toFixed(4)}`.padEnd(23);
  const noNStr = `${noN.mean.toFixed(4)} ± ${noN.std.toFixed(4)}`.padEnd(24);
  const oRStr = `${oR.mean.toFixed(4)} ± ${oR.std.toFixed(4)}`.padEnd(18);
  const noRStr = `${noR.mean.toFixed(4)} ± ${noR.std.toFixed(4)}`;

  console.log(`${label} | ${oNStr} | ${noNStr} | ${oRStr} | ${noRStr}`);

  task2Out[k] = {
    overlapNdcg: oN.mean,
    overlapNdcgStd: oN.std,
    noOverlapNdcg: noN.mean,
    noOverlapNdcgStd: noN.std,
    overlapRecall: oR.mean,
    overlapRecallStd: oR.std,
    noOverlapRecall: noR.mean,
    noOverlapRecallStd: noR.std
  };
}
console.log("-----------------------------------------------------------------------------------------------------------------------------");
console.log(`NOTE ON CIs: No-overlap group size is N=${noOverlapIndices.length}. With N=7, confidence intervals are too wide and unstable to report formal 95% CIs.`);

experimentResults.task2 = {
  overlapUsersCount: overlapIndices.length,
  noOverlapUsersCount: noOverlapIndices.length,
  systems: task2Out
};

// ==========================================================================
// TASK 3: LONG-TAIL METRICS
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 3: LONG-TAIL METRICS");
console.log("==========================================================================");

// 1. Identify Catalog Popularity Split: Top 20% vs Bottom 80%
const sortedCatalogByVotes = [...hybridMlCatalog].sort((a, b) => b.vote_count - a.vote_count);
const top20CutoffIdx = Math.floor(0.20 * sortedCatalogByVotes.length);
const thresholdVoteCount = sortedCatalogByVotes[top20CutoffIdx].vote_count;
console.log(`Catalog size: ${sortedCatalogByVotes.length} films.`);
console.log(`Top 20% cutoff threshold: vote_count >= ${thresholdVoteCount} (${top20CutoffIdx} movies labeled POPULAR).`);
console.log(`Bottom 80% long-tail: vote_count < ${thresholdVoteCount} (${sortedCatalogByVotes.length - top20CutoffIdx} movies labeled LONG-TAIL).`);

const popularMovieIds = new Set(sortedCatalogByVotes.slice(0, top20CutoffIdx).map(m => Number(m.tmdbId)));

// Split held-out positives for each user
let totalHeldOutPos = 0;
let totalHeldOutPop = 0;
let totalHeldOutLT = 0;

const userHoldoutSplits = [];
for (let u = 0; u < userContexts.length; u++) {
  const ctx = userContexts[u];
  const popPos = new Set();
  const ltPos = new Set();
  const ltRelevance = new Map();

  for (const tidStr of ctx.holdoutPositives) {
    const tid = Number(tidStr);
    const rel = ctx.holdoutRelevance.get(tidStr) || 0;
    if (popularMovieIds.has(tid)) {
      popPos.add(tidStr);
      totalHeldOutPop++;
    } else {
      ltPos.add(tidStr);
      ltRelevance.set(tidStr, rel);
      totalHeldOutLT++;
    }
    totalHeldOutPos++;
  }
  userHoldoutSplits.push({ popPos, ltPos, ltRelevance });
}

console.log(`Held-out positives summary across all 328 users:`);
console.log(`- Total held-out positives: ${totalHeldOutPos} (10 per user = 3,280 total)`);
console.log(`- Popular held-out positives: ${totalHeldOutPop} (${(totalHeldOutPop / totalHeldOutPos * 100).toFixed(1)}%)`);
console.log(`- Long-tail held-out positives: ${totalHeldOutLT} (${(totalHeldOutLT / totalHeldOutPos * 100).toFixed(1)}%)`);

// Evaluate the 3 systems on Long-Tail & Popularity Metrics:
// (a) Popularity baseline
// (b) collabSim alone (raw dot)
// (c) Current ranker (damping 0.20, 1x genreOverlap)

const t3_evals = {
  popularity: {
    ltNdcg: new Float64Array(userContexts.length),
    ltRecall: new Float64Array(userContexts.length),
    popRecall: new Float64Array(userContexts.length),
    meanLogCount: new Float64Array(userContexts.length),
    top10Unique: new Set(),
    top10LtShare: new Float64Array(userContexts.length)
  },
  collab_dot: {
    ltNdcg: new Float64Array(userContexts.length),
    ltRecall: new Float64Array(userContexts.length),
    popRecall: new Float64Array(userContexts.length),
    meanLogCount: new Float64Array(userContexts.length),
    top10Unique: new Set(),
    top10LtShare: new Float64Array(userContexts.length)
  },
  current_ranker: {
    ltNdcg: new Float64Array(userContexts.length),
    ltRecall: new Float64Array(userContexts.length),
    popRecall: new Float64Array(userContexts.length),
    meanLogCount: new Float64Array(userContexts.length),
    top10Unique: new Set(),
    top10LtShare: new Float64Array(userContexts.length)
  }
};

for (let u = 0; u < userContexts.length; u++) {
  const ctx = userContexts[u];
  const { popPos, ltPos, ltRelevance } = userHoldoutSplits[u];

  // 1. Popularity ranked list
  const popRanked = [...ctx.candidatesHyb].sort((a, b) => {
    const sA = computeBayesianScore(a.vote_average, a.vote_count);
    const sB = computeBayesianScore(b.vote_average, b.vote_count);
    return sB - sA;
  });
  const popIds = popRanked.map(getMovieKey);
  t3_evals.popularity.ltNdcg[u] = computeNDCGAtK(popIds, ltRelevance, 10);
  t3_evals.popularity.ltRecall[u] = computeRecallAtK(popIds, ltPos, 20);
  t3_evals.popularity.popRecall[u] = computeRecallAtK(popIds, popPos, 20);

  let pLogSum = 0, pLtCount = 0;
  for (let i = 0; i < 10 && i < popRanked.length; i++) {
    const tid = Number(popRanked[i].tmdbId);
    const cnt = movieRatingCounts.get(tid) || popRanked[i].vote_count || 1;
    pLogSum += Math.log(cnt);
    t3_evals.popularity.top10Unique.add(tid);
    if (!popularMovieIds.has(tid)) pLtCount++;
  }
  t3_evals.popularity.meanLogCount[u] = pLogSum / 10;
  t3_evals.popularity.top10LtShare[u] = (pLtCount / 10) * 100;

  // 2. collabSim (raw dot) ranked list
  const dotRanked = [...ctx.candidatesHyb].sort((a, b) => {
    const sA = Number(ctx.hybCollabMap.get(Number(a.tmdbId)) ?? -999);
    const sB = Number(ctx.hybCollabMap.get(Number(b.tmdbId)) ?? -999);
    return sB - sA;
  });
  const dotIds = dotRanked.map(getMovieKey);
  t3_evals.collab_dot.ltNdcg[u] = computeNDCGAtK(dotIds, ltRelevance, 10);
  t3_evals.collab_dot.ltRecall[u] = computeRecallAtK(dotIds, ltPos, 20);
  t3_evals.collab_dot.popRecall[u] = computeRecallAtK(dotIds, popPos, 20);

  let dLogSum = 0, dLtCount = 0;
  for (let i = 0; i < 10 && i < dotRanked.length; i++) {
    const tid = Number(dotRanked[i].tmdbId);
    const cnt = movieRatingCounts.get(tid) || dotRanked[i].vote_count || 1;
    dLogSum += Math.log(cnt);
    t3_evals.collab_dot.top10Unique.add(tid);
    if (!popularMovieIds.has(tid)) dLtCount++;
  }
  t3_evals.collab_dot.meanLogCount[u] = dLogSum / 10;
  t3_evals.collab_dot.top10LtShare[u] = (dLtCount / 10) * 100;

  // 3. Current ranker ranked list
  const curRanked = rankCandidatePool(
    ctx.candidatesHyb,
    {
      profile: ctx.hybProfile,
      collabSimMap: ctx.hybCollabMap,
      contentSimMap: new Map(),
      repulsionMap: ctx.hybRepulsionMap,
      anchorKeywords: ctx.hybProfile.lovedKeywordIds || [],
      userProviders: []
    },
    DEFAULT_RANKER_WEIGHTS,
    ctx.candidatesHyb.length,
    { metadataDampingFactor: 0.20 }
  );
  const curIds = curRanked.map(getMovieKey);
  t3_evals.current_ranker.ltNdcg[u] = computeNDCGAtK(curIds, ltRelevance, 10);
  t3_evals.current_ranker.ltRecall[u] = computeRecallAtK(curIds, ltPos, 20);
  t3_evals.current_ranker.popRecall[u] = computeRecallAtK(curIds, popPos, 20);

  let cLogSum = 0, cLtCount = 0;
  for (let i = 0; i < 10 && i < curRanked.length; i++) {
    const tid = Number(curRanked[i].tmdbId);
    const cnt = movieRatingCounts.get(tid) || curRanked[i].vote_count || 1;
    cLogSum += Math.log(cnt);
    t3_evals.current_ranker.top10Unique.add(tid);
    if (!popularMovieIds.has(tid)) cLtCount++;
  }
  t3_evals.current_ranker.meanLogCount[u] = cLogSum / 10;
  t3_evals.current_ranker.top10LtShare[u] = (cLtCount / 10) * 100;
}

console.log("\nTASK 3: Long-Tail & Popularity Evaluation Table (All 328 Users):");
console.log("----------------------------------------------------------------------------------------------------------------------------------------");
console.log("System                  | LT NDCG@10 | LT Recall@20 | Pop Recall@20 | Mean log(Votes) | Catalog Cov (%)     | LT Share of Top10 (%)");
console.log("----------------------------------------------------------------------------------------------------------------------------------------");
const t3Keys = ["popularity", "collab_dot", "current_ranker"];
const t3Labels = {
  popularity: "1. Popularity Baseline",
  collab_dot: "2. collabSim Alone (raw dot)",
  current_ranker: "3. Current Ranker (Damping 0.20)"
};

for (const k of t3Keys) {
  const d = t3_evals[k];
  const ltN = stats(d.ltNdcg).mean.toFixed(4).padEnd(10);
  const ltR = stats(d.ltRecall).mean.toFixed(4).padEnd(12);
  const popR = stats(d.popRecall).mean.toFixed(4).padEnd(13);
  const logV = stats(d.meanLogCount).mean.toFixed(3).padEnd(15);
  const covPct = (d.top10Unique.size / hybridMlCatalog.length * 100).toFixed(2);
  const covStr = `${d.top10Unique.size} (${covPct}%)`.padEnd(19);
  const ltShr = `${stats(d.top10LtShare).mean.toFixed(2)}%`.padEnd(20);
  console.log(`${t3Labels[k].padEnd(23)} | ${ltN} | ${ltR} | ${popR} | ${logV} | ${covStr} | ${ltShr}`);
}
console.log("----------------------------------------------------------------------------------------------------------------------------------------");

// Paired bootstrap 95% CIs: Current Ranker vs collabSim Alone
console.log("\nTASK 3: Paired Bootstrap 95% Confidence Intervals: Current Ranker vs. collabSim Alone (1,000 resamples):");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Metric                             | Mean Delta | 95% Paired Bootstrap CI  | Significant?");
console.log("----------------------------------------------------------------------------------------------------------");
const t3_metrics_to_test = [
  { name: "Long-Tail NDCG@10", cand: t3_evals.current_ranker.ltNdcg, base: t3_evals.collab_dot.ltNdcg },
  { name: "Long-Tail Recall@20", cand: t3_evals.current_ranker.ltRecall, base: t3_evals.collab_dot.ltRecall },
  { name: "Popular Recall@20", cand: t3_evals.current_ranker.popRecall, base: t3_evals.collab_dot.popRecall },
  { name: "Mean log(rating_count) Top10", cand: t3_evals.current_ranker.meanLogCount, base: t3_evals.collab_dot.meanLogCount },
  { name: "Long-Tail Share of Top10 (%)", cand: t3_evals.current_ranker.top10LtShare, base: t3_evals.collab_dot.top10LtShare }
];

const t3BootstrapResults = {};
for (const m of t3_metrics_to_test) {
  const boot = pairedBootstrapCI(m.cand, m.base);
  const nameP = m.name.padEnd(34);
  const dStr = `${boot.meanDiff >= 0 ? "+" : ""}${boot.meanDiff.toFixed(4)}`.padEnd(10);
  const ciStr = `[${boot.ciLower >= 0 ? "+" : ""}${boot.ciLower.toFixed(4)}, ${boot.ciUpper >= 0 ? "+" : ""}${boot.ciUpper.toFixed(4)}]`.padEnd(24);
  const sigStr = boot.isSignificant ? "YES (Significant)" : "NO (Includes 0)";
  console.log(`${nameP} | ${dStr} | ${ciStr} | ${sigStr}`);
  t3BootstrapResults[m.name] = boot;
}
console.log("----------------------------------------------------------------------------------------------------------");

experimentResults.task3 = {
  thresholdVoteCount,
  totalHeldOutPos,
  totalHeldOutPop,
  totalHeldOutLT,
  systems: {
    popularity: {
      ltNdcg: stats(t3_evals.popularity.ltNdcg).mean,
      ltRecall: stats(t3_evals.popularity.ltRecall).mean,
      popRecall: stats(t3_evals.popularity.popRecall).mean,
      meanLogCount: stats(t3_evals.popularity.meanLogCount).mean,
      top10UniqueCount: t3_evals.popularity.top10Unique.size,
      top10UniquePct: t3_evals.popularity.top10Unique.size / hybridMlCatalog.length * 100,
      ltShareTop10: stats(t3_evals.popularity.top10LtShare).mean
    },
    collab_dot: {
      ltNdcg: stats(t3_evals.collab_dot.ltNdcg).mean,
      ltRecall: stats(t3_evals.collab_dot.ltRecall).mean,
      popRecall: stats(t3_evals.collab_dot.popRecall).mean,
      meanLogCount: stats(t3_evals.collab_dot.meanLogCount).mean,
      top10UniqueCount: t3_evals.collab_dot.top10Unique.size,
      top10UniquePct: t3_evals.collab_dot.top10Unique.size / hybridMlCatalog.length * 100,
      ltShareTop10: stats(t3_evals.collab_dot.top10LtShare).mean
    },
    current_ranker: {
      ltNdcg: stats(t3_evals.current_ranker.ltNdcg).mean,
      ltRecall: stats(t3_evals.current_ranker.ltRecall).mean,
      popRecall: stats(t3_evals.current_ranker.popRecall).mean,
      meanLogCount: stats(t3_evals.current_ranker.meanLogCount).mean,
      top10UniqueCount: t3_evals.current_ranker.top10Unique.size,
      top10UniquePct: t3_evals.current_ranker.top10Unique.size / hybridMlCatalog.length * 100,
      ltShareTop10: stats(t3_evals.current_ranker.top10LtShare).mean
    }
  },
  bootstrapVsCollab: t3BootstrapResults
};

// ==========================================================================
// TASK 4: DECAY ON OLD TIMESTAMPS
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 4: DECAY ON OLD TIMESTAMPS");
console.log("==========================================================================");

// Sample 10 diverse users across the 328
const sampleIndices = [0, 32, 65, 98, 131, 164, 197, 230, 263, 296];
const sampleUsers = sampleIndices.map(idx => allEligibleUsers[idx]);
console.log(`Selected 10 diverse users: ${sampleUsers.map(u => u.uid).join(", ")}`);

const shifts = [
  { label: "30 days before Date.now()", days: 30 },
  { label: "1 year before Date.now()", days: 365 },
  { label: "3 years before Date.now()", days: 3 * 365 },
  { label: "8 years before Date.now()", days: 8 * 365 }
];

const task4Results = [];

for (const shift of shifts) {
  const targetNewestMs = Date.now() - shift.days * 86400000;
  
  let allMinWeights = [], allMedWeights = [], allMaxWeights = [];
  let allMinDecay = [], allMedDecay = [], allMaxDecay = [];
  let totalLikedFilms = 0, likedUnderThreshold = 0;
  let nonZeroPersonaCount = 0;
  let nonNullFallbackCount = 0;

  for (const user of sampleUsers) {
    const { trainWatched } = getUserSplit(user);
    const maxTs = Math.max(...trainWatched.map(m => m.ts));
    const offsetMs = targetNewestMs - maxTs;

    // Shift timestamps
    const shiftedWatched = trainWatched.map(m => {
      const shiftedTs = m.ts + offsetMs;
      return {
        ...m,
        ts: shiftedTs,
        dateWatched: new Date(shiftedTs).toISOString()
      };
    });

    // Run through production decay path (unanchored Date.now())
    const profile = await extractTasteProfile(shiftedWatched, [], {});
    const zScored = profile.weightedRatings || [];

    const weights = zScored.map(e => Number(e.weight || e.finalWeight || 0));
    const decays = zScored.map(e => Number(e.timeDecay || 0));
    weights.sort((a, b) => a - b);
    decays.sort((a, b) => a - b);

    if (weights.length > 0) {
      allMinWeights.push(weights[0]);
      allMedWeights.push(weights[Math.floor(weights.length / 2)]);
      allMaxWeights.push(weights[weights.length - 1]);
    }
    if (decays.length > 0) {
      allMinDecay.push(decays[0]);
      allMedDecay.push(decays[Math.floor(decays.length / 2)]);
      allMaxDecay.push(decays[decays.length - 1]);
    }

    for (const e of zScored) {
      const r = Number(e.rating || e.movie?.userRating || 0);
      const w = Number(e.weight || e.finalWeight || 0);
      if (r >= 8) {
        totalLikedFilms++;
        if (Math.abs(w) < 0.01) likedUnderThreshold++;
      }
    }

    const personas = computeUserPersonas(zScored, embeddingIndex);
    if (personas.length > 0) nonZeroPersonaCount++;
    const fb = computeUserEmbedding(zScored, embeddingIndex);
    if (fb !== null) nonNullFallbackCount++;
  }

  const avgMinW = stats(allMinWeights).mean;
  const avgMedW = stats(allMedWeights).mean;
  const avgMaxW = stats(allMaxWeights).mean;
  const avgMinD = stats(allMinDecay).mean;
  const avgMedD = stats(allMedDecay).mean;
  const avgMaxD = stats(allMaxDecay).mean;

  task4Results.push({
    shift: shift.label,
    days: shift.days,
    minDecay: avgMinD,
    medDecay: avgMedD,
    maxDecay: avgMaxD,
    minWeight: avgMinW,
    medWeight: avgMedW,
    maxWeight: avgMaxW,
    personasActive: `${nonZeroPersonaCount} / 10`,
    fallbackActive: `${nonNullFallbackCount} / 10`,
    totalLikedFilms,
    likedUnderThreshold,
    pctUnderThreshold: (likedUnderThreshold / totalLikedFilms * 100).toFixed(1)
  });
}

console.log("\nTASK 4: Production Decay Behavior on Aging Timestamps (Unanchored Real Date.now()):");
console.log("------------------------------------------------------------------------------------------------------------------------------------------------");
console.log("Timestamp Shift           | TimeDecay (Min / Med / Max)       | Weight (Min / Med / Max)          | Personas Non-Empty | Liked Films Weight < 0.01");
console.log("------------------------------------------------------------------------------------------------------------------------------------------------");
for (const r of task4Results) {
  const sStr = r.shift.padEnd(25);
  const dStr = `${r.minDecay.toFixed(4)} / ${r.medDecay.toFixed(4)} / ${r.maxDecay.toFixed(4)}`.padEnd(33);
  const wStr = `${r.minWeight.toFixed(4)} / ${r.medWeight.toFixed(4)} / ${r.maxWeight.toFixed(4)}`.padEnd(33);
  const pStr = `${r.personasActive} users`.padEnd(18);
  const lStr = `${r.likedUnderThreshold} / ${r.totalLikedFilms} (${r.pctUnderThreshold}%)`;
  console.log(`${sStr} | ${dStr} | ${wStr} | ${pStr} | ${lStr}`);
}
console.log("------------------------------------------------------------------------------------------------------------------------------------------------");

// Check scoringUtils.js bulkPriorDays fallback logic
console.log("\nAuditing CSV Bulk Import Fallback in scoringUtils.js:");
console.log("- Location: scoringUtils.js:64-70");
console.log("- Behavior when movie.isBulkImported = true OR dateWatched is missing: daysSince = bulkPriorDays (default 180 days).");
console.log("  => At 180 days: timeDecay = e^(-0.002 * 180) = e^(-0.36) = 0.6977 (~70% retention).");
console.log("- Behavior when real timestamps ARE present on old imports (movie.dateWatched set):");
console.log("  => daysSince = Math.max(0, (Date.now() - parsedMs) / 86400000).");
console.log("  => If an imported rating is from 2018 (8 years old = 2,920 days):");
console.log("     timeDecay = e^(-0.002 * 2920) = 0.0029 (0.29% retention).");
console.log("  => If an imported rating is from 2000 (26 years old = 9,500 days):");
console.log("     timeDecay = e^(-0.002 * 9500) = 5.6e-9 (skipped in personas: weight <= 1e-6!).");

experimentResults.task4 = {
  shifts: task4Results,
  bulkImportExplanation: {
    codePath: "scoringUtils.js lines 64-70",
    missingDateDecay: Math.exp(-0.002 * 180),
    threeYearDecay: Math.exp(-0.002 * 1095),
    eightYearDecay: Math.exp(-0.002 * 2920)
  }
};

// ==========================================================================
// TASK 5: REAL-VAULT COVERAGE
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 5: REAL-VAULT COVERAGE");
console.log("==========================================================================");

const allProjectFiles = fs.readdirSync(root);
const dataFiles = fs.readdirSync(path.join(root, ".data"));
const csvFiles = [...allProjectFiles, ...dataFiles.map(f => path.join(".data", f))].filter(f => f.endsWith(".csv"));

console.log(`CSV files found in root or .data/: ${csvFiles.length > 0 ? csvFiles.join(", ") : "None"}`);

const expectedColumns = [
  { column: "Title", role: "Movie title", aliases: ["Title", "Film", "Name"], required: true },
  { column: "Year", role: "Release year", aliases: ["Year", "Released"], required: false },
  { column: "Rating / My Rating", role: "User rating (1-10 or 1-5 or 0.5-5 stars)", aliases: ["Rating", "My Rating", "User Rating", "Stars", "Rating10"], required: true },
  { column: "Date Watched", role: "Watch date timestamp", aliases: ["Date Watched", "Watched Date", "Date"], required: false },
  { column: "IMDb ID", role: "Direct IMDb reference (e.g. tt0111161)", aliases: ["IMDb ID", "Const", "id"], required: false },
  { column: "Review / Notes", role: "User review note", aliases: ["Notes", "Review", "Comment"], required: false },
  { column: "Type / List", role: "List type ('Watched' vs 'Watchlist')", aliases: ["Type", "List"], required: false }
];

console.log("\nExact CSV Columns Expected by CinemaVault (from src/components/BackupManagerModal.jsx):");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Expected Header       | Required? | Recognized Synonyms / Formats                | Processing Effect");
console.log("----------------------------------------------------------------------------------------------------------");
expectedColumns.forEach(c => {
  console.log(`${c.column.padEnd(21)} | ${(c.required ? "YES" : "Optional").padEnd(9)} | ${c.aliases.join(", ").padEnd(44)} | ${c.role}`);
});
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Letterboxd Standard Export Format:");
console.log("  Header: Title,Year,Rating10");
console.log("  Or Letterboxd diary export: Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date");

experimentResults.task5 = {
  csvFilesFound: csvFiles,
  expectedColumns
};

// ==========================================================================
// SAVE ALL PER-USER RESULTS TO .DATA/EXPERIMENTS_RESULTS_V2.JSON
// ==========================================================================
const outV2Path = path.join(root, ".data/experiments_results_v2.json");
fs.writeFileSync(outV2Path, JSON.stringify(experimentResults, null, 2));
console.log(`\nPer-user experimental results saved to: ${outV2Path}`);
console.log("==========================================================================");
console.log("PHASE 2 RIGOROUS EXPERIMENTAL SUITE COMPLETE.");
console.log("==========================================================================");
