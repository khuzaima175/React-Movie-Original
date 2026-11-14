import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "g:/Important Projects/movie-ratings";
const importSrc = rel => import(pathToFileURL(path.join(root, rel)).href);

const {
  parseEmbeddingBinary,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  computeUserPersonas
} = await importSrc("src/services/embeddingService.js");
const { computeRecallAtK, computeNDCGAtK } = await importSrc("src/services/evalHarness.js");
const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await importSrc("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await importSrc("src/services/tmdbService.js");
const { computeBayesianScore } = await importSrc("src/services/scoringUtils.js");

if (DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty !== -0.5) {
  throw new Error(`Expected Phase A DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty === -0.5, got ${DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty}`);
}

const MS_PER_DAY = 86400000;
const FIXED_NOW_MS = Date.parse("2026-11-13T00:00:00.000Z");

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
  if (!arr || arr.length === 0) return 180;
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

  const cols = new Array(11);
  for (let f = 0; f < 11; f++) cols[f] = new Float64Array(n);
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

  return { cols, hasCollab, n };
}

function scoreBatch(batch, weights = DEFAULT_RANKER_WEIGHTS, damping = 0.20) {
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
  const holdoutAllSet = new Set();
  const holdoutRelevance = new Map();
  for (const m of holdoutSlice) {
    const tid = Number(m.tmdbId);
    const key = String(tid);
    holdoutAllSet.add(tid);
    holdoutRelevance.set(key, m.userRating);
    if (m.userRating >= 8) holdoutPositives.add(key);
  }
  return { trainWatched, holdoutSlice, holdoutPositives, holdoutAllSet, holdoutRelevance, holdoutStartTs };
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

function computePriorForVault(vault, mode, importedAtMs, nowMs) {
  if (mode === "A") return 180;
  if (mode === "D") return 180 + Math.max(0, (nowMs - importedAtMs) / MS_PER_DAY);
  const datedAges = [];
  for (const m of vault) {
    if (!m.isBulkImported && m.dateWatched) {
      const ms = Date.parse(m.dateWatched);
      if (Number.isFinite(ms)) datedAges.push(Math.max(0, (nowMs - ms) / MS_PER_DAY));
    }
  }
  if (datedAges.length === 0) return 180;
  if (mode === "B") return medianOf(datedAges);
  if (mode === "C") return Math.max(...datedAges);
  throw new Error(`Unknown prior mode: ${mode}`);
}

function pickFiveMinimalCosineMovies(primaryPersona, trainIdSet, holdoutAllSet, catalog, embSubset) {
  const { dim, vectors, idToIndex } = embSubset;
  // Normalize primaryPersona cleanly
  let normSq = 0;
  for (let d = 0; d < dim; d++) normSq += primaryPersona[d] * primaryPersona[d];
  const pNorm = Math.sqrt(normSq) || 1;

  const scored = [];
  for (let idx = 0; idx < catalog.length; idx++) {
    const c = catalog[idx];
    const tid = c.tmdbId;
    if (trainIdSet.has(tid) || holdoutAllSet.has(tid)) continue;
    const eIdx = idToIndex.get(tid);
    if (eIdx === undefined) continue;
    const base = eIdx * dim;
    let dot = 0;
    let vSq = 0;
    for (let d = 0; d < dim; d++) {
      const v = vectors[base + d];
      dot += (primaryPersona[d] / pNorm) * v;
      vSq += v * v;
    }
    const cos = vSq > 1e-12 ? dot / Math.sqrt(vSq) : 0;
    scored.push({ catIdx: idx, movie: c, cos });
  }
  scored.sort((a, b) => (a.cos !== b.cos ? a.cos - b.cos : a.movie.tmdbId - b.movie.tmdbId));
  return scored.slice(0, 5);
}

// --------------------------------------------------------------------------
// PHASE B2: BLOCK-IMPORT TEST
// --------------------------------------------------------------------------
async function runB2(users, catalog, embSub) {
  console.log("\n==========================================================================");
  console.log("PHASE B2: BLOCK-IMPORT TEST (80% UNDATED + 20% DATED, 60 USERS x 3 SEEDS)");
  console.log("==========================================================================");

  const catIdStrArr = catalog.map(c => String(c.tmdbId));
  const N_cat = catalog.length;
  const sampled60 = Array.from({ length: 60 }, (_, i) => users[Math.floor((i * users.length) / 60)]);
  const SEEDS = [42, 43, 44];
  const METHODS = [
    { id: "A", label: "(A) Fixed 180d" },
    { id: "B", label: "(B) Median dated age" },
    { id: "C", label: "(C) Oldest dated age" },
    { id: "D", label: "(D) 180d + importedAt age" }
  ];

  // Precompute per-user splits and canonical primaryPersona + 5 minimal-cosine adversarial mood films
  const preUsers = [];
  let sumMinCos = 0;
  let countMinCos = 0;
  let equivVerified = false;

  for (let u = 0; u < sampled60.length; u++) {
    const user = sampled60[u];
    const split = getUserSplit(user.ratings);
    const nTrain = split.trainWatched.length;
    const cut = Math.floor(0.80 * nTrain);
    const undatedBlock = split.trainWatched.slice(0, cut);
    const datedBlock = split.trainWatched.slice(cut);

    const trainIdSet = new Set(split.trainWatched.map(m => Number(m.tmdbId)));
    const candIndicesBefore = [];
    for (let i = 0; i < N_cat; i++) {
      if (!trainIdSet.has(catalog[i].tmdbId)) candIndicesBefore.push(i);
    }

    // Compute canonical primaryPersona from natural-timestamp control vault (100% dated, newest = 7d)
    const maxTrainTs = split.trainWatched[nTrain - 1].ts;
    const ctrlVault = split.trainWatched.map(m => ({
      ...m,
      isBulkImported: false,
      dateWatched: new Date(FIXED_NOW_MS - 7 * MS_PER_DAY - (maxTrainTs - m.ts)).toISOString()
    }));
    const ctrlProfile = await extractTasteProfile(ctrlVault, [], {
      now: FIXED_NOW_MS,
      anchorCutoff: Infinity,
      bulkPriorDays: 180
    });
    const personas = computeUserPersonas(ctrlProfile.weightedRatings, embSub);
    if (!personas || personas.length === 0) {
      throw new Error(`User ${user.uid} produced no personas`);
    }
    const minCos5 = pickFiveMinimalCosineMovies(personas[0], trainIdSet, split.holdoutAllSet, catalog, embSub);
    for (const x of minCos5) {
      sumMinCos += x.cos;
      countMinCos++;
    }
    const moodIdSet = new Set(minCos5.map(x => x.movie.tmdbId));
    const candIndicesAfter = candIndicesBefore.filter(idx => !moodIdSet.has(catalog[idx].tmdbId));

    preUsers.push({
      uid: user.uid,
      ...split,
      undatedBlock,
      datedBlock,
      candIndicesBefore,
      candIndicesAfter,
      minCos5,
      moodIdSet
    });
  }
  console.log(`Sampled 60 users; selected 5 minimal-cosine unseen non-holdout films/user (mean cos = ${(sumMinCos / countMinCos).toFixed(4)}).`);

  async function evaluateVault(vault, candIndices, bulkPriorDays, checkEquiv = false) {
    const profile = await extractTasteProfile(vault, [], {
      now: FIXED_NOW_MS,
      anchorCutoff: Infinity,
      bulkPriorDays
    });
    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, embSub);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embSub);
    const context = {
      profile,
      collabSimMap,
      contentSimMap: new Map(),
      repulsionMap,
      anchorKeywords: profile.lovedKeywordIds || [],
      userProviders: []
    };
    const batch = extractFeaturesBatch(candIndices, catalog, context);
    const probs = scoreBatch(batch, DEFAULT_RANKER_WEIGHTS, 0.20);
    const top20CatIdx = selectTopKDescending(probs, candIndices, 20);
    const top20Ids = top20CatIdx.map(idx => catIdStrArr[idx]);

    if (checkEquiv) {
      const refTop20 = rankCandidatePool(candIndices.map(i => catalog[i]), context, DEFAULT_RANKER_WEIGHTS, 20, { metadataDampingFactor: 0.20 }).map(m => String(m.tmdbId));
      for (let i = 0; i < 20; i++) {
        if (refTop20[i] !== top20Ids[i]) throw new Error(`B2 rankCandidatePool parity mismatch pos=${i}: ${refTop20[i]} vs ${top20Ids[i]}`);
      }
    }

    let sumAll = 0;
    let sumUndat = 0;
    for (const item of profile.weightedRatings) {
      const aw = Math.abs(item.weight || 0);
      sumAll += aw;
      if (item.movie?.isBulkImported || !item.movie?.dateWatched) sumUndat += aw;
    }

    return {
      top20Ids,
      undatedShare: sumAll > 0 ? sumUndat / sumAll : 0
    };
  }

  const REGIMES = [
    { id: "natural_7d", label: "Regime 1: Natural 20% span (newest = 7d, importedAt = prior to oldest dated)" },
    { id: "spread_3y", label: "Regime 2: Import 3y ago (importedAt = 1095d), 20% additions spread over 3y (newest = 7d)" }
  ];

  const b2Results = {
    meta: { nUsers: 60, seeds: SEEDS, meanMinCosSim: sumMinCos / countMinCos },
    regimes: {}
  };

  for (const reg of REGIMES) {
    console.log(`\nRunning ${reg.label} ...`);
    const importedAtAges = [];
    const store = {};
    for (const m of METHODS) {
      store[m.id] = {
        ndcg: new Float64Array(60),
        recall: new Float64Array(60),
        undatedShareBefore: new Float64Array(60),
        undatedShareAfter: new Float64Array(60),
        moodOverlap10: new Float64Array(60),
        priorBefore: new Float64Array(60),
        priorAfter: new Float64Array(60)
      };
    }

    for (let u = 0; u < preUsers.length; u++) {
      const pu = preUsers[u];
      const undatedItems = pu.undatedBlock.map(m => ({ ...m, isBulkImported: true, dateWatched: undefined }));

      let importedAtMsReg1 = 0;
      let datedReg1 = null;
      if (reg.id === "natural_7d") {
        const maxDatedTs = pu.datedBlock[pu.datedBlock.length - 1].ts;
        const minDatedTs = pu.datedBlock[0].ts;
        const oldestDatedAge = 7 + (maxDatedTs - minDatedTs) / MS_PER_DAY;
        importedAtMsReg1 = FIXED_NOW_MS - oldestDatedAge * MS_PER_DAY - 1000;
        importedAtAges.push((FIXED_NOW_MS - importedAtMsReg1) / MS_PER_DAY);
        datedReg1 = pu.datedBlock.map(m => {
          const age = 7 + (maxDatedTs - m.ts) / MS_PER_DAY;
          return { ...m, isBulkImported: false, dateWatched: new Date(FIXED_NOW_MS - age * MS_PER_DAY).toISOString() };
        });
      }

      // Cache deterministic "before" results in natural_7d across seeds (vaultBefore doesn't vary by seed in reg1!)
      const reg1BeforeCache = reg.id === "natural_7d" ? {} : null;

      for (const seed of SEEDS) {
        const rng = makeRng(seed * 100003 + Number(pu.uid));
        let importedAtMs;
        let datedItems;

        if (reg.id === "natural_7d") {
          importedAtMs = importedAtMsReg1;
          datedItems = datedReg1;
        } else {
          importedAtMs = FIXED_NOW_MS - 1095 * MS_PER_DAY;
          if (seed === SEEDS[0]) importedAtAges.push(1095);
          const mDated = pu.datedBlock.length;
          // Draw mDated - 1 uniform ages in (7, 1095) sorted descending (oldest first), newest fixed at 7d
          const olderAges = Array.from({ length: Math.max(0, mDated - 1) }, () => 7 + rng() * (1095 - 7)).sort((a, b) => b - a);
          datedItems = pu.datedBlock.map((m, idx) => {
            const age = idx === mDated - 1 ? 7.0 : olderAges[idx];
            return { ...m, isBulkImported: false, dateWatched: new Date(FIXED_NOW_MS - age * MS_PER_DAY).toISOString() };
          });
        }

        const vaultBefore = [...undatedItems, ...datedItems];
        const mood5 = pu.minCos5.map(x => {
          const d = Math.floor(rng() * 7); // 0..6 days old
          return {
            ...x.movie,
            userRating: 9,
            isBulkImported: false,
            dateWatched: new Date(FIXED_NOW_MS - d * MS_PER_DAY).toISOString()
          };
        });
        const vaultAfter = [...vaultBefore, ...mood5];

        for (const m of METHODS) {
          const priorB = computePriorForVault(vaultBefore, m.id, importedAtMs, FIXED_NOW_MS);
          let resB;
          if (reg1BeforeCache && reg1BeforeCache[m.id]) {
            resB = reg1BeforeCache[m.id];
          } else {
            const doCheck = !equivVerified && u === 0 && seed === SEEDS[0] && reg.id === "natural_7d" && m.id === "D";
            resB = await evaluateVault(vaultBefore, pu.candIndicesBefore, priorB, doCheck);
            if (doCheck) {
              equivVerified = true;
              console.log("B2 strict equivalence check PASSED vs real src/ rankCandidatePool.");
            }
            if (reg1BeforeCache) reg1BeforeCache[m.id] = resB;
          }

          // Verify adversarial mood films didn't rank in top-10 before
          const top10Before = resB.top20Ids.slice(0, 10);
          for (const id of top10Before) {
            if (pu.moodIdSet.has(Number(id))) {
              throw new Error(`Adversarial minimal-cosine film appeared in before top10: ${id}`);
            }
          }

          const priorA = computePriorForVault(vaultAfter, m.id, importedAtMs, FIXED_NOW_MS);
          const resA = await evaluateVault(vaultAfter, pu.candIndicesAfter, priorA, false);
          const top10AfterSet = new Set(resA.top20Ids.slice(0, 10));

          let overlap10 = 0;
          for (const id of top10Before) {
            if (top10AfterSet.has(id)) overlap10++;
          }

          const st = store[m.id];
          st.ndcg[u] += computeNDCGAtK(resB.top20Ids, pu.holdoutRelevance, 10) / SEEDS.length;
          st.recall[u] += computeRecallAtK(resB.top20Ids, pu.holdoutPositives, 20) / SEEDS.length;
          st.undatedShareBefore[u] += resB.undatedShare / SEEDS.length;
          st.undatedShareAfter[u] += resA.undatedShare / SEEDS.length;
          st.moodOverlap10[u] += (overlap10 / 10) / SEEDS.length;
          st.priorBefore[u] += priorB / SEEDS.length;
          st.priorAfter[u] += priorA / SEEDS.length;
        }
      }
    }

    const sortedImp = [...importedAtAges].sort((a, b) => a - b);
    const impStats = {
      mean: meanAndStd(importedAtAges).mean,
      min: sortedImp[0],
      p25: sortedImp[Math.floor(sortedImp.length * 0.25)],
      median: medianOf(sortedImp),
      p75: sortedImp[Math.floor(sortedImp.length * 0.75)],
      max: sortedImp[sortedImp.length - 1]
    };
    console.log(
      `importedAt age across 60 users: mean=${impStats.mean.toFixed(2)}d, med=${impStats.median.toFixed(2)}d ` +
      `[min=${impStats.min.toFixed(2)}d, p25=${impStats.p25.toFixed(2)}d, p75=${impStats.p75.toFixed(2)}d, max=${impStats.max.toFixed(2)}d]`
    );

    const refA = store["A"];
    const regOut = { importedAtStats: impStats, methods: {} };
    console.log("Method                   | Prior(B->A) | Undat|W|(B->A) | NDCG@10 | Recall@20 | MoodTop10Ovl | dNDCG vs A [95% CI] (Sig?)     | dRec vs A [95% CI] (Sig?)      | dMoodOvl vs A [95% CI]");
    console.log("-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------");
    const fmtD = x => `${x >= 0 ? "+" : ""}${x.toFixed(4)}`;

    for (const m of METHODS) {
      const st = store[m.id];
      const means = {
        priorBefore: meanAndStd(st.priorBefore).mean,
        priorAfter: meanAndStd(st.priorAfter).mean,
        undatedShareBefore: meanAndStd(st.undatedShareBefore).mean,
        undatedShareAfter: meanAndStd(st.undatedShareAfter).mean,
        ndcg: meanAndStd(st.ndcg).mean,
        recall: meanAndStd(st.recall).mean,
        moodOverlap10: meanAndStd(st.moodOverlap10).mean
      };
      const vsA = m.id === "A" ? null : {
        ndcg: pairedBootstrapCI(st.ndcg, refA.ndcg, 1000, 42),
        recall: pairedBootstrapCI(st.recall, refA.recall, 1000, 42),
        undatedShareBefore: pairedBootstrapCI(st.undatedShareBefore, refA.undatedShareBefore, 1000, 42),
        moodOverlap10: pairedBootstrapCI(st.moodOverlap10, refA.moodOverlap10, 1000, 42)
      };
      regOut.methods[m.id] = { label: m.label, means, vsA };

      const pStr = `${means.priorBefore.toFixed(1)}->${means.priorAfter.toFixed(1)}d`;
      const uStr = `${means.undatedShareBefore.toFixed(3)}->${means.undatedShareAfter.toFixed(3)}`;
      if (!vsA) {
        console.log(
          `${m.label.padEnd(24)} | ${pStr.padEnd(11)} | ${uStr.padEnd(14)} | ${means.ndcg.toFixed(4)}  | ${means.recall.toFixed(4)}    | ${means.moodOverlap10.toFixed(4)}       | ref                            | ref                            | ref`
        );
      } else {
        const sN = `${fmtD(vsA.ndcg.meanDiff)} [${fmtD(vsA.ndcg.ciLower)},${fmtD(vsA.ndcg.ciUpper)}] ${vsA.ndcg.isSignificant ? "YES" : "no "}`;
        const sR = `${fmtD(vsA.recall.meanDiff)} [${fmtD(vsA.recall.ciLower)},${fmtD(vsA.recall.ciUpper)}] ${vsA.recall.isSignificant ? "YES" : "no "}`;
        const sM = `${fmtD(vsA.moodOverlap10.meanDiff)} [${fmtD(vsA.moodOverlap10.ciLower)},${fmtD(vsA.moodOverlap10.ciUpper)}] ${vsA.moodOverlap10.isSignificant ? "YES" : "no "}`;
        console.log(
          `${m.label.padEnd(24)} | ${pStr.padEnd(11)} | ${uStr.padEnd(14)} | ${means.ndcg.toFixed(4)}  | ${means.recall.toFixed(4)}    | ${means.moodOverlap10.toFixed(4)}       | ${sN.padEnd(30)} | ${sR.padEnd(30)} | ${sM}`
        );
      }
    }
    b2Results.regimes[reg.id] = regOut;
  }

  return b2Results;
}

