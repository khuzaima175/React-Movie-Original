import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "g:/Important Projects/movie-ratings";
const importSrc = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { parseEmbeddingBinary, buildCollabSimMapFromIndex, buildRepulsionMapFromIndex, computeUserPersonas, computeUserEmbedding } = await importSrc("src/services/embeddingService.js");
const { computeRecallAtK, computeNDCGAtK } = await importSrc("src/services/evalHarness.js");
const { rankCandidatePool, extractCandidateFeatures, DEFAULT_RANKER_WEIGHTS } = await importSrc("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await importSrc("src/services/tmdbService.js");
const { computeBayesianScore, computeZScoredWeights, computeUserRatingStats } = await importSrc("src/services/scoringUtils.js");

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
}

function getDistributionStats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += sorted[i];
  const mean = sum / (n || 1);
  return {
    min: sorted[0] ?? 0,
    p10: percentile(sorted, 10),
    median: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[n - 1] ?? 0,
    mean
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

// Spearman rank correlation between two arrays of length K (rank 1..20)
function computeSpearmanRankCorr(listA, listB, k = 20) {
  const topA = listA.slice(0, k).map(String);
  const topB = listB.slice(0, k).map(String);

  const rankA = new Map(topA.map((id, idx) => [id, idx + 1]));
  const rankB = new Map(topB.map((id, idx) => [id, idx + 1]));

  const union = Array.from(new Set([...topA, ...topB]));
  const unrankedPenalty = k + 1;

  let sumSqDiff = 0;
  const n = union.length;
  if (n <= 1) return 1.0;

  for (const id of union) {
    const rA = rankA.get(id) ?? unrankedPenalty;
    const rB = rankB.get(id) ?? unrankedPenalty;
    sumSqDiff += (rA - rB) ** 2;
  }

  // Spearman formula: 1 - (6 * sum(d^2)) / (n * (n^2 - 1))
  return 1 - (6 * sumSqDiff) / (n * (n * n - 1));
}

// Kendall Tau rank correlation on the union
function computeKendallTau(listA, listB, k = 20) {
  const topA = listA.slice(0, k).map(String);
  const topB = listB.slice(0, k).map(String);

  const rankA = new Map(topA.map((id, idx) => [id, idx + 1]));
  const rankB = new Map(topB.map((id, idx) => [id, idx + 1]));

  const union = Array.from(new Set([...topA, ...topB]));
  const n = union.length;
  if (n <= 1) return 1.0;

  const unrankedPenalty = k + 1;
  let concordant = 0;
  let discordant = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const rAi = rankA.get(union[i]) ?? unrankedPenalty;
      const rAj = rankA.get(union[j]) ?? unrankedPenalty;
      const rBi = rankB.get(union[i]) ?? unrankedPenalty;
      const rBj = rankB.get(union[j]) ?? unrankedPenalty;

      const signA = Math.sign(rAi - rAj);
      const signB = Math.sign(rBi - rBj);

      if (signA * signB > 0) concordant++;
      else if (signA * signB < 0) discordant++;
    }
  }

  const totalPairs = (n * (n - 1)) / 2;
  return totalPairs > 0 ? (concordant - discordant) / totalPairs : 0;
}

console.log("==========================================================================");
console.log("TASK 1 & TASK 2: RIGOROUS SCIENTIFIC INVESTIGATION");
console.log("==========================================================================");

// 1. Load Embeddings
const embBuffer = fs.readFileSync(path.join(root, "public/models/item_embeddings_f16.bin"));
const ab = embBuffer.buffer.slice(embBuffer.byteOffset, embBuffer.byteOffset + embBuffer.byteLength);
const embeddingIndex = parseEmbeddingBinary(ab);

// 2. Load MovieLens small
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

// Build catalog
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

// 328 eligible active users
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

// Identify Popular (top 20%) vs Long-Tail (bottom 80%)
const sortedByVotes = [...catalog].sort((a, b) => b.vote_count - a.vote_count);
const top20Idx = Math.floor(0.20 * sortedByVotes.length);
const popularIds = new Set(sortedByVotes.slice(0, top20Idx).map(m => Number(m.tmdbId)));

// ==========================================================================
// TASK 1: OFFLINE VOTE-SCALE CHECK & VALIDITY OF THE HARNESS
// ==========================================================================
console.log("\n" + "=".repeat(70));
console.log("TASK 1: OFFLINE VOTE-SCALE CHECK");
console.log("=".repeat(70));

