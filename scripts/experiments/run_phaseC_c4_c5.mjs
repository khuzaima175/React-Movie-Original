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
const { computeNDCGAtK } = await importSrc("src/services/evalHarness.js");
const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await importSrc("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await importSrc("src/services/tmdbService.js");
const { computeBayesianScore } = await importSrc("src/services/scoringUtils.js");
const { parseCSVImport } = await importSrc("src/services/csvImport.js");

if (DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty !== -0.5) {
  throw new Error(`Expected DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty === -0.5, got ${DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty}`);
}

const FIXED_NOW_MS = Date.parse("2026-11-13T00:00:00.000Z");

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function meanAndMedian(arr) {
  if (!arr || arr.length === 0) return { mean: 0, median: 0 };
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { mean: sum / arr.length, median };
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
  const rnd = makeRng(seed);
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

function buildMaskedIndex(baseIndex, maskedTmdbSet) {
  const { count, dim, ids, vectors } = baseIndex;
  const keepIndices = [];
  for (let i = 0; i < count; i++) {
    if (!maskedTmdbSet.has(ids[i])) keepIndices.push(i);
  }
  const newCount = keepIndices.length;
  const maskedIds = new Int32Array(newCount);
  const maskedVecs = new Float32Array(newCount * dim);
  const maskedIdToIndex = new Map();
  for (let j = 0; j < newCount; j++) {
    const srcIdx = keepIndices[j];
    const tid = ids[srcIdx];
    maskedIds[j] = tid;
    maskedVecs.set(vectors.subarray(srcIdx * dim, (srcIdx + 1) * dim), j * dim);
    maskedIdToIndex.set(tid, j);
  }
  return { version: baseIndex.version, count: newCount, dim, ids: maskedIds, vectors: maskedVecs, idToIndex: maskedIdToIndex };
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
    const rawTitle = l.slice(commaIdx + 1, lastComma).trim().replace(/^"|"$/g, "");
    const yearMatch = rawTitle.match(/\((\d{4})\)\s*$/);
    const cleanTitle = yearMatch ? rawTitle.slice(0, yearMatch.index).trim() : rawTitle;
    movieMeta.set(mid, { title: rawTitle, cleanTitle, genres, mlYear: yearMatch ? yearMatch[1] : "" });
  }
  const catalog = [];
  const catalogByTmdb = new Map();
  for (const [tid, mids] of tmdbIdToMovieIds.entries()) {
    const meta = movieMeta.get(mids[0]) || { title: "Unknown", cleanTitle: "Unknown", genres: "", mlYear: "" };
    const e = tmdbItems[tid] || null;
    const fallbackGenres = mapMovieLensGenresToTmdb(meta.genres);
    const genreIds = e ? (e.tmdbGenreIds || []) : fallbackGenres;
    const obj = {
      id: tid,
      tmdbId: tid,
      title: e?.title || meta.cleanTitle || meta.title,
      mlTitle: meta.cleanTitle || meta.title,
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
  return { catalog, catalogByTmdb, movieIdToTmdbId };
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
      rawMlRating: Number(rStr),
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

  const holdoutAllSet = new Set();
  for (const m of holdoutSlice) holdoutAllSet.add(Number(m.tmdbId));
  return { trainWatched, holdoutSlice, holdoutAllSet, holdoutStartTs };
}

function computeRocAuc(scores, isPos) {
  const n = scores.length;
  let posCount = 0;
  for (let i = 0; i < n; i++) if (isPos[i] === 1) posCount++;
  const negCount = n - posCount;
  if (posCount === 0 || negCount === 0) return null;

  let wins = 0;
  let ties = 0;
  for (let i = 0; i < n; i++) {
    if (isPos[i] !== 1) continue;
    const si = scores[i];
    for (let j = 0; j < n; j++) {
      if (isPos[j] !== 0) continue;
      if (si > scores[j]) wins++;
      else if (si === scores[j]) ties++;
    }
  }
  return (wins + 0.5 * ties) / (posCount * negCount);
}

// ============================================================================
// PHASE C4: FAIR COLD-START RERUN (POPULARITY-MATCHED DECILE NEGATIVES)
// ============================================================================
async function runC4(users, catalog, embSub) {
  console.log("==========================================================================");
  console.log("PHASE C4: POPULARITY-MATCHED COLD-START RERUN (328 USERS x 3 SEEDS)");
  console.log("==========================================================================");

  const N_cat = catalog.length;
  const maskCount = Math.round(0.30 * N_cat);
  const SEEDS = [42, 43, 44];
  const NUM_PERMS = 100;
  const nUsers = users.length;

  // Assign catalog-wide TMDB vote_count deciles (0..9) deterministically
  const sortedByVc = [...catalog].sort((a, b) =>
    a.vote_count !== b.vote_count ? a.vote_count - b.vote_count : a.tmdbId - b.tmdbId
  );
  const tmdbToDecile = new Map();
  const decileRanges = Array.from({ length: 10 }, () => ({ min: Infinity, max: -Infinity, count: 0 }));
  for (let r = 0; r < N_cat; r++) {
    const decile = Math.min(9, Math.floor((r * 10) / N_cat));
    const item = sortedByVc[r];
    tmdbToDecile.set(item.tmdbId, decile);
    const dr = decileRanges[decile];
    dr.count++;
    if (item.vote_count < dr.min) dr.min = item.vote_count;
    if (item.vote_count > dr.max) dr.max = item.vote_count;
  }

  const preUsers = [];
  for (const u of users) {
    const split = getUserSplit(u.ratings);
    const allRatedIdSet = new Set(u.ratings.map(m => Number(m.tmdbId)));
    const profile = await extractTasteProfile(split.trainWatched, [], {
      now: split.holdoutStartTs,
      anchorCutoff: Infinity
    });
    preUsers.push({ uid: u.uid, ...split, allRatedIdSet, profile });
  }

  const SYSTEMS = ["prodMeta", "personalMetaDiag", "voteCountPop", "bayesianPop", "random100"];
  const userStore = {};
  for (const s of SYSTEMS) {
    userStore[s] = {
      ndcgSum: new Float64Array(nUsers),
      aucSum: new Float64Array(nUsers)
    };
  }
  const validSeedCount = new Int32Array(nUsers);
  const personalOnlyWeights = { ...DEFAULT_RANKER_WEIGHTS, bayesianRatingNorm: 0, noveltyBonus: 0 };

  let totalPairs = 0;
  let validPairs = 0;
  let skippedZeroMaskPairs = 0;
  let totalHoldPos = 0;
  let totalNegDrawn = 0;
  let nearestDecileFallbackDraws = 0;
  const posVoteCounts = [];
  const negVoteCounts = [];

  for (const seed of SEEDS) {
    const maskRng = makeRng(seed * 99991 + 7);
    const catPos = Array.from({ length: N_cat }, (_, i) => i);
    for (let i = N_cat - 1; i > 0; i--) {
      const j = Math.floor(maskRng() * (i + 1));
      const tmp = catPos[i];
      catPos[i] = catPos[j];
      catPos[j] = tmp;
    }
    const maskedSet = new Set(catPos.slice(0, maskCount).map(idx => catalog[idx].tmdbId));
    const maskedEmb = buildMaskedIndex(embSub, maskedSet);

    // Pre-group masked catalog items by decile for fast lookup
    const maskedByDecile = Array.from({ length: 10 }, () => []);
    for (let i = 0; i < N_cat; i++) {
      const c = catalog[i];
      if (maskedSet.has(c.tmdbId)) {
        maskedByDecile[tmdbToDecile.get(c.tmdbId)].push(c);
      }
    }

    let seedValid = 0;
    let seedSkipped = 0;

    for (let u = 0; u < nUsers; u++) {
      const pu = preUsers[u];
      totalPairs++;

      const maskedHoldPosMovies = [];
      for (const m of pu.holdoutSlice) {
        if (m.userRating >= 8 && maskedSet.has(Number(m.tmdbId))) {
          maskedHoldPosMovies.push(m);
        }
      }
      if (maskedHoldPosMovies.length === 0) {
        skippedZeroMaskPairs++;
        seedSkipped++;
        continue;
      }

      const collabSimMap = buildCollabSimMapFromIndex(pu.profile.weightedRatings, maskedEmb);
      const repulsionMap = buildRepulsionMapFromIndex(pu.profile.weightedRatings, maskedEmb);
      const pairRng = makeRng(seed * 100003 + Number(pu.uid));

      // Draw 4 unseen masked negatives per positive from the same vote_count decile (fallback to nearest decile if exhausted)
      const chosenNegIds = new Set();
      const selectedNeg = [];
      const availableCache = new Array(10).fill(null);

      const getDecileAvailable = d => {
        if (availableCache[d] !== null) return availableCache[d];
        const list = maskedByDecile[d].filter(
          c => !pu.allRatedIdSet.has(c.tmdbId) && !chosenNegIds.has(c.tmdbId)
        );
        // Shuffle once per (user, seed, decile) for unbiased O(1) pops
        for (let k = list.length - 1; k > 0; k--) {
          const j = Math.floor(pairRng() * (k + 1));
          const tmp = list[k];
          list[k] = list[j];
          list[j] = tmp;
        }
        availableCache[d] = list;
        return list;
      };

      for (const pos of maskedHoldPosMovies) {
        posVoteCounts.push(pos.vote_count || 0);
        const targetD = tmdbToDecile.get(Number(pos.tmdbId));
        let need = 4;

        // Distance 0 (same decile), then delta = 1..9 outward
        for (let delta = 0; delta <= 9 && need > 0; delta++) {
          const candDeciles = delta === 0
            ? [targetD]
            : [targetD - delta, targetD + delta].filter(d => d >= 0 && d <= 9);
          for (const d of candDeciles) {
            if (need <= 0) break;
            const avail = getDecileAvailable(d);
            while (avail.length > 0 && need > 0) {
              const neg = avail.pop();
              if (chosenNegIds.has(neg.tmdbId)) continue;
              chosenNegIds.add(neg.tmdbId);
              selectedNeg.push(neg);
              negVoteCounts.push(neg.vote_count || 0);
              if (delta > 0) nearestDecileFallbackDraws++;
              totalNegDrawn++;
              need--;
            }
          }
        }
        if (need > 0) {
          throw new Error(`Could not find 4 unseen masked negatives for uid=${pu.uid} seed=${seed}`);
        }
      }

      const pool = [...maskedHoldPosMovies, ...selectedNeg];
      const poolLen = pool.length;
      const isPos = new Uint8Array(poolLen);
      for (let i = 0; i < maskedHoldPosMovies.length; i++) isPos[i] = 1;

      const maskedHoldRelMap = new Map(
        maskedHoldPosMovies.map(m => [String(m.tmdbId), m.userRating])
      );

      const context = {
        profile: pu.profile,
        collabSimMap,
        contentSimMap: new Map(),
        repulsionMap,
        anchorKeywords: pu.profile.lovedKeywordIds || [],
        userProviders: []
      };

      // 1. Production metadata ranker (weight negKw = -0.5, collabSim = 0 for all masked items)
      const rankedProd = rankCandidatePool(pool, context, DEFAULT_RANKER_WEIGHTS, poolLen, { metadataDampingFactor: 0.20 });
      const scoreMapProd = new Map(rankedProd.map(m => [m.tmdbId, m.rankerProbability]));
      const prodScores = pool.map(m => scoreMapProd.get(m.tmdbId));
      const prodIds = rankedProd.map(m => String(m.tmdbId));

      // 1b. Diagnostic: Personal metadata only (zero bayesianRatingNorm and noveltyBonus)
      const rankedPers = rankCandidatePool(pool, context, personalOnlyWeights, poolLen, { metadataDampingFactor: 0.20 });
      const scoreMapPers = new Map(rankedPers.map(m => [m.tmdbId, m.rankerProbability]));
      const persScores = pool.map(m => scoreMapPers.get(m.tmdbId));
      const persIds = rankedPers.map(m => String(m.tmdbId));

      // 2. Popularity by TMDB vote_count
      const vcScores = pool.map(m => Number(m.vote_count || 0));
      const vcIds = pool
        .map((m, idx) => ({ tid: String(m.tmdbId), s: vcScores[idx] }))
        .sort((a, b) => (b.s !== a.s ? b.s - a.s : Number(a.tid) - Number(b.tid)))
        .map(x => x.tid);

      // 3. Popularity by Bayesian rating
      const bayesScores = pool.map(m => computeBayesianScore(m.vote_average, m.vote_count, 500, 7.0));
      const bayesIds = pool
        .map((m, idx) => ({ tid: String(m.tmdbId), s: bayesScores[idx] }))
        .sort((a, b) => (b.s !== a.s ? b.s - a.s : Number(a.tid) - Number(b.tid)))
        .map(x => x.tid);

      userStore.prodMeta.ndcgSum[u] += computeNDCGAtK(prodIds, maskedHoldRelMap, 10);
      userStore.prodMeta.aucSum[u] += computeRocAuc(prodScores, isPos);

      userStore.personalMetaDiag.ndcgSum[u] += computeNDCGAtK(persIds, maskedHoldRelMap, 10);
      userStore.personalMetaDiag.aucSum[u] += computeRocAuc(persScores, isPos);

      userStore.voteCountPop.ndcgSum[u] += computeNDCGAtK(vcIds, maskedHoldRelMap, 10);
      userStore.voteCountPop.aucSum[u] += computeRocAuc(vcScores, isPos);

      userStore.bayesianPop.ndcgSum[u] += computeNDCGAtK(bayesIds, maskedHoldRelMap, 10);
      userStore.bayesianPop.aucSum[u] += computeRocAuc(bayesScores, isPos);

      // 4. Random (average of 100 permutations)
      let randNdcgSum = 0;
      let randAucSum = 0;
      const permScores = new Float64Array(poolLen);
      for (let p = 0; p < NUM_PERMS; p++) {
        for (let idx = 0; idx < poolLen; idx++) permScores[idx] = pairRng();
        const order = Array.from({ length: poolLen }, (_, idx) => idx)
          .sort((a, b) => permScores[b] - permScores[a]);
        const rIds = order.map(idx => String(pool[idx].tmdbId));
        randNdcgSum += computeNDCGAtK(rIds, maskedHoldRelMap, 10);
        randAucSum += computeRocAuc(permScores, isPos);
      }
      userStore.random100.ndcgSum[u] += randNdcgSum / NUM_PERMS;
      userStore.random100.aucSum[u] += randAucSum / NUM_PERMS;

      validSeedCount[u]++;
      totalHoldPos += maskedHoldPosMovies.length;
      validPairs++;
      seedValid++;
    }
    console.log(`Seed ${seed}: valid pairs=${seedValid}, skipped (0 masked pos)=${seedSkipped}`);
  }

  const validUsers = [];
  for (let u = 0; u < nUsers; u++) {
    if (validSeedCount[u] > 0) validUsers.push(u);
  }
  const nValidUsers = validUsers.length;

  const perUser = {};
  const means = {};
  for (const s of SYSTEMS) {
    const ndcgArr = Float64Array.from(validUsers, u => userStore[s].ndcgSum[u] / validSeedCount[u]);
    const aucArr = Float64Array.from(validUsers, u => userStore[s].aucSum[u] / validSeedCount[u]);
    perUser[s] = { ndcg: ndcgArr, auc: aucArr };
    means[s] = { ndcg10: meanAndMedian(ndcgArr).mean, rocAuc: meanAndMedian(aucArr).mean };
  }

  const comparisons = [
    ["prodMeta", "voteCountPop"],
    ["prodMeta", "bayesianPop"],
    ["prodMeta", "random100"],
    ["personalMetaDiag", "voteCountPop"],
    ["personalMetaDiag", "bayesianPop"],
    ["personalMetaDiag", "random100"],
    ["bayesianPop", "voteCountPop"],
    ["bayesianPop", "random100"],
    ["voteCountPop", "random100"]
  ];
  const cis = {};
  for (const [cand, base] of comparisons) {
    cis[`${cand}_vs_${base}`] = {
      ndcg10: pairedBootstrapCI(perUser[cand].ndcg, perUser[base].ndcg, 1000, 42),
      rocAuc: pairedBootstrapCI(perUser[cand].auc, perUser[base].auc, 1000, 42)
    };
  }

  const posVcStats = meanAndMedian(posVoteCounts);
  const negVcStats = meanAndMedian(negVoteCounts);

  console.log(`\nValid pairs: ${validPairs}/${totalPairs} (skipped ${skippedZeroMaskPairs}), valid users: ${nValidUsers}/${nUsers}`);
  console.log(`Mean masked holdout positives/pair: ${(totalHoldPos / validPairs).toFixed(3)}; negatives drawn: ${totalNegDrawn} (nearest-decile fallback draws: ${nearestDecileFallbackDraws})`);
  console.log(`Vote-count balance: positives mean=${posVcStats.mean.toFixed(1)}, median=${posVcStats.median.toFixed(1)} | matched negatives mean=${negVcStats.mean.toFixed(1)}, median=${negVcStats.median.toFixed(1)}`);

  const LABELS = {
    prodMeta: "Prod Metadata Ranker (-0.5)",
    personalMetaDiag: "[Diag] Personal Meta Only",
    voteCountPop: "Popularity (TMDB vote_count)",
    bayesianPop: "Popularity (Bayesian Rating)",
    random100: "Random (100 perms/pair)"
  };
  console.log("\nC4 — FAIR COLD-START (1:4 vote_count decile-matched):");
  console.log("System                         | NDCG@10 | ROC-AUC");
  console.log("--------------------------------------------------");
  for (const s of SYSTEMS) {
    console.log(`${LABELS[s].padEnd(30)} | ${means[s].ndcg10.toFixed(4)}  | ${means[s].rocAuc.toFixed(4)}`);
  }

  const fmtC = x => `${x >= 0 ? "+" : ""}${x.toFixed(4)}`;
  console.log(`\nPAIRED BOOTSTRAP 95% CIs (1,000 resamples over N=${nValidUsers} users, seed=42):`);
  for (const [k, obj] of Object.entries(cis)) {
    console.log(
      `  ${k.padEnd(32)} | NDCG@10: ${fmtC(obj.ndcg10.meanDiff)} [${fmtC(obj.ndcg10.ciLower)}, ${fmtC(obj.ndcg10.ciUpper)}] (${obj.ndcg10.isSignificant ? "YES" : "no "}) | ` +
      `ROC-AUC: ${fmtC(obj.rocAuc.meanDiff)} [${fmtC(obj.rocAuc.ciLower)}, ${fmtC(obj.rocAuc.ciUpper)}] (${obj.rocAuc.isSignificant ? "YES" : "no "})`
    );
  }

  return {
    meta: {
      totalPairs,
      validPairs,
      skippedZeroMaskPairs,
      nValidUsers,
      nTotalUsers: nUsers,
      numPermsForRandom: NUM_PERMS,
      meanMaskedHoldPosPerValidPair: totalHoldPos / validPairs,
      totalNegDrawn,
      nearestDecileFallbackDraws,
      posVoteCountMean: posVcStats.mean,
      posVoteCountMedian: posVcStats.median,
      negVoteCountMean: negVcStats.mean,
      negVoteCountMedian: negVcStats.median,
      decileRanges
    },
    means,
    cis
  };
}

// ============================================================================
// PHASE C5: IMPORT SMOKE TEST + BACKLOG CLUSTERING RISK
// ============================================================================
function csvEscape(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtYmdUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function runC5(users) {
  console.log("\n==========================================================================");
  console.log("PHASE C5: IMPORT SMOKE TEST (3 MOVIELENS USERS) + BACKLOG CLUSTERING RISK");
  console.log("==========================================================================");

  // Pick 3 MovieLens users cleanly
  const smokeUsers = [users[0], users[1], users[2]];

  const ratingsRows = ["Date,Name,Year,Letterboxd URI,Rating"];
  const diaryRows = ["Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date"];

  for (const u of smokeUsers) {
    for (let idx = 0; idx < u.ratings.length; idx++) {
      const m = u.ratings[idx];
      const title = m.mlTitle || m.title;
      const year = m.year === "N/A" ? "" : m.year;
      const uri = `https://boxd.it/ml${m.tmdbId}`;
      const lbRating = Number.isFinite(m.rawMlRating) ? m.rawMlRating : m.userRating / 2;
      const watchedYmd = fmtYmdUtc(m.ts);
      // In synthetic diary, log date = watched date (or +2d for realism on alternating rows)
      const loggedYmd = fmtYmdUtc(m.ts + (idx % 3) * 86400000);
      const rewatch = idx % 7 === 0 ? "Yes" : "";
      const tags = idx % 5 === 0 ? "favorite" : "";

      ratingsRows.push([
        loggedYmd,
        csvEscape(title),
        csvEscape(year),
        uri,
        lbRating
      ].join(","));

      diaryRows.push([
        loggedYmd,
        csvEscape(title),
        csvEscape(year),
        uri,
        lbRating,
        rewatch,
        tags,
        watchedYmd
      ].join(","));
    }
  }

  const ratingsCsv = ratingsRows.join("\n");
  const diaryCsv = diaryRows.join("\n");

  const parsedRatings = parseCSVImport(ratingsCsv, { now: FIXED_NOW_MS });
  const parsedDiary = parseCSVImport(diaryCsv, { now: FIXED_NOW_MS });

  const formatSampleRow = r => ({
    title: r.title,
    year: r.year,
    rating: r.rating,
    note: r.note,
    dateWatched: r.dateWatched,
    dateSource: r.dateSource
  });

  const ratingsSample5 = parsedRatings.rows.slice(0, 5).map(formatSampleRow);
  const diarySample5 = parsedDiary.rows.slice(0, 5).map(formatSampleRow);

  console.log(`Selected 3 MovieLens users: uids=[${smokeUsers.map(u => u.uid).join(", ")}], rating counts=[${smokeUsers.map(u => u.ratings.length).join(", ")}]`);
  console.log(`ratings.csv: inputDataRows=${ratingsRows.length - 1}, parsed=${parsedRatings.rows.length}, dropped=${parsedRatings.droppedRows.length}`);
  console.log("  5 sample rows (ratings.csv):", JSON.stringify(ratingsSample5, null, 2));
  console.log(`diary.csv  : inputDataRows=${diaryRows.length - 1}, parsed=${parsedDiary.rows.length}, dropped=${parsedDiary.droppedRows.length}`);
  console.log("  5 sample rows (diary.csv):", JSON.stringify(diarySample5, null, 2));

  // Synthetic clustered backlog ratings.csv:
  // Pick a user with >= 100 ratings (100 rows total):
  // 80% (80 rows) share 3 recent onboarding backlog "Date" values (Oct 20-22, 2026),
  // 20% (20 rows) logged over the subsequent 3 weeks (Oct 23 .. Nov 12, 2026, newest = 2026-11-12).
  const clusterUser = users.find(u => u.ratings.length >= 100) || users[0];
  const clusterSource = clusterUser.ratings.slice(0, 100);
  const totalClusterRows = clusterSource.length;
  const backlogCount = Math.floor(0.80 * totalClusterRows);
  const backlogDates = ["2026-10-20", "2026-10-21", "2026-10-22"];
  const remainingCount = totalClusterRows - backlogCount;

  const clusterCsvRows = ["Date,Name,Year,Letterboxd URI,Rating"];
  for (let i = 0; i < totalClusterRows; i++) {
    const m = clusterSource[i];
    const title = m.mlTitle || m.title;
    const year = m.year === "N/A" ? "" : m.year;
    const uri = `https://boxd.it/ml${m.tmdbId}`;
    const lbRating = Number.isFinite(m.rawMlRating) ? m.rawMlRating : m.userRating / 2;

    let rowDate;
    if (i < backlogCount) {
      rowDate = backlogDates[i % backlogDates.length];
    } else {
      // Spread remaining 20% over Oct 23 .. Nov 12, 2026 (newest = 2026-11-12)
      const relIdx = i - backlogCount;
      const dayOffset = remainingCount > 1 ? Math.round((relIdx / (remainingCount - 1)) * 20) : 20;
      rowDate = fmtYmdUtc(Date.parse("2026-10-23T00:00:00Z") + dayOffset * 86400000);
    }

    clusterCsvRows.push([rowDate, csvEscape(title), csvEscape(year), uri, lbRating].join(","));
  }

  const parsedCluster = parseCSVImport(clusterCsvRows.join("\n"), { now: FIXED_NOW_MS });
  let maxDateMs = -Infinity;
  for (const r of parsedCluster.rows) {
    if (r.dateWatched) {
      const ms = Date.parse(r.dateWatched);
      if (ms > maxDateMs) maxDateMs = ms;
    }
  }
  const cutoff30dMs = maxDateMs - 30 * 86400000;
  let within30DaysCount = 0;
  let dateCounts = new Map();
  for (const r of parsedCluster.rows) {
    if (!r.dateWatched) continue;
    const ms = Date.parse(r.dateWatched);
    if (ms >= cutoff30dMs) within30DaysCount++;
    const ymd = r.dateWatched.slice(0, 10);
    dateCounts.set(ymd, (dateCounts.get(ymd) || 0) + 1);
  }

  const topClusterDates = [...dateCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([date, count]) => ({ date, count }));

  console.log(`\nClustered ratings.csv smoke test (N=${parsedCluster.rows.length}, dropped=${parsedCluster.droppedRows.length}):`);
  console.log(`  Backlog rows assigned to ${backlogDates.join(", ")}: ${backlogCount}/${totalClusterRows} (${((backlogCount / totalClusterRows) * 100).toFixed(1)}%)`);
  console.log(`  Newest dateWatched: ${new Date(maxDateMs).toISOString()} (30d cutoff: ${new Date(cutoff30dMs).toISOString()})`);
  console.log(`  Films with dateWatched within 30 days of newest date: ${within30DaysCount}/${parsedCluster.rows.length} (${((within30DaysCount / parsedCluster.rows.length) * 100).toFixed(1)}%)`);
  console.log(`  Top clustered dates:`, JSON.stringify(topClusterDates));

  return {
    smokeUsers: smokeUsers.map(u => ({ uid: u.uid, totalRatings: u.ratings.length })),
    parseNowIso: new Date(FIXED_NOW_MS).toISOString(),
    ratingsCsv: {
      inputDataRows: ratingsRows.length - 1,
      parsedCount: parsedRatings.rows.length,
      droppedCount: parsedRatings.droppedRows.length,
      droppedRows: parsedRatings.droppedRows,
      sample5: ratingsSample5
    },
    diaryCsv: {
      inputDataRows: diaryRows.length - 1,
      parsedCount: parsedDiary.rows.length,
      droppedCount: parsedDiary.droppedRows.length,
      droppedRows: parsedDiary.droppedRows,
      sample5: diarySample5
    },
    clusteringSmokeTest: {
      uid: clusterUser.uid,
      totalRows: parsedCluster.rows.length,
      droppedCount: parsedCluster.droppedRows.length,
      backlogDates,
      backlogRowCount: backlogCount,
      newestDateWatched: new Date(maxDateMs).toISOString(),
      cutoff30dIso: new Date(cutoff30dMs).toISOString(),
      within30DaysOfNewestCount: within30DaysCount,
      within30DaysOfNewestFrac: within30DaysCount / parsedCluster.rows.length,
      topClusterDates
    }
  };
}

async function main() {
  const t0 = Date.now();
  const { catalog, catalogByTmdb, movieIdToTmdbId } = buildCatalog();
  const origUsers = loadOrig328Users(catalogByTmdb, movieIdToTmdbId);
  const clean1Sub = buildCatalogSubsetIndex(loadEmbeddingBin(".data/item_embeddings_clean_f16.bin"), catalog);
  console.log(`Loaded catalog (${catalog.length} films), ${origUsers.length} users, subset cleanEmb (${clean1Sub.count}x${clean1Sub.dim}), negKwWeight=${DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty}`);

  const c4 = await runC4(origUsers, catalog, clean1Sub);
  const c5 = runC5(origUsers);

  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      negKwWeight: DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty,
      elapsedSec: (Date.now() - t0) / 1000
    },
    c4,
    c5
  };

  fs.writeFileSync(path.join(root, ".data/phaseC_c4_c5_results.json"), JSON.stringify(out, null, 2));
  console.log(`\nSaved .data/phaseC_c4_c5_results.json in ${out.meta.elapsedSec.toFixed(1)}s`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
