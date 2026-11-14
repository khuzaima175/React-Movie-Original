import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "g:/Important Projects/movie-ratings";
const importSrc = rel => import(pathToFileURL(path.join(root, rel)).href);

const {
  parseEmbeddingBinary,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex
} = await importSrc("src/services/embeddingService.js");
const { computeRecallAtK, computeNDCGAtK } = await importSrc("src/services/evalHarness.js");
const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await importSrc("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await importSrc("src/services/tmdbService.js");

if (DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty !== -0.5) {
  throw new Error(`Expected updated DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty === -0.5, got ${DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty}`);
}

function meanAndStd(arr) {
  const n = arr.length;
  if (n === 0) return { mean: 0, std: 0 };
  let s = 0;
  for (let i = 0; i < n; i++) s += arr[i];
  const mean = s / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (arr[i] - mean) ** 2;
  return { mean, std: Math.sqrt(v / n) };
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
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const bootMeans = new Float64Array(numResamples);
  for (let b = 0; b < numResamples; b++) {
    let bSum = 0;
    for (let i = 0; i < n; i++) {
      bSum += diffs[Math.floor(rnd() * n)];
    }
    bootMeans[b] = bSum / n;
  }
  bootMeans.sort();
  const ciLower = bootMeans[Math.floor(0.025 * numResamples)];
  const ciUpper = bootMeans[Math.floor(0.975 * numResamples)];
  const isSignificant = (ciLower > 0 && ciUpper > 0) || (ciLower < 0 && ciUpper < 0);
  return { meanDiff, ciLower, ciUpper, isSignificant };
}

function mapMovieLensGenresToTmdb(genresStr = "") {
  if (!genresStr || genresStr === "(no genres listed)") return [];
  const normalized = genresStr
    .replace(/\|/g, ",")
    .replace(/\bchildren\b/gi, "Family")
    .replace(/\bsci-fi\b/gi, "Sci-Fi");
  return mapOmdbToTmdbGenreIds(normalized);
}

function getUserSplit(ratings) {
  const sorted = [...ratings].sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.tmdbId - b.tmdbId));
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
    const key = String(m.tmdbId);
    holdoutRelevance.set(key, m.userRating);
    if (m.userRating >= 8) holdoutPositives.add(key);
  }
  return { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs };
}

function loadEmbeddingBin(relPath) {
  const buf = fs.readFileSync(path.join(root, relPath));
  return parseEmbeddingBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function buildCatalogSubsetIndex(fullIndex, catalog) {
  const keepIds = [];
  for (const c of catalog) {
    if (fullIndex.idToIndex.has(c.tmdbId)) keepIds.push(c.tmdbId);
  }
  const dim = fullIndex.dim;
  const subCount = keepIds.length;
  const subIds = new Int32Array(subCount);
  const subVecs = new Float32Array(subCount * dim);
  const subIdToIndex = new Map();
  for (let i = 0; i < subCount; i++) {
    const tid = keepIds[i];
    const srcIdx = fullIndex.idToIndex.get(tid);
    subIds[i] = tid;
    subVecs.set(fullIndex.vectors.subarray(srcIdx * dim, (srcIdx + 1) * dim), i * dim);
    subIdToIndex.set(tid, i);
  }
  return { version: fullIndex.version, count: subCount, dim, ids: subIds, vectors: subVecs, idToIndex: subIdToIndex };
}

function buildCatalog() {
  const tmdbEnriched = JSON.parse(fs.readFileSync(path.join(root, ".data/tmdb_enriched.json"), "utf8"));
  const tmdbItems = tmdbEnriched.items || {};
  const linksLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/links.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1);
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
  const moviesLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/movies.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1);
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
  const catalog = [];
  const catalogByTmdb = new Map();
  for (const [tid, mids] of tmdbIdToMovieIds.entries()) {
    const meta = movieMeta.get(mids[0]) || { title: "Unknown", genres: "", mlYear: "N/A" };
    const e = tmdbItems[tid] || null;
    const fallbackGenres = mapMovieLensGenresToTmdb(meta.genres);
    const genreIds = e ? (e.tmdbGenreIds || []) : fallbackGenres;
    const obj = {
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
      streamProviders: e?.streamProviders || []
    };
    catalog.push(obj);
    catalogByTmdb.set(tid, obj);
  }
  const sortedByVotes = [...catalog].sort((a, b) => {
    if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count;
    return (b.vote_average ?? 0) - (a.vote_average ?? 0) || a.tmdbId - b.tmdbId;
  });
  const top20Cut = Math.floor(0.20 * sortedByVotes.length);
  const popularTmdbIds = new Set(sortedByVotes.slice(0, top20Cut).map(c => c.tmdbId));
  return { catalog, catalogByTmdb, movieIdToTmdbId, popularTmdbIds };
}

