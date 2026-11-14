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

const FIXED_NOW_MS = Date.parse("2026-11-13T00:00:00.000Z");
const MS_PER_DAY = 86400000;

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
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

function medianOf(arr) {
  if (!arr.length) return 180;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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

function computeTieCorrectedUnionSpearman(listA, listB, k = 20) {
  const topA = listA.slice(0, k).map(String);
  const topB = listB.slice(0, k).map(String);
  const union = Array.from(new Set([...topA, ...topB]));
  const n = union.length;
  if (n <= 1) return 1.0;

  const rankMapA = new Map(topA.map((id, idx) => [id, idx + 1]));
  const rankMapB = new Map(topB.map((id, idx) => [id, idx + 1]));

  const missA = n - topA.length;
  const missB = n - topB.length;
  const tiedA = missA > 0 ? (k + 1 + n) / 2 : 0;
  const tiedB = missB > 0 ? (k + 1 + n) / 2 : 0;

  const rA = union.map(id => rankMapA.get(id) ?? tiedA);
  const rB = union.map(id => rankMapB.get(id) ?? tiedB);

  const mA = rA.reduce((a, b) => a + b, 0) / n;
  const mB = rB.reduce((a, b) => a + b, 0) / n;
  let num = 0, dA = 0, dB = 0;
  for (let i = 0; i < n; i++) {
    const a = rA[i] - mA;
    const b = rB[i] - mB;
    num += a * b;
    dA += a * a;
    dB += b * b;
  }
  const den = Math.sqrt(dA * dB);
  return den > 1e-12 ? num / den : 0;
}

function mapMovieLensGenresToTmdb(genresStr = "") {
  if (!genresStr || genresStr === "(no genres listed)") return [];
  const normalized = genresStr
    .replace(/\|/g, ",")
    .replace(/\bchildren\b/gi, "Family")
    .replace(/\bsci-fi\b/gi, "Sci-Fi");
  return mapOmdbToTmdbGenreIds(normalized);
}

const FEAT_KEYS = Object.keys(DEFAULT_RANKER_WEIGHTS).filter(k => k !== "bias");
const GENRE_IDX = FEAT_KEYS.indexOf("genreOverlap");
const BAYES_IDX = FEAT_KEYS.indexOf("bayesianRatingNorm");

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

function extractFeaturesBatch(candIndices, catalog, context) {
  const n = candIndices.length;
  const {
    profile = {},
    collabSimMap = new Map(),
    contentSimMap = new Map(),
    repulsionMap = new Map(),
    anchorKeywords = [],
    userProviders = []
  } = context;

  let maxPoolCollab = 0;
  for (let j = 0; j < n; j++) {
    const tid = catalog[candIndices[j]].tmdbId;
    const v = Number(collabSimMap?.get?.(tid) ?? 0);
    if (v > maxPoolCollab) maxPoolCollab = v;
  }
  const collabScale = maxPoolCollab > 0.05 ? maxPoolCollab : 1.0;

  const lovedGenreSet = new Set(profile.lovedGenreIds || []);
  const lovedGenreDenom = Math.min(3, lovedGenreSet.size);

  const effectiveAnchorKws =
    Array.isArray(anchorKeywords) && anchorKeywords.length > 0
      ? anchorKeywords
      : (profile.lovedKeywordIds || []);
  const anchorKwSet = new Set(effectiveAnchorKws.map(Number));
  const anchorKwDenom = Math.min(3, anchorKwSet.size);

  const hatedSet = new Set(profile.hatedKeywordIds || []);
  const topCrewSet = new Set((profile.topCrewIds || []).map(Number));
  if (profile.topCrewMemberId) topCrewSet.add(Number(profile.topCrewMemberId));
  const topCastSet = new Set((profile.topCastIds || []).map(Number));
  const providerSet = new Set(userProviders || []);

  // Pre-allocate typed 11-feature matrix
  const cols = new Array(11);
  for (let f = 0; f < 11; f++) cols[f] = new Float64Array(n);
  const rawCollab = new Float64Array(n);
  const hasCollab = new Uint8Array(n);

  const fCollab = cols[FEAT_KEYS.indexOf("collabSim")];
  const fContent = cols[FEAT_KEYS.indexOf("contentSim")];
  const fGenre = cols[FEAT_KEYS.indexOf("genreOverlap")];
  const fKw = cols[FEAT_KEYS.indexOf("keywordOverlap")];
  const fCrew = cols[FEAT_KEYS.indexOf("crewMatch")];
  const fCast = cols[FEAT_KEYS.indexOf("castMatch")];
  const fBayes = cols[FEAT_KEYS.indexOf("bayesianRatingNorm")];
  const fNov = cols[FEAT_KEYS.indexOf("noveltyBonus")];
  const fNegKw = cols[FEAT_KEYS.indexOf("negativeKeywordPenalty")];
  const fRep = cols[FEAT_KEYS.indexOf("repulsion")];
  const fProv = cols[FEAT_KEYS.indexOf("providerMatch")];

  for (let j = 0; j < n; j++) {
    const c = catalog[candIndices[j]];
    const tid = Number(c.tmdbId ?? c.id ?? 0);

    const rawC = Number(collabSimMap?.get?.(tid) ?? c.collabSim ?? 0);
    rawCollab[j] = rawC;
    const scaledC = rawC > 0 && maxPoolCollab > 0.05 ? Math.min(1.0, rawC / collabScale) : rawC;
    fCollab[j] = scaledC;
    hasCollab[j] = Math.abs(scaledC) > 0.001 ? 1 : 0;

    fContent[j] = Number(contentSimMap?.get?.(tid) ?? c.contentSim ?? 0);
    fRep[j] = Number(repulsionMap?.get?.(tid) ?? c.repulsion ?? 0);

    if (lovedGenreDenom > 0) {
      let gh = 0;
      const cg = c.tmdbGenreIds || c.genre_ids || [];
      for (let i = 0; i < cg.length; i++) {
        if (lovedGenreSet.has(Number(cg[i]))) gh++;
      }
      fGenre[j] = Math.min(1, gh / lovedGenreDenom);
    }

    const ckw = c.tmdbKeywords || [];
    if (anchorKwDenom > 0) {
      let kh = 0;
      for (let i = 0; i < ckw.length; i++) {
        if (anchorKwSet.has(Number(ckw[i]))) kh++;
      }
      fKw[j] = kh > 0 ? Math.min(1, kh / anchorKwDenom) : 0;
    }

    if (hatedSet.size > 0 && ckw.length > 0) {
      let nh = 0;
      for (let i = 0; i < ckw.length; i++) {
        if (hatedSet.has(Number(ckw[i]))) nh++;
      }
      fNegKw[j] = Math.min(1, nh);
    }

    const cCrew = Number(c.crewPersonId || 0);
    fCrew[j] = cCrew > 0 && topCrewSet.has(cCrew) ? 1 : 0;

    let castHit = 0;
    const cCast = c.castIds || [];
    for (let i = 0; i < cCast.length; i++) {
      if (topCastSet.has(Number(cCast[i]))) {
        castHit = 1;
        break;
      }
    }
    fCast[j] = castHit;

    const v = Math.max(0, Number(c.vote_count) || 0);
    const R = Number(c.vote_average) || 7.0;
    const bayesian = (v / (v + 500)) * R + (500 / (v + 500)) * 7.0;
    fBayes[j] = Math.max(0, Math.min(1, (bayesian - 5.0) / 4.5));

    const vc = Math.max(10, Number(c.vote_count || 200));
    fNov[j] = vc >= 100 && vc <= 4000 ? 0.5 : 0.1;

    fProv[j] = providerSet.size === 0 ? 0.5 : 0;
  }

  return { cols, rawCollab, hasCollab, n };
}

function scoreBatch(batch, weights, damping = 0.20) {
  const { cols, hasCollab, n } = batch;
  const probs = new Float64Array(n);
  const bias = Number(weights.bias || 0);
  const wArr = Float64Array.from(FEAT_KEYS, k => Number(weights[k] || 0));

  for (let j = 0; j < n; j++) {
    let logit = bias;
    const damp = hasCollab[j] ? damping : 1.0;
    for (let f = 0; f < 11; f++) {
      let x = cols[f][j];
      if (f === GENRE_IDX || f === BAYES_IDX) x *= damp;
      logit += wArr[f] * x;
    }
    probs[j] = 1 / (1 + Math.exp(-logit));
  }
  return probs;
}

function scoreLinearFast(candIndices, catalog, context, weights, damping = 0.20) {
  const batch = extractFeaturesBatch(candIndices, catalog, context);
  return scoreBatch(batch, weights, damping);
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

function loadCatalogAndOrig328() {
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
  return { catalog, catalogByTmdb, users };
}

function buildCatalogSubsetIndex(baseIndex, catalog) {
  const catSet = new Set(catalog.map(c => Number(c.tmdbId)));
  const { count, dim, ids, vectors } = baseIndex;
  const keepIndices = [];
  for (let i = 0; i < count; i++) {
    if (catSet.has(ids[i])) keepIndices.push(i);
  }
  const subCount = keepIndices.length;
  const subIds = new Uint32Array(subCount);
  const subVecs = new Float32Array(subCount * dim);
  const subIdToIndex = new Map();
  for (let k = 0; k < subCount; k++) {
    const origIdx = keepIndices[k];
    const tid = ids[origIdx];
    subIds[k] = tid;
    subIdToIndex.set(tid, k);
    subVecs.set(vectors.subarray(origIdx * dim, (origIdx + 1) * dim), k * dim);
  }
  return {
    version: baseIndex.version,
    count: subCount,
    dim,
    ids: subIds,
    vectors: subVecs,
    idToIndex: subIdToIndex
  };
}

function buildMaskedIndex(baseIndex, maskedTmdbSet) {
  const { count, dim, ids, vectors } = baseIndex;
  const maskedVecs = new Float32Array(vectors);
  const maskedIdToIndex = new Map();

  for (let i = 0; i < count; i++) {
    const tid = ids[i];
    if (maskedTmdbSet.has(tid)) {
      const base = i * dim;
      for (let d = 0; d < dim; d++) maskedVecs[base + d] = 0;
    } else {
      maskedIdToIndex.set(tid, i);
    }
  }

  return {
    version: baseIndex.version,
    count,
    dim,
    ids,
    vectors: maskedVecs,
    idToIndex: maskedIdToIndex
  };
}

async function runTask3(users, catalog, cleanEmb) {
  console.log("\n==========================================================================");
  console.log("TASK 3: UNDATED-ITEM AGING (60 EVENLY SPACED USERS x 3 SEEDS x 3 GAPS)");
  console.log("==========================================================================");

  const catIdStrArr = catalog.map(c => String(c.tmdbId));
  const N_cat = catalog.length;

  const sampledIndices = Array.from({ length: 60 }, (_, i) => Math.floor((i * users.length) / 60));
  const sampled60 = sampledIndices.map(idx => users[idx]);
  console.log(`Sampled ${sampled60.length} evenly spaced users (index range ${sampledIndices[0]}..${sampledIndices[59]}, uids ${sampled60[0].uid}..${sampled60[59].uid}).`);

  const SEEDS = [42, 43, 44];
  const GAPS = [
    { id: "30d", label: "30 days", days: 30 },
    { id: "1y", label: "1 year (365d)", days: 365 },
    { id: "3y", label: "3 years (1095d)", days: 1095 }
  ];
  const METHODS = [
    { id: "A", label: "(A) Fixed 180d" },
    { id: "B", label: "(B) Median dated age" },
    { id: "C", label: "(C) Oldest dated age" }
  ];

  // Helper to evaluate a vault under bulkPriorDays against FIXED_NOW_MS
  async function rankVault(vault, candIndices, bulkPriorDays) {
    const profile = await extractTasteProfile(vault, [], {
      now: FIXED_NOW_MS,
      anchorCutoff: Infinity,
      bulkPriorDays
    });
    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, cleanEmb);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, cleanEmb);
    const context = {
      profile,
      collabSimMap,
      contentSimMap: new Map(),
      repulsionMap,
      anchorKeywords: profile.lovedKeywordIds || [],
      userProviders: []
    };
    const probs = scoreLinearFast(candIndices, catalog, context, DEFAULT_RANKER_WEIGHTS, 0.20);
    const top20CatIdx = selectTopKDescending(probs, candIndices, 20);
    const top20Ids = top20CatIdx.map(idx => catIdStrArr[idx]);

    let sumAllW = 0;
    let sumUndatedW = 0;
    for (const item of profile.weightedRatings) {
      const aw = Math.abs(item.weight || 0);
      sumAllW += aw;
      if (item.movie?.isBulkImported || !item.movie?.dateWatched) sumUndatedW += aw;
    }

    return {
      top20Ids,
      probs,
      undatedAbsWeightShare: sumAllW > 0 ? sumUndatedW / sumAllW : 0
    };
  }

  // First confirm 100% undated vault invariance across first 10 users
  let allUndatedIdentical = true;
  for (let u = 0; u < 10; u++) {
    const user = sampled60[u];
    const { trainWatched } = getUserSplit(user.ratings);
    const trainIdSet = new Set(trainWatched.map(m => Number(m.tmdbId)));
    const candIndices = [];
    for (let i = 0; i < N_cat; i++) {
      if (!trainIdSet.has(catalog[i].tmdbId)) candIndices.push(i);
    }
    const undatedVault = trainWatched.map(m => ({ ...m, isBulkImported: true, dateWatched: undefined }));
    const resA = await rankVault(undatedVault, candIndices, 180);
    const resB = await rankVault(undatedVault, candIndices, 180); // median fallback when 0 dated
    const resC = await rankVault(undatedVault, candIndices, 180); // oldest fallback when 0 dated
    // Also test direct rankCandidatePool equivalence on user 0
    if (u === 0) {
      const prof = await extractTasteProfile(undatedVault, [], { now: FIXED_NOW_MS, anchorCutoff: Infinity, bulkPriorDays: 180 });
      const ctx = {
        profile: prof,
        collabSimMap: buildCollabSimMapFromIndex(prof.weightedRatings, cleanEmb),
        contentSimMap: new Map(),
        repulsionMap: buildRepulsionMapFromIndex(prof.weightedRatings, cleanEmb),
        anchorKeywords: prof.lovedKeywordIds || [],
        userProviders: []
      };
      const refTop20 = rankCandidatePool(candIndices.map(i => catalog[i]), ctx, DEFAULT_RANKER_WEIGHTS, 20, { metadataDampingFactor: 0.20 }).map(m => String(m.tmdbId));
      for (let i = 0; i < 20; i++) {
        if (refTop20[i] !== resA.top20Ids[i]) throw new Error(`Task 3 equiv mismatch pos=${i}`);
      }
    }
    for (let i = 0; i < 20; i++) {
      if (resA.top20Ids[i] !== resB.top20Ids[i] || resA.top20Ids[i] !== resC.top20Ids[i]) {
        allUndatedIdentical = false;
      }
    }
  }
  console.log(`100% undated vault invariance check across 10 users (A, B, C top-20 identical): ${allUndatedIdentical}`);

  const task3Results = { allUndatedIdentical, gaps: {} };

  for (const gap of GAPS) {
    console.log(`\nRunning Task 3 gap regime: newest dated = ${gap.label} ...`);
    const gapStore = {
      control: { ndcg: new Float64Array(60), recall: new Float64Array(60) },
      methods: {}
    };
    for (const m of METHODS) {
      gapStore.methods[m.id] = {
        top10Overlap: new Float64Array(60),
        spearman20: new Float64Array(60),
        undatedWeightShare: new Float64Array(60),
        ndcg: new Float64Array(60),
        recall: new Float64Array(60),
        priorDaysSum: 0
      };
    }

    for (let u = 0; u < sampled60.length; u++) {
      const user = sampled60[u];
      const { trainWatched, holdoutPositives, holdoutRelevance } = getUserSplit(user.ratings);
      const trainIdSet = new Set(trainWatched.map(m => Number(m.tmdbId)));
      const candIndices = [];
      for (let i = 0; i < N_cat; i++) {
        if (!trainIdSet.has(catalog[i].tmdbId)) candIndices.push(i);
      }

      const maxTrainTs = trainWatched[trainWatched.length - 1].ts;
      const controlVault = trainWatched.map(m => ({
        ...m,
        isBulkImported: false,
        dateWatched: new Date(FIXED_NOW_MS - gap.days * MS_PER_DAY - (maxTrainTs - m.ts)).toISOString()
      }));
      const ctrlRes = await rankVault(controlVault, candIndices, 180);
      const ctrlTop10Set = new Set(ctrlRes.top20Ids.slice(0, 10));
      gapStore.control.ndcg[u] = computeNDCGAtK(ctrlRes.top20Ids, holdoutRelevance, 10);
      gapStore.control.recall[u] = computeRecallAtK(ctrlRes.top20Ids, holdoutPositives, 20);

      for (const seed of SEEDS) {
        const rng = makeRng(seed * 100003 + Number(user.uid));
        const nTrain = trainWatched.length;
        const perm = Array.from({ length: nTrain }, (_, k) => k);
        for (let k = nTrain - 1; k > 0; k--) {
          const j = Math.floor(rng() * (k + 1));
          const tmp = perm[k];
          perm[k] = perm[j];
          perm[j] = tmp;
        }
        const halfN = Math.floor(nTrain / 2);
        const undatedIdxSet = new Set(perm.slice(0, halfN));

        let maxDatedTs = -Infinity;
        for (let k = 0; k < nTrain; k++) {
          if (!undatedIdxSet.has(k) && trainWatched[k].ts > maxDatedTs) {
            maxDatedTs = trainWatched[k].ts;
          }
        }

        const datedAges = [];
        const maskedVault = trainWatched.map((m, k) => {
          if (undatedIdxSet.has(k)) {
            return { ...m, isBulkImported: true, dateWatched: undefined };
          }
          const datedMs = FIXED_NOW_MS - gap.days * MS_PER_DAY - (maxDatedTs - m.ts);
          datedAges.push(Math.max(0, (FIXED_NOW_MS - datedMs) / MS_PER_DAY));
          return {
            ...m,
            isBulkImported: false,
            dateWatched: new Date(datedMs).toISOString()
          };
        });

        const priors = {
          A: 180,
          B: medianOf(datedAges),
          C: Math.max(...datedAges)
        };

        for (const m of METHODS) {
          const r = await rankVault(maskedVault, candIndices, priors[m.id]);
          const top10 = r.top20Ids.slice(0, 10);
          let hits10 = 0;
          for (const id of top10) {
            if (ctrlTop10Set.has(id)) hits10++;
          }
          const st = gapStore.methods[m.id];
          st.top10Overlap[u] += (hits10 / 10) / SEEDS.length;
          st.spearman20[u] += computeTieCorrectedUnionSpearman(r.top20Ids, ctrlRes.top20Ids, 20) / SEEDS.length;
          st.undatedWeightShare[u] += r.undatedAbsWeightShare / SEEDS.length;
          st.ndcg[u] += computeNDCGAtK(r.top20Ids, holdoutRelevance, 10) / SEEDS.length;
          st.recall[u] += computeRecallAtK(r.top20Ids, holdoutPositives, 20) / SEEDS.length;
          st.priorDaysSum += priors[m.id];
        }
      }
    }

    const ctrlNdcgMean = meanAndStd(gapStore.control.ndcg).mean;
    const ctrlRecallMean = meanAndStd(gapStore.control.recall).mean;
    const summaryGap = {
      controlMeans: { ndcg: ctrlNdcgMean, recall: ctrlRecallMean },
      methods: {}
    };

    const refA = gapStore.methods["A"];
    for (const m of METHODS) {
      const st = gapStore.methods[m.id];
      const means = {
        avgPriorDays: st.priorDaysSum / (60 * SEEDS.length),
        top10Overlap: meanAndStd(st.top10Overlap).mean,
        spearman20: meanAndStd(st.spearman20).mean,
        undatedWeightShare: meanAndStd(st.undatedWeightShare).mean,
        ndcg: meanAndStd(st.ndcg).mean,
        recall: meanAndStd(st.recall).mean
      };
      const vsA = m.id === "A" ? null : {
        top10Overlap: pairedBootstrapCI(st.top10Overlap, refA.top10Overlap, 1000, 42),
        spearman20: pairedBootstrapCI(st.spearman20, refA.spearman20, 1000, 42),
        undatedWeightShare: pairedBootstrapCI(st.undatedWeightShare, refA.undatedWeightShare, 1000, 42),
        ndcg: pairedBootstrapCI(st.ndcg, refA.ndcg, 1000, 42),
        recall: pairedBootstrapCI(st.recall, refA.recall, 1000, 42)
      };
      summaryGap.methods[m.id] = { label: m.label, means, vsA };
    }
    task3Results.gaps[gap.id] = summaryGap;

    console.log(`Control (100% dated, newest=${gap.label}): NDCG@10=${ctrlNdcgMean.toFixed(4)}, Recall@20=${ctrlRecallMean.toFixed(4)}`);
    console.log("Method                 | AvgPrior | Top10Ovl | Spear@20 | Undat|W| | NDCG@10 | Recall@20 | dTop10Ovl vs A [CI] (Sig?)       | dNDCG@10 vs A [CI] (Sig?)");
    console.log("-----------------------------------------------------------------------------------------------------------------------------------------------------------");
    const fmtS = x => `${x >= 0 ? "+" : ""}${x.toFixed(4)}`;
    for (const m of METHODS) {
      const { means, vsA } = summaryGap.methods[m.id];
      const ciO = vsA ? `${fmtS(vsA.top10Overlap.meanDiff)} [${fmtS(vsA.top10Overlap.ciLower)},${fmtS(vsA.top10Overlap.ciUpper)}] ${vsA.top10Overlap.isSignificant ? "YES" : "no"}` : "ref";
      const ciN = vsA ? `${fmtS(vsA.ndcg.meanDiff)} [${fmtS(vsA.ndcg.ciLower)},${fmtS(vsA.ndcg.ciUpper)}] ${vsA.ndcg.isSignificant ? "YES" : "no"}` : "ref";
      console.log(
        `${m.label.padEnd(22)} | ${means.avgPriorDays.toFixed(1).padStart(7)}d | ${means.top10Overlap.toFixed(4)}   | ${means.spearman20.toFixed(4)}   | ${means.undatedWeightShare.toFixed(4)}   | ${means.ndcg.toFixed(4)}  | ${means.recall.toFixed(4)}    | ${ciO.padEnd(32)} | ${ciN}`
      );
    }
  }

  return task3Results;
}