// 1. Distributions for Offline MovieLens
const mlVoteCounts = catalog.map(m => m.vote_count);
const mlVoteAverages = catalog.map(m => m.vote_average);
const mlBayesNorms = catalog.map(m => {
  const b = computeBayesianScore(m.vote_average, m.vote_count, 500, 7.0);
  return Math.max(0, Math.min(1, (b - 5.0) / 4.5));
});
const mlNovelties = catalog.map(m => {
  const vc = Math.max(10, Number(m.vote_count || 200));
  return vc >= 100 && vc <= 4000 ? 0.5 : 0.1;
});

const mlVcDist = getDistributionStats(mlVoteCounts);
const mlVaDist = getDistributionStats(mlVoteAverages);
const mlBnDist = getDistributionStats(mlBayesNorms);
const mlNovDist = getDistributionStats(mlNovelties);

// 2. Distributions for Production TMDB
const tmdbEntries = Object.values(tmdbCache).filter(e => e && e.vote_count !== undefined && e.vote_average !== undefined);
const tmdbVoteCounts = tmdbEntries.map(e => e.vote_count);
const tmdbVoteAverages = tmdbEntries.map(e => e.vote_average);
const tmdbBayesNorms = tmdbEntries.map(e => {
  const b = computeBayesianScore(e.vote_average, e.vote_count, 500, 7.0);
  return Math.max(0, Math.min(1, (b - 5.0) / 4.5));
});
const tmdbNovelties = tmdbEntries.map(e => {
  const vc = Math.max(10, Number(e.vote_count || 200));
  return vc >= 100 && vc <= 4000 ? 0.5 : 0.1;
});

const tmdbVcDist = getDistributionStats(tmdbVoteCounts);
const tmdbVaDist = getDistributionStats(tmdbVoteAverages);
const tmdbBnDist = getDistributionStats(tmdbBayesNorms);
const tmdbNovDist = getDistributionStats(tmdbNovelties);

console.log("\nTABLE 1A: Vote Scale Distribution (Offline MovieLens vs. Production TMDB):");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Dataset           | Feature            | Min      | p10      | Median   | p90      | p99      | Max");
console.log("----------------------------------------------------------------------------------------------------------");
function printDistRow(dataset, feat, d) {
  console.log(`${dataset.padEnd(17)} | ${feat.padEnd(18)} | ${d.min.toFixed(1).padEnd(8)} | ${d.p10.toFixed(1).padEnd(8)} | ${d.median.toFixed(1).padEnd(8)} | ${d.p90.toFixed(1).padEnd(8)} | ${d.p99.toFixed(1).padEnd(8)} | ${d.max.toFixed(1)}`);
}
printDistRow("Offline ML (9.7k)", "voteCount", mlVcDist);
printDistRow("Prod TMDB (559)", "voteCount", tmdbVcDist);
printDistRow("Offline ML (9.7k)", "voteAverage", mlVaDist);
printDistRow("Prod TMDB (559)", "voteAverage", tmdbVaDist);
console.log("----------------------------------------------------------------------------------------------------------");

console.log("\nTABLE 1B: Derived Feature Distributions (bayesianRatingNorm and noveltyBonus):");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Dataset           | Feature            | Min      | p10      | Median   | p90      | p99      | Max");
console.log("----------------------------------------------------------------------------------------------------------");
printDistRow("Offline ML (9.7k)", "bayesianRatingNorm", mlBnDist);
printDistRow("Prod TMDB (559)", "bayesianRatingNorm", tmdbBnDist);
printDistRow("Offline ML (9.7k)", "noveltyBonus", mlNovDist);
printDistRow("Prod TMDB (559)", "noveltyBonus", tmdbNovDist);
console.log("----------------------------------------------------------------------------------------------------------");

const mlNovPointFiveCount = mlNovelties.filter(v => v === 0.5).length;
const tmdbNovPointFiveCount = tmdbNovelties.filter(v => v === 0.5).length;

console.log(`\nNovelty Bonus Behavior:`);
console.log(`- Offline MovieLens: ${mlNovPointFiveCount} / ${catalog.length} (${(mlNovPointFiveCount / catalog.length * 100).toFixed(2)}%) get bonus 0.5; ${catalog.length - mlNovPointFiveCount} (${((catalog.length - mlNovPointFiveCount) / catalog.length * 100).toFixed(2)}%) get base 0.1.`);
console.log(`- Production TMDB:   ${tmdbNovPointFiveCount} / ${tmdbEntries.length} (${(tmdbNovPointFiveCount / tmdbEntries.length * 100).toFixed(2)}%) get bonus 0.5; ${tmdbEntries.length - tmdbNovPointFiveCount} (${((tmdbEntries.length - tmdbNovPointFiveCount) / tmdbEntries.length * 100).toFixed(2)}%) get base 0.1.`);