function loadOrig328Users(catalogByTmdb, movieIdToTmdbId) {
  const ratingsLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/ratings.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1);
  const ratingsByUser = new Map();
  for (const l of ratingsLines) {
    const [uid, mid, rStr, tsStr] = l.trim().split(",");
    const tid = movieIdToTmdbId.get(mid);
    if (!tid) continue;
    const cat = catalogByTmdb.get(tid);
    if (!cat) continue;
    if (!ratingsByUser.has(uid)) ratingsByUser.set(uid, []);
    ratingsByUser.get(uid).push({
      ...cat,
      movieId: mid,
      userRating: Number(rStr) * 2,
      dateWatched: new Date(Number(tsStr) * 1000).toISOString(),
      ts: Number(tsStr) * 1000
    });
  }
  const benchmarkUserIds = new Set(["89", "263", "409", "561"]);
  const users = [];
  for (const [uid, ratings] of ratingsByUser.entries()) {
    if (benchmarkUserIds.has(uid)) continue;
    if (ratings.length < 60) continue;
    ratings.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.tmdbId - b.tmdbId));
    const pos = ratings.filter(r => r.userRating >= 8);
    if (pos.length >= 15) users.push({ uid, ratings });
  }
  users.sort((a, b) => Number(a.uid) - Number(b.uid));
  return users;
}

function loadFresh300Users(catalogByTmdb) {
  const payload = JSON.parse(fs.readFileSync(path.join(root, ".data/fresh_300_users.json"), "utf8"));
  return payload.users.map(u => ({
    uid: u.uid,
    ratings: u.ratings.map(r => {
      const cat = catalogByTmdb.get(r.tmdbId);
      return {
        ...cat,
        movieId: r.movieId,
        userRating: r.userRating,
        dateWatched: new Date(r.ts).toISOString(),
        ts: r.ts
      };
    })
  }));
}

async function runRealPathEval(users, embSubset, catalog, popularTmdbIds, label) {
  const nUsers = users.length;
  const oldWeights = { ...DEFAULT_RANKER_WEIGHTS, negativeKeywordPenalty: -2.0 };
  const metricKeys = ["ndcg", "recall", "ltNdcg", "ltRecall", "meanLogVc"];
  const res = { a: {}, e: {} };
  for (const v of ["a", "e"]) {
    for (const m of metricKeys) res[v][m] = new Float64Array(nUsers);
  }

  for (let u = 0; u < nUsers; u++) {
    const user = users[u];
    const { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs } = getUserSplit(user.ratings);
    const trainIdSet = new Set(trainWatched.map(m => Number(m.tmdbId)));

    const profile = await extractTasteProfile(trainWatched, [], {
      now: holdoutStartTs,
      anchorCutoff: Infinity
    });
    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, embSubset);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embSubset);

    const ltHoldoutPositives = new Set();
    const ltHoldoutRelevance = new Map();
    for (const [tidStr, rel] of holdoutRelevance.entries()) {
      if (!popularTmdbIds.has(Number(tidStr))) {
        ltHoldoutRelevance.set(tidStr, rel);
        if (holdoutPositives.has(tidStr)) ltHoldoutPositives.add(tidStr);
      }
    }

    const candidates = catalog.filter(c => !trainIdSet.has(c.tmdbId));
    const context = {
      profile,
      collabSimMap,
      contentSimMap: new Map(),
      repulsionMap,
      anchorKeywords: profile.lovedKeywordIds || [],
      userProviders: []
    };

    // Variant (a): explicit old weight -2.0; Variant (e): updated src/ DEFAULT_RANKER_WEIGHTS (-0.5)
    const rankedA = rankCandidatePool(candidates, context, oldWeights, 20, { metadataDampingFactor: 0.20 });
    const rankedE = rankCandidatePool(candidates, context, undefined, 20, { metadataDampingFactor: 0.20 });

    for (const [key, ranked] of [["a", rankedA], ["e", rankedE]]) {
      const top20Ids = ranked.map(m => String(m.tmdbId));
      res[key].ndcg[u] = computeNDCGAtK(top20Ids, holdoutRelevance, 10);
      res[key].recall[u] = computeRecallAtK(top20Ids, holdoutPositives, 20);
      res[key].ltNdcg[u] = computeNDCGAtK(top20Ids, ltHoldoutRelevance, 10);
      res[key].ltRecall[u] = computeRecallAtK(top20Ids, ltHoldoutPositives, 20);
      let vcSum = 0;
      for (let i = 0; i < 10 && i < ranked.length; i++) {
        vcSum += Math.log(Math.max(1, ranked[i].vote_count));
      }
      res[key].meanLogVc[u] = vcSum / Math.min(10, ranked.length || 1);
    }

    if ((u + 1) % 100 === 0) {
      console.log(`[${label}] processed ${u + 1}/${nUsers} users via real rankCandidatePool`);
    }
  }

  const means = { a: {}, e: {} };
  const vsA = {};
  for (const m of metricKeys) {
    means.a[m] = meanAndStd(res.a[m]).mean;
    means.e[m] = meanAndStd(res.e[m]).mean;
    vsA[m] = pairedBootstrapCI(res.e[m], res.a[m], 1000, 42);
  }
  return { nUsers, means, vsA };
}

