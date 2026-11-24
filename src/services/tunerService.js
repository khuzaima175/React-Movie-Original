import { computeDisplayMatchScore } from "./rankerService.js";
import { GENRE_ID_TO_NAME } from "./moodPolicy.js";

export const DEFAULT_TUNER_STATE = Object.freeze({
  era: 0,
  familiarity: 0,
  pacing: 0,
  tone: 0,
  antiBubble: false
});

const DEFAULT_TUNER_AXES_URL = "/models/tuner_axes.json";
let cachedTunerAxesPromise = null;

// Genre ID priors in [-1, 1] for deterministic Pacing (Slow Burn <-> Adrenaline)
const GENRE_PACING_PRIOR = {
  28: 0.85,   // Action
  53: 0.65,   // Thriller
  12: 0.6,    // Adventure
  878: 0.35,  // Sci-Fi
  80: 0.35,   // Crime
  27: 0.3,    // Horror
  16: 0.25,   // Animation
  35: 0.2,    // Comedy
  14: 0.2,    // Fantasy
  9648: 0.05, // Mystery
  10749: -0.25, // Romance
  18: -0.45,  // Drama
  36: -0.6,   // History
  99: -0.55   // Documentary
};

// Genre ID priors in [-1, 1] for deterministic Tone (Bleak & Cynical <-> Warm & Uplifting)
const GENRE_TONE_PRIOR = {
  10751: 0.9, // Family
  35: 0.8,    // Comedy
  16: 0.6,    // Animation
  10402: 0.6, // Music
  10749: 0.55,// Romance
  12: 0.4,    // Adventure
  14: 0.25,   // Fantasy
  28: 0.05,   // Action
  878: -0.1,  // Sci-Fi
  18: -0.2,   // Drama
  9648: -0.4, // Mystery
  10752: -0.65,// War
  80: -0.6,   // Crime
  53: -0.55,  // Thriller
  27: -0.85   // Horror
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function extractCandidateYear(candidate = {}) {
  const match = String(candidate?.release_date || candidate?.year || candidate?.Year || "").match(
    /\b(18\d{2}|19\d{2}|20\d{2}|21\d{2})\b/
  );
  return match ? Number(match[1]) : null;
}

function extractGenreIds(candidate = {}) {
  const raw = candidate?.tmdbGenreIds ?? candidate?.genre_ids ?? [];
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const g of raw) {
    const id = Number(g);
    if (Number.isFinite(id) && id > 0) out.push(id);
  }
  return out;
}

function averageGenrePrior(genreIds, priorTable) {
  if (!genreIds.length) return 0;
  let sum = 0;
  let hits = 0;
  for (const g of genreIds) {
    if (g in priorTable) {
      sum += priorTable[g];
      hits += 1;
    }
  }
  return hits > 0 ? clamp(sum / hits, -1, 1) : 0;
}

function projectSemanticAxis(candidate, contentIndex, axisVec) {
  if (!contentIndex || !Array.isArray(axisVec) || !contentIndex.idToIndex || !contentIndex.vectors) {
    return null;
  }
  const tmdbId = Number(candidate?.tmdbId ?? candidate?.id ?? 0);
  if (!tmdbId) return null;
  const idx = contentIndex.idToIndex.get(tmdbId);
  if (idx === undefined) return null;
  const dim = Number(contentIndex.dim) || 0;
  if (dim <= 0 || axisVec.length !== dim) return null;

  const base = idx * dim;
  let dot = 0;
  let normSq = 0;
  for (let d = 0; d < dim; d += 1) {
    const v = contentIndex.vectors[base + d];
    dot += v * axisVec[d];
    normSq += v * v;
  }
  if (normSq <= 1e-10) return null;
  // Scale cosine (~[-0.35, +0.35]) into [-1, 1]
  return clamp((dot / Math.sqrt(normSq)) * 3.0, -1, 1);
}

/**
 * Checks whether all tuner dials are at 0 and antiBubble is disabled.
 */
export function isTunerNeutral(state = DEFAULT_TUNER_STATE) {
  if (!state || typeof state !== "object") return true;
  return (
    Math.abs(Number(state.era) || 0) < 1e-6 &&
    Math.abs(Number(state.familiarity) || 0) < 1e-6 &&
    Math.abs(Number(state.pacing) || 0) < 1e-6 &&
    Math.abs(Number(state.tone) || 0) < 1e-6 &&
    !state.antiBubble
  );
}

/**
 * Identifies the user's top dominant TMDB genre IDs from positively rated watched films.
 */