// --------------------------------------------------------------------------
// PHASE B3: POOL-LEVEL COLD-START TEST
// --------------------------------------------------------------------------
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

async function runB3(users, catalog, embSub) {
  console.log("\n==========================================================================");
  console.log("PHASE B3: POOL-LEVEL COLD-START TEST (328 USERS x 3 SEEDS; 30 TOP UNMASKED + 60 MASKED)");
  console.log("==========================================================================");

  const N_cat = catalog.length;
  const maskCount = Math.round(0.30 * N_cat);
  const SEEDS = [42, 43, 44];
  const nUsers = users.length;

  const preUsers = [];
  for (const u of users) {
    const split = getUserSplit(u.ratings);
    const trainIdSet = new Set(split.trainWatched.map(m => Number(m.tmdbId)));
    const profile = await extractTasteProfile(split.trainWatched, [], {
      now: split.holdoutStartTs,
      anchorCutoff: Infinity
    });
    preUsers.push({ uid: u.uid, ...split, trainIdSet, profile });
  }

  const SYS60 = ["prodMeta", "personalMeta", "bayesianPop", "voteCountPop", "random"];
  const userStore = {};
  for (const s of SYS60) {
    userStore[s] = {
      ndcgSum: new Float64Array(nUsers),
      aucSum: new Float64Array(nUsers)
    };
  }
  const mixStore = {
    maskedInTop15Sum: new Float64Array(nUsers),
    maskedHoldPosInTop15Sum: new Float64Array(nUsers),
    maskedRecallAt15Sum: new Float64Array(nUsers),
    anyMaskedInTop15Sum: new Float64Array(nUsers),
    minMaskedRankSum: new Float64Array(nUsers),
    validSeedCount: new Int32Array(nUsers)
  };

  const personalOnlyWeights = { ...DEFAULT_RANKER_WEIGHTS, bayesianRatingNorm: 0, noveltyBonus: 0 };

  let totalPairs = 0;
  let validPairs = 0;
  let skippedZeroMaskPairs = 0;
  let totalHoldPosAcrossValid = 0;
  let historyMaskedVerified = false;

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

    if (!historyMaskedVerified) {
      // Confirm masked history items carry 0 vector in maskedEmb (both idToIndex missing AND vectors zeroed)
      let nonZeroVec = 0;
      for (const tid of maskedSet) {
        if (maskedEmb.idToIndex.has(tid)) nonZeroVec++;
      }
      if (nonZeroVec > 0) throw new Error(`Masked IDs still in idToIndex: ${nonZeroVec}`);
      historyMaskedVerified = true;
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

      // Assert masked items have strictly 0 collab/repulsion
      if (u === 0 && seed === SEEDS[0]) {
        for (const m of maskedHoldPosMovies) {
          if (collabSimMap.has(m.tmdbId) || repulsionMap.has(m.tmdbId)) {
            throw new Error(`Masked holdout positive leaked into collabSimMap or repulsionMap`);
          }
        }
      }

      // Top 30 unmasked collabSim neighbors (unseen in train)
      const unmaskedCands = [];
      for (let i = 0; i < N_cat; i++) {
        const c = catalog[i];
        if (pu.trainIdSet.has(c.tmdbId) || maskedSet.has(c.tmdbId)) continue;
        const sim = collabSimMap.get(c.tmdbId);
        if (sim !== undefined) unmaskedCands.push({ movie: c, sim });
      }
      unmaskedCands.sort((a, b) => (b.sim !== a.sim ? b.sim - a.sim : a.movie.tmdbId - b.movie.tmdbId));
      const top30Unmasked = unmaskedCands.slice(0, 30).map(x => x.movie);
      if (top30Unmasked.length < 30) {
        throw new Error(`User ${pu.uid} seed ${seed} found < 30 unmasked neighbors: ${top30Unmasked.length}`);
      }

      // Masked unseen negatives (!train, !holdoutAllSet, masked)
      const maskedUnseenNegPool = [];
      for (let i = 0; i < N_cat; i++) {
        const c = catalog[i];
        if (!maskedSet.has(c.tmdbId)) continue;
        if (pu.trainIdSet.has(c.tmdbId) || pu.holdoutAllSet.has(c.tmdbId)) continue;
        maskedUnseenNegPool.push(c);
      }
      const needNeg = 60 - maskedHoldPosMovies.length;
      if (maskedUnseenNegPool.length < needNeg) {
        throw new Error(`User ${pu.uid} seed ${seed} insufficient masked negatives: ${maskedUnseenNegPool.length} < ${needNeg}`);
      }

      const pairRng = makeRng(seed * 100003 + Number(pu.uid));
      const selectedNeg = [];
      // Partial Fisher-Yates for needNeg elements without mutating order permanently
      const negCopy = [...maskedUnseenNegPool];
      for (let k = 0; k < needNeg; k++) {
        const j = k + Math.floor(pairRng() * (negCopy.length - k));
        const tmp = negCopy[k];
        negCopy[k] = negCopy[j];
        negCopy[j] = tmp;
        selectedNeg.push(negCopy[k]);
      }

      const pool60 = [...maskedHoldPosMovies, ...selectedNeg];
      const pool60IsPos = new Uint8Array(60);
      for (let k = 0; k < maskedHoldPosMovies.length; k++) pool60IsPos[k] = 1;

      const maskedHoldSetStr = new Set(maskedHoldPosMovies.map(m => String(m.tmdbId)));
      const maskedHoldRelMap = new Map(maskedHoldPosMovies.map(m => [String(m.tmdbId), m.userRating]));

      const context = {
        profile: pu.profile,
        collabSimMap,
        contentSimMap: new Map(),
        repulsionMap,
        anchorKeywords: pu.profile.lovedKeywordIds || [],
        userProviders: []
      };

      // Subtask (1): rank the 60 masked films only with real src/ rankCandidatePool
      const rankedProd60 = rankCandidatePool(pool60, context, DEFAULT_RANKER_WEIGHTS, 60, { metadataDampingFactor: 0.20 });
      const scoreMapProd = new Map(rankedProd60.map(m => [m.tmdbId, m.rankerProbability]));
      const prodScores60 = pool60.map(m => scoreMapProd.get(m.tmdbId));
      const prodIds60 = rankedProd60.map(m => String(m.tmdbId));

      const rankedPersonal60 = rankCandidatePool(pool60, context, personalOnlyWeights, 60, { metadataDampingFactor: 0.20 });
      const scoreMapPersonal = new Map(rankedPersonal60.map(m => [m.tmdbId, m.rankerProbability]));
      const personalScores60 = pool60.map(m => scoreMapPersonal.get(m.tmdbId));
      const personalIds60 = rankedPersonal60.map(m => String(m.tmdbId));

      const bayesScores60 = pool60.map(m => computeBayesianScore(m.vote_average, m.vote_count, 500, 7.0));
      const bayesRanked60 = pool60
        .map((m, idx) => ({ tid: String(m.tmdbId), s: bayesScores60[idx] }))
        .sort((a, b) => (b.s !== a.s ? b.s - a.s : Number(a.tid) - Number(b.tid)));
      const bayesIds60 = bayesRanked60.map(x => x.tid);

      const vcScores60 = pool60.map(m => Number(m.vote_count || 0));
      const vcRanked60 = pool60
        .map((m, idx) => ({ tid: String(m.tmdbId), s: vcScores60[idx] }))
        .sort((a, b) => (b.s !== a.s ? b.s - a.s : Number(a.tid) - Number(b.tid)));
      const vcIds60 = vcRanked60.map(x => x.tid);

      const randScores60 = pool60.map(() => pairRng());
      const randRanked60 = pool60
        .map((m, idx) => ({ tid: String(m.tmdbId), s: randScores60[idx] }))
        .sort((a, b) => b.s - a.s);
      const randIds60 = randRanked60.map(x => x.tid);

      const metrics60 = {
        prodMeta: { ids: prodIds60, scores: prodScores60 },
        personalMeta: { ids: personalIds60, scores: personalScores60 },
        bayesianPop: { ids: bayesIds60, scores: bayesScores60 },
        voteCountPop: { ids: vcIds60, scores: vcScores60 },
        random: { ids: randIds60, scores: randScores60 }
      };

      for (const s of SYS60) {
        userStore[s].ndcgSum[u] += computeNDCGAtK(metrics60[s].ids, maskedHoldRelMap, 10);
        userStore[s].aucSum[u] += computeRocAuc(metrics60[s].scores, pool60IsPos);
      }

      // Subtask (2): Mixed 90-film pool = top30Unmasked + pool60, top 15 with full production ranker
      const pool90 = [...top30Unmasked, ...pool60];
      const ranked90 = rankCandidatePool(pool90, context, DEFAULT_RANKER_WEIGHTS, 90, { metadataDampingFactor: 0.20 });

      let maskedIn15 = 0;
      let maskedPosIn15 = 0;
      let minRank = 91;
      for (let r = 0; r < ranked90.length; r++) {
        const tid = Number(ranked90[r].tmdbId);
        if (maskedSet.has(tid)) {
          if (r + 1 < minRank) minRank = r + 1;
          if (r < 15) {
            maskedIn15++;
            if (maskedHoldSetStr.has(String(tid))) maskedPosIn15++;
          }
        }
      }

      mixStore.maskedInTop15Sum[u] += maskedIn15;
      mixStore.maskedHoldPosInTop15Sum[u] += maskedPosIn15;
      mixStore.maskedRecallAt15Sum[u] += maskedPosIn15 / maskedHoldPosMovies.length;
      mixStore.anyMaskedInTop15Sum[u] += maskedIn15 > 0 ? 1 : 0;
      mixStore.minMaskedRankSum[u] += minRank;
      mixStore.validSeedCount[u]++;

      totalHoldPosAcrossValid += maskedHoldPosMovies.length;
      validPairs++;
      seedValid++;
    }
    console.log(`Seed ${seed}: valid pairs=${seedValid}, skipped (0 masked pos)=${seedSkipped}`);
  }

  const validUsers = [];
  for (let u = 0; u < nUsers; u++) {
    if (mixStore.validSeedCount[u] > 0) validUsers.push(u);
  }
  const nValidUsers = validUsers.length;
  console.log(`Total valid (user, seed) pairs: ${validPairs}/${totalPairs} (skipped ${skippedZeroMaskPairs}); valid users: ${nValidUsers}/${nUsers}; mean masked holdout pos/pair: ${(totalHoldPosAcrossValid / validPairs).toFixed(3)}.`);

  // Average over valid seeds per user FIRST
  const perUser60 = {};
  const means60 = {};
  for (const s of SYS60) {
    const ndcgArr = Float64Array.from(validUsers, u => userStore[s].ndcgSum[u] / mixStore.validSeedCount[u]);
    const aucArr = Float64Array.from(validUsers, u => userStore[s].aucSum[u] / mixStore.validSeedCount[u]);
    perUser60[s] = { ndcg: ndcgArr, auc: aucArr };
    means60[s] = { ndcg10: meanAndStd(ndcgArr).mean, rocAuc: meanAndStd(aucArr).mean };
  }

  const comparisons = [
    ["prodMeta", "bayesianPop"],
    ["prodMeta", "voteCountPop"],
    ["prodMeta", "random"],
    ["personalMeta", "bayesianPop"],
    ["personalMeta", "random"],
    ["bayesianPop", "random"],
    ["voteCountPop", "random"]
  ];
  const cis60 = {};
  for (const [cand, base] of comparisons) {
    const key = `${cand}_vs_${base}`;
    cis60[key] = {
      ndcg10: pairedBootstrapCI(perUser60[cand].ndcg, perUser60[base].ndcg, 1000, 42),
      rocAuc: pairedBootstrapCI(perUser60[cand].auc, perUser60[base].auc, 1000, 42)
    };
  }

  const mixArrays = {
    maskedInTop15: Float64Array.from(validUsers, u => mixStore.maskedInTop15Sum[u] / mixStore.validSeedCount[u]),
    maskedTop15Share: Float64Array.from(validUsers, u => (mixStore.maskedInTop15Sum[u] / mixStore.validSeedCount[u]) / 15),
    maskedHoldPosInTop15: Float64Array.from(validUsers, u => mixStore.maskedHoldPosInTop15Sum[u] / mixStore.validSeedCount[u]),
    maskedRecallAt15: Float64Array.from(validUsers, u => mixStore.maskedRecallAt15Sum[u] / mixStore.validSeedCount[u]),
    anyMaskedInTop15Prob: Float64Array.from(validUsers, u => mixStore.anyMaskedInTop15Sum[u] / mixStore.validSeedCount[u]),
    minMaskedRank: Float64Array.from(validUsers, u => mixStore.minMaskedRankSum[u] / mixStore.validSeedCount[u])
  };
  const mixMeans = Object.fromEntries(Object.entries(mixArrays).map(([k, arr]) => [k, meanAndStd(arr).mean]));

  console.log("\nB3 (1) — 60 MASKED FILMS ONLY (User-averaged across valid seeds, then N=328 users):");
  console.log("System                      | NDCG@10 | ROC-AUC");
  console.log("------------------------------------------------");
  const LABELS60 = {
    prodMeta: "Prod Metadata Ranker (-0.5)",
    personalMeta: "Personal Meta Only (no bayes/nov)",
    bayesianPop: "Popularity (Bayesian Rating)",
    voteCountPop: "Popularity (TMDB vote_count)",
    random: "Random Permutation"
  };
  for (const s of SYS60) {
    console.log(`${LABELS60[s].padEnd(28)} | ${means60[s].ndcg10.toFixed(4)}  | ${means60[s].rocAuc.toFixed(4)}`);
  }

  console.log("\nB3 (1) PAIRED BOOTSTRAP 95% CIs (1,000 resamples over N=328 users, seed=42):");
  const fmtC = x => `${x >= 0 ? "+" : ""}${x.toFixed(4)}`;
  for (const [k, obj] of Object.entries(cis60)) {
    console.log(
      `  ${k.padEnd(28)} | NDCG@10: ${fmtC(obj.ndcg10.meanDiff)} [${fmtC(obj.ndcg10.ciLower)}, ${fmtC(obj.ndcg10.ciUpper)}] (${obj.ndcg10.isSignificant ? "YES" : "no"}) | ` +
      `ROC-AUC: ${fmtC(obj.rocAuc.meanDiff)} [${fmtC(obj.rocAuc.ciLower)}, ${fmtC(obj.rocAuc.ciUpper)}] (${obj.rocAuc.isSignificant ? "YES" : "no"})`
    );
  }

  console.log("\nB3 (2) — MIXED 90-FILM POOL TOP-15 (30 top unmasked collabSim + 60 masked; real rankCandidatePool):");
  console.log(`  Mean masked films in top 15 / 15       : ${mixMeans.maskedInTop15.toFixed(4)} (${(mixMeans.maskedTop15Share * 100).toFixed(2)}%)`);
  console.log(`  Mean masked held-out pos in top 15     : ${mixMeans.maskedHoldPosInTop15.toFixed(4)} (Recall@15 of masked pos = ${(mixMeans.maskedRecallAt15 * 100).toFixed(2)}%)`);
  console.log(`  Fraction of users/seeds w/ >=1 masked  : ${(mixMeans.anyMaskedInTop15Prob * 100).toFixed(2)}%`);
  console.log(`  Mean best rank of any masked film (1..90): ${mixMeans.minMaskedRank.toFixed(2)}`);

  return {
    meta: { totalPairs, validPairs, skippedZeroMaskPairs, nValidUsers, nTotalUsers: nUsers, meanMaskedHoldPosPerValidPair: totalHoldPosAcrossValid / validPairs },
    subtask1Means: means60,
    subtask1CIs: cis60,
    subtask2Mixed90Means: mixMeans
  };
}

