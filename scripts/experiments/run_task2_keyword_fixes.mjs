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
const {
  rankCandidatePool,
  extractCandidateFeatures,
  DEFAULT_RANKER_WEIGHTS
} = await importSrc("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await importSrc("src/services/tmdbService.js");
const { computeZScoredWeights } = await importSrc("src/services/scoringUtils.js");

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

function selectTopKDescending(scores, candIndices, k = 20) {
  const n = scores.length;
  const top = new Array(Math.min(k, n));
  let filled = 0;
  let minVal = -Infinity;
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

/**
 * Reproduces tmdbService.js hatedKeywordIds extraction AND computes variants:
 *  - lovedSet: Set(profile.lovedKeywordIds)
 *  - variant (c): exclude any keyword ID in lovedKeywordIds (before top-5 slice)
 *  - variant (d): keep keyword only if hatedCount >= 3 AND hatedCount / (hatedCount + lovedCount) >= 0.75
 *  - plus diagnostic post-slice vs pre-slice comparison
 */
function extractKeywordVariants(trainWatched, holdoutStartTs, baseProfile) {
  const DECAY_RATE = 0.002;
  const zList = computeZScoredWeights(trainWatched, { lambda: DECAY_RATE, bulkPriorDays: 180, now: holdoutStartTs });
  const hatedWeighted = {};
  const hatedRawCount = {};
  const lovedRawCount = {};

  for (const { movie, rating, zScore, daysSince, weight } of zList) {
    const kws = movie.tmdbKeywords;
    if (!Array.isArray(kws) || kws.length === 0) continue;
    if (rating <= 4 || zScore < -0.4) {
      const negativeDecay = Math.exp(-(DECAY_RATE / 2) * daysSince);
      const negMagnitude = Math.max(1, Math.abs(zScore)) * negativeDecay;
      for (const kId of kws) {
        hatedWeighted[kId] = (hatedWeighted[kId] || 0) + negMagnitude;
        hatedRawCount[kId] = (hatedRawCount[kId] || 0) + 1;
      }
    }
    if (rating >= 8 && weight > 0) {
      for (const kId of kws) {
        lovedRawCount[kId] = (lovedRawCount[kId] || 0) + 1;
      }
    }
  }

  const reproducedA = Object.entries(hatedWeighted)
    .filter(([_, cnt]) => cnt > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => Number(id));

  // Verify exact parity with src/services/tmdbService.js extractTasteProfile
  const origA = baseProfile.hatedKeywordIds || [];
  if (reproducedA.length !== origA.length || reproducedA.some((id, idx) => id !== origA[idx])) {
    throw new Error(`hatedKeywordIds reproduction mismatch: [${reproducedA}] vs [${origA}]`);
  }

  const lovedSet = new Set(baseProfile.lovedKeywordIds || []);

  // Variant (c): exclude any keyword ID also in lovedKeywordIds before taking top-5
  const hatedC = Object.entries(hatedWeighted)
    .filter(([id, cnt]) => cnt > 0 && !lovedSet.has(Number(id)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => Number(id));

  // Variant (d): keep keyword only if hatedCount >= 3 AND hatedCount / (hatedCount + lovedCount) >= 0.75
  const hatedD = Object.entries(hatedWeighted)
    .filter(([id, cnt]) => {
      if (cnt <= 0) return false;
      const hCnt = hatedRawCount[id] || 0;
      const lCnt = lovedRawCount[id] || 0;
      return hCnt >= 3 && hCnt / (hCnt + lCnt) >= 0.75;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => Number(id));

  return { hatedC, hatedD };
}

function loadEmbeddingBin(relPath) {
  const fullPath = path.join(root, relPath);
  const buf = fs.readFileSync(fullPath);
  return parseEmbeddingBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const FEAT_KEYS = Object.keys(DEFAULT_RANKER_WEIGHTS).filter(k => k !== "bias");
const GENRE_IDX = FEAT_KEYS.indexOf("genreOverlap");
const BAYES_IDX = FEAT_KEYS.indexOf("bayesianRatingNorm");
const NEG_KW_IDX = FEAT_KEYS.indexOf("negativeKeywordPenalty");

function buildCatalog() {
  const tmdbEnriched = JSON.parse(fs.readFileSync(path.join(root, ".data/tmdb_enriched.json"), "utf8"));
  const tmdbItems = tmdbEnriched.items || {};

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
  const ratingsLines = fs
    .readFileSync(path.join(root, ".data/ml-latest-small/ratings.csv"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1);

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

function scoreWithNegKwArray(candFeats, negKwArr, hasCollabFlag, weights, damping = 0.20) {
  const n = negKwArr.length;
  const probs = new Float64Array(n);
  const bias = Number(weights.bias || 0);
  const wArr = Float64Array.from(FEAT_KEYS, k => Number(weights[k] || 0));

  for (let j = 0; j < n; j++) {
    let logit = bias;
    const damp = hasCollabFlag[j] ? damping : 1.0;
    for (let f = 0; f < 11; f++) {
      let x = f === NEG_KW_IDX ? negKwArr[j] : candFeats[f][j];
      if (f === GENRE_IDX || f === BAYES_IDX) x *= damp;
      logit += wArr[f] * x;
    }
    probs[j] = 1 / (1 + Math.exp(-logit));
  }
  return probs;
}

async function evaluateKeywordVariants(users, embIndex, catalog, popularTmdbIds, variantKeysToRun, label) {
  const N_cat = catalog.length;
  const catIdStrArr = catalog.map(c => String(c.tmdbId));
  const catLogVoteArr = Float64Array.from(catalog, c => Math.log(Math.max(1, c.vote_count)));

  const ALL_VARIANTS = {
    a: { id: "a", name: "(a) Prod ranker (w=-2.0)", type: "ranker", negMode: "a", weights: { ...DEFAULT_RANKER_WEIGHTS } },
    b: { id: "b", name: "(b) negKwPenalty = 0", type: "ranker", negMode: "a", weights: { ...DEFAULT_RANKER_WEIGHTS, negativeKeywordPenalty: 0 } },
    c: { id: "c", name: "(c) Hated excl. Loved", type: "ranker", negMode: "c", weights: { ...DEFAULT_RANKER_WEIGHTS } },
    d: { id: "d", name: "(d) Hated >=3 & >=75%", type: "ranker", negMode: "d", weights: { ...DEFAULT_RANKER_WEIGHTS } },
    e: { id: "e", name: "(e) Penalty x0.25 (-0.5)", type: "ranker", negMode: "a", weights: { ...DEFAULT_RANKER_WEIGHTS, negativeKeywordPenalty: -0.5 } },
    f: { id: "f", name: "(f) Penalty x0.50 (-1.0)", type: "ranker", negMode: "a", weights: { ...DEFAULT_RANKER_WEIGHTS, negativeKeywordPenalty: -1.0 } },
    g: { id: "g", name: "(g) collabSim alone", type: "collab_only" }
  };

  const variants = variantKeysToRun.map(k => ALL_VARIANTS[k]);
  const nUsers = users.length;

  const diagCounts = {
    usersWithNonEmptyHated_a: 0,
    usersWithNonEmptyHated_c: 0,
    usersWithNonEmptyHated_d: 0,
    usersWithLovedHatedOverlap_a: 0,
    totalHatedSlots_a: 0,
    totalHatedSlots_c: 0,
    totalHatedSlots_d: 0,
    ltHoldoutUsers: 0
  };

  const results = {};
  for (const v of variants) {
    results[v.id] = {
      id: v.id,
      name: v.name,
      ndcg: new Float64Array(nUsers),
      recall: new Float64Array(nUsers),
      ltNdcg: new Float64Array(nUsers),
      ltRecall: new Float64Array(nUsers),
      meanLogVc: new Float64Array(nUsers)
    };
  }

  let equivChecked = 0;

  for (let u = 0; u < nUsers; u++) {
    const user = users[u];
    const { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs } = getUserSplit(user.ratings);
    const trainIdSet = new Set(trainWatched.map(m => Number(m.tmdbId)));

    const profile = await extractTasteProfile(trainWatched, [], {
      now: holdoutStartTs,
      anchorCutoff: Infinity
    });
    const { hatedC, hatedD } = extractKeywordVariants(trainWatched, holdoutStartTs, profile);

    const hatedA = profile.hatedKeywordIds || [];
    const lovedSet = new Set(profile.lovedKeywordIds || []);
    if (hatedA.length > 0) diagCounts.usersWithNonEmptyHated_a++;
    if (hatedC.length > 0) diagCounts.usersWithNonEmptyHated_c++;
    if (hatedD.length > 0) diagCounts.usersWithNonEmptyHated_d++;
    if (hatedA.some(id => lovedSet.has(id))) diagCounts.usersWithLovedHatedOverlap_a++;
    diagCounts.totalHatedSlots_a += hatedA.length;
    diagCounts.totalHatedSlots_c += hatedC.length;
    diagCounts.totalHatedSlots_d += hatedD.length;

    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, embIndex);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embIndex);

    const ltHoldoutPositives = new Set();
    const ltHoldoutRelevance = new Map();
    for (const [tidStr, rel] of holdoutRelevance.entries()) {
      if (!popularTmdbIds.has(Number(tidStr))) {
        ltHoldoutRelevance.set(tidStr, rel);
        if (holdoutPositives.has(tidStr)) ltHoldoutPositives.add(tidStr);
      }
    }
    if (ltHoldoutPositives.size > 0) diagCounts.ltHoldoutUsers++;

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

    const rawCollab = new Float64Array(nCand);
    const candFeats = new Array(11);
    for (let f = 0; f < 11; f++) candFeats[f] = new Float64Array(nCand);
    const negKwC = new Float64Array(nCand);
    const negKwD = new Float64Array(nCand);
    const hasCollabFlag = new Uint8Array(nCand);

    const hatedSetC = new Set(hatedC);
    const hatedSetD = new Set(hatedD);

    for (let j = 0; j < nCand; j++) {
      const c = catalog[candIndices[j]];
      const feat = extractCandidateFeatures(c, context);
      rawCollab[j] = feat.collabSim;
      if (feat.collabSim > 0 && maxPoolCollab > 0.05) {
        feat.collabSim = Math.min(1.0, feat.collabSim / collabScale);
      }
      hasCollabFlag[j] = Math.abs(Number(feat.collabSim || 0)) > 0.001 ? 1 : 0;
      for (let f = 0; f < 11; f++) {
        candFeats[f][j] = Number(feat[FEAT_KEYS[f]] || 0);
      }
      if (hatedSetC.size > 0 && c.tmdbKeywords.length > 0) {
        negKwC[j] = c.tmdbKeywords.some(k => hatedSetC.has(Number(k))) ? 1 : 0;
      }
      if (hatedSetD.size > 0 && c.tmdbKeywords.length > 0) {
        negKwD[j] = c.tmdbKeywords.some(k => hatedSetD.has(Number(k))) ? 1 : 0;
      }
    }

    // Strict equivalence test on first 5 users against rankCandidatePool
    if (equivChecked < 5) {
      const cands = candIndices.map(idx => catalog[idx]);
      for (const v of variants) {
        if (v.type !== "ranker") continue;
        const profOverride =
          v.negMode === "c"
            ? { ...profile, hatedKeywordIds: hatedC }
            : v.negMode === "d"
              ? { ...profile, hatedKeywordIds: hatedD }
              : profile;
        const refCtx = { ...context, profile: profOverride };
        const refTop20 = rankCandidatePool(cands, refCtx, v.weights, 20, { metadataDampingFactor: 0.20 }).map(m => String(m.tmdbId));

        const negArr = v.negMode === "c" ? negKwC : v.negMode === "d" ? negKwD : candFeats[NEG_KW_IDX];
        const probs = scoreWithNegKwArray(candFeats, negArr, hasCollabFlag, v.weights, 0.20);
        const fastTop20 = selectTopKDescending(probs, candIndices, 20).map(idx => catIdStrArr[idx]);

        for (let i = 0; i < 20; i++) {
          if (refTop20[i] !== fastTop20[i]) {
            throw new Error(`[${label}] Equiv mismatch uid=${user.uid} var=${v.id} pos=${i}: ${refTop20[i]} vs ${fastTop20[i]}`);
          }
        }
      }
      equivChecked++;
    }

    for (const v of variants) {
      let top20CatIdx;
      if (v.type === "collab_only") {
        const scores = new Float64Array(nCand);
        for (let j = 0; j < nCand; j++) {
          const tid = catalog[candIndices[j]].tmdbId;
          scores[j] = collabSimMap.has(tid) ? Number(collabSimMap.get(tid)) : -999;
        }
        top20CatIdx = selectTopKDescending(scores, candIndices, 20);
      } else {
        const negArr = v.negMode === "c" ? negKwC : v.negMode === "d" ? negKwD : candFeats[NEG_KW_IDX];
        const probs = scoreWithNegKwArray(candFeats, negArr, hasCollabFlag, v.weights, 0.20);
        top20CatIdx = selectTopKDescending(probs, candIndices, 20);
      }

      const top20Ids = top20CatIdx.map(idx => catIdStrArr[idx]);
      const r = results[v.id];
      r.ndcg[u] = computeNDCGAtK(top20Ids, holdoutRelevance, 10);
      r.recall[u] = computeRecallAtK(top20Ids, holdoutPositives, 20);
      r.ltNdcg[u] = computeNDCGAtK(top20Ids, ltHoldoutRelevance, 10);
      r.ltRecall[u] = computeRecallAtK(top20Ids, ltHoldoutPositives, 20);

      let logVcSum = 0;
      for (let i = 0; i < 10 && i < top20CatIdx.length; i++) {
        logVcSum += catLogVoteArr[top20CatIdx[i]];
      }
      r.meanLogVc[u] = logVcSum / Math.min(10, top20CatIdx.length || 1);
    }
  }

  console.log(`[${label}] Strict rankCandidatePool top-20 equivalence verified on ${equivChecked}/5 users (100% match).`);
  return { variants, results, diagCounts, nUsers };
}

function summarizeComparisons(evalOut, splitHalfCheck = false) {
  const { variants, results, diagCounts, nUsers } = evalOut;
  const metricSpecs = [
    { key: "ndcg", label: "NDCG@10" },
    { key: "recall", label: "Recall@20" },
    { key: "ltNdcg", label: "LT NDCG@10" },
    { key: "ltRecall", label: "LT Recall@20" },
    { key: "meanLogVc", label: "Mean ln(VC)" }
  ];

  const baseA = results["a"];
  const baseG = results["g"];
  const summary = { nUsers, diagCounts, means: {}, vsA: {}, vsG: {} };

  for (const v of variants) {
    const r = results[v.id];
    summary.means[v.id] = {};
    for (const m of metricSpecs) {
      summary.means[v.id][m.key] = meanAndStd(r[m.key]).mean;
    }
  }

  for (const v of variants) {
    const r = results[v.id];
    if (v.id !== "a") {
      summary.vsA[v.id] = {};
      for (const m of metricSpecs) {
        const ciAll = pairedBootstrapCI(r[m.key], baseA[m.key], 1000, 42);
        const obj = { ...ciAll };
        if (splitHalfCheck) {
          const dTun = meanAndStd(Array.from(r[m.key].slice(0, 160), (x, i) => x - baseA[m.key][i])).mean;
          const dTest = meanAndStd(Array.from(r[m.key].slice(160), (x, i) => x - baseA[m.key][160 + i])).mean;
          obj.tunDelta = dTun;
          obj.testDelta = dTest;
          obj.halvesAgree = (dTun > 0 && dTest > 0) || (dTun < 0 && dTest < 0) || (Math.abs(dTun) < 1e-9 && Math.abs(dTest) < 1e-9);
        }
        summary.vsA[v.id][m.key] = obj;
      }
    }
    if (v.id !== "g") {
      summary.vsG[v.id] = {};
      for (const m of metricSpecs) {
        const ciAll = pairedBootstrapCI(r[m.key], baseG[m.key], 1000, 42);
        const obj = { ...ciAll };
        if (splitHalfCheck) {
          const dTun = meanAndStd(Array.from(r[m.key].slice(0, 160), (x, i) => x - baseG[m.key][i])).mean;
          const dTest = meanAndStd(Array.from(r[m.key].slice(160), (x, i) => x - baseG[m.key][160 + i])).mean;
          obj.tunDelta = dTun;
          obj.testDelta = dTest;
          obj.halvesAgree = (dTun > 0 && dTest > 0) || (dTun < 0 && dTest < 0) || (Math.abs(dTun) < 1e-9 && Math.abs(dTest) < 1e-9);
        }
        summary.vsG[v.id][m.key] = obj;
      }
    }
  }

  return summary;
}

function printTables(evalOut, summary, titlePrefix) {
  console.log(`\n${titlePrefix} — MEAN METRICS (N = ${summary.nUsers}, LT users >=1 = ${summary.diagCounts.ltHoldoutUsers}):`);
  console.log(
    `Hated keyword diagnostics: nonEmpty(a)=${summary.diagCounts.usersWithNonEmptyHated_a}/${summary.nUsers}, ` +
    `overlapWithLoved(a)=${summary.diagCounts.usersWithLovedHatedOverlap_a}/${summary.nUsers}` +
    (summary.diagCounts.usersWithNonEmptyHated_c !== undefined
      ? `, nonEmpty(c)=${summary.diagCounts.usersWithNonEmptyHated_c}/${summary.nUsers}, nonEmpty(d)=${summary.diagCounts.usersWithNonEmptyHated_d}/${summary.nUsers}`
      : "")
  );
  console.log("---------------------------------------------------------------------------------------------");
  console.log("Variant                    | NDCG@10 | Recall@20 | LT NDCG@10 | LT Rec@20 | Mean ln(VC)");
  console.log("---------------------------------------------------------------------------------------------");
  for (const v of evalOut.variants) {
    const m = summary.means[v.id];
    console.log(
      `${v.name.padEnd(26)} | ${m.ndcg.toFixed(4)}  | ${m.recall.toFixed(4)}    | ${m.ltNdcg.toFixed(4)}     | ${m.ltRecall.toFixed(4)}    | ${m.meanLogVc.toFixed(4)}`
    );
  }
  console.log("---------------------------------------------------------------------------------------------");

  const metricList = [
    { key: "ndcg", label: "NDCG@10" },
    { key: "recall", label: "Recall@20" },
    { key: "ltNdcg", label: "LT NDCG@10" },
    { key: "ltRecall", label: "LT Recall@20" },
    { key: "meanLogVc", label: "Mean ln(VC)" }
  ];

  const fmtS = x => `${x >= 0 ? "+" : ""}${x.toFixed(4)}`;

  for (const [refTitle, refMap] of [["vs (a) Prod Ranker", summary.vsA], ["vs (g) collabSim Alone", summary.vsG]]) {
    console.log(`\n${titlePrefix} — PAIRED BOOTSTRAP 95% CIs (1,000 resamples, seed=42) ${refTitle}:`);
    console.log("-----------------------------------------------------------------------------------------------------------------------");
    const hasHalves = Object.values(refMap)[0]?.ndcg?.tunDelta !== undefined;
    console.log(
      hasHalves
        ? "Variant                    | Metric      | Delta [95% CI]              | Sig? | Tun (160) | Test (168) | Halves"
        : "Variant                    | Metric      | Delta [95% CI]              | Sig?"
    );
    console.log("-----------------------------------------------------------------------------------------------------------------------");
    for (const v of evalOut.variants) {
      if (!refMap[v.id]) continue;
      for (const m of metricList) {
        const ci = refMap[v.id][m.key];
        const ciStr = `${fmtS(ci.meanDiff)} [${fmtS(ci.ciLower)}, ${fmtS(ci.ciUpper)}]`.padEnd(27);
        const sigStr = ci.isSignificant ? "YES" : "no ";
        if (hasHalves) {
          const hStr = ci.halvesAgree ? (ci.tunDelta >= 0 ? "Conc++" : "Conc--") : "Discord";
          console.log(
            `${v.name.padEnd(26)} | ${m.label.padEnd(11)} | ${ciStr} | ${sigStr}  | ${fmtS(ci.tunDelta).padEnd(9)} | ${fmtS(ci.testDelta).padEnd(10)} | ${hStr}`
          );
        } else {
          console.log(`${v.name.padEnd(26)} | ${m.label.padEnd(11)} | ${ciStr} | ${sigStr}`);
        }
      }
    }
    console.log("-----------------------------------------------------------------------------------------------------------------------");
  }
}

async function main() {
  const tStart = Date.now();
  console.log("==========================================================================");
  console.log("TASK 2: KEYWORD-PENALTY FIXES (ORIG 328 -> SELECTION -> FRESH 300 LOCKED)");
  console.log("==========================================================================");

  const { catalog, catalogByTmdb, movieIdToTmdbId, popularTmdbIds } = buildCatalog();
  const orig328 = loadOrig328Users(catalogByTmdb, movieIdToTmdbId);
  const fresh300 = loadFresh300Users(catalogByTmdb);

  const cleanEmb = loadEmbeddingBin(".data/item_embeddings_clean_f16.bin");
  const clean2Emb = loadEmbeddingBin(".data/item_embeddings_clean2_f16.bin");
  console.log(`Loaded clean1 (${cleanEmb.count}x${cleanEmb.dim}) and clean2 (${clean2Emb.count}x${clean2Emb.dim}).`);

  // Step 1: All 7 variants on Orig 328 with clean1
  const origEval = await evaluateKeywordVariants(orig328, cleanEmb, catalog, popularTmdbIds, ["a", "b", "c", "d", "e", "f", "g"], "ORIG 328 (clean1)");
  const origSummary = summarizeComparisons(origEval, true);
  printTables(origEval, origSummary, "TASK 2A — ORIG 328 (item_embeddings_clean_f16.bin)");

  // Step 2: Pre-declared selection rule from (a)-(f):
  // Highest NDCG@10 among those whose Recall@20 >= (a)'s Recall@20
  const recallA = origSummary.means.a.recall;
  const eligible = ["a", "b", "c", "d", "e", "f"].filter(id => origSummary.means[id].recall >= recallA - 1e-12);
  eligible.sort((id1, id2) => {
    const diff = origSummary.means[id2].ndcg - origSummary.means[id1].ndcg;
    if (Math.abs(diff) > 1e-12) return diff;
    return origSummary.means[id2].recall - origSummary.means[id1].recall;
  });
  const winnerId = eligible[0];
  console.log(
    `\nPRE-DECLARED SELECTION RULE RESULT:\n` +
    `  Baseline (a) Recall@20 = ${recallA.toFixed(6)}, NDCG@10 = ${origSummary.means.a.ndcg.toFixed(6)}\n` +
    `  Candidates meeting Recall@20 >= (a): [${eligible.join(", ")}]\n` +
    `  Selected Winner: (${winnerId}) ${origEval.variants.find(v => v.id === winnerId).name} ` +
    `[NDCG@10=${origSummary.means[winnerId].ndcg.toFixed(4)}, Recall@20=${origSummary.means[winnerId].recall.toFixed(4)}]`
  );

  // Step 3: Confirmation evaluation on Fresh 300 using clean2 — ONLY (a), (g), and winnerId
  const freshVariantKeys = winnerId === "a" ? ["a", "g"] : ["a", winnerId, "g"];
  const freshEval = await evaluateKeywordVariants(fresh300, clean2Emb, catalog, popularTmdbIds, freshVariantKeys, "FRESH 300 (clean2)");
  const freshSummary = summarizeComparisons(freshEval, false);
  printTables(freshEval, freshSummary, "TASK 2B — FRESH 300 CONFIRMATION SET (item_embeddings_clean2_f16.bin)");

  const outJson = {
    meta: {
      seed: 42,
      resamples: 1000,
      catalogSize: catalog.length,
      popularThresholdNote: "top 20% by TMDB vote_count",
      elapsedSec: (Date.now() - tStart) / 1000
    },
    orig328Summary: origSummary,
    selectionRule: {
      baselineRecallA: recallA,
      eligibleVariantIds: eligible,
      winnerId,
      winnerName: origEval.variants.find(v => v.id === winnerId).name
    },
    fresh300Summary: freshSummary
  };

  fs.writeFileSync(path.join(root, ".data/task2_keyword_results.json"), JSON.stringify(outJson, null, 2));
  console.log(`\nSaved .data/task2_keyword_results.json in ${((Date.now() - tStart) / 1000).toFixed(1)}s.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
