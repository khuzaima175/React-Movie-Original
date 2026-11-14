import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "g:/Important Projects/movie-ratings";
const importSrc = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { parseEmbeddingBinary, buildCollabSimMapFromIndex, buildRepulsionMapFromIndex } = await importSrc("src/services/embeddingService.js");
const { computeRecallAtK, computeNDCGAtK, computeNovelty } = await importSrc("src/services/evalHarness.js");
const { rankCandidatePool, extractCandidateFeatures, DEFAULT_RANKER_WEIGHTS } = await importSrc("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await importSrc("src/services/tmdbService.js");
const { computeBayesianScore } = await importSrc("src/services/scoringUtils.js");

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

console.log("==========================================================================");
console.log("CINEMAVAULT RIGOROUS OFFLINE EXPERIMENTAL SUITE");
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

// Construct catalog: base (feature-poor) and enriched (hybrid)
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
console.log(`Constructed catalogs: ${hybridMlCatalog.length} movies.`);

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
console.log(`Partitioned users: Tuning = ${tuningUsers.length}, Locked Test = ${lockedTestUsers.length}`);

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
  const m = s / arr.length;
  let varSum = 0;
  for (let i = 0; i < arr.length; i++) varSum += (arr[i] - m) ** 2;
  return { mean: m, std: Math.sqrt(varSum / arr.length) };
}

const experimentResults = {
  task1: {},
  task2: {},
  task3: {},
  task4: {}
};

// ==========================================================================
// TASK 1: CORRECTED BASELINES UNDER FIXED HARNESS (LOCKED TEST SET - 168 USERS)
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 1: CORRECTED BASELINES UNDER FIXED HARNESS (168 LOCKED TEST USERS)");
console.log("==========================================================================");

// Build Unit-Norm Index for Cosine Similarity
const unitNormVectors = new Float32Array(embCount * embDim);
for (let i = 0; i < embCount; i++) {
  const base = i * embDim;
  let normSq = 0;
  for (let d = 0; d < embDim; d++) normSq += embVectors[base + d] * embVectors[base + d];
  const invNorm = normSq > 1e-12 ? 1 / Math.sqrt(normSq) : 0;
  for (let d = 0; d < embDim; d++) unitNormVectors[base + d] = embVectors[base + d] * invNorm;
}
const unitNormIndex = { count: embCount, dim: embDim, ids: embIds, vectors: unitNormVectors, idToIndex: embIdToIndex };

const t1_pop = { ndcg: new Float64Array(lockedTestUsers.length), recall: new Float64Array(lockedTestUsers.length) };
const t1_dot = { ndcg: new Float64Array(lockedTestUsers.length), recall: new Float64Array(lockedTestUsers.length) };
const t1_cos = { ndcg: new Float64Array(lockedTestUsers.length), recall: new Float64Array(lockedTestUsers.length) };
const t1_ranker = { ndcg: new Float64Array(lockedTestUsers.length), recall: new Float64Array(lockedTestUsers.length) };

for (let u = 0; u < lockedTestUsers.length; u++) {
  const user = lockedTestUsers[u];
  const { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs } = getUserSplit(user);
  const trainKeys = new Set(trainWatched.map(getMovieKey));
  const candidates = hybridMlCatalog.filter(c => !trainKeys.has(getMovieKey(c)));

  const profile = await extractTasteProfile(trainWatched, [], { now: holdoutStartTs, anchorCutoff: Infinity });
  const rawCollabMap = buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex);
  const cosCollabMap = buildCollabSimMapFromIndex(profile.weightedRatings, unitNormIndex);
  const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex);

  // (a) Popularity baseline (sort by bayesian rating)
  const popRanked = [...candidates].sort((a, b) => {
    const sA = computeBayesianScore(a.vote_average, a.vote_count);
    const sB = computeBayesianScore(b.vote_average, b.vote_count);
    return sB - sA;
  });
  const popIds = popRanked.map(getMovieKey);
  t1_pop.ndcg[u] = computeNDCGAtK(popIds, holdoutRelevance, 10);
  t1_pop.recall[u] = computeRecallAtK(popIds, holdoutPositives, 20);

  // (b) collabSim alone, raw dot product
  const dotRanked = [...candidates].sort((a, b) => {
    const sA = Number(rawCollabMap.get(Number(a.tmdbId)) ?? -999);
    const sB = Number(rawCollabMap.get(Number(b.tmdbId)) ?? -999);
    return sB - sA;
  });
  const dotIds = dotRanked.map(getMovieKey);
  t1_dot.ndcg[u] = computeNDCGAtK(dotIds, holdoutRelevance, 10);
  t1_dot.recall[u] = computeRecallAtK(dotIds, holdoutPositives, 20);

  // (c) collabSim alone, cosine similarity
  const cosRanked = [...candidates].sort((a, b) => {
    const sA = Number(cosCollabMap.get(Number(a.tmdbId)) ?? -999);
    const sB = Number(cosCollabMap.get(Number(b.tmdbId)) ?? -999);
    return sB - sA;
  });
  const cosIds = cosRanked.map(getMovieKey);
  t1_cos.ndcg[u] = computeNDCGAtK(cosIds, holdoutRelevance, 10);
  t1_cos.recall[u] = computeRecallAtK(cosIds, holdoutPositives, 20);

  // (d) current rankerService (damping 0.20)
  const rankerRanked = rankCandidatePool(
    candidates,
    {
      profile,
      collabSimMap: rawCollabMap,
      contentSimMap: new Map(),
      repulsionMap,
      anchorKeywords: profile.lovedKeywordIds || [],
      userProviders: []
    },
    DEFAULT_RANKER_WEIGHTS,
    candidates.length,
    { metadataDampingFactor: 0.20 }
  );
  const rankerIds = rankerRanked.map(getMovieKey);
  t1_ranker.ndcg[u] = computeNDCGAtK(rankerIds, holdoutRelevance, 10);
  t1_ranker.recall[u] = computeRecallAtK(rankerIds, holdoutPositives, 20);
}

