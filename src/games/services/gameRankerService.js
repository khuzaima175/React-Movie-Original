/**
 * Client-Side Local ML Game Recommendation & Ranking Engine.
 * Powers GameVault using:
 *   - game_ease_k80.cvea (14,656 x K=80 exact EASE^R graph)
 *   - game_embeddings_f16.bin (14,656 x 64-D Spectral EASE-64)
 *   - game_content_f16.bin (24,439 x 128-D Tag-Dropout BGE-large cold-start vectors)
 *   - game_tuner_axes.json (popularity-decorrelated Intensity & Tone 128-D axes)
 */

import { buildEaseSimMapFromIndex, blendEaseAndCollabSimMaps } from "../../services/easeService.js";
import {
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  getCollabCatalogMax
} from "../../services/embeddingService.js";
import { buildContentSimMap, retrieveColdContentNeighbors } from "../../services/contentSimService.js";
import { computeDisplayMatchScore } from "../../services/rankerService.js";

export const DEFAULT_GAME_TUNER_STATE = Object.freeze({
  era: 0,
  familiarity: 0,
  pacing: 0,
  tone: 0,
  antiBubble: false
});

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Converts a player's logged games (1-10 rating + hoursPlayed + status) into weighted preference entries
 * compatible with CinemaVault's EASE^R, Spectral-EASE, and 128-D Content engines.
 */
export function buildWeightedGameRatings(played = []) {
  if (!Array.isArray(played) || played.length === 0) return [];
  const validRatings = played
    .map((g) => Number(g?.userRating ?? 0))
    .filter((r) => Number.isFinite(r) && r > 0);
  const meanR = validRatings.length >= 2
    ? validRatings.reduce((a, b) => a + b, 0) / validRatings.length
    : 7.5;
  const varR = validRatings.length >= 2
    ? validRatings.reduce((s, r) => s + (r - meanR) ** 2, 0) / validRatings.length
    : 2.25;
  const stdR = Math.max(0.8, Math.sqrt(varR));

  const out = [];
  for (const g of played) {
    const igdbId = Number(g?.igdbId ?? g?.id ?? 0);
    if (!Number.isInteger(igdbId) || igdbId <= 0) continue;

    const rating = Number(g?.userRating ?? 0);
    const hours = Math.max(0, Number(g?.hoursPlayed ?? 0) || 0);
    const status = String(g?.status || "completed").toLowerCase();

    // Playtime multiplier: log-damped engagement boost [0.85 .. 1.25]
    const playBoost = hours > 0 ? clamp(0.88 + 0.12 * Math.log10(1 + hours), 0.85, 1.25) : 1.0;

    let weight = 0;
    if (Number.isFinite(rating) && rating > 0) {
      if (rating >= 7) {
        const z = Math.max(0, (rating - Math.min(meanR, 7.5)) / stdR);
        weight = (0.75 + 0.25 * (rating - 6) + 0.35 * z) * playBoost;
      } else if (rating >= 6) {
        weight = 0.28 * playBoost;
      } else if (rating <= 4) {
        // Salty high-hour negative review guard: don't strongly repulse a 100h love-hate game
        weight = hours >= 60 ? -0.15 : -0.75 * (1 + (4 - rating) * 0.2);
      } else {
        weight = -0.15;
      }
    } else if (status === "completed" || status === "playing") {
      weight = 0.9 * playBoost;
    } else if (status === "dropped") {
      weight = hours >= 50 ? 0.0 : -0.45;
    }

    if (status === "completed" && weight > 0) weight *= 1.08;
    if (Math.abs(weight) < 1e-6) continue;

    out.push({
      tmdbId: igdbId, // shared key consumed by easeService/embeddingService/contentSimService
      igdbId,
      rating: Number.isFinite(rating) && rating > 0 ? rating : (weight > 0 ? 8 : 4),
      weight,
      game: g
    });
  }
  return out;
}

/**
 * Extracts studio, genre, and theme affinity profiles from positively rated games.
 */
