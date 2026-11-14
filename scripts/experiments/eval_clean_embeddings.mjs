import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "g:/Important Projects/movie-ratings";
const importSrc = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { parseEmbeddingBinary, buildCollabSimMapFromIndex, buildRepulsionMapFromIndex } = await importSrc("src/services/embeddingService.js");
const { computeRecallAtK, computeNDCGAtK } = await importSrc("src/services/evalHarness.js");
const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await importSrc("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await importSrc("src/services/tmdbService.js");
const { computeBayesianScore } = await importSrc("src/services/scoringUtils.js");

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

function stats(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  const m = s / (arr.length || 1);
  let varSum = 0;
  for (let i = 0; i < arr.length; i++) varSum += (arr[i] - m) ** 2;
  return { mean: m, std: Math.sqrt(varSum / (arr.length || 1)) };
}

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

  return { meanDiff, ciLower, ciUpper, isSignificant };
}

console.log("==========================================================================");
console.log("TASK 3: EVALUATION WITH LEAKAGE-CLEAN RETRAINED EMBEDDINGS");
console.log("==========================================================================");

// 1. Load Leaky and Clean Embeddings
const leakyBuf = fs.readFileSync(path.join(root, "public/models/item_embeddings_f16.bin"));
const leakyIndex = parseEmbeddingBinary(leakyBuf.buffer.slice(leakyBuf.byteOffset, leakyBuf.byteOffset + leakyBuf.byteLength));

const cleanBuf = fs.readFileSync(path.join(root, ".data/item_embeddings_clean_f16.bin"));
const cleanIndex = parseEmbeddingBinary(cleanBuf.buffer.slice(cleanBuf.byteOffset, cleanBuf.byteOffset + cleanBuf.byteLength));

console.log(`Leaky Index: ${leakyIndex.count} items, dim=${leakyIndex.dim}`);
console.log(`Clean Index: ${cleanIndex.count} items, dim=${cleanIndex.dim}`);