async function main() {
  const t0 = Date.now();
  const partArg = process.argv.find(a => a.startsWith("--part="))?.split("=")[1] || "all";

  if (partArg === "merge") {
    const b2 = JSON.parse(fs.readFileSync(path.join(root, ".data/phaseB_b2_only.json"), "utf8"));
    const b3 = JSON.parse(fs.readFileSync(path.join(root, ".data/phaseB_b3_only.json"), "utf8"));
    const merged = { meta: { mergedAt: new Date().toISOString(), negKwWeight: DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty }, b2, b3 };
    fs.writeFileSync(path.join(root, ".data/phaseB_b2_b3_results.json"), JSON.stringify(merged, null, 2));
    console.log("Merged .data/phaseB_b2_only.json + .data/phaseB_b3_only.json -> .data/phaseB_b2_b3_results.json");
    return;
  }

  const { catalog, catalogByTmdb, movieIdToTmdbId } = buildCatalog();
  const origUsers = loadOrig328Users(catalogByTmdb, movieIdToTmdbId);
  const clean1Sub = buildCatalogSubsetIndex(loadEmbeddingBin(".data/item_embeddings_clean_f16.bin"), catalog);
  console.log(`Loaded catalog (${catalog.length} films), ${origUsers.length} users, subset cleanEmb (${clean1Sub.count}x${clean1Sub.dim}), negKwWeight=${DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty}`);

  if (partArg === "b2") {
    const b2 = await runB2(origUsers, catalog, clean1Sub);
    fs.writeFileSync(path.join(root, ".data/phaseB_b2_only.json"), JSON.stringify(b2, null, 2));
    console.log(`Saved .data/phaseB_b2_only.json in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return;
  }
  if (partArg === "b3") {
    const b3 = await runB3(origUsers, catalog, clean1Sub);
    fs.writeFileSync(path.join(root, ".data/phaseB_b3_only.json"), JSON.stringify(b3, null, 2));
    console.log(`Saved .data/phaseB_b3_only.json in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return;
  }

  const b2 = await runB2(origUsers, catalog, clean1Sub);
  const b3 = await runB3(origUsers, catalog, clean1Sub);
  const merged = { meta: { generatedAt: new Date().toISOString(), negKwWeight: DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty, elapsedSec: (Date.now() - t0) / 1000 }, b2, b3 };
  fs.writeFileSync(path.join(root, ".data/phaseB_b2_b3_results.json"), JSON.stringify(merged, null, 2));
  console.log(`\nSaved .data/phaseB_b2_b3_results.json in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