export function extractGameTasteProfile(played = []) {
  const genreCounts = new Map();
  const themeCounts = new Map();
  const devCounts = new Map();

  for (const g of Array.isArray(played) ? played : []) {
    const r = Number(g?.userRating ?? 0);
    if (r > 0 && r < 7) continue;
    if (String(g?.status || "").toLowerCase() === "dropped" && r === 0) continue;
    const w = r >= 9 ? 1.5 : 1.0;

    for (const genre of g?.genres || []) {
      const k = String(genre).trim();
      if (k) genreCounts.set(k, (genreCounts.get(k) || 0) + w);
    }
    for (const theme of g?.themes || []) {
      const k = String(theme).trim();
      if (k) themeCounts.set(k, (themeCounts.get(k) || 0) + w);
    }
    for (const dev of g?.developers || []) {
      const k = String(dev).trim();
      if (k) devCounts.set(k, (devCounts.get(k) || 0) + w);
    }
  }

  const topKeys = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return {
    topGenres: topKeys(genreCounts, 6),
    topThemes: topKeys(themeCounts, 6),
    topDevelopers: topKeys(devCounts, 5),
    genreSet: new Set(topKeys(genreCounts, 6).map((x) => x.toLowerCase())),
    themeSet: new Set(topKeys(themeCounts, 6).map((x) => x.toLowerCase())),
    devSet: new Set(topKeys(devCounts, 5).map((x) => x.toLowerCase()))
  };
}

/**
 * Computes full-catalog similarity maps once across all 24,439 games in < 45 ms.
 */
export function computeGameSimilarityMaps(played = [], backlog = [], models = {}) {
  const { easeIndex = null, collabIndex = null, contentIndex = null, weights = null } = models || {};
  const weighted = buildWeightedGameRatings(played);
  const backlogEntries = (Array.isArray(backlog) ? backlog : [])
    .map((g) => ({ tmdbId: Number(g?.igdbId ?? g?.id ?? 0), updatedAt: g?.updatedAt || g?.dateAdded || 0 }))
    .filter((x) => x.tmdbId > 0);

  const easeWeight = Number(weights?.blend?.ease) > 0 && Number(weights?.blend?.collab) >= 0
    ? clamp(Number(weights.blend.ease) / Math.max(1e-6, Number(weights.blend.ease) + Number(weights.blend.collab)), 0.55, 0.85)
    : 0.72;

  const easeSimMap = buildEaseSimMapFromIndex(weighted, easeIndex, {
    watchlistItems: backlogEntries,
    watchlistWeight: 0.25,
    negWeight: Number(weights?.ease_neg_weight ?? -0.35)
  });
  const spectralSimMap = buildCollabSimMapFromIndex(weighted, collabIndex);
  const collabSimMap = blendEaseAndCollabSimMaps(easeSimMap, spectralSimMap, easeIndex, { easeWeight });
  const repulsionMap = buildRepulsionMapFromIndex(weighted, collabIndex);
  const contentSimMap = buildContentSimMap(weighted, contentIndex, [], {
    coldOnly: false,
    minPositiveRating: 7
  });
  const catalogMax = getCollabCatalogMax(collabSimMap);

  return {
    weighted,
    easeSimMap,
    spectralSimMap,
    collabSimMap,
    repulsionMap,
    contentSimMap,
    catalogMax: catalogMax !== null ? Math.max(0.05, catalogMax) : null
  };
}

/**
 * Retrieves interleaved top unseen IGDB IDs from BOTH warm collaborative space (EASE^R + Spectral-EASE)
 * and cold-start 128-D BGE-large space (PS/Nintendo exclusives & 2024-2026 hits).
 */