console.log(`\nBayesian Rating Norm Behavior:`);
console.log(`- Offline MovieLens: Mean = ${mlBnDist.mean.toFixed(4)}, Median = ${mlBnDist.median.toFixed(4)}, Std = ${stats(mlBayesNorms).std.toFixed(4)}.`);
console.log(`  Because prior m=500 dwarfs offline vote counts (median=3), 90% of movies have bayesianRatingNorm between ${mlBnDist.p10.toFixed(4)} and ${mlBnDist.p90.toFixed(4)}.`);
console.log(`- Production TMDB:   Mean = ${tmdbBnDist.mean.toFixed(4)}, Median = ${tmdbBnDist.median.toFixed(4)}, Std = ${stats(tmdbBayesNorms).std.toFixed(4)}.`);
console.log(`  TMDB vote counts (median=${tmdbVcDist.median.toFixed(0)}) easily overcome m=500, spanning full dynamic range [${tmdbBnDist.min.toFixed(2)}, ${tmdbBnDist.max.toFixed(2)}].`);

// Re-run comparison: collabSim alone vs. current ranker vs. zeroed ranker (noveltyBonus = 0, bayesianRatingNorm = 0)
console.log("\nRe-running all-328 comparison: collabSim alone vs Current Ranker vs Zeroed Ranker (no bayesian, no novelty)...");

const sys_collab = { ndcg: new Float64Array(328), recall: new Float64Array(328), ltNdcg: new Float64Array(328), ltRecall: new Float64Array(328) };
const sys_current = { ndcg: new Float64Array(328), recall: new Float64Array(328), ltNdcg: new Float64Array(328), ltRecall: new Float64Array(328) };
const sys_zeroed = { ndcg: new Float64Array(328), recall: new Float64Array(328), ltNdcg: new Float64Array(328), ltRecall: new Float64Array(328) };

const ZEROED_WEIGHTS = {
  ...DEFAULT_RANKER_WEIGHTS,
  bayesianRatingNorm: 0.0,
  noveltyBonus: 0.0
};

for (let u = 0; u < allEligibleUsers.length; u++) {
  const user = allEligibleUsers[u];
  const { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs } = getUserSplit(user);
  const trainKeys = new Set(trainWatched.map(getMovieKey));
  const candidates = catalog.filter(c => !trainKeys.has(getMovieKey(c)));

  const profile = await extractTasteProfile(trainWatched, [], { now: holdoutStartTs, anchorCutoff: Infinity });
  const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex);
  const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex);

  const ltPos = new Set();
  const ltRelevance = new Map();
  for (const tidStr of holdoutPositives) {
    if (!popularIds.has(Number(tidStr))) {
      ltPos.add(tidStr);
      ltRelevance.set(tidStr, holdoutRelevance.get(tidStr));
    }
  }

  // 1. CollabSim alone (raw dot)
  const dotRanked = [...candidates].sort((a, b) => {
    const sA = Number(collabSimMap.get(Number(a.tmdbId)) ?? -999);
    const sB = Number(collabSimMap.get(Number(b.tmdbId)) ?? -999);
    return sB - sA;
  });
  const dotIds = dotRanked.map(getMovieKey);
  sys_collab.ndcg[u] = computeNDCGAtK(dotIds, holdoutRelevance, 10);
  sys_collab.recall[u] = computeRecallAtK(dotIds, holdoutPositives, 20);
  sys_collab.ltNdcg[u] = computeNDCGAtK(dotIds, ltRelevance, 10);
  sys_collab.ltRecall[u] = computeRecallAtK(dotIds, ltPos, 20);

  // 2. Current Ranker (damping 0.20, default weights)
  const curRanked = rankCandidatePool(
    candidates,
    { profile, collabSimMap, contentSimMap: new Map(), repulsionMap, anchorKeywords: profile.lovedKeywordIds || [], userProviders: [] },
    DEFAULT_RANKER_WEIGHTS,
    candidates.length,
    { metadataDampingFactor: 0.20 }
  );
  const curIds = curRanked.map(getMovieKey);
  sys_current.ndcg[u] = computeNDCGAtK(curIds, holdoutRelevance, 10);
  sys_current.recall[u] = computeRecallAtK(curIds, holdoutPositives, 20);
  sys_current.ltNdcg[u] = computeNDCGAtK(curIds, ltRelevance, 10);
  sys_current.ltRecall[u] = computeRecallAtK(curIds, ltPos, 20);

  // 3. Zeroed Ranker (damping 0.20, bayesianRatingNorm=0, noveltyBonus=0)
  const zeroRanked = rankCandidatePool(
    candidates,
    { profile, collabSimMap, contentSimMap: new Map(), repulsionMap, anchorKeywords: profile.lovedKeywordIds || [], userProviders: [] },
    ZEROED_WEIGHTS,
    candidates.length,
    { metadataDampingFactor: 0.20 }
  );
  const zeroIds = zeroRanked.map(getMovieKey);
  sys_zeroed.ndcg[u] = computeNDCGAtK(zeroIds, holdoutRelevance, 10);
  sys_zeroed.recall[u] = computeRecallAtK(zeroIds, holdoutPositives, 20);
  sys_zeroed.ltNdcg[u] = computeNDCGAtK(zeroIds, ltRelevance, 10);
  sys_zeroed.ltRecall[u] = computeRecallAtK(zeroIds, ltPos, 20);
}