experimentResults.task1 = {
  popularity: { ndcg: Array.from(t1_pop.ndcg), recall: Array.from(t1_pop.recall) },
  collab_dot: { ndcg: Array.from(t1_dot.ndcg), recall: Array.from(t1_dot.recall) },
  collab_cos: { ndcg: Array.from(t1_cos.ndcg), recall: Array.from(t1_cos.recall) },
  ranker_d020: { ndcg: Array.from(t1_ranker.ndcg), recall: Array.from(t1_ranker.recall) }
};

console.log("\nTASK 1: Baseline Metrics on Locked Test Set (168 users):");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Strategy                                | NDCG@10 (Mean ± Std)   | Recall@20 (Mean ± Std)");
console.log("----------------------------------------------------------------------------------------------------------");
const s_pop_n = stats(t1_pop.ndcg), s_pop_r = stats(t1_pop.recall);
const s_dot_n = stats(t1_dot.ndcg), s_dot_r = stats(t1_dot.recall);
const s_cos_n = stats(t1_cos.ndcg), s_cos_r = stats(t1_cos.recall);
const s_rnk_n = stats(t1_ranker.ndcg), s_rnk_r = stats(t1_ranker.recall);
console.log(`(a) Popularity baseline                 | ${s_pop_n.mean.toFixed(4)} ± ${s_pop_n.std.toFixed(4)}       | ${s_pop_r.mean.toFixed(4)} ± ${s_pop_r.std.toFixed(4)}`);
console.log(`(b) collabSim alone (raw dot product)   | ${s_dot_n.mean.toFixed(4)} ± ${s_dot_n.std.toFixed(4)}       | ${s_dot_r.mean.toFixed(4)} ± ${s_dot_r.std.toFixed(4)}`);
console.log(`(c) collabSim alone (cosine similarity) | ${s_cos_n.mean.toFixed(4)} ± ${s_cos_n.std.toFixed(4)}       | ${s_cos_r.mean.toFixed(4)} ± ${s_cos_r.std.toFixed(4)}`);
console.log(`(d) current rankerService (damping 0.20)| ${s_rnk_n.mean.toFixed(4)} ± ${s_rnk_n.std.toFixed(4)}       | ${s_rnk_r.mean.toFixed(4)} ± ${s_rnk_r.std.toFixed(4)}`);
console.log("----------------------------------------------------------------------------------------------------------");

console.log("\nTASK 1: Paired Bootstrap 95% Confidence Intervals vs (d) Current Ranker (1,000 resamples):");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Comparison vs (d) Current Ranker         | Metric    | Mean Delta | 95% Paired Bootstrap CI  | Significant?");
console.log("----------------------------------------------------------------------------------------------------------");
const comps_t1 = [
  { name: "(a) Popularity vs (d) Ranker", cand: t1_pop },
  { name: "(b) collabSim (raw dot) vs (d) Ranker", cand: t1_dot },
  { name: "(c) collabSim (cosine) vs (d) Ranker", cand: t1_cos }
];