async function main() {
  const t0 = Date.now();
  const { catalog, catalogByTmdb, movieIdToTmdbId, popularTmdbIds } = buildCatalog();
  const origUsers = loadOrig328Users(catalogByTmdb, movieIdToTmdbId);
  const freshUsers = loadFresh300Users(catalogByTmdb);

  const clean1Sub = buildCatalogSubsetIndex(loadEmbeddingBin(".data/item_embeddings_clean_f16.bin"), catalog);
  const clean2Sub = buildCatalogSubsetIndex(loadEmbeddingBin(".data/item_embeddings_clean2_f16.bin"), catalog);

  console.log(`Updated DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty = ${DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty}`);
  const origReal = await runRealPathEval(origUsers, clean1Sub, catalog, popularTmdbIds, "Orig 328");
  const freshReal = await runRealPathEval(freshUsers, clean2Sub, catalog, popularTmdbIds, "Fresh 300");

  const prior = JSON.parse(fs.readFileSync(path.join(root, ".data/task2_keyword_results.json"), "utf8"));
  const metricKeys = ["ndcg", "recall", "ltNdcg", "ltRecall", "meanLogVc"];

  function compareAgainstPrior(realOut, priorBlock, blockName) {
    let maxDiff = 0;
    console.log(`\n${blockName} (real src/ rankCandidatePool path, a=-2.0 vs e=-0.5):`);
    for (const v of ["a", "e"]) {
      const m = realOut.means[v];
      console.log(
        `  (${v}) NDCG@10=${m.ndcg.toFixed(4)} | Recall@20=${m.recall.toFixed(4)} | ` +
        `LT NDCG@10=${m.ltNdcg.toFixed(4)} | LT Rec@20=${m.ltRecall.toFixed(4)} | Mean ln(VC)=${m.meanLogVc.toFixed(4)}`
      );
      for (const k of metricKeys) {
        maxDiff = Math.max(maxDiff, Math.abs(m[k] - priorBlock.means[v][k]));
      }
    }
    console.log(`  Paired CIs (e vs a):`);
    for (const k of metricKeys) {
      const ci = realOut.vsA[k];
      maxDiff = Math.max(maxDiff, Math.abs(ci.meanDiff - priorBlock.vsA.e[k].meanDiff));
      console.log(
        `    ${k.padEnd(10)}: ${ci.meanDiff >= 0 ? "+" : ""}${ci.meanDiff.toFixed(4)} ` +
        `[${ci.ciLower >= 0 ? "+" : ""}${ci.ciLower.toFixed(4)}, ${ci.ciUpper >= 0 ? "+" : ""}${ci.ciUpper.toFixed(4)}] ` +
        `Sig: ${ci.isSignificant ? "YES" : "no"}`
      );
    }
    console.log(`  Max absolute mean diff vs earlier task2_keyword_results.json = ${maxDiff.toExponential(3)}`);
    return maxDiff;
  }

  const maxDiffOrig = compareAgainstPrior(origReal, prior.orig328Summary, "ORIG 328 (clean1)");
  const maxDiffFresh = compareAgainstPrior(freshReal, prior.fresh300Summary, "FRESH 300 (clean2)");

  const outPayload = {
    verifiedAt: new Date().toISOString(),
    defaultNegativeKeywordPenalty: DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty,
    orig328: origReal,
    fresh300: freshReal,
    maxAbsDiffVsPriorReport: { orig328: maxDiffOrig, fresh300: maxDiffFresh }
  };
  fs.writeFileSync(path.join(root, ".data/phaseA_real_ranker_verify.json"), JSON.stringify(outPayload, null, 2));
  console.log(`\nSaved .data/phaseA_real_ranker_verify.json in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