// 2. Load MovieLens Small
const linksLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/links.csv"), "utf8").split("\n").filter(Boolean).slice(1);
const movieIdToTmdbId = new Map();
linksLines.forEach(l => {
  const [mid, imdb, tmdb] = l.trim().split(",");
  if (tmdb) movieIdToTmdbId.set(mid, Number(tmdb));
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

function mapMovieLensGenresToTmdb(genresStr = "") {
  if (!genresStr || genresStr === "(no genres listed)") return [];
  const normalized = genresStr
    .replace(/\|/g, ",")
    .replace(/\bchildren\b/gi, "Family")
    .replace(/\bsci-fi\b/gi, "Sci-Fi");
  return mapOmdbToTmdbGenreIds(normalized);
}

const tmdbCache = fs.existsSync(path.join(root, ".data/tmdb_cache.json"))
  ? JSON.parse(fs.readFileSync(path.join(root, ".data/tmdb_cache.json"), "utf8"))
  : {};

const ratingsLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/ratings.csv"), "utf8").split("\n").filter(Boolean).slice(1);
const ratingsByUser = new Map();
const movieRatingCounts = new Map();
const movieRatingSums = new Map();

ratingsLines.forEach(l => {
  const [uid, mid, rStr, tsStr] = l.trim().split(",");
  if (!movieIdToTmdbId.has(mid)) return;
  const tmdbId = movieIdToTmdbId.get(mid);
  const r = Number(rStr) * 2;
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

const catalog = [];
for (const [mid, tmdbId] of movieIdToTmdbId.entries()) {
  const meta = movieMeta.get(mid) || { title: "Unknown", genres: "" };
  const cnt = movieRatingCounts.get(tmdbId) || 1;
  const sum = movieRatingSums.get(tmdbId) || 7.0;
  const avg = cnt > 0 ? sum / cnt : 7.0;
  const cached = tmdbCache[tmdbId] || {};
  const tmdbGenreIds = mapMovieLensGenresToTmdb(meta.genres);

  catalog.push({
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

const sortedByVotes = [...catalog].sort((a, b) => b.vote_count - a.vote_count);
const top20Idx = Math.floor(0.20 * sortedByVotes.length);
const popularIds = new Set(sortedByVotes.slice(0, top20Idx).map(m => Number(m.tmdbId)));

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

const sys_pop = { ndcg: new Float64Array(328), recall: new Float64Array(328), ltNdcg: new Float64Array(328), ltRecall: new Float64Array(328) };
const sys_leaky_collab = { ndcg: new Float64Array(328), recall: new Float64Array(328), ltNdcg: new Float64Array(328), ltRecall: new Float64Array(328) };
const sys_clean_collab = { ndcg: new Float64Array(328), recall: new Float64Array(328), ltNdcg: new Float64Array(328), ltRecall: new Float64Array(328) };
const sys_leaky_ranker = { ndcg: new Float64Array(328), recall: new Float64Array(328), ltNdcg: new Float64Array(328), ltRecall: new Float64Array(328) };
const sys_clean_ranker = { ndcg: new Float64Array(328), recall: new Float64Array(328), ltNdcg: new Float64Array(328), ltRecall: new Float64Array(328) };

console.log("Evaluating 5 systems across all 328 users...");

for (let u = 0; u < allEligibleUsers.length; u++) {
  const user = allEligibleUsers[u];
  const { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs } = getUserSplit(user);
  const trainKeys = new Set(trainWatched.map(getMovieKey));
  const candidates = catalog.filter(c => !trainKeys.has(getMovieKey(c)));

  const profile = await extractTasteProfile(trainWatched, [], { now: holdoutStartTs, anchorCutoff: Infinity });

  const leakyCollab = buildCollabSimMapFromIndex(profile.weightedRatings, leakyIndex);
  const cleanCollab = buildCollabSimMapFromIndex(profile.weightedRatings, cleanIndex);
  const leakyRep = buildRepulsionMapFromIndex(profile.weightedRatings, leakyIndex);
  const cleanRep = buildRepulsionMapFromIndex(profile.weightedRatings, cleanIndex);

  const ltPos = new Set();
  const ltRelevance = new Map();
  for (const tidStr of holdoutPositives) {
    if (!popularIds.has(Number(tidStr))) {
      ltPos.add(tidStr);
      ltRelevance.set(tidStr, holdoutRelevance.get(tidStr));
    }
  }

  // 1. Popularity Baseline
  const popRanked = [...candidates].sort((a, b) => {
    const sA = computeBayesianScore(a.vote_average, a.vote_count);
    const sB = computeBayesianScore(b.vote_average, b.vote_count);
    return sB - sA;
  });
  const popIds = popRanked.map(getMovieKey);
  sys_pop.ndcg[u] = computeNDCGAtK(popIds, holdoutRelevance, 10);
  sys_pop.recall[u] = computeRecallAtK(popIds, holdoutPositives, 20);
  sys_pop.ltNdcg[u] = computeNDCGAtK(popIds, ltRelevance, 10);
  sys_pop.ltRecall[u] = computeRecallAtK(popIds, ltPos, 20);

  // 2. Leaky Collab Alone
  const lDotRanked = [...candidates].sort((a, b) => {
    const sA = Number(leakyCollab.get(Number(a.tmdbId)) ?? -999);
    const sB = Number(leakyCollab.get(Number(b.tmdbId)) ?? -999);
    return sB - sA;
  });
  const lDotIds = lDotRanked.map(getMovieKey);
  sys_leaky_collab.ndcg[u] = computeNDCGAtK(lDotIds, holdoutRelevance, 10);
  sys_leaky_collab.recall[u] = computeRecallAtK(lDotIds, holdoutPositives, 20);
  sys_leaky_collab.ltNdcg[u] = computeNDCGAtK(lDotIds, ltRelevance, 10);
  sys_leaky_collab.ltRecall[u] = computeRecallAtK(lDotIds, ltPos, 20);

  // 3. Clean Collab Alone
  const cDotRanked = [...candidates].sort((a, b) => {
    const sA = Number(cleanCollab.get(Number(a.tmdbId)) ?? -999);
    const sB = Number(cleanCollab.get(Number(b.tmdbId)) ?? -999);
    return sB - sA;
  });
  const cDotIds = cDotRanked.map(getMovieKey);
  sys_clean_collab.ndcg[u] = computeNDCGAtK(cDotIds, holdoutRelevance, 10);
  sys_clean_collab.recall[u] = computeRecallAtK(cDotIds, holdoutPositives, 20);
  sys_clean_collab.ltNdcg[u] = computeNDCGAtK(cDotIds, ltRelevance, 10);
  sys_clean_collab.ltRecall[u] = computeRecallAtK(cDotIds, ltPos, 20);

  // 4. Leaky Ranker (Current)
  const lRanked = rankCandidatePool(
    candidates,
    { profile, collabSimMap: leakyCollab, contentSimMap: new Map(), repulsionMap: leakyRep, anchorKeywords: profile.lovedKeywordIds || [], userProviders: [] },
    DEFAULT_RANKER_WEIGHTS,
    candidates.length,
    { metadataDampingFactor: 0.20 }
  );
  const lRankIds = lRanked.map(getMovieKey);
  sys_leaky_ranker.ndcg[u] = computeNDCGAtK(lRankIds, holdoutRelevance, 10);
  sys_leaky_ranker.recall[u] = computeRecallAtK(lRankIds, holdoutPositives, 20);
  sys_leaky_ranker.ltNdcg[u] = computeNDCGAtK(lRankIds, ltRelevance, 10);
  sys_leaky_ranker.ltRecall[u] = computeRecallAtK(lRankIds, ltPos, 20);

  // 5. Clean Ranker
  const cRanked = rankCandidatePool(
    candidates,
    { profile, collabSimMap: cleanCollab, contentSimMap: new Map(), repulsionMap: cleanRep, anchorKeywords: profile.lovedKeywordIds || [], userProviders: [] },
    DEFAULT_RANKER_WEIGHTS,
    candidates.length,
    { metadataDampingFactor: 0.20 }
  );
  const cRankIds = cRanked.map(getMovieKey);
  sys_clean_ranker.ndcg[u] = computeNDCGAtK(cRankIds, holdoutRelevance, 10);
  sys_clean_ranker.recall[u] = computeRecallAtK(cRankIds, holdoutPositives, 20);
  sys_clean_ranker.ltNdcg[u] = computeNDCGAtK(cRankIds, ltRelevance, 10);
  sys_clean_ranker.ltRecall[u] = computeRecallAtK(cRankIds, ltPos, 20);
}

console.log("\nTABLE 3A: Clean vs. Leaky Embeddings Performance (All 328 Users):");
console.log("------------------------------------------------------------------------------------------------------------------");
console.log("System                             | NDCG@10 (Mean) | Recall@20 (Mean) | LT NDCG@10 (Mean) | LT Recall@20 (Mean)");
console.log("------------------------------------------------------------------------------------------------------------------");
function printRow(name, s) {
  console.log(`${name.padEnd(34)} | ${stats(s.ndcg).mean.toFixed(4).padEnd(14)} | ${stats(s.recall).mean.toFixed(4).padEnd(16)} | ${stats(s.ltNdcg).mean.toFixed(4).padEnd(17)} | ${stats(s.ltRecall).mean.toFixed(4)}`);
}
printRow("1. Popularity Baseline", sys_pop);
printRow("2. collabSim Alone (Leaky)", sys_leaky_collab);
printRow("3. collabSim Alone (Clean)", sys_clean_collab);
printRow("4. Current Ranker (Leaky)", sys_leaky_ranker);
printRow("5. Current Ranker (Clean)", sys_clean_ranker);
console.log("------------------------------------------------------------------------------------------------------------------");

console.log("\nTABLE 3B: Paired Bootstrap 95% Confidence Intervals (1,000 resamples):");
console.log("----------------------------------------------------------------------------------------------------------------------------------------");
console.log("Comparison                             | Metric       | Mean Delta | 95% Paired Bootstrap CI  | Significant?");
console.log("----------------------------------------------------------------------------------------------------------------------------------------");
const tests = [
  // Leakage inflation on collabSim: Leaky vs Clean
  { name: "Leakage Inflation (Collab Leaky vs Clean)", cand: sys_leaky_collab.ndcg, base: sys_clean_collab.ndcg, metric: "NDCG@10" },
  { name: "Leakage Inflation (Collab Leaky vs Clean)", cand: sys_leaky_collab.recall, base: sys_clean_collab.recall, metric: "Recall@20" },
  { name: "Leakage Inflation (Collab Leaky vs Clean)", cand: sys_leaky_collab.ltRecall, base: sys_clean_collab.ltRecall, metric: "LT Recall@20" },

  // Leakage inflation on Ranker: Leaky vs Clean
  { name: "Leakage Inflation (Ranker Leaky vs Clean)", cand: sys_leaky_ranker.ndcg, base: sys_clean_ranker.ndcg, metric: "NDCG@10" },
  { name: "Leakage Inflation (Ranker Leaky vs Clean)", cand: sys_leaky_ranker.recall, base: sys_clean_ranker.recall, metric: "Recall@20" },
  { name: "Leakage Inflation (Ranker Leaky vs Clean)", cand: sys_leaky_ranker.ltRecall, base: sys_clean_ranker.ltRecall, metric: "LT Recall@20" },

  // Clean comparison: Clean Ranker vs Clean CollabSim
  { name: "Clean Head-to-Head (Ranker vs Collab)", cand: sys_clean_ranker.ndcg, base: sys_clean_collab.ndcg, metric: "NDCG@10" },
  { name: "Clean Head-to-Head (Ranker vs Collab)", cand: sys_clean_ranker.recall, base: sys_clean_collab.recall, metric: "Recall@20" },
  { name: "Clean Head-to-Head (Ranker vs Collab)", cand: sys_clean_ranker.ltRecall, base: sys_clean_collab.ltRecall, metric: "LT Recall@20" }
];

const task3Results = {};

for (const t of tests) {
  const boot = pairedBootstrapCI(t.cand, t.base);
  const nameP = t.name.padEnd(38);
  const mP = t.metric.padEnd(12);
  const dStr = `${boot.meanDiff >= 0 ? "+" : ""}${boot.meanDiff.toFixed(4)}`.padEnd(10);
  const ciStr = `[${boot.ciLower >= 0 ? "+" : ""}${boot.ciLower.toFixed(4)}, ${boot.ciUpper >= 0 ? "+" : ""}${boot.ciUpper.toFixed(4)}]`.padEnd(24);
  const sigStr = boot.isSignificant ? "YES (Significant)" : "NO (Includes 0)";
  console.log(`${nameP} | ${mP} | ${dStr} | ${ciStr} | ${sigStr}`);
  task3Results[`${t.name} - ${t.metric}`] = boot;
}
console.log("----------------------------------------------------------------------------------------------------------------------------------------");

const outPath = path.join(root, ".data/task3_clean_eval_results.json");
fs.writeFileSync(outPath, JSON.stringify({
  systems: {
    pop: { ndcg: stats(sys_pop.ndcg).mean, recall: stats(sys_pop.recall).mean },
    leaky_collab: { ndcg: stats(sys_leaky_collab.ndcg).mean, recall: stats(sys_leaky_collab.recall).mean },
    clean_collab: { ndcg: stats(sys_clean_collab.ndcg).mean, recall: stats(sys_clean_collab.recall).mean },
    leaky_ranker: { ndcg: stats(sys_leaky_ranker.ndcg).mean, recall: stats(sys_leaky_ranker.recall).mean },
    clean_ranker: { ndcg: stats(sys_clean_ranker.ndcg).mean, recall: stats(sys_clean_ranker.recall).mean }
  },
  bootstrapTests: task3Results
}, null, 2));
console.log(`Saved clean evaluation results to ${outPath}`);
console.log("TASK 3 EVALUATION COMPLETE.");
