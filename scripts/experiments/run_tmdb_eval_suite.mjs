import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "g:/Important Projects/movie-ratings";
const importSrc = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const {
  parseEmbeddingBinary,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  computeUserPersonas
} = await importSrc("src/services/embeddingService.js");
const { computeRecallAtK, computeNDCGAtK } = await importSrc("src/services/evalHarness.js");
const {
  rankCandidatePool,
  extractCandidateFeatures,
  scoreCandidate,
  DEFAULT_RANKER_WEIGHTS
} = await importSrc("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await importSrc("src/services/tmdbService.js");
const { computeBayesianScore } = await importSrc("src/services/scoringUtils.js");

function getMovieKey(m) {
  return String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
}

function stats(arr) {
  const n = arr.length;
  if (n === 0) return { mean: 0, std: 0 };
  let s = 0;
  for (let i = 0; i < n; i++) s += arr[i];
  const mean = s / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (arr[i] - mean) ** 2;
  return { mean, std: Math.sqrt(varSum / n) };
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return sortedArr[lo] * (1 - w) + sortedArr[hi] * w;
}

function distStats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const st = stats(arr);
  return {
    n: arr.length,
    min: sorted[0] ?? 0,
    p10: percentile(sorted, 10),
    median: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    mean: st.mean,
    std: st.std
  };
}

function pairedBootstrapCI(candScores, baseScores, numResamples = 1000, seed = 42) {
  const n = candScores.length;
  const diffs = new Float64Array(n);
  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    const d = candScores[i] - baseScores[i];
    diffs[i] = d;
    sumDiff += d;
  }
  const meanDiff = sumDiff / (n || 1);

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
  const ciLower = bootMeans[Math.floor(0.025 * numResamples)];
  const ciUpper = bootMeans[Math.floor(0.975 * numResamples)];
  const isSignificant = (ciLower > 0 && ciUpper > 0) || (ciLower < 0 && ciUpper < 0);

  return { meanDiff, ciLower, ciUpper, isSignificant };
}

function computeCorpusCoverage(topSets, catalogSize) {
  const uSet = new Set();
  for (let i = 0; i < topSets.length; i++) {
    for (const id of topSets[i]) uSet.add(id);
  }
  return { count: uSet.size, cov: uSet.size / catalogSize };
}