async function runTask4(users, catalog, cleanEmb) {
  console.log("\n==========================================================================");
  console.log("TASK 4: COLD-START SIMULATION (30% CATALOG MASKED x 3 SEEDS ON 328 USERS)");
  console.log("==========================================================================");

  const SEEDS = [42, 43, 44];
  const N_cat = catalog.length;
  const nUsers = users.length;
  const catIdStrArr = catalog.map(c => String(c.tmdbId));
  const maskCount = Math.round(0.30 * N_cat);

  const SYSTEMS = [
    { id: "full_prod", label: "Full Production Ranker", type: "ranker", weights: { ...DEFAULT_RANKER_WEIGHTS } },
    { id: "zero_meta", label: "Zeroed genre/kw/crew/cast", type: "ranker", weights: { ...DEFAULT_RANKER_WEIGHTS, genreOverlap: 0, keywordOverlap: 0, crewMatch: 0, castMatch: 0 } },
    { id: "collab_only", label: "collabSim Alone", type: "collab_only" }
  ];

  // Pre-build per-user split and train-only metadata taste profile (independent of seed mask!)
  const preUsers = [];
  for (const u of users) {
    const split = getUserSplit(u.ratings);
    const trainIdSet = new Set(split.trainWatched.map(m => Number(m.tmdbId)));
    const candIndices = [];
    for (let i = 0; i < N_cat; i++) {
      if (!trainIdSet.has(catalog[i].tmdbId)) candIndices.push(i);
    }
    const profile = await extractTasteProfile(split.trainWatched, [], {
      now: split.holdoutStartTs,
      anchorCutoff: Infinity
    });
    preUsers.push({ uid: u.uid, ...split, trainIdSet, candIndices, profile });
  }

  // Per-user accumulators averaged across valid seeds (and across all 3 seeds for top-20 share)
  const userAgg = {};
  for (const sys of SYSTEMS) {
    userAgg[sys.id] = {
      maskedRecallSum: new Float64Array(nUsers),
      maskedNdcgSum: new Float64Array(nUsers),
      validSeedCount: new Int32Array(nUsers),
      maskedTop20ShareSum: new Float64Array(nUsers),
      allHoldoutRecallSum: new Float64Array(nUsers),
      allHoldoutNdcgSum: new Float64Array(nUsers)
    };
  }

  let totalHoldoutPosSeen = 0;
  let totalHoldoutPosMasked = 0;
  let totalUserSeeds = 0;
  let validUserSeeds = 0;
  let equivChecked = false;

  for (const seed of SEEDS) {
    const rng = makeRng(seed * 99991 + 7);
    const catPos = Array.from({ length: N_cat }, (_, i) => i);
    for (let i = N_cat - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = catPos[i];
      catPos[i] = catPos[j];
      catPos[j] = tmp;
    }
    const maskedSet = new Set(catPos.slice(0, maskCount).map(idx => catalog[idx].tmdbId));
    const maskedIndex = buildMaskedIndex(cleanEmb, maskedSet);

    let seedHoldPos = 0;
    let seedMaskedPos = 0;

    for (let u = 0; u < nUsers; u++) {
      const pu = preUsers[u];
      const profile = pu.profile;
      const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, maskedIndex);
      const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, maskedIndex);

      // Assert masked items have strictly 0 collabSim and 0 (absent) repulsion
      if (!equivChecked && u === 0) {
        let nonZeroMasked = 0;
        for (const tid of maskedSet) {
          if (Math.abs(collabSimMap.get(tid) || 0) > 1e-12) nonZeroMasked++;
          if (Math.abs(repulsionMap.get(tid) || 0) > 1e-12) nonZeroMasked++;
        }
        if (nonZeroMasked > 0) throw new Error(`Masked items had non-zero collab/repulsion: ${nonZeroMasked}`);
      }

      const maskedHoldPos = new Set();
      const maskedHoldRel = new Map();
      for (const tidStr of pu.holdoutPositives) {
        seedHoldPos++;
        if (maskedSet.has(Number(tidStr))) {
          seedMaskedPos++;
          maskedHoldPos.add(tidStr);
          maskedHoldRel.set(tidStr, pu.holdoutRelevance.get(tidStr));
        }
      }
      totalUserSeeds++;
      if (maskedHoldPos.size > 0) validUserSeeds++;

      const context = {
        profile,
        collabSimMap,
        contentSimMap: new Map(),
        repulsionMap,
        anchorKeywords: profile.lovedKeywordIds || [],
        userProviders: []
      };

      // Extract all 11 features once per (user, seed) for both full_prod and zero_meta
      const batch = extractFeaturesBatch(pu.candIndices, catalog, context);

      // Equivalence check on user 0 seed 42 against production rankCandidatePool
      if (!equivChecked && u === 0) {
        const cands = pu.candIndices.map(i => catalog[i]);
        for (const sys of SYSTEMS.filter(s => s.type === "ranker")) {
          const refTop20 = rankCandidatePool(cands, context, sys.weights, 20, { metadataDampingFactor: 0.20 }).map(m => String(m.tmdbId));
          const probs = scoreBatch(batch, sys.weights, 0.20);
          const fastTop20 = selectTopKDescending(probs, pu.candIndices, 20).map(idx => catIdStrArr[idx]);
          for (let i = 0; i < 20; i++) {
            if (refTop20[i] !== fastTop20[i]) throw new Error(`Task 4 equiv mismatch sys=${sys.id} pos=${i}`);
          }
        }
        equivChecked = true;
        console.log("Task 4 strict equivalence check PASSED vs production rankCandidatePool (including un-damped collabSim=0 path).");
      }

      const nCand = pu.candIndices.length;
      for (const sys of SYSTEMS) {
        let top20CatIdx;
        if (sys.type === "collab_only") {
          const scores = new Float64Array(nCand);
          for (let j = 0; j < nCand; j++) {
            const tid = catalog[pu.candIndices[j]].tmdbId;
            if (maskedSet.has(tid)) {
              scores[j] = 0;
            } else {
              scores[j] = collabSimMap.has(tid) ? Number(collabSimMap.get(tid)) : -999;
            }
          }
          top20CatIdx = selectTopKDescending(scores, pu.candIndices, 20);
        } else {
          const probs = scoreBatch(batch, sys.weights, 0.20);
          top20CatIdx = selectTopKDescending(probs, pu.candIndices, 20);
        }

        const top20Ids = top20CatIdx.map(idx => catIdStrArr[idx]);
        let maskedInTop20 = 0;
        for (const idx of top20CatIdx) {
          if (maskedSet.has(catalog[idx].tmdbId)) maskedInTop20++;
        }

        const agg = userAgg[sys.id];
        agg.maskedTop20ShareSum[u] += (maskedInTop20 / 20) / SEEDS.length;
        agg.allHoldoutRecallSum[u] += computeRecallAtK(top20Ids, pu.holdoutPositives, 20) / SEEDS.length;
        agg.allHoldoutNdcgSum[u] += computeNDCGAtK(top20Ids, pu.holdoutRelevance, 10) / SEEDS.length;

        if (maskedHoldPos.size > 0) {
          agg.maskedRecallSum[u] += computeRecallAtK(top20Ids, maskedHoldPos, 20);
          agg.maskedNdcgSum[u] += computeNDCGAtK(top20Ids, maskedHoldRel, 10);
          agg.validSeedCount[u]++;
        }
      }
    }

    totalHoldoutPosSeen += seedHoldPos;
    totalHoldoutPosMasked += seedMaskedPos;
    console.log(
      `Seed ${seed}: masked ${maskCount}/${N_cat} (${((maskCount / N_cat) * 100).toFixed(2)}%) catalog; ` +
      `masked ${seedMaskedPos}/${seedHoldPos} (${((seedMaskedPos / seedHoldPos) * 100).toFixed(2)}%) held-out positives.`
    );
  }

  // Per-user averages over valid seeds (users with >= 1 valid seed)
  const validUserIndices = [];
  for (let u = 0; u < nUsers; u++) {
    if (userAgg["full_prod"].validSeedCount[u] > 0) validUserIndices.push(u);
  }
  const nValidUsers = validUserIndices.length;

  const perUserArrays = {};
  for (const sys of SYSTEMS) {
    const agg = userAgg[sys.id];
    perUserArrays[sys.id] = {
      maskedRecall20: Float64Array.from(validUserIndices, u => agg.maskedRecallSum[u] / agg.validSeedCount[u]),
      maskedNdcg10: Float64Array.from(validUserIndices, u => agg.maskedNdcgSum[u] / agg.validSeedCount[u]),
      maskedTop20Share: agg.maskedTop20ShareSum,
      allHoldoutRecall20: agg.allHoldoutRecallSum,
      allHoldoutNdcg10: agg.allHoldoutNdcgSum
    };
  }

  const fullArr = perUserArrays["full_prod"];
  const zeroArr = perUserArrays["zero_meta"];
  const colArr = perUserArrays["collab_only"];

  const summary = {
    catalogMaskFrac: maskCount / N_cat,
    empiricalHoldoutMaskFrac: totalHoldoutPosMasked / totalHoldoutPosSeen,
    validUserSeeds,
    totalUserSeeds,
    nValidUsers,
    nTotalUsers: nUsers,
    means: Object.fromEntries(SYSTEMS.map(s => [
      s.id,
      {
        label: s.label,
        maskedRecall20: meanAndStd(perUserArrays[s.id].maskedRecall20).mean,
        maskedNdcg10: meanAndStd(perUserArrays[s.id].maskedNdcg10).mean,
        maskedTop20Share: meanAndStd(perUserArrays[s.id].maskedTop20Share).mean,
        allHoldoutRecall20: meanAndStd(perUserArrays[s.id].allHoldoutRecall20).mean,
        allHoldoutNdcg10: meanAndStd(perUserArrays[s.id].allHoldoutNdcg10).mean
      }
    ])),
    cis: {
      full_vs_zeroMeta: {
        maskedRecall20: pairedBootstrapCI(fullArr.maskedRecall20, zeroArr.maskedRecall20, 1000, 42),
        maskedNdcg10: pairedBootstrapCI(fullArr.maskedNdcg10, zeroArr.maskedNdcg10, 1000, 42),
        maskedTop20Share: pairedBootstrapCI(fullArr.maskedTop20Share, zeroArr.maskedTop20Share, 1000, 42)
      },
      full_vs_collabOnly: {
        maskedRecall20: pairedBootstrapCI(fullArr.maskedRecall20, colArr.maskedRecall20, 1000, 42),
        maskedNdcg10: pairedBootstrapCI(fullArr.maskedNdcg10, colArr.maskedNdcg10, 1000, 42),
        maskedTop20Share: pairedBootstrapCI(fullArr.maskedTop20Share, colArr.maskedTop20Share, 1000, 42)
      },
      zeroMeta_vs_collabOnly: {
        maskedRecall20: pairedBootstrapCI(zeroArr.maskedRecall20, colArr.maskedRecall20, 1000, 42),
        maskedNdcg10: pairedBootstrapCI(zeroArr.maskedNdcg10, colArr.maskedNdcg10, 1000, 42),
        maskedTop20Share: pairedBootstrapCI(zeroArr.maskedTop20Share, colArr.maskedTop20Share, 1000, 42)
      }
    }
  };

  console.log(`\nValid (user, seed) pairs with >=1 masked positive: ${validUserSeeds}/${totalUserSeeds}; valid users: ${nValidUsers}/${nUsers}`);
  console.log("System                      | Masked Rec@20 | Masked NDCG@10 | Top-20 Masked Share | All-Pos Rec@20 | All-Pos NDCG@10");
  console.log("-----------------------------------------------------------------------------------------------------------------------");
  for (const s of SYSTEMS) {
    const m = summary.means[s.id];
    console.log(
      `${s.label.padEnd(27)} | ${m.maskedRecall20.toFixed(6)}      | ${m.maskedNdcg10.toFixed(6)}       | ${(m.maskedTop20Share * 100).toFixed(3).padStart(7)}%            | ${m.allHoldoutRecall20.toFixed(4)}         | ${m.allHoldoutNdcg10.toFixed(4)}`
    );
  }
  console.log("-----------------------------------------------------------------------------------------------------------------------");
  const fmtS = x => `${x >= 0 ? "+" : ""}${x.toFixed(6)}`;
  console.log("\nTASK 4 PAIRED BOOTSTRAP 95% CIs (1,000 resamples, seed=42):");
  for (const [compName, cis] of Object.entries(summary.cis)) {
    for (const [metricKey, ci] of Object.entries(cis)) {
      console.log(
        `  ${compName.padEnd(22)} | ${metricKey.padEnd(17)} | ${fmtS(ci.meanDiff)} [${fmtS(ci.ciLower)}, ${fmtS(ci.ciUpper)}] | Sig: ${ci.isSignificant ? "YES" : "no"}`
      );
    }
  }

  return summary;
}

