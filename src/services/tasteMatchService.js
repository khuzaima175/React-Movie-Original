import {
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  getCollabCatalogMax,
  l2NormalizeInPlace
} from "./embeddingService.js";
import {
  buildEaseSimMapFromIndex,
  blendEaseAndCollabSimMaps
} from "./easeService.js";
import { computeZScoredWeights } from "./scoringUtils.js";
import { compileActiveTasteRules, candidateMatchesAvoidRule, candidateMatchesPreferRule } from "./tasteRulesService.js";
import { extractTmdbNumericId, isSameMovie } from "./movieIdentity.js";

export const TASTE_MATCH_MIN_RATED = 3;

const GENRE_NAME_ALIASES = {
  "sci-fi": "science fiction",
  "scifi": "science fiction",
  "sci fi": "science fiction"
};

function canonicalGenreName(name) {
  const lower = String(name || "").trim().toLowerCase();
  return GENRE_NAME_ALIASES[lower] || lower;
}

function normalizeNameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseGenreNames(movie) {
  const raw = movie?.genre || movie?.Genre || "";
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(/[,•/|]+/)
      .map((g) => g.trim())
      .filter((g) => g && g.toLowerCase() !== "n/a");
  }
  return [];
}

function parseGenreIds(movie) {
  const arr = Array.isArray(movie?.tmdbGenreIds)
    ? movie.tmdbGenreIds
    : Array.isArray(movie?.genre_ids)
      ? movie.genre_ids
      : [];
  return arr.map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

function parseDirectorNames(movie) {
  if (Array.isArray(movie?.directorDetails) && movie.directorDetails.length > 0) {
    return movie.directorDetails.map((d) => String(d?.name || "").trim()).filter(Boolean);
  }
  const raw = String(movie?.director || movie?.Director || "").trim();
  if (!raw || raw.toLowerCase() === "n/a" || raw.toLowerCase() === "unknown") return [];
  return raw.split(/[,&]+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Calibrates a [50, 99] match percentage onto the user's own rating mean/spread
 * so predicted scores reflect whether the user is a generous or strict rater.
 */
export function calibratePredictedRating({ matchPct, watched = [] } = {}) {
  const pct = Number(matchPct);
  if (!Number.isFinite(pct)) return null;

  const ratings = (Array.isArray(watched) ? watched : [])
    .map((m) => Number(m?.userRating ?? m?.UserRating ?? 0))
    .filter((r) => Number.isFinite(r) && r > 0);

  const mean = ratings.length > 0
    ? ratings.reduce((acc, r) => acc + r, 0) / ratings.length
    : 7.4;

  let std = 1.25;
  if (ratings.length >= 3) {
    const variance = ratings.reduce((acc, r) => acc + (r - mean) ** 2, 0) / ratings.length;
    std = Math.max(0.75, Math.min(2.1, Math.sqrt(variance)));
  }

  // Map matchPct in [50..99] -> z in [-1.5..+1.85]
  const normalized = (Math.max(50, Math.min(99, pct)) - 74) / 14.5;
  const rawEstimate = mean + normalized * std;
  const clamped = Math.max(4.5, Math.min(9.9, rawEstimate));
  return Math.round(clamped * 10) / 10;
}

function buildUserContentVector(weightedRatings = [], contentIndex = null) {
  if (!contentIndex?.count || !contentIndex?.dim || !contentIndex?.vectors || !contentIndex?.idToIndex) {
    return null;
  }
  const { dim, vectors, idToIndex } = contentIndex;
  const accum = new Float32Array(dim);
  let matchedCount = 0;

  for (const item of weightedRatings) {
    const rating = Number(item?.rating ?? 0);
    if (!Number.isFinite(rating) || rating < 7) continue;
    const tmdbId = Number(item?.tmdbId ?? item?.movie?.tmdbId ?? item?.movie?.id ?? 0);
    if (!tmdbId) continue;
    const idx = idToIndex.get(tmdbId);
    if (idx === undefined) continue;

    const w = Math.max(0.25, Math.min(2.0, Number(item?.weight) || 1));
    const base = idx * dim;
    for (let d = 0; d < dim; d += 1) {
      accum[d] += w * vectors[base + d];
    }
    matchedCount += 1;
  }

  if (matchedCount === 0) return null;
  const norm = l2NormalizeInPlace(accum, 0, dim);
  return norm > 1e-12 ? accum : null;
}

/**
 * Builds a reusable per-vault taste match context so scoring 1 detail page or
 * 50+ search/catalog cards runs in <2ms on-device at $0.00 API cost.
 * Supports 3-tier on-device inference: EASE^R + 64-D SVD blend for warm catalog films,
 * 128-D MiniLM content embeddings for 2024-2026 cold-start films, and metadata DNA fallback.
 */
export function buildTasteMatchContext({
  watched = [],
  watchlist = [],
  tasteRules = [],
  embeddingIndex = null,
  easeIndex = null,
  contentIndex = null,
  now = Date.now()
} = {}) {
  const ratedWatched = (Array.isArray(watched) ? watched : []).filter(
    (m) => m && Number(m.userRating ?? m.UserRating ?? 0) > 0
  );

  if (ratedWatched.length < TASTE_MATCH_MIN_RATED) {
    return {
      ready: false,
      ratedCount: ratedWatched.length,
      watched: ratedWatched
    };
  }

  const normalizedEntries = computeZScoredWeights(ratedWatched, { now });
  const weightedRatings = normalizedEntries.map((entry) => ({
    movie: entry.movie,
    weight: entry.weight,
    finalWeight: entry.weight,
    zScore: entry.zScore,
    rating: entry.rating,
    tmdbId: Number(entry.movie?.tmdbId || 0) || null
  }));

  const svdSimMap = embeddingIndex
    ? buildCollabSimMapFromIndex(weightedRatings, embeddingIndex)
    : null;
  const easeSimMap = easeIndex
    ? buildEaseSimMapFromIndex(weightedRatings, easeIndex, { watchlistItems: watchlist })
    : null;
  const hasEaseBlend = Boolean(easeSimMap && easeSimMap.size > 0);
  const collabSimMap = hasEaseBlend
    ? blendEaseAndCollabSimMaps(easeSimMap, svdSimMap, easeIndex)
    : svdSimMap;
  const repulsionMap = embeddingIndex
    ? buildRepulsionMapFromIndex(weightedRatings, embeddingIndex)
    : null;
  const collabCatalogMax = collabSimMap ? getCollabCatalogMax(collabSimMap) : null;
  const userContentVec = buildUserContentVector(weightedRatings, contentIndex);

  // Build lightweight genre & director affinity tables from rated entries
  const genreScoreById = new Map();
  const genreScoreByName = new Map();
  const directorAffinity = new Map();
  const directorDisplay = new Map();
  const topAnchors = [];

  for (const item of weightedRatings) {
    const signal = Number(item.zScore || 0) * Math.max(0.25, Math.min(1.5, Math.abs(item.weight || 1)));
    const rating = Number(item.rating || 0);
    if (rating >= 8) {
      topAnchors.push(item);
    }

    for (const gid of parseGenreIds(item.movie)) {
      genreScoreById.set(gid, (genreScoreById.get(gid) || 0) + signal);
    }
    for (const gname of parseGenreNames(item.movie)) {
      const key = canonicalGenreName(gname);
      if (!key) continue;
      genreScoreByName.set(key, (genreScoreByName.get(key) || 0) + signal);
    }
    for (const dir of parseDirectorNames(item.movie)) {
      const key = normalizeNameKey(dir);
      if (!key) continue;
      directorAffinity.set(key, (directorAffinity.get(key) || 0) + signal);
      if (!directorDisplay.has(key)) directorDisplay.set(key, dir);
    }
  }

  topAnchors.sort((a, b) => (b.rating - a.rating) || (b.weight - a.weight));

  return {
    ready: true,
    ratedCount: ratedWatched.length,
    watched: ratedWatched,
    watchlist: Array.isArray(watchlist) ? watchlist : [],
    embeddingIndex,
    easeIndex,
    contentIndex,
    userContentVec,
    hasEaseBlend,
    collabSimMap,
    repulsionMap,
    collabCatalogMax,
    genreScoreById,
    genreScoreByName,
    directorAffinity,
    directorDisplay,
    topAnchors: topAnchors.slice(0, 12),
    compiledRules: compileActiveTasteRules(tasteRules)
  };
}

function resolveMovieTmdbId(movie) {
  if (!movie || typeof movie !== "object") return 0;
  return (
    extractTmdbNumericId(movie.tmdbId) ||
    extractTmdbNumericId(movie.id) ||
    extractTmdbNumericId(movie.imdbID) ||
    0
  );
}

function findClosestAnchorsInIndex(movie, tmdbId, index, topAnchors = [], minSim = 0.25) {
  if (!index?.idToIndex?.has(tmdbId) || !index.vectors || !index.dim) return [];
  const candIdx = index.idToIndex.get(tmdbId);
  const dim = index.dim;
  const candBase = candIdx * dim;
  let candNormSq = 0;
  for (let d = 0; d < dim; d += 1) {
    const v = index.vectors[candBase + d];
    candNormSq += v * v;
  }
  const candNorm = Math.sqrt(candNormSq) || 1;

  const scoredAnchors = [];
  for (const anchor of topAnchors || []) {
    if (isSameMovie(anchor.movie, movie)) continue;
    const aid = resolveMovieTmdbId(anchor.movie);
    if (!aid || aid === tmdbId || !index.idToIndex.has(aid)) continue;
    const aIdx = index.idToIndex.get(aid);
    const aBase = aIdx * dim;
    let dot = 0;
    let aNormSq = 0;
    for (let d = 0; d < dim; d += 1) {
      const av = index.vectors[aBase + d];
      dot += av * index.vectors[candBase + d];
      aNormSq += av * av;
    }
    const sim = dot / (candNorm * (Math.sqrt(aNormSq) || 1));
    if (sim > minSim) {
      scoredAnchors.push({ title: anchor.movie.title || anchor.movie.Title, sim });
    }
  }
  scoredAnchors.sort((a, b) => b.sim - a.sim);
  return scoredAnchors
    .slice(0, 2)
    .map((a) => a.title)
    .filter(Boolean);
}

function findClosestAnchors(movie, ctx) {
  const tmdbId = resolveMovieTmdbId(movie);

  // 1. SVD collaborative cosine proximity against user's top loved anchors
  const svdAnchors = findClosestAnchorsInIndex(movie, tmdbId, ctx.embeddingIndex, ctx.topAnchors, 0.25);
  if (svdAnchors.length > 0) return svdAnchors;

  // 2. Cold-start 128-D semantic cosine proximity (for 2024-2026 films absent from 64-D SVD)
  const contentAnchors = findClosestAnchorsInIndex(movie, tmdbId, ctx.contentIndex, ctx.topAnchors, 0.34);
  if (contentAnchors.length > 0) return contentAnchors;

  // 3. Fallback: same director or overlapping genres from topAnchors
  const anchors = [];
  const movieDirs = new Set(parseDirectorNames(movie).map(normalizeNameKey));
  const movieGenres = new Set(parseGenreNames(movie).map(canonicalGenreName));
  for (const anchor of ctx.topAnchors || []) {
    if (isSameMovie(anchor.movie, movie)) continue;
    const title = anchor.movie?.title || anchor.movie?.Title;
    if (!title || anchors.includes(title)) continue;
    const aDirs = parseDirectorNames(anchor.movie).map(normalizeNameKey);
    const aGenres = parseGenreNames(anchor.movie).map(canonicalGenreName);
    if (aDirs.some((d) => movieDirs.has(d)) || aGenres.some((g) => movieGenres.has(g))) {
      anchors.push(title);
    }
    if (anchors.length >= 2) break;
  }

  return anchors;
}

/**
 * Predicts personal Match % and calibrated Est. Rating for any film on-device ($0.00).
 * Uses CVEM v1 collaborative similarity + repulsion when indexed, and falls back smoothly
 * to genre, filmmaker, acclaim, and Taste Rules affinity for unindexed 2024-2026 films.
 */
export function predictMovieMatch({
  movie = null,
  watched = [],
  watchlist = [],
  tasteRules = [],
  embeddingIndex = null,
  cachedContext = null,
  now = Date.now()
} = {}) {
  if (!movie || typeof movie !== "object") {
    return {
      available: false,
      matchPct: null,
      predictedRating: null,
      confidence: "insufficient",
      summary: "",
      anchorTitles: [],
      signals: []
    };
  }

  const ctx =
    cachedContext ||
    buildTasteMatchContext({ watched, watchlist, tasteRules, embeddingIndex, now });

  if (!ctx?.ready) {
    return {
      available: false,
      matchPct: null,
      predictedRating: null,
      confidence: "insufficient",
      summary: `Rate at least ${TASTE_MATCH_MIN_RATED} films to unlock personal predictions`,
      anchorTitles: [],
      signals: []
    };
  }

  const tmdbId = resolveMovieTmdbId(movie);
  const hasCollabEntry = Boolean(tmdbId && ctx.collabSimMap && ctx.collabSimMap.has(tmdbId));
  const rawCollab = hasCollabEntry ? Number(ctx.collabSimMap.get(tmdbId) || 0) : 0;
  const catalogMax = Number(ctx.collabCatalogMax) || 0.35;
  const normCollab = hasCollabEntry
    ? Math.max(-1, Math.min(1, rawCollab / Math.max(0.08, catalogMax)))
    : 0;
  const repulsion = tmdbId && ctx.repulsionMap ? Number(ctx.repulsionMap.get(tmdbId) || 0) : 0;

  // Genre affinity score in [-1, 1] (ID-first with canonical name fallback for OMDb/CSV vaults)
  const gIds = parseGenreIds(movie);
  const gNames = parseGenreNames(movie);
  let genreSum = 0;
  let genreHits = 0;
  const matchedGenreLabels = [];

  for (const gid of gIds) {
    if (ctx.genreScoreById.has(gid)) {
      genreSum += ctx.genreScoreById.get(gid);
      genreHits += 1;
    }
  }
  const useNameScores = genreHits === 0;
  for (const gname of gNames) {
    const key = canonicalGenreName(gname);
    if (ctx.genreScoreByName.has(key)) {
      const val = ctx.genreScoreByName.get(key);
      if (useNameScores) {
        genreSum += val;
        genreHits += 1;
      }
      if (val > 0.35) matchedGenreLabels.push(gname);
    }
  }
  const genreAffinity = genreHits > 0 ? Math.tanh(genreSum / (genreHits * 2.2)) : 0;

  // Director affinity score in [-1, 1]
  let directorScore = 0;
  let matchedDirector = "";
  for (const dir of parseDirectorNames(movie)) {
    const key = normalizeNameKey(dir);
    if (ctx.directorAffinity.has(key)) {
      const val = ctx.directorAffinity.get(key);
      if (Math.abs(val) > Math.abs(directorScore)) {
        directorScore = val;
        if (val > 0.3) matchedDirector = ctx.directorDisplay.get(key) || dir;
      }
    }
  }
  const normDirector = Math.tanh(directorScore / 1.8);

  // Bayesian acclaim baseline
  const rawVote = Number(movie.imdbRating ?? movie.vote_average ?? 0);
  const voteCount = Number(movie.vote_count ?? 0);
  const acclaimSignal =
    Number.isFinite(rawVote) && rawVote > 0
      ? Math.max(-0.5, Math.min(0.8, (rawVote - 6.8) / 2.2)) * (voteCount >= 50 || movie.imdbRating ? 1 : 0.6)
      : 0;

  // Taste Rules alignment (properly checks .matched on avoidRules / preferRules arrays)
  let ruleShift = 0;
  if (ctx.compiledRules?.activeRules?.length > 0) {
    if (candidateMatchesAvoidRule(movie, ctx.compiledRules.avoidRules).matched) ruleShift -= 1.4;
    else if (candidateMatchesPreferRule(movie, ctx.compiledRules.preferRules).matched) ruleShift += 0.55;
  }

  let hasContentEntry = false;
  let normContent = 0;
  if (!hasCollabEntry && tmdbId && ctx.userContentVec && ctx.contentIndex?.idToIndex?.has(tmdbId)) {
    const cIdx = ctx.contentIndex.idToIndex.get(tmdbId);
    const dim = ctx.contentIndex.dim;
    const base = cIdx * dim;
    let dot = 0;
    let candNormSq = 0;
    for (let d = 0; d < dim; d += 1) {
      const cv = ctx.contentIndex.vectors[base + d];
      dot += ctx.userContentVec[d] * cv;
      candNormSq += cv * cv;
    }
    if (candNormSq > 1e-12) {
      const rawContentSim = dot / Math.sqrt(candNormSq);
      hasContentEntry = true;
      normContent = Math.max(-1, Math.min(1, (rawContentSim - 0.28) / 0.3));
    }
  }

  let logit = 0;
  let confidence = "metadata";
  if (hasCollabEntry) {
    confidence = Math.abs(rawCollab) > 0.08 ? "high" : "medium";
    logit =
      0.25 +
      normCollab * 2.35 -
      Math.max(0, repulsion) * 1.9 +
      genreAffinity * 0.65 +
      normDirector * 0.75 +
      acclaimSignal * 0.55 +
      ruleShift;
  } else if (hasContentEntry) {
    confidence = "semantic";
    logit =
      0.15 +
      normContent * 1.95 +
      genreAffinity * 0.85 +
      normDirector * 0.95 +
      acclaimSignal * 0.65 +
      ruleShift;
  } else {
    confidence = "metadata";
    logit =
      0.1 +
      genreAffinity * 1.35 +
      normDirector * 1.45 +
      acclaimSignal * 0.9 +
      ruleShift;
  }

  const prob = 1 / (1 + Math.exp(-logit));
  const matchPct = Math.max(50, Math.min(99, Math.round(50 + prob * 49)));
  const predictedRating = calibratePredictedRating({ matchPct, watched: ctx.watched });
  const anchorTitles = findClosestAnchors(movie, ctx);

  const signals = [];
  if (matchedDirector) signals.push(matchedDirector);
  if (matchedGenreLabels.length > 0) signals.push(matchedGenreLabels.slice(0, 2).join(" · "));
  if ((confidence === "high" || confidence === "semantic") && anchorTitles.length > 0) {
    signals.push(`Near ${anchorTitles.join(" & ")}`);
  }

  let summary = "";
  if (anchorTitles.length > 0 && (hasCollabEntry || hasContentEntry)) {
    summary = `Close to ${anchorTitles.join(" & ")}${matchedDirector ? ` · ${matchedDirector}` : ""}`;
  } else if (matchedDirector && matchedGenreLabels.length > 0) {
    summary = `Matches ${matchedDirector} & ${matchedGenreLabels[0]} DNA`;
  } else if (matchedDirector) {
    summary = `Director fit: ${matchedDirector}`;
  } else if (matchedGenreLabels.length > 0) {
    summary = `Estimated from ${matchedGenreLabels.slice(0, 2).join(" & ")} taste DNA`;
  } else if (hasCollabEntry) {
    summary = ctx.hasEaseBlend
      ? "Based on your EASE + 64-D taste profile"
      : "Based on your 64-D taste profile";
  } else if (hasContentEntry) {
    summary = "Based on 128-D semantic taste DNA";
  } else {
    summary = "Estimated from genre & acclaim DNA";
  }

  return {
    available: true,
    matchPct,
    predictedRating,
    confidence,
    summary,
    anchorTitles,
    signals
  };
}