export function buildGameRecommendationIds(
  played = [],
  backlog = [],
  models = {},
  { warmLimit = 48, coldLimit = 18, excludeBacklog = false } = {}
) {
  const excludeIds = new Set();
  for (const g of played || []) {
    const id = Number(g?.igdbId ?? g?.id ?? 0);
    if (id > 0) excludeIds.add(id);
  }
  if (excludeBacklog) {
    for (const g of backlog || []) {
      const id = Number(g?.igdbId ?? g?.id ?? 0);
      if (id > 0) excludeIds.add(id);
    }
  }

  const maps = computeGameSimilarityMaps(played, backlog, models);
  const warmScored = [];
  for (const [id, rawSim] of maps.collabSimMap.entries()) {
    if (excludeIds.has(id)) continue;
    const normSim = rawSim > 0 && maps.catalogMax ? Math.min(1, rawSim / maps.catalogMax) : rawSim;
    const rep = maps.repulsionMap.get(id) || 0;
    const cnt = maps.contentSimMap.get(id) || 0;
    const score = normSim + 0.18 * Math.max(0, cnt) - 0.25 * rep;
    warmScored.push({ id, score });
  }
  warmScored.sort((a, b) => b.score - a.score);
  const warmIds = warmScored.slice(0, warmLimit).map((x) => x.id);

  const coldNeighbors = retrieveColdContentNeighbors(maps.weighted, models?.contentIndex || null, excludeIds, {
    collabIndex: models?.collabIndex || null,
    collabSimMap: maps.collabSimMap,
    repulsionMap: maps.repulsionMap,
    topK: coldLimit
  });
  const coldIds = coldNeighbors.map((c) => c.tmdbId);

  // Interleave 3 warm : 1 cold so console exclusives & 2024-2026 hits surface naturally
  const allIds = [];
  const seen = new Set();
  let wi = 0;
  let ci = 0;
  while (wi < warmIds.length || ci < coldIds.length) {
    for (let k = 0; k < 3 && wi < warmIds.length; k++) {
      const id = warmIds[wi++];
      if (!seen.has(id)) {
        seen.add(id);
        allIds.push(id);
      }
    }
    if (ci < coldIds.length) {
      const id = coldIds[ci++];
      if (!seen.has(id)) {
        seen.add(id);
        allIds.push(id);
      }
    }
  }

  return { warmIds, coldIds, allIds, maps };
}

/**
 * Ranks hydrated IGDB game candidates using our local ML models + metadata overlap,
 * locking calibrated `50-99%` matchScore and up to 3 deterministic `matchReasons`.
 */
export function rankGameCandidates(candidates = [], played = [], backlog = [], models = {}, precomputedMaps = null) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const maps = precomputedMaps || computeGameSimilarityMaps(played, backlog, models);
  const profile = extractGameTasteProfile(played);

  const scored = candidates.map((game) => {
    const id = Number(game?.igdbId ?? game?.id ?? 0);
    const hasCollab = Boolean(models?.collabIndex?.idToIndex?.has(id) || maps.collabSimMap.has(id));
    const rawCollab = maps.collabSimMap.get(id) ?? 0;
    const collabNorm = rawCollab > 0 && maps.catalogMax
      ? clamp(rawCollab / maps.catalogMax, 0, 1)
      : clamp(rawCollab, -0.5, 1);

    const rawContent = maps.contentSimMap.get(id) ?? 0;
    const contentNorm = clamp(rawContent, -0.5, 1);
    const repulsion = maps.repulsionMap.get(id) ?? 0;

    const genres = Array.isArray(game?.genres) ? game.genres : [];
    const themes = Array.isArray(game?.themes) ? game.themes : [];
    const devs = Array.isArray(game?.developers) ? game.developers : [];

    const matchedGenres = genres.filter((g) => profile.genreSet.has(String(g).toLowerCase()));
    const matchedThemes = themes.filter((t) => profile.themeSet.has(String(t).toLowerCase()));
    const matchedDev = devs.find((d) => profile.devSet.has(String(d).toLowerCase())) || "";

    const genreOverlap = genres.length > 0 ? matchedGenres.length / Math.min(3, genres.length) : 0;
    const themeOverlap = themes.length > 0 ? matchedThemes.length / Math.min(3, themes.length) : 0;
    const devMatch = matchedDev ? 1 : 0;

    // Bayesian acclaim in [0, 1]
    const r10 = Number(game?.rating10 ?? 0);
    const votes = Math.max(0, Number(game?.ratingCount ?? 0));
    const bayes = r10 > 0 ? (votes * r10 + 40 * 7.2) / (votes + 40) : 7.2;
    const acclaimNorm = clamp((bayes - 5.5) / 4.0, 0, 1);

    // Calibrated logit combining warm collaborative + cold-start BGE-large alignment
    let logit;
    if (hasCollab && collabNorm > 0.02) {
      logit =
        -1.05 +
        3.8 * collabNorm +
        1.1 * Math.max(0, contentNorm) +
        0.55 * genreOverlap +
        0.4 * themeOverlap +
        0.65 * devMatch +
        1.0 * acclaimNorm -
        1.45 * repulsion;
    } else {
      // Cold-start (console exclusives & 2024-2026 releases): calibrate 0.72 cosine -> 1.0 parity with catalog-max collab
      const coldContentCal = clamp(Math.max(0, contentNorm) / 0.72, 0, 1);
      logit =
        -1.05 +
        4.45 * coldContentCal +
        0.75 * genreOverlap +
        0.55 * themeOverlap +
        0.75 * devMatch +
        1.05 * acclaimNorm -
        1.2 * repulsion;
    }

    const matchScore = computeDisplayMatchScore(logit);
    const matchReasons = [];
    if (hasCollab && collabNorm >= 0.45) {
      matchReasons.push("Strong Taste Match");
    } else if (!hasCollab && contentNorm >= 0.42) {
      if ((game?.year || 0) >= 2024) {
        matchReasons.push("2024–2026 Cold-Start Match");
      } else if (game?.isExclusive) {
        matchReasons.push("Console Exclusive Match");
      } else {
        matchReasons.push("Semantic Taste Match");
      }
    }
    if (matchedDev) {
      matchReasons.push(`Studio: ${matchedDev}`);
    }
    if (matchedGenres.length > 0 && matchReasons.length < 3) {
      matchReasons.push(matchedGenres.slice(0, 2).join(" · "));
    } else if (matchedThemes.length > 0 && matchReasons.length < 3) {
      matchReasons.push(matchedThemes.slice(0, 2).join(" · "));
    }
    if (r10 >= 8.5 && votes >= 150 && matchReasons.length < 3) {
      matchReasons.push("Critically Acclaimed");
    }
    if (matchReasons.length === 0) {
      matchReasons.push(hasCollab ? "Collaborative Pick" : "Catalog Discovery");
    }

    return {
      ...game,
      matchScore,
      rankerLogit: Number(logit.toFixed(4)),
      collabSim: Number(collabNorm.toFixed(4)),
      contentSim: Number(contentNorm.toFixed(4)),
      isColdStart: !hasCollab,
      matchReasons: matchReasons.slice(0, 3)
    };
  });

  scored.sort((a, b) => b.rankerLogit - a.rankerLogit || (b.ratingCount || 0) - (a.ratingCount || 0));
  return scored;
}