async function main() {
  const tStart = Date.now();
  const partArg = process.argv.find(a => a.startsWith("--part="))?.split("=")[1] || "all";
  const { catalog, users } = loadCatalogAndOrig328();
  const cleanBuf = fs.readFileSync(path.join(root, ".data/item_embeddings_clean_f16.bin"));
  const cleanEmb = parseEmbeddingBinary(cleanBuf.buffer.slice(cleanBuf.byteOffset, cleanBuf.byteOffset + cleanBuf.byteLength));
  const catEmb = buildCatalogSubsetIndex(cleanEmb, catalog);

  // Verify catalog subset index produces bit-for-bit identical collab & repulsion maps on User 0
  if (partArg !== "merge") {
    const s0 = getUserSplit(users[0].ratings);
    const p0 = await extractTasteProfile(s0.trainWatched, [], { now: s0.holdoutStartTs, anchorCutoff: Infinity });
    const fullC = buildCollabSimMapFromIndex(p0.weightedRatings, cleanEmb);
    const subC = buildCollabSimMapFromIndex(p0.weightedRatings, catEmb);
    const fullR = buildRepulsionMapFromIndex(p0.weightedRatings, cleanEmb);
    const subR = buildRepulsionMapFromIndex(p0.weightedRatings, catEmb);
    for (const c of catalog) {
      const tid = c.tmdbId;
      if (Math.abs((fullC.get(tid) || 0) - (subC.get(tid) || 0)) > 1e-12) throw new Error(`Subset collab mismatch tid=${tid}`);
      if (Math.abs((fullR.get(tid) || 0) - (subR.get(tid) || 0)) > 1e-12) throw new Error(`Subset repulsion mismatch tid=${tid}`);
    }
    console.log(`Loaded catalog (${catalog.length} films), ${users.length} users, cleanEmb (${cleanEmb.count}x${cleanEmb.dim}) -> catalogSubset (${catEmb.count}x${catEmb.dim}) verified identical on all ${catalog.length} items.`);
  }

  if (partArg === "task3") {
    const task3Results = await runTask3(users, catalog, catEmb);
    fs.writeFileSync(path.join(root, ".data/task3_only_results.json"), JSON.stringify({ elapsedSec: (Date.now() - tStart) / 1000, task3: task3Results }, null, 2));
    console.log(`\nSaved .data/task3_only_results.json in ${((Date.now() - tStart) / 1000).toFixed(1)}s.`);
    return;
  }

  if (partArg === "task4") {
    const task4Results = await runTask4(users, catalog, catEmb);
    fs.writeFileSync(path.join(root, ".data/task4_only_results.json"), JSON.stringify({ elapsedSec: (Date.now() - tStart) / 1000, task4: task4Results }, null, 2));
    console.log(`\nSaved .data/task4_only_results.json in ${((Date.now() - tStart) / 1000).toFixed(1)}s.`);
    return;
  }

  if (partArg === "merge") {
    const t3 = JSON.parse(fs.readFileSync(path.join(root, ".data/task3_only_results.json"), "utf8"));
    const t4 = JSON.parse(fs.readFileSync(path.join(root, ".data/task4_only_results.json"), "utf8"));
    const payload = {
      meta: {
        seedList: [42, 43, 44],
        fixedNowIso: new Date(FIXED_NOW_MS).toISOString(),
        task3ElapsedSec: t3.elapsedSec,
        task4ElapsedSec: t4.elapsedSec
      },
      task3: t3.task3,
      task4: t4.task4
    };
    fs.writeFileSync(path.join(root, ".data/task3_task4_results.json"), JSON.stringify(payload, null, 2));
    console.log("Merged .data/task3_only_results.json + .data/task4_only_results.json -> .data/task3_task4_results.json.");
    return;
  }

  const task3Results = await runTask3(users, catalog, catEmb);
  const task4Results = await runTask4(users, catalog, catEmb);

  const payload = {
    meta: {
      seedList: [42, 43, 44],
      fixedNowIso: new Date(FIXED_NOW_MS).toISOString(),
      elapsedSec: (Date.now() - tStart) / 1000
    },
    task3: task3Results,
    task4: task4Results
  };
  fs.writeFileSync(path.join(root, ".data/task3_task4_results.json"), JSON.stringify(payload, null, 2));
  console.log(`\nSaved .data/task3_task4_results.json in ${((Date.now() - tStart) / 1000).toFixed(1)}s.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