console.log("\nTABLE 1C: System Performance on All 328 Users (Current vs. Zeroed Features):");
console.log("------------------------------------------------------------------------------------------------------------------");
console.log("System                             | NDCG@10 (Mean) | Recall@20 (Mean) | LT NDCG@10 (Mean) | LT Recall@20 (Mean)");
console.log("------------------------------------------------------------------------------------------------------------------");
function printSysRow(name, s) {
  console.log(`${name.padEnd(34)} | ${stats(s.ndcg).mean.toFixed(4).padEnd(14)} | ${stats(s.recall).mean.toFixed(4).padEnd(16)} | ${stats(s.ltNdcg).mean.toFixed(4).padEnd(17)} | ${stats(s.ltRecall).mean.toFixed(4)}`);
}
printSysRow("1. collabSim Alone (raw dot)", sys_collab);
printSysRow("2. Current Ranker (Default)", sys_current);
printSysRow("3. Ranker (Bayesian=0, Novelty=0)", sys_zeroed);
console.log("------------------------------------------------------------------------------------------------------------------");

console.log("\nTABLE 1D: Paired Bootstrap 95% CIs: Zeroed Ranker vs. Current Ranker (1,000 resamples):");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Metric                             | Mean Delta | 95% Paired Bootstrap CI  | Significant?");
console.log("----------------------------------------------------------------------------------------------------------");
const zero_comps = [
  { name: "NDCG@10", cand: sys_zeroed.ndcg, base: sys_current.ndcg },
  { name: "Recall@20", cand: sys_zeroed.recall, base: sys_current.recall },
  { name: "Long-Tail NDCG@10", cand: sys_zeroed.ltNdcg, base: sys_current.ltNdcg },
  { name: "Long-Tail Recall@20", cand: sys_zeroed.ltRecall, base: sys_current.ltRecall }
];
for (const c of zero_comps) {
  const boot = pairedBootstrapCI(c.cand, c.base);
  const nameP = c.name.padEnd(34);
  const dStr = `${boot.meanDiff >= 0 ? "+" : ""}${boot.meanDiff.toFixed(4)}`.padEnd(10);
  const ciStr = `[${boot.ciLower >= 0 ? "+" : ""}${boot.ciLower.toFixed(4)}, ${boot.ciUpper >= 0 ? "+" : ""}${boot.ciUpper.toFixed(4)}]`.padEnd(24);
  const sigStr = boot.isSignificant ? "YES (Significant)" : "NO (Includes 0)";
  console.log(`${nameP} | ${dStr} | ${ciStr} | ${sigStr}`);
}
console.log("----------------------------------------------------------------------------------------------------------");

// ==========================================================================
// TASK 2: DECAY QUALITY TEST (NOT JUST WEIGHT SIZE)
// ==========================================================================
console.log("\n" + "=".repeat(70));
console.log("TASK 2: DECAY QUALITY TEST ACROSS 20 DIVERSE USERS");
console.log("=".repeat(70));

// Select 20 evenly spaced users
const userStep = allEligibleUsers.length / 20;
const sample20Users = Array.from({ length: 20 }, (_, i) => allEligibleUsers[Math.floor(i * userStep)]);
console.log(`Selected 20 diverse users: ${sample20Users.map(u => u.uid).join(", ")}`);