for (const c of comps_t1) {
  const nStat = pairedBootstrapCI(c.cand.ndcg, t1_ranker.ndcg);
  const rStat = pairedBootstrapCI(c.cand.recall, t1_ranker.recall);
  const nameP = c.name.padEnd(40, " ");
  console.log(`${nameP} | NDCG@10   | ${nStat.meanDiff >= 0 ? "+" : ""}${nStat.meanDiff.toFixed(4)}     | [${nStat.ciLower >= 0 ? "+" : ""}${nStat.ciLower.toFixed(4)}, ${nStat.ciUpper >= 0 ? "+" : ""}${nStat.ciUpper.toFixed(4)}]     | ${nStat.isSignificant ? "YES (Significant)" : "NO (Includes 0)"}`);
  console.log(`${"".padEnd(40, " ")} | Recall@20 | ${rStat.meanDiff >= 0 ? "+" : ""}${rStat.meanDiff.toFixed(4)}     | [${rStat.ciLower >= 0 ? "+" : ""}${rStat.ciLower.toFixed(4)}, ${rStat.ciUpper >= 0 ? "+" : ""}${rStat.ciUpper.toFixed(4)}]     | ${rStat.isSignificant ? "YES (Significant)" : "NO (Includes 0)"}`);
  console.log("----------------------------------------------------------------------------------------------------------");
}

// ==========================================================================
// TASK 2: MAKE THE RANKER ACTUALLY HYBRID OFFLINE
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 2: MAKE THE RANKER ACTUALLY HYBRID OFFLINE");
console.log("==========================================================================");

// Audit metadata coverage in the catalog
let genreCount = 0, kwCount = 0, castCount = 0, crewCount = 0;
for (const item of hybridMlCatalog) {
  if (item.tmdbGenreIds?.length > 0) genreCount++;
  if (item.tmdbKeywords?.length > 0) kwCount++;
  if (item.castIds?.length > 0) castCount++;
  if (item.crewPersonId) crewCount++;
}
const catLen = hybridMlCatalog.length;
console.log(`\nCatalog Metadata Coverage across all ${catLen} MovieLens films:`);
console.log(`- tmdbGenreIds (mapped from MovieLens genres): ${genreCount} / ${catLen} (${(genreCount / catLen * 100).toFixed(2)}%)`);
console.log(`- tmdbKeywords (cached from TMDB):             ${kwCount} / ${catLen} (${(kwCount / catLen * 100).toFixed(2)}%)`);
console.log(`- castIds      (cached from TMDB):             ${castCount} / ${catLen} (${(castCount / catLen * 100).toFixed(2)}%)`);
console.log(`- crewPersonId (cached from TMDB):             ${crewCount} / ${catLen} (${(crewCount / catLen * 100).toFixed(2)}%)`);

// Re-audit populated ranker features with hybrid metadata
async function auditPopulatedFeatures(catalog, sampleUsers) {
  const counts = {
    collabSim: 0,
    genreOverlap: 0,
    keywordOverlap: 0,
    crewMatch: 0,
    castMatch: 0,
    bayesianRatingNorm: 0,
    noveltyBonus: 0,
    negativeKeywordPenalty: 0,
    repulsion: 0,
    providerMatch: 0
  };
  const total = catalog.length * sampleUsers.length;
  for (const user of sampleUsers) {
    const { trainWatched, holdoutStartTs } = getUserSplit(user);
    const profile = await extractTasteProfile(trainWatched, [], { now: holdoutStartTs, anchorCutoff: Infinity });
    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex);

    for (const item of catalog) {
      const feats = extractCandidateFeatures(item, {
        profile,
        collabSimMap,
        repulsionMap,
        anchorKeywords: profile.lovedKeywordIds || [],
        userProviders: []
      });
      for (const k of Object.keys(counts)) {
        if (Math.abs(Number(feats[k] || 0)) > 1e-4) counts[k]++;
      }
    }
  }
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, (v / total * 100)]));
}

const hybridFeatPercents = await auditPopulatedFeatures(hybridMlCatalog, allEligibleUsers.slice(0, 10));
console.log("\nPopulated Ranker Features Table AFTER Hybrid Fix:");
console.log("-------------------------------------------------------");
console.log("Feature                  | Populated Fraction (%)");
console.log("-------------------------------------------------------");
for (const [feat, pct] of Object.entries(hybridFeatPercents)) {
  console.log(`${feat.padEnd(25)}| ${pct.toFixed(2)}%`);
}
console.log("-------------------------------------------------------");