// Tie-corrected Spearman rank correlation over union of top K lists
function computeTieCorrectedUnionSpearman(listA, listB, k = 20) {
  const topA = listA.slice(0, k).map(String);
  const topB = listB.slice(0, k).map(String);
  const union = Array.from(new Set([...topA, ...topB]));
  const n = union.length;
  if (n <= 1) return 1.0;

  const rankMapA = new Map(topA.map((id, idx) => [id, idx + 1]));
  const rankMapB = new Map(topB.map((id, idx) => [id, idx + 1]));

  const missCountA = n - topA.length;
  const missCountB = n - topB.length;
  const tiedRankA = missCountA > 0 ? (k + 1 + n) / 2 : 0;
  const tiedRankB = missCountB > 0 ? (k + 1 + n) / 2 : 0;

  const rA = union.map(id => rankMapA.get(id) ?? tiedRankA);
  const rB = union.map(id => rankMapB.get(id) ?? tiedRankB);

  const meanA = rA.reduce((a, b) => a + b, 0) / n;
  const meanB = rB.reduce((a, b) => a + b, 0) / n;

  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = rA[i] - meanA;
    const db = rB[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const denom = Math.sqrt(denA * denB);
  return denom > 1e-12 ? num / denom : 0;
}

function fmtSigned(val, decimals = 4) {
  return `${val >= 0 ? "+" : ""}${val.toFixed(decimals)}`;
}

// ==========================================================================
// 1. LOAD EMBEDDINGS (CLEAN ONLY) & TMDB ENRICHMENT DATA
// ==========================================================================
console.log("==========================================================================");
console.log("LOADING CLEAN EMBEDDINGS, MOVIELENS, AND TMDB-ENRICHED CATALOG");
console.log("==========================================================================");

const cleanEmbPath = path.join(root, ".data/item_embeddings_clean_f16.bin");
const cleanBuf = fs.readFileSync(cleanEmbPath);
const cleanIndex = parseEmbeddingBinary(
  cleanBuf.buffer.slice(cleanBuf.byteOffset, cleanBuf.byteOffset + cleanBuf.byteLength)
);
console.log(`Loaded CLEAN embeddings (${cleanEmbPath}): ${cleanIndex.count} items, dim=${cleanIndex.dim}`);

const enrichedPath = path.join(root, ".data/tmdb_enriched.json");
if (!fs.existsSync(enrichedPath)) {
  console.error("ERROR: .data/tmdb_enriched.json not found! Run enrich_tmdb.mjs first.");
  process.exit(1);
}
const tmdbEnriched = JSON.parse(fs.readFileSync(enrichedPath, "utf8"));
const tmdbItems = tmdbEnriched.items || {};
const tmdbFailed = tmdbEnriched.failed || {};
console.log(
  `Loaded .data/tmdb_enriched.json (mode=${tmdbEnriched.meta?.mode || "unknown"}): ` +
  `fetched=${Object.keys(tmdbItems).length}, failed=${Object.keys(tmdbFailed).length}`
);

const tmdbCache = fs.existsSync(path.join(root, ".data/tmdb_cache.json"))
  ? JSON.parse(fs.readFileSync(path.join(root, ".data/tmdb_cache.json"), "utf8"))
  : {};

// Load MovieLens small
const linksLines = fs
  .readFileSync(path.join(root, ".data/ml-latest-small/links.csv"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1);

const movieIdToTmdbId = new Map();
const tmdbIdToMovieIds = new Map();
for (const l of linksLines) {
  const [mid, , tmdb] = l.trim().split(",");
  if (tmdb) {
    const tid = Number(tmdb);
    if (Number.isFinite(tid) && tid > 0) {
      movieIdToTmdbId.set(mid.trim(), tid);
      if (!tmdbIdToMovieIds.has(tid)) tmdbIdToMovieIds.set(tid, []);
      tmdbIdToMovieIds.get(tid).push(mid.trim());
    }
  }
}

const moviesLines = fs
  .readFileSync(path.join(root, ".data/ml-latest-small/movies.csv"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1);
const movieMeta = new Map();
for (const l of moviesLines) {
  const commaIdx = l.indexOf(",");
  const lastComma = l.lastIndexOf(",");
  if (commaIdx === -1) continue;
  const mid = l.slice(0, commaIdx).trim();
  const genres = l.slice(lastComma + 1).trim();
  const title = l.slice(commaIdx + 1, lastComma).trim().replace(/^"|"$/g, "");
  const yearMatch = title.match(/\((\d{4})\)\s*$/);
  movieMeta.set(mid, { title, genres, mlYear: yearMatch ? yearMatch[1] : "N/A" });
}

function mapMovieLensGenresToTmdb(genresStr = "") {
  if (!genresStr || genresStr === "(no genres listed)") return [];
  const normalized = genresStr
    .replace(/\|/g, ",")
    .replace(/\bchildren\b/gi, "Family")
    .replace(/\bsci-fi\b/gi, "Sci-Fi");
  return mapOmdbToTmdbGenreIds(normalized);
}

const ratingsLines = fs
  .readFileSync(path.join(root, ".data/ml-latest-small/ratings.csv"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1);

const ratingsByUser = new Map();
const mlCounts = new Map();
const mlSums = new Map();

for (const l of ratingsLines) {
  const [uid, mid, rStr, tsStr] = l.trim().split(",");
  const tid = movieIdToTmdbId.get(mid);
  if (!tid) continue;

  const r = Number(rStr) * 2; // 10-point scale
  const ts = Number(tsStr);
  const meta = movieMeta.get(mid) || { title: "Unknown", genres: "", mlYear: "N/A" };
  const e = tmdbItems[tid] || null;
  const fallbackGenres = mapMovieLensGenresToTmdb(meta.genres);
  const genreIds = e ? (e.tmdbGenreIds || []) : fallbackGenres;

  if (!ratingsByUser.has(uid)) ratingsByUser.set(uid, []);
  ratingsByUser.get(uid).push({
    id: tid,
    tmdbId: tid,
    movieId: mid,
    title: e?.title || meta.title,
    year: e?.year || meta.mlYear || "N/A",
    release_date: e?.release_date || null,
    userRating: r,
    dateWatched: new Date(ts * 1000).toISOString(),
    ts: ts * 1000,
    genre: e?.genre || meta.genres || "Cinema",
    tmdbGenreIds: genreIds,
    genre_ids: genreIds,
    tmdbKeywords: e?.tmdbKeywords || [],
    castIds: e?.castIds || [],
    crewPersonId: e?.crewPersonId ?? null,
    director: e?.director || "Unknown",
    vote_average: e?.vote_average ?? null,
    vote_count: e?.vote_count ?? 0,
    popularity: e?.popularity ?? 0,
    streamProviders: e?.streamProviders || []
  });

  mlCounts.set(tid, (mlCounts.get(tid) || 0) + 1);
  mlSums.set(tid, (mlSums.get(tid) || 0) + r);
}

// Identify the exact 328 eligible users
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
console.log(`Eligible Users: ${allEligibleUsers.length} (Tuning: 0..159 [160], Test: 160..327 [168])`);

// Build deduplicated TMDB-enriched catalog (if restricted mode, filter to ratedBy328 OR mlCount >= 5)
const ratedBy328 = new Set();
for (const u of allEligibleUsers) {
  for (const m of u.ratings) ratedBy328.add(m.tmdbId);
}

const isRestricted = tmdbEnriched.meta?.mode === "restricted";
const catalog = [];
for (const [tid, mids] of tmdbIdToMovieIds.entries()) {
  const mlCnt = mlCounts.get(tid) || 0;
  if (isRestricted && !ratedBy328.has(tid) && mlCnt < 5) continue;

  const meta = movieMeta.get(mids[0]) || { title: "Unknown", genres: "", mlYear: "N/A" };
  const e = tmdbItems[tid] || null;
  const fallbackGenres = mapMovieLensGenresToTmdb(meta.genres);
  const genreIds = e ? (e.tmdbGenreIds || []) : fallbackGenres;

  catalog.push({
    id: tid,
    tmdbId: tid,
    title: e?.title || meta.title,
    year: e?.year || meta.mlYear || "N/A",
    release_date: e?.release_date || null,
    genre: e?.genre || meta.genres || "Cinema",
    tmdbGenreIds: genreIds,
    genre_ids: genreIds,
    tmdbKeywords: e?.tmdbKeywords || [],
    castIds: e?.castIds || [],
    crewPersonId: e?.crewPersonId ?? null,
    director: e?.director || "Unknown",
    vote_average: e?.vote_average ?? null,
    vote_count: e?.vote_count ?? 0,
    popularity: e?.popularity ?? 0,
    streamProviders: e?.streamProviders || [],
    _enriched: Boolean(e),
    _mlVoteCount: mlCnt,
    _mlVoteAvg: mlCnt > 0 ? Number(((mlSums.get(tid) || 7.0) / mlCnt).toFixed(1)) : 7.0
  });
}

console.log(`Catalog Pool (${isRestricted ? "Restricted >=5 or 328-rated" : "Full Unique TMDB"}): ${catalog.length} films`);

function getUserSplit(user) {
  const sorted = [...user.ratings].sort((a, b) => a.ts - b.ts);
  let pCount = 0;
  let splitIdx = sorted.length;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].userRating >= 8) {
      pCount++;
      if (pCount === 10) {
        splitIdx = i;
        break;
      }
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

// ==========================================================================
// TASK 1: COVERAGE, VOTE-SCALE & FEATURE-POPULATION DIAGNOSTICS
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 1: TMDB ENRICHMENT COVERAGE, VOTE-SCALE & FEATURE POPULATION");
console.log("==========================================================================");

const N_cat = catalog.length;
let cntEnriched = 0;
let cntVoteAvg = 0;
let cntVoteCnt = 0;
let cntGenresTmdb = 0;
let cntKeywords = 0;
let cntCast = 0;
let cntCrew = 0;
let cntRelDate = 0;
let cntProviders = 0;
let cntCleanEmb = 0;

for (const c of catalog) {
  if (c._enriched) {
    cntEnriched++;
    if (c.vote_average !== null && c.vote_average > 0) cntVoteAvg++;
    if (c.vote_count > 0) cntVoteCnt++;
    if (c.tmdbGenreIds.length > 0) cntGenresTmdb++;
    if (c.tmdbKeywords.length > 0) cntKeywords++;
    if (c.castIds.length > 0) cntCast++;
    if (c.crewPersonId !== null && c.crewPersonId > 0) cntCrew++;
    if (c.release_date) cntRelDate++;
    if (c.streamProviders.length > 0) cntProviders++;
  }
  if (cleanIndex.idToIndex.has(Number(c.tmdbId))) cntCleanEmb++;
}

// Holdout positive coverage across 328 users
let totalHoldoutPosCount = 0;
let holdoutTmdbOkCount = 0;
let holdoutCleanEmbCount = 0;
let holdoutKeywordsCount = 0;
let holdoutCastCount = 0;
let holdoutCrewCount = 0;
for (const u of allEligibleUsers) {
  const { holdoutPositives } = getUserSplit(u);
  for (const tidStr of holdoutPositives) {
    const tid = Number(tidStr);
    totalHoldoutPosCount++;
    const e = tmdbItems[tid];
    if (e) {
      holdoutTmdbOkCount++;
      if (e.tmdbKeywords?.length > 0) holdoutKeywordsCount++;
      if (e.castIds?.length > 0) holdoutCastCount++;
      if (e.crewPersonId) holdoutCrewCount++;
    }
    if (cleanIndex.idToIndex.has(tid)) holdoutCleanEmbCount++;
  }
}

const fieldCoverage = {
  catalogSize: N_cat,
  tmdbFetchedOk: { count: cntEnriched, pct: (cntEnriched / N_cat) * 100 },
  tmdbFailed: { count: N_cat - cntEnriched, pct: ((N_cat - cntEnriched) / N_cat) * 100 },
  vote_average: { count: cntVoteAvg, pct: (cntVoteAvg / N_cat) * 100 },
  vote_count_gt0: { count: cntVoteCnt, pct: (cntVoteCnt / N_cat) * 100 },
  tmdbGenreIds: { count: cntGenresTmdb, pct: (cntGenresTmdb / N_cat) * 100 },
  tmdbKeywords: { count: cntKeywords, pct: (cntKeywords / N_cat) * 100 },
  castIds: { count: cntCast, pct: (cntCast / N_cat) * 100 },
  crewPersonId: { count: cntCrew, pct: (cntCrew / N_cat) * 100 },
  release_date: { count: cntRelDate, pct: (cntRelDate / N_cat) * 100 },
  streamProviders: { count: cntProviders, pct: (cntProviders / N_cat) * 100 },
  cleanEmbeddings: { count: cntCleanEmb, pct: (cntCleanEmb / N_cat) * 100 },
  holdoutPositives: {
    total: totalHoldoutPosCount,
    tmdbOkPct: (holdoutTmdbOkCount / Math.max(1, totalHoldoutPosCount)) * 100,
    cleanEmbPct: (holdoutCleanEmbCount / Math.max(1, totalHoldoutPosCount)) * 100,
    keywordsPct: (holdoutKeywordsCount / Math.max(1, totalHoldoutPosCount)) * 100,
    castPct: (holdoutCastCount / Math.max(1, totalHoldoutPosCount)) * 100,
    crewPct: (holdoutCrewCount / Math.max(1, totalHoldoutPosCount)) * 100
  }
};

console.log("\nTABLE 1A: TMDB Per-Field Coverage Across Offline Catalog (N = " + N_cat + "):");
console.log("------------------------------------------------------------------");
console.log("Field / Source          | Populated Count | Catalog Share (%)");
console.log("------------------------------------------------------------------");
for (const [k, v] of Object.entries(fieldCoverage)) {
  if (k === "catalogSize" || k === "holdoutPositives") continue;
  console.log(`${k.padEnd(23)} | ${String(v.count).padEnd(15)} | ${v.pct.toFixed(2)}%`);
}
console.log("------------------------------------------------------------------");
console.log(
  `Held-out Positives (N=${totalHoldoutPosCount}): ` +
  `TMDB OK=${fieldCoverage.holdoutPositives.tmdbOkPct.toFixed(2)}%, ` +
  `CleanEmb=${fieldCoverage.holdoutPositives.cleanEmbPct.toFixed(2)}%, ` +
  `Keywords=${fieldCoverage.holdoutPositives.keywordsPct.toFixed(2)}%, ` +
  `Cast=${fieldCoverage.holdoutPositives.castPct.toFixed(2)}%, ` +
  `Crew=${fieldCoverage.holdoutPositives.crewPct.toFixed(2)}%`
);

// Vote-scale & derived feature comparison (Old ML vs New Enriched TMDB vs Prod Cache Sample)
const oldMlVc = catalog.map(c => Math.max(1, c._mlVoteCount));
const oldMlVa = catalog.map(c => c._mlVoteAvg);
const oldMlBn = catalog.map(c => Math.max(0, Math.min(1, (computeBayesianScore(c._mlVoteAvg, Math.max(1, c._mlVoteCount), 500, 7.0) - 5.0) / 4.5)));
const oldMlNov = catalog.map(c => {
  const vc = Math.max(10, Number(c._mlVoteCount || 200));
  return vc >= 100 && vc <= 4000 ? 0.5 : 0.1;
});

const newTmdbVc = catalog.map(c => c.vote_count);
const newTmdbVa = catalog.filter(c => c.vote_average !== null).map(c => c.vote_average);
const newTmdbBn = catalog.map(c => Math.max(0, Math.min(1, (computeBayesianScore(c.vote_average, c.vote_count, 500, 7.0) - 5.0) / 4.5)));
const newTmdbNov = catalog.map(c => {
  const vc = Math.max(10, Number(c.vote_count || 200));
  return vc >= 100 && vc <= 4000 ? 0.5 : 0.1;
});

const prodCacheEntries = Object.values(tmdbCache).filter(e => e && e.vote_count !== undefined && e.vote_average !== undefined);
const prodVc = prodCacheEntries.map(e => e.vote_count);
const prodVa = prodCacheEntries.map(e => e.vote_average);
const prodBn = prodCacheEntries.map(e => Math.max(0, Math.min(1, (computeBayesianScore(e.vote_average, e.vote_count, 500, 7.0) - 5.0) / 4.5)));
const prodNov = prodCacheEntries.map(e => {
  const vc = Math.max(10, Number(e.vote_count || 200));
  return vc >= 100 && vc <= 4000 ? 0.5 : 0.1;
});

const voteScaleSummary = {
  oldMl: { voteCount: distStats(oldMlVc), voteAvg: distStats(oldMlVa), bayesNorm: distStats(oldMlBn), novelty: distStats(oldMlNov), nov05Share: oldMlNov.filter(x => x === 0.5).length / N_cat },
  enrichedCatalog: { voteCount: distStats(newTmdbVc), voteAvg: distStats(newTmdbVa), bayesNorm: distStats(newTmdbBn), novelty: distStats(newTmdbNov), nov05Share: newTmdbNov.filter(x => x === 0.5).length / N_cat },
  prodCache: { voteCount: distStats(prodVc), voteAvg: distStats(prodVa), bayesNorm: distStats(prodBn), novelty: distStats(prodNov), nov05Share: prodNov.filter(x => x === 0.5).length / prodCacheEntries.length }
};

console.log("\nTABLE 1B: Vote-Scale & Derived Feature Distributions (Old ML vs TMDB-Enriched Offline vs Prod Sample):");
console.log("-----------------------------------------------------------------------------------------------------------------------");
console.log("Dataset                | Feature            | Min     | p10     | Median  | p90      | p99      | Max      | Sigma (Std)");
console.log("-----------------------------------------------------------------------------------------------------------------------");
function pScaleRow(ds, feat, d) {
  console.log(
    `${ds.padEnd(22)} | ${feat.padEnd(18)} | ${d.min.toFixed(2).padEnd(7)} | ${d.p10.toFixed(2).padEnd(7)} | ` +
    `${d.median.toFixed(2).padEnd(7)} | ${d.p90.toFixed(2).padEnd(8)} | ${d.p99.toFixed(2).padEnd(8)} | ${d.max.toFixed(2).padEnd(8)} | ${d.std.toFixed(4)}`
  );
}
pScaleRow("Old ML (9.7k)", "voteCount", voteScaleSummary.oldMl.voteCount);
pScaleRow("Enriched TMDB (9.7k)", "voteCount", voteScaleSummary.enrichedCatalog.voteCount);
pScaleRow("Prod Cache (559)", "voteCount", voteScaleSummary.prodCache.voteCount);
pScaleRow("Old ML (9.7k)", "voteAverage", voteScaleSummary.oldMl.voteAvg);
pScaleRow("Enriched TMDB (9.7k)", "voteAverage", voteScaleSummary.enrichedCatalog.voteAvg);
pScaleRow("Prod Cache (559)", "voteAverage", voteScaleSummary.prodCache.voteAvg);
pScaleRow("Old ML (9.7k)", "bayesianRatingNorm", voteScaleSummary.oldMl.bayesNorm);
pScaleRow("Enriched TMDB (9.7k)", "bayesianRatingNorm", voteScaleSummary.enrichedCatalog.bayesNorm);
pScaleRow("Prod Cache (559)", "bayesianRatingNorm", voteScaleSummary.prodCache.bayesNorm);
pScaleRow("Old ML (9.7k)", "noveltyBonus", voteScaleSummary.oldMl.novelty);
pScaleRow("Enriched TMDB (9.7k)", "noveltyBonus", voteScaleSummary.enrichedCatalog.novelty);
pScaleRow("Prod Cache (559)", "noveltyBonus", voteScaleSummary.prodCache.novelty);
console.log("-----------------------------------------------------------------------------------------------------------------------");
console.log(
  `noveltyBonus == 0.5 share: Old ML=${(voteScaleSummary.oldMl.nov05Share * 100).toFixed(2)}%, ` +
  `Enriched TMDB=${(voteScaleSummary.enrichedCatalog.nov05Share * 100).toFixed(2)}%, ` +
  `Prod Cache=${(voteScaleSummary.prodCache.nov05Share * 100).toFixed(2)}% (all remaining get 0.1, so nonzero share is 100%)`
);

// Build Long-Tail definition (bottom 80% by TMDB vote_count)
const sortedByTmdbVotes = [...catalog].sort((a, b) => {
  if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count;
  return (b.vote_average ?? 0) - (a.vote_average ?? 0) || a.tmdbId - b.tmdbId;
});
const top20Cut = Math.floor(0.20 * sortedByTmdbVotes.length);
const popularTmdbIds = new Set(sortedByTmdbVotes.slice(0, top20Cut).map(c => Number(c.tmdbId)));
const popVoteThreshold = sortedByTmdbVotes[top20Cut - 1]?.vote_count ?? 0;
console.log(`Long-Tail Cutoff (Bottom 80% by TMDB vote_count): vote_count <= ${popVoteThreshold} (${catalog.length - top20Cut} / ${catalog.length} films)`);

// Pre-calculate user splits, profiles, collab/repulsion maps, and extracted candidate features
console.log("\nExtracting TMDB-enriched taste profiles, clean embeddings similarity maps, and ranker features for 328 users...");
const FEAT_KEYS = Object.keys(DEFAULT_RANKER_WEIGHTS).filter(k => k !== "bias");

// Accumulators for Feature Population Table across all (user, candidate) pairs
const featPairCount = { total: 0 };
const featNonZeroCount = Object.fromEntries(FEAT_KEYS.map(k => [k, 0]));
const featNovHalfCount = { val: 0 };
const featSum = Object.fromEntries(FEAT_KEYS.map(k => [k, 0]));
const featSumSq = Object.fromEntries(FEAT_KEYS.map(k => [k, 0]));
const userProfilePop = {
  lovedGenres: 0,
  lovedKeywords: 0,
  hatedKeywords: 0,
  topCast: 0,
  topCrew: 0,
  ltHoldoutUsers: 0,
  ltHoldoutTuning: 0,
  ltHoldoutTest: 0
};

// Map catalog index by tmdbId for fast lookup
const catalogMap = new Map(catalog.map((c, idx) => [c.tmdbId, idx]));
const catVoteCountArr = Float64Array.from(catalog, c => c.vote_count);
const catVoteAvgArr = Float64Array.from(catalog, c => c.vote_average ?? 7.0);
const catLogVoteArr = Float64Array.from(catalog, c => Math.log(Math.max(1, c.vote_count)));
const catBayesArr = Float64Array.from(catalog, c => computeBayesianScore(c.vote_average, c.vote_count, 500, 7.0));
const catIdStrArr = catalog.map(c => String(c.tmdbId));
const catIsPopArr = Uint8Array.from(catalog, c => (popularTmdbIds.has(Number(c.tmdbId)) ? 1 : 0));

// Pre-sort static catalog indices for Pop VoteCount & Pop Bayesian
const popVcOrder = Array.from({ length: N_cat }, (_, i) => i).sort((a, b) => {
  if (catVoteCountArr[b] !== catVoteCountArr[a]) return catVoteCountArr[b] - catVoteCountArr[a];
  if (catVoteAvgArr[b] !== catVoteAvgArr[a]) return catVoteAvgArr[b] - catVoteAvgArr[a];
  return catalog[a].tmdbId - catalog[b].tmdbId;
});
const popBayesOrder = Array.from({ length: N_cat }, (_, i) => i).sort((a, b) => {
  if (catBayesArr[b] !== catBayesArr[a]) return catBayesArr[b] - catBayesArr[a];
  return String(catalog[a].tmdbId).localeCompare(String(catalog[b].tmdbId));
});

// Helper: extract ranker features identically to rankCandidatePool + verify on first 5 users
const userEvalInputs = [];
for (let u = 0; u < allEligibleUsers.length; u++) {
  const user = allEligibleUsers[u];
  const { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs } = getUserSplit(user);
  const trainIdSet = new Set(trainWatched.map(m => Number(m.tmdbId)));

  const profile = await extractTasteProfile(trainWatched, [], {
    now: holdoutStartTs,
    anchorCutoff: Infinity
  });

  if (profile.lovedGenreIds?.length > 0) userProfilePop.lovedGenres++;
  if (profile.lovedKeywordIds?.length > 0) userProfilePop.lovedKeywords++;
  if (profile.hatedKeywordIds?.length > 0) userProfilePop.hatedKeywords++;
  if (profile.topCastIds?.length > 0) userProfilePop.topCast++;
  if (profile.topCrewIds?.length > 0 || profile.topCrewMemberId) userProfilePop.topCrew++;

  const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, cleanIndex);
  const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, cleanIndex);

  const ltHoldoutPositives = new Set();
  const ltHoldoutRelevance = new Map();
  for (const [tidStr, rel] of holdoutRelevance.entries()) {
    if (!popularTmdbIds.has(Number(tidStr))) {
      ltHoldoutRelevance.set(tidStr, rel);
      if (holdoutPositives.has(tidStr)) ltHoldoutPositives.add(tidStr);
    }
  }
  if (ltHoldoutPositives.size > 0) {
    userProfilePop.ltHoldoutUsers++;
    if (u < 160) userProfilePop.ltHoldoutTuning++;
    else userProfilePop.ltHoldoutTest++;
  }

  // Build unseen candidate indices preserving catalog order
  const candIndices = [];
  for (let i = 0; i < N_cat; i++) {
    if (!trainIdSet.has(catalog[i].tmdbId)) candIndices.push(i);
  }
  const nCand = candIndices.length;

  let maxPoolCollab = 0;
  for (let j = 0; j < nCand; j++) {
    const tid = catalog[candIndices[j]].tmdbId;
    const v = Number(collabSimMap.get(tid) ?? 0);
    if (v > maxPoolCollab) maxPoolCollab = v;
  }
  const collabScale = maxPoolCollab > 0.05 ? maxPoolCollab : 1.0;

  const context = {
    profile,
    collabSimMap,
    contentSimMap: new Map(),
    repulsionMap,
    anchorKeywords: profile.lovedKeywordIds || [],
    userProviders: []
  };

  // Store dense Float64 matrix: 11 features x nCand + rawCollab vector
  const rawCollab = new Float64Array(nCand);
  const candFeats = new Array(11);
  for (let f = 0; f < 11; f++) candFeats[f] = new Float64Array(nCand);
  const hasCollabFlag = new Uint8Array(nCand);

  for (let j = 0; j < nCand; j++) {
    const c = catalog[candIndices[j]];
    const feat = extractCandidateFeatures(c, context);
    rawCollab[j] = feat.collabSim;
    if (feat.collabSim > 0 && maxPoolCollab > 0.05) {
      feat.collabSim = Math.min(1.0, feat.collabSim / collabScale);
    }
    hasCollabFlag[j] = Math.abs(Number(feat.collabSim || 0)) > 0.001 ? 1 : 0;

    featPairCount.total++;
    if (feat.noveltyBonus === 0.5) featNovHalfCount.val++;

    for (let f = 0; f < 11; f++) {
      const k = FEAT_KEYS[f];
      const val = Number(feat[k] || 0);
      candFeats[f][j] = val;
      if (Math.abs(val) > 1e-12) featNonZeroCount[k]++;
      featSum[k] += val;
      featSumSq[k] += val * val;
    }
  }

  userEvalInputs.push({
    uid: user.uid,
    trainIdSet,
    candIndices,
    nCand,
    rawCollab,
    candFeats,
    hasCollabFlag,
    holdoutPositives,
    holdoutRelevance,
    ltHoldoutPositives,
    ltHoldoutRelevance,
    profile,
    context
  });
}

const featurePopSummary = {};
console.log("\nTABLE 1C: Extracted Ranker Feature Population Across 328 Users x Candidates (N_pairs = " + featPairCount.total + "):");
console.log("Profile Population across 328 users: " +
  `lovedGenres=${userProfilePop.lovedGenres}/328 (${(userProfilePop.lovedGenres/328*100).toFixed(1)}%), ` +
  `lovedKeywords=${userProfilePop.lovedKeywords}/328 (${(userProfilePop.lovedKeywords/328*100).toFixed(1)}%), ` +
  `hatedKeywords=${userProfilePop.hatedKeywords}/328 (${(userProfilePop.hatedKeywords/328*100).toFixed(1)}%), ` +
  `topCast=${userProfilePop.topCast}/328 (${(userProfilePop.topCast/328*100).toFixed(1)}%), ` +
  `topCrew=${userProfilePop.topCrew}/328 (${(userProfilePop.topCrew/328*100).toFixed(1)}%)`
);
console.log("---------------------------------------------------------------------------------------");
console.log("Feature                | NonZero Share (%) | Mean       | Sigma (Std) | Notes");
console.log("---------------------------------------------------------------------------------------");
for (const k of FEAT_KEYS) {
  const nzPct = (featNonZeroCount[k] / featPairCount.total) * 100;
  const m = featSum[k] / featPairCount.total;
  const variance = Math.max(0, featSumSq[k] / featPairCount.total - m * m);
  const sd = Math.sqrt(variance);
  let note = "";
  if (k === "noveltyBonus") note = `0.5 bonus share = ${(featNovHalfCount.val / featPairCount.total * 100).toFixed(2)}%`;
  if (k === "contentSim") note = "Always 0 (no content embeddings wired)";
  if (k === "providerMatch") note = "Always 0.5 (userProviders = [])";
  featurePopSummary[k] = { nonZeroShare: nzPct / 100, mean: m, sigma: sd };
  console.log(`${k.padEnd(22)} | ${nzPct.toFixed(3).padStart(16)}% | ${m.toFixed(4).padEnd(10)} | ${sd.toFixed(4).padEnd(11)} | ${note}`);
}
console.log("---------------------------------------------------------------------------------------");

// ==========================================================================
// TASK 2: FULL RANKER EVALUATION + 11 ABLATIONS ON ALL 328 USERS
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 2: FULL EVALUATION & 11 LEAVE-ONE-FEATURE-OUT ABLATIONS (CLEAN EMB)");
console.log("==========================================================================");

const SYSTEMS = [
  { id: "pop_vc", label: "Popularity (TMDB vote_count)", type: "pop_vc" },
  { id: "pop_bayes", label: "Popularity (Bayesian vote_avg)", type: "pop_bayes" },
  { id: "collab_only", label: "collabSim Alone (Clean Dot)", type: "collab_only" },
  { id: "prod_ranker", label: "Current Ranker (Production)", type: "ranker", weights: { ...DEFAULT_RANKER_WEIGHTS } },
  ...FEAT_KEYS.map(k => ({
    id: `ablate_${k}`,
    label: `w/o ${k}`,
    type: "ranker",
    ablatedKey: k,
    weights: { ...DEFAULT_RANKER_WEIGHTS, [k]: 0 }
  }))
];

// Verification check: ensure fast ranker path produces IDENTICAL top-20 lists to rankCandidatePool on first 5 users
function selectTopKDescending(scores, candIndices, k = 20) {
  // Exact match to descending Array.prototype.sort preserving earlier index on ties
  const n = scores.length;
  const top = new Array(Math.min(k, n));
  // Maintain small sorted array of size k (much faster than sorting 9,700 elements 15x328=4,920 times!)
  let filled = 0;
  let minVal = -Infinity;
  let minPos = -1;
  // Wait: to be 100% deterministic and super fast, track full indices? Actually N=9,700 partial min-heap or sorted insert of k=20:
  // Wait: most items have score < 20th threshold after first ~100 items, so threshold check skips 99% of comparisons!
  for (let j = 0; j < n; j++) {
    const s = scores[j];
    if (filled < k) {
      let pos = filled;
      while (pos > 0 && top[pos - 1].s < s) {
        top[pos] = top[pos - 1];
        pos--;
      }
      top[pos] = { s, j };
      filled++;
      minVal = top[filled - 1].s;
    } else if (s > minVal) {
      let pos = filled - 1;
      while (pos > 0 && top[pos - 1].s < s) {
        top[pos] = top[pos - 1];
        pos--;
      }
      top[pos] = { s, j };
      minVal = top[filled - 1].s;
    }
  }
  return top.map(x => candIndices[x.j]);
}

function scoreLinearRanker(uIn, weights, damping = 0.20) {
  const n = uIn.nCand;
  const probs = new Float64Array(n);
  const bias = Number(weights.bias || 0);
  const wArr = Float64Array.from(FEAT_KEYS, k => Number(weights[k] || 0));
  const genreIdx = FEAT_KEYS.indexOf("genreOverlap");
  const bayesIdx = FEAT_KEYS.indexOf("bayesianRatingNorm");
  const feats = uIn.candFeats;
  const hasCollab = uIn.hasCollabFlag;

  for (let j = 0; j < n; j++) {
    let logit = bias;
    const damp = hasCollab[j] ? damping : 1.0;
    for (let f = 0; f < 11; f++) {
      let x = feats[f][j];
      if (f === genreIdx || f === bayesIdx) x *= damp;
      logit += wArr[f] * x;
    }
    probs[j] = 1 / (1 + Math.exp(-logit));
  }
  return probs;
}

console.log("Running strict equivalence test: fast ranker vs direct src/ rankCandidatePool on first 5 users...");
for (let u = 0; u < 5; u++) {
  const uIn = userEvalInputs[u];
  const cands = uIn.candIndices.map(idx => catalog[idx]);
  for (const sys of SYSTEMS.filter(s => s.type === "ranker")) {
    const refRanked = rankCandidatePool(cands, uIn.context, sys.weights, 20, { metadataDampingFactor: 0.20 });
    const refTop20 = refRanked.map(m => String(m.tmdbId));
    const probs = scoreLinearRanker(uIn, sys.weights, 0.20);
    const fastTop20 = selectTopKDescending(probs, uIn.candIndices, 20).map(idx => catIdStrArr[idx]);
    for (let i = 0; i < 20; i++) {
      if (refTop20[i] !== fastTop20[i]) {
        throw new Error(`Equivalence mismatch user=${uIn.uid} sys=${sys.id} pos=${i}: ${refTop20[i]} vs ${fastTop20[i]}`);
      }
    }
  }
}
console.log("Equivalence test PASSED 100% (all ranker configs match rankCandidatePool top-20 bit-for-bit).");

const sysResults = {};
for (const sys of SYSTEMS) {
  sysResults[sys.id] = {
    label: sys.label,
    ndcg: new Float64Array(328),
    recall: new Float64Array(328),
    ltNdcg: new Float64Array(328),
    ltRecall: new Float64Array(328),
    meanLogVc: new Float64Array(328),
    top10Sets: new Array(328),
    top20Sets: new Array(328)
  };
}

for (let u = 0; u < 328; u++) {
  const uIn = userEvalInputs[u];

  for (const sys of SYSTEMS) {
    let top20CatIdx;
    if (sys.type === "pop_vc") {
      top20CatIdx = [];
      for (let i = 0; i < popVcOrder.length && top20CatIdx.length < 20; i++) {
        const idx = popVcOrder[i];
        if (!uIn.trainIdSet.has(catalog[idx].tmdbId)) top20CatIdx.push(idx);
      }
    } else if (sys.type === "pop_bayes") {
      top20CatIdx = [];
      for (let i = 0; i < popBayesOrder.length && top20CatIdx.length < 20; i++) {
        const idx = popBayesOrder[i];
        if (!uIn.trainIdSet.has(catalog[idx].tmdbId)) top20CatIdx.push(idx);
      }
    } else if (sys.type === "collab_only") {
      const scores = new Float64Array(uIn.nCand);
      for (let j = 0; j < uIn.nCand; j++) {
        const tid = catalog[uIn.candIndices[j]].tmdbId;
        scores[j] = uIn.context.collabSimMap.has(tid) ? Number(uIn.context.collabSimMap.get(tid)) : -999;
      }
      top20CatIdx = selectTopKDescending(scores, uIn.candIndices, 20);
    } else {
      const probs = scoreLinearRanker(uIn, sys.weights, 0.20);
      top20CatIdx = selectTopKDescending(probs, uIn.candIndices, 20);
    }

    const top20Ids = top20CatIdx.map(idx => catIdStrArr[idx]);
    const sr = sysResults[sys.id];
    sr.ndcg[u] = computeNDCGAtK(top20Ids, uIn.holdoutRelevance, 10);
    sr.recall[u] = computeRecallAtK(top20Ids, uIn.holdoutPositives, 20);
    sr.ltNdcg[u] = computeNDCGAtK(top20Ids, uIn.ltHoldoutRelevance, 10);
    sr.ltRecall[u] = computeRecallAtK(top20Ids, uIn.ltHoldoutPositives, 20);

    let logVcSum = 0;
    for (let i = 0; i < 10 && i < top20CatIdx.length; i++) {
      logVcSum += catLogVoteArr[top20CatIdx[i]];
    }
    sr.meanLogVc[u] = logVcSum / Math.min(10, top20CatIdx.length || 1);
    sr.top10Sets[u] = top20CatIdx.slice(0, 10);
    sr.top20Sets[u] = top20CatIdx;
  }
}

const baseSys = sysResults["prod_ranker"];
const task2Summary = {};

console.log("\nTABLE 2A: All 15 Systems — Overall Performance Across All 328 Users:");
console.log("-------------------------------------------------------------------------------------------------------------------------------");
console.log("System                         | NDCG@10 | Recall@20 | LT NDCG@10 | LT Rec@20 | Mean ln(VC) | Cov@10 (N / %)     | Cov@20 (%)");
console.log("-------------------------------------------------------------------------------------------------------------------------------");
for (const sys of SYSTEMS) {
  const sr = sysResults[sys.id];
  const u10 = new Set();
  const u20 = new Set();
  for (let u = 0; u < 328; u++) {
    for (const id of sr.top10Sets[u]) u10.add(id);
    for (const id of sr.top20Sets[u]) u20.add(id);
  }
  const cov10Pct = (u10.size / N_cat) * 100;
  const cov20Pct = (u20.size / N_cat) * 100;

  const mN = stats(sr.ndcg).mean;
  const mR = stats(sr.recall).mean;
  const mLN = stats(sr.ltNdcg).mean;
  const mLR = stats(sr.ltRecall).mean;
  const mLVC = stats(sr.meanLogVc).mean;

  console.log(
    `${sys.label.padEnd(30)} | ${mN.toFixed(4)}  | ${mR.toFixed(4)}    | ${mLN.toFixed(4)}     | ${mLR.toFixed(4)}    | ` +
    `${mLVC.toFixed(4).padEnd(11)} | ${String(u10.size).padStart(4)} (${cov10Pct.toFixed(2).padStart(5)}%) | ${cov20Pct.toFixed(2)}%`
  );

  task2Summary[sys.id] = {
    label: sys.label,
    means: {
      ndcg: mN,
      recall: mR,
      ltNdcg: mLN,
      ltRecall: mLR,
      meanLogVc: mLVC,
      cov10Count: u10.size,
      cov10Pct,
      cov20Count: u20.size,
      cov20Pct
    }
  };
}
console.log("-------------------------------------------------------------------------------------------------------------------------------");

console.log("\nTABLE 2B: Paired Bootstrap 95% CIs vs. Current Production Ranker (System - ProdRanker, 1,000 resamples, All 328 Users):");
console.log("Note: Positive delta means System > ProdRanker; for ablations (w/o X), negative delta means feature X HELPS Production Ranker.");
console.log("---------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
console.log("System                         | Metric        | All328 Delta [95% CI]              | Sig? | Tun (160)   | Test (168)  | Halves Status");
console.log("---------------------------------------------------------------------------------------------------------------------------------------------------------------------------");

const metricSpecs = [
  { key: "ndcg", name: "NDCG@10" },
  { key: "recall", name: "Recall@20" },
  { key: "ltNdcg", name: "LT NDCG@10" },
  { key: "ltRecall", name: "LT Recall@20" },
  { key: "meanLogVc", name: "Mean ln(VC)" }
];

for (const sys of SYSTEMS) {
  if (sys.id === "prod_ranker") continue;
  const sr = sysResults[sys.id];
  task2Summary[sys.id].vsProd = {};

  for (const m of metricSpecs) {
    const bootAll = pairedBootstrapCI(sr[m.key], baseSys[m.key], 1000, 42);
    const tunDiff = stats(sr[m.key].slice(0, 160)).mean - stats(baseSys[m.key].slice(0, 160)).mean;
    const tstDiff = stats(sr[m.key].slice(160, 328)).mean - stats(baseSys[m.key].slice(160, 328)).mean;
    const tunSign = tunDiff > 1e-12 ? "+" : tunDiff < -1e-12 ? "-" : "0";
    const tstSign = tstDiff > 1e-12 ? "+" : tstDiff < -1e-12 ? "-" : "0";
    const discordant = (tunDiff > 1e-12 && tstDiff < -1e-12) || (tunDiff < -1e-12 && tstDiff > 1e-12);
    const status = discordant ? "DISCORDANT" : tunSign === "0" && tstSign === "0" ? "EXACT TIE" : `Concordant (${tunSign}/${tstSign})`;

    task2Summary[sys.id].vsProd[m.key] = {
      ...bootAll,
      tunDiff,
      tstDiff,
      tunSign,
      tstSign,
      discordant
    };

    const ciStr = `${fmtSigned(bootAll.meanDiff)} [${fmtSigned(bootAll.ciLower)}, ${fmtSigned(bootAll.ciUpper)}]`.padEnd(34);
    const sigStr = (bootAll.isSignificant ? "YES" : "NO").padEnd(4);
    const tunStr = fmtSigned(tunDiff).padEnd(11);
    const tstStr = fmtSigned(tstDiff).padEnd(11);
    console.log(
      `${sys.label.padEnd(30)} | ${m.name.padEnd(13)} | ${ciStr} | ${sigStr} | ${tunStr} | ${tstStr} | ${status}`
    );
  }

  // Observed corpus-level Cov@10 difference (All 328, Tuning 160, Test 168 — non-additive union metric, no with-replacement bootstrap)
  const covAllC = computeCorpusCoverage(sr.top10Sets, N_cat);
  const covAllB = computeCorpusCoverage(baseSys.top10Sets, N_cat);
  const covTunC = computeCorpusCoverage(sr.top10Sets.slice(0, 160), N_cat);
  const covTunB = computeCorpusCoverage(baseSys.top10Sets.slice(0, 160), N_cat);
  const covTstC = computeCorpusCoverage(sr.top10Sets.slice(160, 328), N_cat);
  const covTstB = computeCorpusCoverage(baseSys.top10Sets.slice(160, 328), N_cat);

  const allCovDiff = covAllC.cov - covAllB.cov;
  const tunCov = covTunC.cov - covTunB.cov;
  const tstCov = covTstC.cov - covTstB.cov;
  const discCov = (tunCov > 1e-12 && tstCov < -1e-12) || (tunCov < -1e-12 && tstCov > 1e-12);
  const statusCov = discCov ? "DISCORDANT" : (Math.abs(tunCov) < 1e-12 && Math.abs(tstCov) < 1e-12 ? "EXACT TIE" : `Concordant (${tunCov > 0 ? "+" : "-"}/${tstCov > 0 ? "+" : "-"})`);
  task2Summary[sys.id].vsProd.cov10 = {
    candCov: covAllC.cov,
    baseCov: covAllB.cov,
    candCount: covAllC.count,
    baseCount: covAllB.count,
    meanDiff: allCovDiff,
    tunDiff: tunCov,
    tstDiff: tstCov,
    discordant: discCov
  };

  const covCiStr = `${fmtSigned(allCovDiff * 100, 2)}% (Corpus union)`.padEnd(34);
  console.log(
    `${sys.label.padEnd(30)} | ${"Cov@10 (pct)".padEnd(13)} | ${covCiStr} | ${"N/A ".padEnd(4)} | ${fmtSigned(tunCov * 100, 2).padEnd(10)}% | ${fmtSigned(tstCov * 100, 2).padEnd(10)}% | ${statusCov}`
  );
  console.log("---------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
}

// ==========================================================================
// TASK 3: MIXED DATED / UNDATED VAULT EXPERIMENT (20 USERS)
// ==========================================================================
console.log("\n==========================================================================");
console.log("TASK 3: MIXED 50% DATED / 50% UNDATED VAULT TEST (20 USERS, REAL Date.now())");
console.log("==========================================================================");

const sample20Indices = Array.from({ length: 20 }, (_, i) => Math.floor((i * allEligibleUsers.length) / 20));
const sample20Users = sample20Indices.map(idx => allEligibleUsers[idx]);
console.log(`Selected 20 Users: ${sample20Users.map(u => u.uid).join(", ")}`);

const shiftsT3 = [
  { label: "30 days", days: 30 },
  { label: "1 year", days: 365 },
  { label: "3 years", days: 3 * 365 }
];

const task3PerShift = Object.fromEntries(
  shiftsT3.map(s => [
    s.label,
    {
      overlap10: [],
      overlap20: [],
      spearman20: [],
      undatedAbsWeightShare: [],
      undatedPosWeightShare: [],
      datedControlHalfAbsShare: [],
      ndcgDated: [],
      ndcgMixed: [],
      recallDated: [],
      recallMixed: []
    }
  ])
);

for (let idx20 = 0; idx20 < sample20Users.length; idx20++) {
  const user = sample20Users[idx20];
  const { trainWatched, holdoutPositives, holdoutRelevance } = getUserSplit(user);
  const trainIdSet = new Set(trainWatched.map(m => Number(m.tmdbId)));
  const candidates = catalog.filter(c => !trainIdSet.has(Number(c.tmdbId)));

  // Deterministic 50% random selection of ratings to strip dates from (seed = 42 + idx20)
  let s = (42 + idx20) >>> 0;
  function rnd() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  }
  const indices = Array.from({ length: trainWatched.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const undatedCount = Math.floor(trainWatched.length / 2);
  const undatedSet = new Set(indices.slice(0, undatedCount));

  // Newest dated timestamp among the kept dated 50%
  let maxDatedTs = -Infinity;
  for (let i = 0; i < trainWatched.length; i++) {
    if (!undatedSet.has(i) && trainWatched[i].ts > maxDatedTs) {
      maxDatedTs = trainWatched[i].ts;
    }
  }

  for (const sh of shiftsT3) {
    const targetNewestMs = Date.now() - sh.days * 86400000;
    const offsetMs = targetNewestMs - maxDatedTs;

    const fullyDatedVault = trainWatched.map((m, idx) => {
      const shiftedTs = m.ts + offsetMs;
      return {
        ...m,
        ts: shiftedTs,
        dateWatched: new Date(shiftedTs).toISOString(),
        _wasUndatedGroup: undatedSet.has(idx)
      };
    });

    const mixedVault = trainWatched.map((m, idx) => {
      const isUndated = undatedSet.has(idx);
      if (isUndated) {
        const copy = { ...m, _isUndated: true };
        delete copy.dateWatched;
        delete copy.ts;
        return copy;
      }
      const shiftedTs = m.ts + offsetMs;
      return {
        ...m,
        ts: shiftedTs,
        dateWatched: new Date(shiftedTs).toISOString(),
        _isUndated: false
      };
    });

    // Run real unanchored production pipeline (now defaults to Date.now())
    const runVault = async (vault) => {
      const profile = await extractTasteProfile(vault, [], {});
      const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, cleanIndex);
      const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, cleanIndex);
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
        20,
        { metadataDampingFactor: 0.20 }
      );
      return { profile, top20Ids: ranked.map(getMovieKey) };
    };

    const resDated = await runVault(fullyDatedVault);
    const resMixed = await runVault(mixedVault);

    const top10D = new Set(resDated.top20Ids.slice(0, 10));
    const ov10 = resMixed.top20Ids.slice(0, 10).filter(id => top10D.has(id)).length;
    const top20D = new Set(resDated.top20Ids);
    const ov20 = resMixed.top20Ids.filter(id => top20D.has(id)).length;
    const sp20 = computeTieCorrectedUnionSpearman(resDated.top20Ids, resMixed.top20Ids, 20);

    let absTotM = 0, absUndM = 0, posTotM = 0, posUndM = 0;
    for (const e of resMixed.profile.weightedRatings || []) {
      const w = Number(e.weight || 0);
      absTotM += Math.abs(w);
      if (w > 0) posTotM += w;
      if (e.movie?._isUndated) {
        absUndM += Math.abs(w);
        if (w > 0) posUndM += w;
      }
    }

    let absTotD = 0, absHalfD = 0;
    for (const e of resDated.profile.weightedRatings || []) {
      const w = Number(e.weight || 0);
      absTotD += Math.abs(w);
      if (e.movie?._wasUndatedGroup) absHalfD += Math.abs(w);
    }

    const b = task3PerShift[sh.label];
    b.overlap10.push(ov10);
    b.overlap20.push(ov20);
    b.spearman20.push(sp20);
    b.undatedAbsWeightShare.push(absTotM > 0 ? absUndM / absTotM : 0);
    b.undatedPosWeightShare.push(posTotM > 0 ? posUndM / posTotM : 0);
    b.datedControlHalfAbsShare.push(absTotD > 0 ? absHalfD / absTotD : 0);
    b.ndcgDated.push(computeNDCGAtK(resDated.top20Ids, holdoutRelevance, 10));
    b.ndcgMixed.push(computeNDCGAtK(resMixed.top20Ids, holdoutRelevance, 10));
    b.recallDated.push(computeRecallAtK(resDated.top20Ids, holdoutPositives, 20));
    b.recallMixed.push(computeRecallAtK(resMixed.top20Ids, holdoutPositives, 20));
  }
}

const task3Summary = {};
console.log("\nTABLE 3A: Mixed (50% Undated / 50% Dated) vs. Fully-Dated Vault Across 20 Users:");
console.log("---------------------------------------------------------------------------------------------------------------------------------------------------");
console.log("Newest Dated Age | Top-10 Overlap  | Top-20 Overlap | Spearman@20 (Union) | Undated |w| Share | Undated +w Share | Dated NDCG -> Mixed NDCG");
console.log("---------------------------------------------------------------------------------------------------------------------------------------------------");
for (const sh of shiftsT3) {
  const b = task3PerShift[sh.label];
  const sOv10 = stats(b.overlap10);
  const sOv20 = stats(b.overlap20);
  const sSp = stats(b.spearman20);
  const sAbs = stats(b.undatedAbsWeightShare);
  const sPos = stats(b.undatedPosWeightShare);
  const sCtrl = stats(b.datedControlHalfAbsShare);
  const sND = stats(b.ndcgDated);
  const sNM = stats(b.ndcgMixed);
  const sRD = stats(b.recallDated);
  const sRM = stats(b.recallMixed);

  task3Summary[sh.label] = {
    overlap10: sOv10,
    overlap20: sOv20,
    spearman20: sSp,
    undatedAbsWeightShare: sAbs,
    undatedPosWeightShare: sPos,
    datedControlHalfAbsShare: sCtrl,
    ndcgDated: sND,
    ndcgMixed: sNM,
    recallDated: sRD,
    recallMixed: sRM
  };

  console.log(
    `${sh.label.padEnd(16)} | ${sOv10.mean.toFixed(2)} ± ${sOv10.std.toFixed(2)} /10 | ${sOv20.mean.toFixed(2).padEnd(6)} /20     | ` +
    `${sSp.mean.toFixed(4)} ± ${sSp.std.toFixed(4)}   | ${(sAbs.mean * 100).toFixed(2)}% ± ${(sAbs.std * 100).toFixed(1)}% | ` +
    `${(sPos.mean * 100).toFixed(2)}% ± ${(sPos.std * 100).toFixed(1)}%  | ${sND.mean.toFixed(4)} -> ${sNM.mean.toFixed(4)} (Rec ${sRD.mean.toFixed(4)} -> ${sRM.mean.toFixed(4)})`
  );
}
console.log("---------------------------------------------------------------------------------------------------------------------------------------------------");

// ==========================================================================
// TASK 4: LETTERBOXD CHECK
// ==========================================================================
const lbDir = path.join(root, ".data/letterboxd");
const letterboxdExists = fs.existsSync(lbDir);
console.log(`\nTASK 4: .data/letterboxd exists = ${letterboxdExists}` + (letterboxdExists ? "" : " -> Skipping Task 4."));

// Save full JSON output
const outJsonPath = path.join(root, ".data/tmdb_eval_results.json");
fs.writeFileSync(
  outJsonPath,
  JSON.stringify(
    {
      meta: {
        timestamp: new Date().toISOString(),
        embeddingsFile: ".data/item_embeddings_clean_f16.bin",
        tmdbEnrichedMode: tmdbEnriched.meta?.mode || "unknown",
        catalogSize: N_cat,
        popularTmdbVoteThreshold: popVoteThreshold,
        eligibleUsers: allEligibleUsers.length,
        tuningUsers: 160,
        testUsers: 168,
        usersWithLongTailHoldout: userProfilePop.ltHoldoutUsers
      },
      task1: {
        fieldCoverage,
        userProfilePop,
        voteScaleSummary,
        featurePopSummary
      },
      task2: task2Summary,
      task3: task3Summary,
      task4: { letterboxdExists }
    },
    null,
    2
  )
);
console.log(`\nSaved complete results to ${outJsonPath}`);