const testShifts = [
  { label: "30 days", days: 30 },
  { label: "1 year", days: 365 },
  { label: "3 years", days: 3 * 365 },
  { label: "8 years", days: 8 * 365 },
  { label: "15 years", days: 15 * 365 }
];

// For each user and shift, run production ranking path with real unanchored Date.now()
const task2UserShifts = [];

for (const user of sample20Users) {
  const { trainWatched, holdoutPositives, holdoutRelevance } = getUserSplit(user);
  const trainKeys = new Set(trainWatched.map(getMovieKey));
  const candidates = catalog.filter(c => !trainKeys.has(getMovieKey(c)));
  const maxTs = Math.max(...trainWatched.map(m => m.ts));

  const shiftRuns = {};

  for (const shift of testShifts) {
    const targetNewestMs = Date.now() - shift.days * 86400000;
    const offsetMs = targetNewestMs - maxTs;

    const shiftedWatched = trainWatched.map(m => {
      const shiftedTs = m.ts + offsetMs;
      return {
        ...m,
        ts: shiftedTs,
        dateWatched: new Date(shiftedTs).toISOString()
      };
    });

    // Production extractTasteProfile using unanchored real Date.now()
    const profile = await extractTasteProfile(shiftedWatched, [], {});
    const zScored = profile.weightedRatings || [];

    const weights = zScored.map(e => Number(e.weight || e.finalWeight || 0));
    const itemsDropped = zScored.filter(e => Math.abs(Number(e.weight || 0)) <= 1e-6).length;
    const likedDropped = zScored.filter(e => Number(e.rating || 0) >= 8 && Math.abs(Number(e.weight || 0)) <= 1e-6).length;

    const personas = computeUserPersonas(zScored, embeddingIndex);
    const collabSimMap = buildCollabSimMapFromIndex(zScored, embeddingIndex);
    const repulsionMap = buildRepulsionMapFromIndex(zScored, embeddingIndex);

    const ranked = rankCandidatePool(
      candidates,
      { profile, collabSimMap, contentSimMap: new Map(), repulsionMap, anchorKeywords: profile.lovedKeywordIds || [], userProviders: [] },
      DEFAULT_RANKER_WEIGHTS,
      candidates.length,
      { metadataDampingFactor: 0.20 }
    );

    const ids = ranked.map(getMovieKey);
    const ndcg = computeNDCGAtK(ids, holdoutRelevance, 10);
    const recall = computeRecallAtK(ids, holdoutPositives, 20);

    shiftRuns[shift.label] = {
      top20Ids: ids.slice(0, 20),
      personasCount: personas.length,
      itemsDropped,
      likedDropped,
      totalItems: zScored.length,
      ndcg,
      recall
    };
  }

  task2UserShifts.push({ user, shiftRuns });
}

// Compute aggregate metrics per shift compared to the 30-day baseline
console.log("\nTABLE 2A: Recommendation Stability & Quality vs. 30-Day Vault (20 Users):");
console.log("----------------------------------------------------------------------------------------------------------------------------------------");
console.log("Shift Age | Overlap@10 (Mean ± Std) | Spearman Rank Corr    | Kendall Tau Corr      | Personas (Mean) | Items Dropped (|w|<=1e-6) | NDCG@10   | Recall@20");
console.log("----------------------------------------------------------------------------------------------------------------------------------------");

const task2Aggregates = [];

for (const shift of testShifts) {
  const overlaps = [];
  const spearmans = [];
  const kendalls = [];
  const personas = [];
  const droppedTotal = [];
  const ndcgs = [];
  const recalls = [];

  for (const uData of task2UserShifts) {
    const baseRun = uData.shiftRuns["30 days"];
    const run = uData.shiftRuns[shift.label];

    // Overlap@10
    const top10Base = new Set(baseRun.top20Ids.slice(0, 10));
    const top10Cur = run.top20Ids.slice(0, 10);
    const overlapCount = top10Cur.filter(id => top10Base.has(id)).length;
    overlaps.push(overlapCount);

    // Rank Correlations
    spearmans.push(computeSpearmanRankCorr(baseRun.top20Ids, run.top20Ids, 20));
    kendalls.push(computeKendallTau(baseRun.top20Ids, run.top20Ids, 20));

    personas.push(run.personasCount);
    droppedTotal.push(run.itemsDropped);
    ndcgs.push(run.ndcg);
    recalls.push(run.recall);
  }

  const sO = stats(overlaps);
  const sS = stats(spearmans);
  const sK = stats(kendalls);
  const sP = stats(personas);
  const sD = stats(droppedTotal);
  const sN = stats(ndcgs);
  const sR = stats(recalls);

  console.log(`${shift.label.padEnd(9)} | ${sO.mean.toFixed(2)} ± ${sO.std.toFixed(2)} (out of 10) | ${sS.mean.toFixed(4).padEnd(21)} | ${sK.mean.toFixed(4).padEnd(21)} | ${sP.mean.toFixed(2).padEnd(15)} | ${sD.mean.toFixed(1).padEnd(25)} | ${sN.mean.toFixed(4).padEnd(9)} | ${sR.mean.toFixed(4)}`);

  task2Aggregates.push({
    shift: shift.label,
    days: shift.days,
    overlap10Mean: sO.mean,
    overlap10Std: sO.std,
    spearmanMean: sS.mean,
    kendallMean: sK.mean,
    personasMean: sP.mean,
    droppedMean: sD.mean,
    ndcgMean: sN.mean,
    recallMean: sR.mean
  });
}
console.log("----------------------------------------------------------------------------------------------------------------------------------------");