// Re-run ranker: Old (feature-poor) vs New (hybrid) on Tuning Set and Locked Test Set
async function runRankerComparison(userList, label) {
  const oldRanker = { ndcg: new Float64Array(userList.length), recall: new Float64Array(userList.length) };
  const newRanker = { ndcg: new Float64Array(userList.length), recall: new Float64Array(userList.length) };

  for (let u = 0; u < userList.length; u++) {
    const user = userList[u];
    const { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs } = getUserSplit(user);
    const trainKeys = new Set(trainWatched.map(getMovieKey));

    // 1. Old (feature-poor): using baseMlCatalog (no genre/cast/crew) and profile without tmdbGenreIds
    const baseTrainWatched = trainWatched.map(m => ({ ...m, tmdbGenreIds: [] }));
    const baseProfile = await extractTasteProfile(baseTrainWatched, [], { now: holdoutStartTs, anchorCutoff: Infinity });
    const baseCollab = buildCollabSimMapFromIndex(baseProfile.weightedRatings, embeddingIndex);
    const baseRep = buildRepulsionMapFromIndex(baseProfile.weightedRatings, embeddingIndex);
    const baseCandidates = baseMlCatalog.filter(c => !trainKeys.has(getMovieKey(c)));

    const oldRanked = rankCandidatePool(
      baseCandidates,
      { profile: baseProfile, collabSimMap: baseCollab, contentSimMap: new Map(), repulsionMap: baseRep, anchorKeywords: [], userProviders: [] },
      DEFAULT_RANKER_WEIGHTS,
      baseCandidates.length,
      { metadataDampingFactor: 0.20 }
    );
    const oldIds = oldRanked.map(getMovieKey);
    oldRanker.ndcg[u] = computeNDCGAtK(oldIds, holdoutRelevance, 10);
    oldRanker.recall[u] = computeRecallAtK(oldIds, holdoutPositives, 20);

    // 2. New (hybrid): using hybridMlCatalog and profile with mapped tmdbGenreIds & cached keywords/crew
    const hybProfile = await extractTasteProfile(trainWatched, [], { now: holdoutStartTs, anchorCutoff: Infinity });
    const hybCollab = buildCollabSimMapFromIndex(hybProfile.weightedRatings, embeddingIndex);
    const hybRep = buildRepulsionMapFromIndex(hybProfile.weightedRatings, embeddingIndex);
    const hybCandidates = hybridMlCatalog.filter(c => !trainKeys.has(getMovieKey(c)));

    const newRanked = rankCandidatePool(
      hybCandidates,
      { profile: hybProfile, collabSimMap: hybCollab, contentSimMap: new Map(), repulsionMap: hybRep, anchorKeywords: hybProfile.lovedKeywordIds || [], userProviders: [] },
      DEFAULT_RANKER_WEIGHTS,
      hybCandidates.length,
      { metadataDampingFactor: 0.20 }
    );
    const newIds = newRanked.map(getMovieKey);
    newRanker.ndcg[u] = computeNDCGAtK(newIds, holdoutRelevance, 10);
    newRanker.recall[u] = computeRecallAtK(newIds, holdoutPositives, 20);
  }

  return { oldRanker, newRanker };
}

const t2_tuning = await runRankerComparison(tuningUsers, "Tuning Set");
const t2_test = await runRankerComparison(lockedTestUsers, "Locked Test Set");

experimentResults.task2 = {
  tuning: {
    old: { ndcg: Array.from(t2_tuning.oldRanker.ndcg), recall: Array.from(t2_tuning.oldRanker.recall) },
    new: { ndcg: Array.from(t2_tuning.newRanker.ndcg), recall: Array.from(t2_tuning.newRanker.recall) }
  },
  test: {
    old: { ndcg: Array.from(t2_test.oldRanker.ndcg), recall: Array.from(t2_test.oldRanker.recall) },
    new: { ndcg: Array.from(t2_test.newRanker.ndcg), recall: Array.from(t2_test.newRanker.recall) }
  }
};

const s_t2_tun_old_n = stats(t2_tuning.oldRanker.ndcg), s_t2_tun_new_n = stats(t2_tuning.newRanker.ndcg);
const s_t2_tst_old_n = stats(t2_test.oldRanker.ndcg), s_t2_tst_new_n = stats(t2_test.newRanker.ndcg);
const s_t2_tst_old_r = stats(t2_test.oldRanker.recall), s_t2_tst_new_r = stats(t2_test.newRanker.recall);