export function extractDominantUserGenres(watched = [], maxGenres = 2) {
  if (!Array.isArray(watched) || watched.length === 0) return [];
  const counts = new Map();
  for (const movie of watched) {
    if (!movie || movie.isSample) continue;
    const rating = Number(movie.userRating ?? 0);
    if (rating > 0 && rating < 7) continue;
    const weight = rating >= 9 ? 1.5 : 1.0;
    const seen = new Set();
    for (const gId of extractGenreIds(movie)) {
      if (seen.has(gId)) continue;
      seen.add(gId);
      counts.set(gId, (counts.get(gId) || 0) + weight);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, maxGenres)
    .map(([id]) => id);
}

export function formatDominantGenreNames(genreIds = []) {
  return (Array.isArray(genreIds) ? genreIds : [])
    .map((id) => GENRE_ID_TO_NAME[id])
    .filter(Boolean);
}

/**
 * Computes normalized [-1, 1] coordinates along Era, Familiarity, Pacing, and Tone for a candidate.
 */
export function computeCandidateAxes(candidate = {}, { contentIndex = null, tunerAxes = null } = {}) {
  const year = extractCandidateYear(candidate);
  const era = year !== null ? clamp((year - 2000) / 25, -1, 1) : 0;

  const rawVotes = Number(candidate?.vote_count ?? candidate?.voteCount ?? 0);
  const familiarity =
    Number.isFinite(rawVotes) && rawVotes > 0
      ? clamp((3.4 - Math.log10(Math.max(20, rawVotes))) / 1.3, -1, 1)
      : 0;

  const genreIds = extractGenreIds(candidate);
  const genrePacing = averageGenrePrior(genreIds, GENRE_PACING_PRIOR);
  const genreTone = averageGenrePrior(genreIds, GENRE_TONE_PRIOR);

  const semPacing = projectSemanticAxis(candidate, contentIndex, tunerAxes?.pacingVec);
  const semTone = projectSemanticAxis(candidate, contentIndex, tunerAxes?.toneVec);

  const pacing =
    semPacing !== null
      ? (genreIds.length > 0 ? clamp(0.45 * genrePacing + 0.55 * semPacing, -1, 1) : semPacing)
      : genrePacing;
  const tone =
    semTone !== null
      ? (genreIds.length > 0 ? clamp(0.45 * genreTone + 0.55 * semTone, -1, 1) : semTone)
      : genreTone;

  return { era, familiarity, pacing, tone };
}

/**
 * Lazily loads distilled 128-D semantic tuner axes (`public/models/tuner_axes.json`),
 * degrading gracefully to null so genre priors always work offline or in tests.
 */
export function loadTunerAxes(url = DEFAULT_TUNER_AXES_URL, customFetch = null) {
  if (cachedTunerAxesPromise) return cachedTunerAxesPromise;
  const fetchFn = customFetch || (typeof fetch === "function" ? fetch : null);
  if (!fetchFn) return Promise.resolve(null);

  cachedTunerAxesPromise = fetchFn(url)
    .then(async (res) => {
      if (!res?.ok) return null;
      const parsed = await res.json();
      if (!parsed || !Array.isArray(parsed.pacingVec) || !Array.isArray(parsed.toneVec)) {
        return null;
      }
      return parsed;
    })
    .catch(() => null);

  return cachedTunerAxesPromise;
}

export function resetTunerAxesCache() {
  cachedTunerAxesPromise = null;
}

/**
 * Applies live client-side Taste Tuner dials and Break-My-Bubble anti-echo re-ranking
 * in < 1 ms over any candidate pool. Preserves exact order & scores when neutral.
 */
export function applyTunerToPool(items = [], tunerState = DEFAULT_TUNER_STATE, context = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (isTunerNeutral(tunerState)) return items;

  const eraWeight = clamp(Number(tunerState.era) || 0, -1, 1);
  const famWeight = clamp(Number(tunerState.familiarity) || 0, -1, 1);
  const pacingWeight = clamp(Number(tunerState.pacing) || 0, -1, 1);
  const toneWeight = clamp(Number(tunerState.tone) || 0, -1, 1);
  const antiBubble = Boolean(tunerState.antiBubble);

  const dominantGenreIds = Array.isArray(context.dominantGenreIds)
    ? context.dominantGenreIds
    : extractDominantUserGenres(context.watched || [], 2);
  const dominantSet = new Set(dominantGenreIds);
  const primaryDominant = dominantGenreIds[0] ?? null;
  const contentIndex = context.contentIndex || null;
  const tunerAxes = context.tunerAxes || null;

  const adjusted = items.map((item, idx) => {
    const baseScore = Number(item?.forYouScore ?? item?.matchScore ?? 75);
    const clampedBase = Number.isFinite(baseScore) ? clamp(baseScore, 50, 99) : 75;
    // Invert display score scale [50..99] roughly into logit space centered around ~1.2
    const baseLogit =
      Number.isFinite(Number(item?.rankerLogit))
        ? Number(item.rankerLogit)
        : (clampedBase - 72) / 14;

    const axes = computeCandidateAxes(item, { contentIndex, tunerAxes });
    let tunerDelta =
      eraWeight * axes.era * 1.15 +
      famWeight * axes.familiarity * 1.1 +
      pacingWeight * axes.pacing * 1.1 +
      toneWeight * axes.tone * 1.15;

    if (antiBubble && dominantSet.size > 0) {
      const candGenres = extractGenreIds(item);
      const hasPrimaryDom = primaryDominant !== null && candGenres[0] === primaryDominant;
      const domHits = candGenres.filter((g) => dominantSet.has(g)).length;
      if (hasPrimaryDom) {
        tunerDelta -= 1.45;
      } else if (domHits > 0) {
        tunerDelta -= 0.85 * Math.min(2, domHits);
      } else {
        const latentSim = Number(item?.collabSim ?? item?.features?.collabSim ?? item?.contentSim ?? 0.45);
        tunerDelta += 0.75 + clamp(latentSim, 0, 1) * 0.65;
      }
    }

    const nextLogit = baseLogit + tunerDelta;
    const nextMatchScore = computeDisplayMatchScore(nextLogit);
    const hasForYouScore = item && "forYouScore" in item;

    return {
      ...item,
      tunerDelta: Number(tunerDelta.toFixed(3)),
      matchScore: nextMatchScore,
      ...(hasForYouScore ? { forYouScore: nextMatchScore } : {}),
      _origIdx: idx,
      _sortKey: nextLogit
    };
  });

  adjusted.sort((a, b) => b._sortKey - a._sortKey || a._origIdx - b._origIdx);
  return adjusted.map(({ _origIdx, _sortKey, ...rest }) => rest);
}