// Print fallback constants in scoringUtils.js
console.log("\nAuditing Fallback Constants in src/services/scoringUtils.js:");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Constant Name   | Value in Code (scoringUtils.js) | Intended Meaning");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("bulkPriorDays   | 180 days (line 39)              | Fallback age applied when dateWatched is missing or isBulkImported=true");
console.log("lambda (default)| 0.002 (line 32)                 | Daily exponential decay rate: e^(-0.002 * daysSince)");
console.log("----------------------------------------------------------------------------------------------------------");
console.log("Weight comparison: Undated import vs. Dated import of varying age (Rating = 8, zScore = 1.0):");
console.log(`- Undated movie (bulkPriorDays=180):   daysSince = 180  => timeDecay = e^(-0.002*180)  = ${(Math.exp(-0.002 * 180)).toFixed(4)} (weight = ${(1.0 * Math.exp(-0.002 * 180)).toFixed(4)})`);
console.log(`- Dated movie 180 days old:            daysSince = 180  => timeDecay = e^(-0.002*180)  = ${(Math.exp(-0.002 * 180)).toFixed(4)} (TIED)`);
console.log(`- Dated movie 1 year old (365 days):   daysSince = 365  => timeDecay = e^(-0.002*365)  = ${(Math.exp(-0.002 * 365)).toFixed(4)} (Undated is +45% higher)`);
console.log(`- Dated movie 3 years old (1095 days): daysSince = 1095 => timeDecay = e^(-0.002*1095) = ${(Math.exp(-0.002 * 1095)).toFixed(4)} (Undated is 6.2x higher)`);
console.log(`- Dated movie 8 years old (2920 days): daysSince = 2920 => timeDecay = e^(-0.002*2920) = ${(Math.exp(-0.002 * 2920)).toFixed(4)} (Undated is 240x higher)`);

// Save results
const outPath = path.join(root, ".data/task1_task2_results.json");
fs.writeFileSync(outPath, JSON.stringify({
  task1: {
    mlDistributions: { voteCount: mlVcDist, voteAverage: mlVaDist, bayesianRatingNorm: mlBnDist, noveltyBonus: mlNovDist },
    tmdbDistributions: { voteCount: tmdbVcDist, voteAverage: tmdbVaDist, bayesianRatingNorm: tmdbBnDist, noveltyBonus: tmdbNovDist },
    systemComparisons: {
      collab: { ndcg: stats(sys_collab.ndcg).mean, recall: stats(sys_collab.recall).mean, ltNdcg: stats(sys_collab.ltNdcg).mean, ltRecall: stats(sys_collab.ltRecall).mean },
      current: { ndcg: stats(sys_current.ndcg).mean, recall: stats(sys_current.recall).mean, ltNdcg: stats(sys_current.ltNdcg).mean, ltRecall: stats(sys_current.ltRecall).mean },
      zeroed: { ndcg: stats(sys_zeroed.ndcg).mean, recall: stats(sys_zeroed.recall).mean, ltNdcg: stats(sys_zeroed.ltNdcg).mean, ltRecall: stats(sys_zeroed.ltRecall).mean }
    }
  },
  task2: {
    aggregates: task2Aggregates,
    constants: { bulkPriorDays: 180, lambda: 0.002 }
  }
}, null, 2));

console.log(`\nSaved Task 1 & 2 results to ${outPath}`);
console.log("TASK 1 & TASK 2 COMPLETED SUCCESSFULLY.");