console.log("\nTASK 2: Ranker Performance Comparison (Old Feature-Poor vs New Hybrid):");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Dataset           | Model                   | NDCG@10 (Mean ± Std)   | Recall@20 (Mean ± Std)");
console.log("----------------------------------------------------------------------------------------------------------");
console.log(`Tuning Set (160)  | Old (Feature-Poor)      | ${s_t2_tun_old_n.mean.toFixed(4)} ± ${s_t2_tun_old_n.std.toFixed(4)}       | ${stats(t2_tuning.oldRanker.recall).mean.toFixed(4)} ± ${stats(t2_tuning.oldRanker.recall).std.toFixed(4)}`);
console.log(`Tuning Set (160)  | New (Hybrid Populated)  | ${s_t2_tun_new_n.mean.toFixed(4)} ± ${s_t2_tun_new_n.std.toFixed(4)}       | ${stats(t2_tuning.newRanker.recall).mean.toFixed(4)} ± ${stats(t2_tuning.newRanker.recall).std.toFixed(4)}`);
console.log(`Test Set (168)    | Old (Feature-Poor)      | ${s_t2_tst_old_n.mean.toFixed(4)} ± ${s_t2_tst_old_n.std.toFixed(4)}       | ${s_t2_tst_old_r.mean.toFixed(4)} ± ${s_t2_tst_old_r.std.toFixed(4)}`);
console.log(`Test Set (168)    | New (Hybrid Populated)  | ${s_t2_tst_new_n.mean.toFixed(4)} ± ${s_t2_tst_new_n.std.toFixed(4)}       | ${s_t2_tst_new_r.mean.toFixed(4)} ± ${s_t2_tst_new_r.std.toFixed(4)}`);
console.log("----------------------------------------------------------------------------------------------------------");

const t2_boot_n = pairedBootstrapCI(t2_test.newRanker.ndcg, t2_test.oldRanker.ndcg);
const t2_boot_r = pairedBootstrapCI(t2_test.newRanker.recall, t2_test.oldRanker.recall);

console.log("\nTASK 2: Paired Bootstrap 95% CI on Locked Test Set (New Hybrid vs Old Feature-Poor):");
console.log(`- Delta NDCG@10:   ${t2_boot_n.meanDiff >= 0 ? "+" : ""}${t2_boot_n.meanDiff.toFixed(4)} | 95% CI: [${t2_boot_n.ciLower >= 0 ? "+" : ""}${t2_boot_n.ciLower.toFixed(4)}, ${t2_boot_n.ciUpper >= 0 ? "+" : ""}${t2_boot_n.ciUpper.toFixed(4)}] | ${t2_boot_n.isSignificant ? "YES (Significant)" : "NO (Includes 0)"}`);
console.log(`- Delta Recall@20: ${t2_boot_r.meanDiff >= 0 ? "+" : ""}${t2_boot_r.meanDiff.toFixed(4)} | 95% CI: [${t2_boot_r.ciLower >= 0 ? "+" : ""}${t2_boot_r.ciLower.toFixed(4)}, ${t2_boot_r.ciUpper >= 0 ? "+" : ""}${t2_boot_r.ciUpper.toFixed(4)}] | ${t2_boot_r.isSignificant ? "YES (Significant)" : "NO (Includes 0)"}`);

// ==========================================================================
// TASK 3: NORM-SCALING EXPERIMENT (POST-HOC, NO RETRAINING)
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 3: NORM-SCALING EXPERIMENT (POST-HOC, NO RETRAINING)");
console.log("==========================================================================");

// Compute original vector norms
const origNorms = new Float32Array(embCount);
for (let i = 0; i < embCount; i++) {
  const base = i * embDim;
  let sumSq = 0;
  for (let d = 0; d < embDim; d++) sumSq += embVectors[base + d] * embVectors[base + d];
  origNorms[i] = Math.sqrt(sumSq);
}

// Factory for norm-scaled index: v_i / ||v_i||^alpha
function createScaledIndex(alpha) {
  if (alpha === 0) return embeddingIndex;
  const newVectors = new Float32Array(embCount * embDim);
  for (let i = 0; i < embCount; i++) {
    const base = i * embDim;
    const n = origNorms[i];
    const denom = n > 1e-12 ? Math.pow(n, alpha) : 1.0;
    const scale = 1.0 / denom;
    for (let d = 0; d < embDim; d++) {
      newVectors[base + d] = embVectors[base + d] * scale;
    }
  }
  return { count: embCount, dim: embDim, ids: embIds, vectors: newVectors, idToIndex: embIdToIndex };
}

const alphas = [0.0, 0.25, 0.50, 0.75, 1.0];
const dampingsT3 = [0.20, 1.00];

console.log("Pre-computing scaled indices for alpha in {0, 0.25, 0.5, 0.75, 1.0}...");
const scaledIndices = new Map();
for (const a of alphas) {
  scaledIndices.set(a, createScaledIndex(a));
}