function projectGameAxis(igdbId, contentIndex, axisVec) {
  if (!contentIndex || !Array.isArray(axisVec) || !contentIndex.idToIndex) return null;
  const idx = contentIndex.idToIndex.get(Number(igdbId));
  if (idx === undefined) return null;
  const dim = contentIndex.dim;
  if (!dim || axisVec.length !== dim) return null;
  const base = idx * dim;
  let dot = 0;
  let normSq = 0;
  for (let d = 0; d < dim; d++) {
    const v = contentIndex.vectors[base + d];
    dot += v * axisVec[d];
    normSq += v * v;
  }
  if (normSq <= 1e-10) return null;
  return clamp((dot / Math.sqrt(normSq)) * 3.0, -1, 1);
}

/**
 * Live <1ms Taste Tuner re-ranking using popularity-decorrelated Intensity (`pacingVec`) & Tone (`toneVec`),
 * Era, Familiarity, and Break-My-Bubble anti-echo controls.
 */
export function applyGameTuner(items = [], tunerState = DEFAULT_GAME_TUNER_STATE, context = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const eraW = clamp(Number(tunerState?.era) || 0, -1, 1);
  const famW = clamp(Number(tunerState?.familiarity) || 0, -1, 1);
  const pacingW = clamp(Number(tunerState?.pacing) || 0, -1, 1);
  const toneW = clamp(Number(tunerState?.tone) || 0, -1, 1);
  const antiBubble = Boolean(tunerState?.antiBubble);

  if (Math.abs(eraW) < 1e-6 && Math.abs(famW) < 1e-6 && Math.abs(pacingW) < 1e-6 && Math.abs(toneW) < 1e-6 && !antiBubble) {
    return items;
  }

  const contentIndex = context?.contentIndex || null;
  const tunerAxes = context?.tunerAxes || null;
  const intensityVec = tunerAxes?.intensityVec || tunerAxes?.pacingVec || null;
  const toneVec = tunerAxes?.toneVec || null;
  const dominantGenres = new Set(
    extractGameTasteProfile(context?.played || []).topGenres.slice(0, 2).map((g) => g.toLowerCase())
  );

  const adjusted = items.map((item, origIdx) => {
    const baseLogit = Number.isFinite(Number(item?.rankerLogit))
      ? Number(item.rankerLogit)
      : ((Number(item?.matchScore) || 75) - 72) / 14;

    const year = Number(item?.year);
    const eraCoord = Number.isFinite(year) && year > 1970 ? clamp((year - 2012) / 14, -1, 1) : 0;

    const votes = Number(item?.ratingCount ?? 0);
    const famCoord = votes > 0 ? clamp((2.7 - Math.log10(Math.max(10, votes))) / 1.1, -1, 1) : 0;

    const intCoord = projectGameAxis(item?.igdbId, contentIndex, intensityVec) ?? 0;
    const toneCoord = projectGameAxis(item?.igdbId, contentIndex, toneVec) ?? 0;

    let delta =
      eraW * eraCoord * 1.25 +
      famW * famCoord * 1.15 +
      pacingW * intCoord * 1.2 +
      toneW * toneCoord * 1.2;

    if (antiBubble && dominantGenres.size > 0) {
      const gList = (item?.genres || []).map((x) => String(x).toLowerCase());
      const hits = gList.filter((g) => dominantGenres.has(g)).length;
      if (hits > 0) {
        delta -= 1.15 * Math.min(2, hits);
      } else {
        delta += 0.85;
      }
    }

    const nextLogit = baseLogit + delta;
    return {
      ...item,
      matchScore: computeDisplayMatchScore(nextLogit),
      tunerDelta: Number(delta.toFixed(3)),
      _sortKey: nextLogit,
      _origIdx: origIdx
    };
  });

  adjusted.sort((a, b) => b._sortKey - a._sortKey || a._origIdx - b._origIdx);
  return adjusted.map(({ _sortKey, _origIdx, ...rest }) => rest);
}