// Function to evaluate the 10 configs on a set of users
async function evaluateTask3Configs(userList, isTestSet = false) {
  // Results structure: configIdx -> per-user arrays
  const configsData = Array.from({ length: alphas.length * dampingsT3.length }, () => ({
    ndcg: new Float64Array(userList.length),
    recall: new Float64Array(userList.length),
    meanLogCount: new Float64Array(userList.length),
    top10Unique: new Set(),
    novelties: new Float64Array(userList.length)
  }));

  for (let u = 0; u < userList.length; u++) {
    const user = userList[u];
    const { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs } = getUserSplit(user);
    const trainKeys = new Set(trainWatched.map(getMovieKey));
    const candidates = hybridMlCatalog.filter(c => !trainKeys.has(getMovieKey(c)));

    const profile = await extractTasteProfile(trainWatched, [], { now: holdoutStartTs, anchorCutoff: Infinity });

    for (let ai = 0; ai < alphas.length; ai++) {
      const alpha = alphas[ai];
      const scaledIdx = scaledIndices.get(alpha);
      const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, scaledIdx);
      const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, scaledIdx);

      for (let di = 0; di < dampingsT3.length; di++) {
        const damping = dampingsT3[di];
        const cfgIdx = ai * dampingsT3.length + di;

        const ranked = rankCandidatePool(
          candidates,
          {
            profile,
            collabSimMap,
            contentSimMap: new Map(),
            repulsionMap,
            anchorKeywords: profile.lovedKeywordIds || [],
            userProviders: []
          },
          DEFAULT_RANKER_WEIGHTS,
          candidates.length,
          { metadataDampingFactor: damping }
        );

        const ids = ranked.map(getMovieKey);
        const top10 = ranked.slice(0, 10);
        const top20 = ranked.slice(0, 20);

        configsData[cfgIdx].ndcg[u] = computeNDCGAtK(ids, holdoutRelevance, 10);
        configsData[cfgIdx].recall[u] = computeRecallAtK(ids, holdoutPositives, 20);

        // Diversity/Popularity Metrics:
        // 1. Mean log(rating_count) of top-10
        let logSum = 0;
        for (const item of top10) {
          const cnt = movieRatingCounts.get(Number(item.tmdbId)) || item.vote_count || 1;
          logSum += Math.log(cnt);
          configsData[cfgIdx].top10Unique.add(Number(item.tmdbId));
        }
        configsData[cfgIdx].meanLogCount[u] = logSum / 10;

        // 2. Novelty
        configsData[cfgIdx].novelties[u] = computeNovelty(top20);
      }
    }
  }

  return configsData;
}

// 1. Run on Tuning Set (160 users)
console.log("\nEvaluating 10 configs on TUNING Set (160 users)...");
const t3_tuning_data = await evaluateTask3Configs(tuningUsers, false);

const t3_tuning_leaderboard = [];
for (let ai = 0; ai < alphas.length; ai++) {
  for (let di = 0; di < dampingsT3.length; di++) {
    const alpha = alphas[ai];
    const damping = dampingsT3[di];
    const cfgIdx = ai * dampingsT3.length + di;
    const res = t3_tuning_data[cfgIdx];

    const ndcgM = stats(res.ndcg).mean;
    const recallM = stats(res.recall).mean;

    t3_tuning_leaderboard.push({
      alpha,
      damping,
      cfgIdx,
      ai,
      di,
      ndcgM,
      recallM
    });
  }
}
t3_tuning_leaderboard.sort((a, b) => b.ndcgM - a.ndcgM);

console.log("\nTASK 3: Tuning Set Leaderboard (10 Configs):");
console.log("--------------------------------------------------------------------------------");
console.log("Rank | Alpha (Norm-Scale) | Damping | NDCG@10 (Mean) | Recall@20 (Mean)");
console.log("--------------------------------------------------------------------------------");
t3_tuning_leaderboard.forEach((cfg, idx) => {
  console.log(`${String(idx + 1).padStart(4)} | ${cfg.alpha.toFixed(2).padEnd(19)} | ${cfg.damping.toFixed(2).padEnd(7)} | ${cfg.ndcgM.toFixed(4).padEnd(14)} | ${cfg.recallM.toFixed(4)}`);
});
console.log("--------------------------------------------------------------------------------");

const t3_top1 = t3_tuning_leaderboard[0];
const t3_top2 = t3_tuning_leaderboard[1];
console.log(`\nSelected for Locked Test: Top 1 (alpha=${t3_top1.alpha}, damping=${t3_top1.damping}), Top 2 (alpha=${t3_top2.alpha}, damping=${t3_top2.damping}), and Current Baseline (alpha=0.00, damping=0.20)`);

// 2. Run on Locked Test Set (168 users)
console.log("\nEvaluating on LOCKED TEST Set (168 users)...");
const t3_test_data = await evaluateTask3Configs(lockedTestUsers, true);

// Extract baseline config: alpha = 0.00, damping = 0.20
const baseCfgIdx = 0 * dampingsT3.length + 0; // ai=0 (alpha=0), di=0 (damping=0.20)
const baseTestData = t3_test_data[baseCfgIdx];
const top1TestData = t3_test_data[t3_top1.cfgIdx];
const top2TestData = t3_test_data[t3_top2.cfgIdx];

experimentResults.task3 = {
  baseline: {
    alpha: 0.0,
    damping: 0.20,
    ndcg: Array.from(baseTestData.ndcg),
    recall: Array.from(baseTestData.recall),
    meanLogCount: Array.from(baseTestData.meanLogCount),
    catalogCoverage: baseTestData.top10Unique.size,
    novelty: stats(baseTestData.novelties).mean
  },
  top1: {
    alpha: t3_top1.alpha,
    damping: t3_top1.damping,
    ndcg: Array.from(top1TestData.ndcg),
    recall: Array.from(top1TestData.recall),
    meanLogCount: Array.from(top1TestData.meanLogCount),
    catalogCoverage: top1TestData.top10Unique.size,
    novelty: stats(top1TestData.novelties).mean
  },
  top2: {
    alpha: t3_top2.alpha,
    damping: t3_top2.damping,
    ndcg: Array.from(top2TestData.ndcg),
    recall: Array.from(top2TestData.recall),
    meanLogCount: Array.from(top2TestData.meanLogCount),
    catalogCoverage: top2TestData.top10Unique.size,
    novelty: stats(top2TestData.novelties).mean
  }
};

console.log("\nTASK 3: Accuracy vs. Popularity & Diversity on Locked Test Set (168 users):");
console.log("------------------------------------------------------------------------------------------------------------------------");
console.log("Config (Alpha, Damping)          | NDCG@10 (Mean) | Recall@20 (Mean) | Mean log(Votes) Top10 | Catalog Cov | Novelty");
console.log("------------------------------------------------------------------------------------------------------------------------");
function printT3Row(name, data) {
  const n = stats(data.ndcg).mean.toFixed(4);
  const r = stats(data.recall).mean.toFixed(4);
  const v = stats(data.meanLogCount).mean.toFixed(3);
  const cov = String(data.top10Unique.size).padStart(11);
  const nov = stats(data.novelties).mean.toFixed(3);
  console.log(`${name.padEnd(33)} | ${n.padStart(14)} | ${r.padStart(16)} | ${v.padStart(21)} | ${cov} | ${nov.padStart(7)}`);
}

printT3Row(`Baseline (a=0.00, d=0.20)`, baseTestData);
printT3Row(`Top 1    (a=${t3_top1.alpha.toFixed(2)}, d=${t3_top1.damping.toFixed(2)})`, top1TestData);
printT3Row(`Top 2    (a=${t3_top2.alpha.toFixed(2)}, d=${t3_top2.damping.toFixed(2)})`, top2TestData);
console.log("------------------------------------------------------------------------------------------------------------------------");

console.log("\nTASK 3: Paired Bootstrap 95% Confidence Intervals vs Baseline (1,000 resamples):");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Comparison vs Baseline                   | Metric    | Mean Delta | 95% Paired Bootstrap CI  | Significant?");
console.log("----------------------------------------------------------------------------------------------------------");
const top1_boot_n = pairedBootstrapCI(top1TestData.ndcg, baseTestData.ndcg);
const top1_boot_r = pairedBootstrapCI(top1TestData.recall, baseTestData.recall);
const top2_boot_n = pairedBootstrapCI(top2TestData.ndcg, baseTestData.ndcg);
const top2_boot_r = pairedBootstrapCI(top2TestData.recall, baseTestData.recall);