/**
 * Finds top hybrid similar IGDB IDs for a single game (works on BOTH warm Steam titles and 100%-cold exclusives!).
 */
export function findSimilarGameIds(igdbId, models = {}, { limit = 12, fallbackIds = [] } = {}) {
  const id = Number(igdbId);
  if (!Number.isInteger(id) || id <= 0) return [];

  const scoreMap = new Map();
  const { easeIndex = null, collabIndex = null, contentIndex = null } = models || {};

  // 1. Exact EASE^R outgoing neighbors (sharpest warm co-play signal)
  if (easeIndex?.idToIndex?.has(id)) {
    const idx = easeIndex.idToIndex.get(id);
    const base = idx * easeIndex.K;
    let maxW = 0;
    for (let k = 0; k < easeIndex.K; k++) {
      const w = easeIndex.nbrW[base + k];
      if (w > maxW) maxW = w;
    }
    if (maxW > 1e-6) {
      for (let k = 0; k < easeIndex.K; k++) {
        const targetIdx = easeIndex.nbrIdx[base + k];
        const w = easeIndex.nbrW[base + k];
        if (targetIdx < easeIndex.count && w > 0) {
          const tid = easeIndex.ids[targetIdx];
          if (tid !== id) {
            scoreMap.set(tid, (scoreMap.get(tid) || 0) + 0.65 * (w / maxW));
          }
        }
      }
    }
  }

  // 2. 128-D Tag-Dropout BGE-large semantic + collab-aligned neighbors (covers 24,439 games incl. PS/Nintendo exclusives!)
  if (contentIndex?.idToIndex?.has(id)) {
    const srcIdx = contentIndex.idToIndex.get(id);
    const { count, dim, ids, vectors } = contentIndex;
    const srcBase = srcIdx * dim;
    const sims = [];
    for (let i = 0; i < count; i++) {
      const tid = ids[i];
      if (tid === id) continue;
      const base = i * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += vectors[srcBase + d] * vectors[base + d];
      if (dot > 0.35) sims.push({ tid, dot });
    }
    sims.sort((a, b) => b.dot - a.dot);
    const wContent = scoreMap.size > 0 ? 0.35 : 1.0;
    for (const s of sims.slice(0, limit * 2)) {
      scoreMap.set(s.tid, (scoreMap.get(s.tid) || 0) + wContent * s.dot);
    }
  }

  // 3. Fallback IGDB similar_games if game is outside the 24.4k index
  if (scoreMap.size < limit && Array.isArray(fallbackIds)) {
    for (const raw of fallbackIds) {
      const tid = Number(raw);
      if (Number.isInteger(tid) && tid > 0 && tid !== id && !scoreMap.has(tid)) {
        scoreMap.set(tid, 0.25);
      }
    }
  }

  return [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tid]) => tid);
}