console.log(`Top 1 (a=${t3_top1.alpha}, d=${t3_top1.damping}) vs Baseline (a=0, d=0.20)| NDCG@10   | ${top1_boot_n.meanDiff >= 0 ? "+" : ""}${top1_boot_n.meanDiff.toFixed(4)}     | [${top1_boot_n.ciLower >= 0 ? "+" : ""}${top1_boot_n.ciLower.toFixed(4)}, ${top1_boot_n.ciUpper >= 0 ? "+" : ""}${top1_boot_n.ciUpper.toFixed(4)}]     | ${top1_boot_n.isSignificant ? "YES (Significant)" : "NO (Includes 0)"}`);
console.log(`${"".padEnd(41)} | Recall@20 | ${top1_boot_r.meanDiff >= 0 ? "+" : ""}${top1_boot_r.meanDiff.toFixed(4)}     | [${top1_boot_r.ciLower >= 0 ? "+" : ""}${top1_boot_r.ciLower.toFixed(4)}, ${top1_boot_r.ciUpper >= 0 ? "+" : ""}${top1_boot_r.ciUpper.toFixed(4)}]     | ${top1_boot_r.isSignificant ? "YES (Significant)" : "NO (Includes 0)"}`);
console.log("----------------------------------------------------------------------------------------------------------");
console.log(`Top 2 (a=${t3_top2.alpha}, d=${t3_top2.damping}) vs Baseline (a=0, d=0.20)| NDCG@10   | ${top2_boot_n.meanDiff >= 0 ? "+" : ""}${top2_boot_n.meanDiff.toFixed(4)}     | [${top2_boot_n.ciLower >= 0 ? "+" : ""}${top2_boot_n.ciLower.toFixed(4)}, ${top2_boot_n.ciUpper >= 0 ? "+" : ""}${top2_boot_n.ciUpper.toFixed(4)}]     | ${top2_boot_n.isSignificant ? "YES (Significant)" : "NO (Includes 0)"}`);
console.log(`${"".padEnd(41)} | Recall@20 | ${top2_boot_r.meanDiff >= 0 ? "+" : ""}${top2_boot_r.meanDiff.toFixed(4)}     | [${top2_boot_r.ciLower >= 0 ? "+" : ""}${top2_boot_r.ciLower.toFixed(4)}, ${top2_boot_r.ciUpper >= 0 ? "+" : ""}${top2_boot_r.ciUpper.toFixed(4)}]     | ${top2_boot_r.isSignificant ? "YES (Significant)" : "NO (Includes 0)"}`);
console.log("----------------------------------------------------------------------------------------------------------");

// ==========================================================================
// TASK 4: COVERAGE ON REAL DATA
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 4: COVERAGE ON REAL DATA");
console.log("==========================================================================");

const benchmarkVaults = JSON.parse(fs.readFileSync(path.join(root, ".data/benchmark_vaults.json"), "utf8")).vaults;

console.log("\nBenchmark Users Coverage Audit:");
console.log("------------------------------------------------------------------------------------------------------------------------");
console.log("User ID     | Total Ratings | Present in Embeddings (%) | Missing from Embeddings (%) | Ratings 2024 or later (%)");
console.log("------------------------------------------------------------------------------------------------------------------------");

const task4Data = {};

for (const vault of benchmarkVaults) {
  const watched = vault.watched || [];
  let present = 0, missing = 0, recent2024 = 0;

  for (const m of watched) {
    const tid = Number(m.tmdbId ?? m.id);
    if (embIdToIndex.has(tid)) {
      present++;
    } else {
      missing++;
    }

    const dStr = m.dateWatched || m.addedAt;
    if (dStr) {
      const year = new Date(dStr).getFullYear();
      if (year >= 2024) recent2024++;
    }
  }

  const pPct = (present / watched.length * 100).toFixed(1);
  const mPct = (missing / watched.length * 100).toFixed(1);
  const rPct = (recent2024 / watched.length * 100).toFixed(1);

  console.log(`${vault.name.padEnd(11)} | ${String(watched.length).padStart(13)} | ${String(present).padStart(10)} (${pPct}%)      | ${String(missing).padStart(11)} (${mPct}%)       | ${String(recent2024).padStart(12)} (${rPct}%)`);

  task4Data[vault.name] = {
    total: watched.length,
    present,
    presentPct: pPct,
    missing,
    missingPct: mPct,
    recent2024,
    recent2024Pct: rPct
  };
}
console.log("------------------------------------------------------------------------------------------------------------------------");

// Check for any other real vaults on disk
console.log("\nSearching for any other real (non-MovieLens) vault data on disk...");
const allDataFiles = fs.readdirSync(path.join(root, ".data"));
const otherVaults = [];
for (const f of allDataFiles) {
  if (f.endsWith(".json") && f !== "benchmark_vaults.json" && f !== "tmdb_cache.json" && f !== "experiments_results.json") {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(root, ".data", f), "utf8"));
      if (parsed.vaults || parsed.watched || Array.isArray(parsed)) {
        otherVaults.push(f);
      }
    } catch (_) {}
  }
}
console.log(`Other vault candidate files found in .data/: ${otherVaults.length ? otherVaults.join(", ") : "None (Only benchmark_vaults.json exists)"}`);
experimentResults.task4 = { benchmarkVaults: task4Data, otherVaultsFound: otherVaults };

// Save complete per-user experiment results to .data/experiments_results.json
const outResultsPath = path.join(root, ".data/experiments_results.json");
fs.writeFileSync(outResultsPath, JSON.stringify(experimentResults, null, 2));
console.log(`\nPer-user experimental results saved to ${outResultsPath}`);
console.log("\nALL TASKS COMPLETED.");
