/**
 * CinemaVault TMDB Service (v3.0 God-Tier Engine)
 * - Deterministic Waterfall 3-Bucket Candidate Engine:
 *   - Bucket A: Semantic Discover (Loved Genres + Watch Providers + Surgical Negative Tropes + Star Power with_cast)
 *   - Bucket B: Spiritual Successors (Top Anchor Keywords with Critical Acclaim Sort)
 *   - Bucket C: Auteur & Creative Crew (Single Top Auteur Crew Member with_crew)
 *   - Cold-Start Bypass: Safe routing for accounts with < 3 ratings
 * - Mathematical Taste Vector:
 *   - Continuous Rating Multiplier: W_base = (Rating - 5) / 5
 *   - Exponential Recency Decay: W_final = W_base * e^(-0.005 * Delta_days)
 *   - Temporal Anchor Selection: Highest W_final film selected as anchor
 * - Watch Provider ID Mapping (Netflix, Prime, Disney+, Max, Apple, Hulu, Tubi, Pluto, Freevee)
 * - Schema Bridge Metadata Persistence (castIds, tmdbKeywords, tmdbGenreIds, streamProviders)
 */

import { computeZScoredWeights, computeUserRatingStats } from "./scoringUtils.js";
import {
  getMoodPreset,
  normalizeMoodFilters,
  isExplicitMoodActive,
  matchesMoodCandidateGate
} from "./moodPolicy.js";
import {
  resolveTmdbKey,
  resolveOmdbKey,
  hasTmdbBackend,
  fetchTmdbJson,
  fetchOmdbJson,
  getMovieDetailsBatch
} from "./apiTransport.js";
import {
  normalizeTitleKey,
  normalizeYearKey,
  extractTmdbNumericId
} from "./movieIdentity.js";

export const getTmdbKey = () => resolveTmdbKey();
export const getOmdbKey = () => resolveOmdbKey();

export const TMDB_KEY = getTmdbKey();
export const OMDB_KEY = getOmdbKey();

// Standard TMDB Genre Taxonomy Dictionary
export const TMDB_GENRE_MAP = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  musical: 10402,
  mystery: 9648,
  romance: 10749,
  "sci-fi": 878,
  "science fiction": 878,
  "tv movie": 10770,
  thriller: 53,
  war: 10752,
  western: 37
};

// Reverse map: ID -> Name
export const TMDB_ID_TO_GENRE = Object.entries(TMDB_GENRE_MAP).reduce((acc, [name, id]) => {
  if (!acc[id]) acc[id] = name.charAt(0).toUpperCase() + name.slice(1);
  return acc;
}, {});

/**
 * Direct TMDB Provider IDs Mapping
 */
export const PROVIDER_MAP = {
  netflix: 8,
  prime: 9,
  max: 1899,
  disney: 337,
  hulu: 15,
  apple: 350,
  paramount: 531,
  peacock: 386,
  tubi: 73,
  pluto: 300,
  freevee: 573,
  criterion: 258
};

export const AVAILABLE_REGIONS = [
  { code: "GLOBAL", name: "Worldwide / Any Country", flag: "🌍" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "SE", name: "Sweden", flag: "🇸🇪" }
];

export const POPULAR_WATCH_PROVIDERS = [
  { id: 8, name: "Netflix", icon: "🔴" },
  { id: 9, name: "Amazon Prime", icon: "📦" },
  { id: 337, name: "Disney+", icon: "✨" },
  { id: 1899, name: "Max (HBO)", icon: "🟣" },
  { id: 350, name: "Apple TV+", icon: "🍏" },
  { id: 15, name: "Hulu", icon: "🟢" },
  { id: 531, name: "Paramount+", icon: "🏔️" },
  { id: 386, name: "Peacock", icon: "🦚" },
  { id: 258, name: "Criterion Channel", icon: "🏛️" },
  { id: 73, name: "Tubi (Free)", icon: "📺" },
  { id: 300, name: "Pluto TV (Free)", icon: "⚡" },
  { id: 573, name: "Freevee (Free)", icon: "🎬" }
];

export const PROVIDER_FAMILY_MAP = {
  8: [8, 1796, 175],               // Netflix, Netflix Standard with Ads, Netflix Kids
  9: [9, 10, 119, 2100],           // Amazon Prime Video + regional Prime Video IDs
  337: [337, 390],                 // Disney Plus
  1899: [1899, 384, 1825, 29, 31], // Max, HBO Max, Max Amazon Channel, HBO Go/Now
  350: [350, 2, 2243],             // Apple TV+, Apple TV Plus Amazon Channel
  15: [15],                        // Hulu
  531: [531, 1853, 2303, 2616, 582], // Paramount+, Paramount+ Amazon/Apple/Showtime/Roku channels
  386: [386, 387],                 // Peacock, Peacock Premium Plus
  258: [258],                      // Criterion Channel
  73: [73],                        // Tubi TV
  300: [300],                      // Pluto TV
  573: [573, 613, 546],            // Amazon Freevee
  613: [613, 546, 573]             // Amazon Freevee alias
};

const PROVIDER_NAME_TOKENS = {
  8: ["netflix"],
  9: ["amazon prime", "prime video"],
  337: ["disney plus", "disney+"],
  1899: ["max", "hbo max", "hbo"],
  350: ["apple tv+", "apple tv plus"],
  15: ["hulu"],
  531: ["paramount+", "paramount plus", "paramount+ with showtime"],
  386: ["peacock"],
  258: ["criterion"],
  73: ["tubi"],
  300: ["pluto"],
  573: ["freevee"],
  613: ["freevee"]
};

export function expandProviderIds(selectedProviders = []) {
  if (!Array.isArray(selectedProviders) || selectedProviders.length === 0) return [];
  const expanded = new Set();
  for (const raw of selectedProviders) {
    const num = typeof raw === "string" && PROVIDER_MAP[raw] ? PROVIDER_MAP[raw] : Number(raw);
    if (!Number.isFinite(num)) continue;
    expanded.add(num);
    for (const alias of PROVIDER_FAMILY_MAP[num] || []) {
      expanded.add(alias);
    }
  }
  return [...expanded];
}

export function buildProviderFilter(selectedProviders, options = {}) {
  if (!selectedProviders || selectedProviders.length === 0) return null;
  const providerIds = options.expandAliases
    ? expandProviderIds(selectedProviders)
    : selectedProviders
        .map(p => (typeof p === "number" ? p : PROVIDER_MAP[p]))
        .filter(Boolean);
  return providerIds.length > 0 ? providerIds.join("|") : null;
}

/**
 * Verifies whether a candidate matches any selected streaming provider, accounting for
 * TMDB regional/ad-tier IDs, free-with-ads providers, and unhydrated discovery results.
 */
export function matchesWatchProviders(candidate = {}, selectedProviders = []) {
  if (!Array.isArray(selectedProviders) || selectedProviders.length === 0) return true;
  if (!candidate || typeof candidate !== "object") return false;

  const expandedIds = new Set(expandProviderIds(selectedProviders));
  const canonicalIds = selectedProviders
    .map(raw => (typeof raw === "string" && PROVIDER_MAP[raw] ? PROVIDER_MAP[raw] : Number(raw)))
    .filter(Number.isFinite);

  const streamList = [
    ...(Array.isArray(candidate.streamProviders) ? candidate.streamProviders : []),
    ...(Array.isArray(candidate.freeProviders) ? candidate.freeProviders : [])
  ];

  if (streamList.length > 0) {
    for (const p of streamList) {
      const pid = Number(p?.provider_id ?? p?.id);
      if (Number.isFinite(pid) && expandedIds.has(pid)) return true;
      const pname = String(p?.provider_name ?? p?.name ?? "").toLowerCase();
      if (pname) {
        for (const cid of canonicalIds) {
          const tokens = PROVIDER_NAME_TOKENS[cid] || [];
          if (
            tokens.some(tok => {
              if (tok === "max") {
                return pname === "max" || pname.startsWith("max ") || pname.includes("hbo max");
              }
              return pname.includes(tok);
            })
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  if (candidate.providersHydrated === true) {
    return false;
  }

  return Boolean(candidate.providerMatchedByQuery);
}

/**
 * Maps OMDb genre string ("Action, Sci-Fi") to TMDB integer IDs ([28, 878])
 */
export function mapOmdbToTmdbGenreIds(omdbGenreStr = "") {
  if (!omdbGenreStr) return [];
  return String(omdbGenreStr)
    .split(",")
    .map(g => {
      const clean = g.trim().toLowerCase();
      return TMDB_GENRE_MAP[clean];
    })
    .filter(Boolean);
}

// Generic structural/meta TMDB keyword IDs suppressed from taste keyword slots:
// 818 (based on novel or book), 179430 (aftercreditsstinger), 179431 (duringcreditsstinger),
// 187056 (woman director), 9663 (sequel)
export const GENERIC_META_KEYWORD_IDS = new Set([818, 179430, 179431, 187056, 9663]);

/**
 * Mathematical Weighted Taste Profiler
 * Integrates Z-Scored Rating Weights + Bulk-Import-Aware Time-Decay + Surgical Trope Math
 */
export async function extractTasteProfile(watched = [], watchlist = [], options = {}) {
  const rated = (watched || []).filter(m => {
    const r = Number(m.userRating || m.UserRating || 0);
    return !isNaN(r) && r > 0;
  });

  const genreScores = {};
  const lovedKeywordScores = {};
  const hatedKeywordCounts = {};
  const keywordDf = {};
  const castScores = {};
  const crewScores = {};
  const castNetScores = {};
  const castPosCounts = {};
  const crewNetScores = {};
  const crewPosCounts = {};
  const DECAY_RATE = options.lambda ?? 0.002;
  const anchorCutoff = options.anchorCutoff ?? 9;
  const personShrinkageK = options.personShrinkageK ?? 2;

  for (const m of rated) {
    if (!Array.isArray(m.tmdbKeywords)) continue;
    const seenInFilm = new Set();
    for (const rawId of m.tmdbKeywords) {
      const kId = Number(rawId);
      if (!Number.isFinite(kId) || kId <= 0 || GENERIC_META_KEYWORD_IDS.has(kId) || seenInFilm.has(kId)) continue;
      seenInFilm.add(kId);
      keywordDf[kId] = (keywordDf[kId] || 0) + 1;
    }
  }

  const userStats = computeUserRatingStats(rated);
  const zScoredList = computeZScoredWeights(rated, {
    lambda: DECAY_RATE,
    dualClock: options.dualClock ?? false,
    now: options.now ?? Date.now(),
    bulkPriorDays: options.bulkPriorDays ?? 180
  });

  // Calculate continuous weights with z-scores and exponential time decay
  const weightedRated = zScoredList.map(({ movie, rating, zScore, daysSince, timeDecay, weight }) => {
    const positiveWeight = Math.max(0, weight);
    const genreIds = movie.tmdbGenreIds || mapOmdbToTmdbGenreIds(movie.genre || movie.Genre || "");

    // 1. Positive Genre Weighting (Direct TMDB IDs or string fallback)
    if (positiveWeight > 0) {
      genreIds.forEach(id => {
        genreScores[id] = (genreScores[id] || 0) + positiveWeight;
      });
    }

    const filmKeywords = Array.isArray(movie.tmdbKeywords)
      ? [...new Set(movie.tmdbKeywords.map(Number).filter(kId => Number.isFinite(kId) && kId > 0 && !GENERIC_META_KEYWORD_IDS.has(kId)))]
      : [];

    // 2. Surgical Negative Trope Extraction (from low rated or <= 5★ negative z-score films; never 6-10★)
    if ((rating <= 4 || (rating <= 5 && zScore < -0.4)) && filmKeywords.length > 0) {
      const negativeDecay = Math.exp(-(DECAY_RATE / 2) * daysSince);
      const negMagnitude = Math.max(1, Math.abs(zScore)) * negativeDecay;
      filmKeywords.forEach(kId => {
        hatedKeywordCounts[kId] = (hatedKeywordCounts[kId] || 0) + negMagnitude;
      });
    }

    // 3. Star Power Cast & Auteur Crew Scoring
    // Preserve topCastIds / topCrewIds (>= 8★) for backward-compatible Bucket A/C queries & cache hashes
    if (rating >= 8 && positiveWeight > 0) {
      if (movie.castIds && Array.isArray(movie.castIds)) {
        movie.castIds.slice(0, 3).forEach(cId => {
          castScores[cId] = (castScores[cId] || 0) + positiveWeight;
        });
      }
      if (movie.crewPersonId) {
        crewScores[movie.crewPersonId] = (crewScores[movie.crewPersonId] || 0) + positiveWeight;
      }
      if (filmKeywords.length > 0) {
        filmKeywords.forEach(kId => {
          lovedKeywordScores[kId] = (lovedKeywordScores[kId] || 0) + positiveWeight;
        });
      }
    }

    // Continuous signed person accumulation across all stored castIds (billing-decayed) and crewPersonId
    if (Array.isArray(movie.castIds) && movie.castIds.length > 0) {
      const seenCast = new Set();
      movie.castIds.forEach((rawId, idx) => {
        const cId = Number(rawId);
        if (!Number.isFinite(cId) || cId <= 0 || seenCast.has(cId)) return;
        seenCast.add(cId);
        const billingDecay = 1 / (1 + 0.2 * idx);
        if (weight > 0) {
          castNetScores[cId] = (castNetScores[cId] || 0) + weight * billingDecay;
          castPosCounts[cId] = (castPosCounts[cId] || 0) + 1;
        } else if (weight < 0 && rating < 7) {
          castNetScores[cId] = (castNetScores[cId] || 0) + weight * billingDecay;
        }
      });
    }

    const crewPersonId = Number(movie.crewPersonId || 0);
    if (Number.isFinite(crewPersonId) && crewPersonId > 0) {
      if (weight > 0) {
        crewNetScores[crewPersonId] = (crewNetScores[crewPersonId] || 0) + weight;
        crewPosCounts[crewPersonId] = (crewPosCounts[crewPersonId] || 0) + 1;
      } else if (weight < 0 && rating < 7) {
        crewNetScores[crewPersonId] = (crewNetScores[crewPersonId] || 0) + weight;
      }
    }

    return { ...movie, finalWeight: weight, zScore, timeDecay };
  });

  // Sort weighted movies descending by finalWeight (captures current obsession)
  weightedRated.sort((a, b) => b.finalWeight - a.finalWeight);

  const lovedGenreIds = Object.entries(genreScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id]) => Number(id));

  const topCastIds = Object.entries(castScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => Number(id));

  const topCrewIds = Object.entries(crewScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => Number(id));
  const topCrewMemberId = topCrewIds[0] || null;

  // Net keyword polarity + vault IDF damping prevents self-collision and generic-tag domination
  const allSeenKeywordIds = new Set([
    ...Object.keys(lovedKeywordScores),
    ...Object.keys(hatedKeywordCounts)
  ]);
  const lovedKeywordEntries = [];
  const hatedKeywordEntries = [];
  for (const rawId of allSeenKeywordIds) {
    const id = Number(rawId);
    const pos = lovedKeywordScores[rawId] || 0;
    const neg = hatedKeywordCounts[rawId] || 0;
    const df = keywordDf[id] || 1;
    const idf = 1 / Math.log2(2 + df);
    const netPolarity = pos - neg;
    if (netPolarity > 0) {
      lovedKeywordEntries.push([id, netPolarity * idf]);
    } else if (netPolarity < 0) {
      hatedKeywordEntries.push([id, -netPolarity * idf]);
    }
  }
  lovedKeywordEntries.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  hatedKeywordEntries.sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  const lovedKeywordIds = lovedKeywordEntries.slice(0, 8).map(([id]) => id);
  const top15LovedKeywords = lovedKeywordEntries.slice(0, 15);

  const maxGenreScore = Math.max(1e-6, ...Object.values(genreScores));
  const genreAffinities = {};
  for (const id of lovedGenreIds) {
    genreAffinities[Number(id)] = (genreScores[id] || 0) / maxGenreScore;
  }

  const maxKwScore = top15LovedKeywords.length > 0 ? Math.max(1e-6, top15LovedKeywords[0][1]) : 1e-6;
  const keywordAffinities = {};
  for (const [id, score] of top15LovedKeywords) {
    keywordAffinities[id] = score / maxKwScore;
  }

  // Bayesian support-shrunk person affinities: shrunk = netScore / (posCount + k)
  const shrunkCrewEntries = Object.entries(crewNetScores)
    .map(([rawId, net]) => {
      const id = Number(rawId);
      const posCount = crewPosCounts[rawId] || 0;
      if (posCount <= 0 || net <= 0) return [id, 0];
      return [id, net / (posCount + personShrinkageK)];
    })
    .filter(([_, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 15);
  const maxCrewAff = shrunkCrewEntries.length > 0 ? Math.max(1e-6, shrunkCrewEntries[0][1]) : 1e-6;
  const crewAffinities = {};
  for (const [id, score] of shrunkCrewEntries) {
    crewAffinities[id] = score / maxCrewAff;
  }

  const shrunkCastEntries = Object.entries(castNetScores)
    .map(([rawId, net]) => {
      const id = Number(rawId);
      const posCount = castPosCounts[rawId] || 0;
      if (posCount <= 0 || net <= 0) return [id, 0];
      return [id, net / (posCount + personShrinkageK)];
    })
    .filter(([_, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 20);
  const maxCastAff = shrunkCastEntries.length > 0 ? Math.max(1e-6, shrunkCastEntries[0][1]) : 1e-6;
  const castAffinities = {};
  for (const [id, score] of shrunkCastEntries) {
    castAffinities[id] = score / maxCastAff;
  }

  const hatedKeywordIds = hatedKeywordEntries
    .slice(0, 5)
    .map(([id]) => id);

  // Top anchor film selected from highest finalWeight
  const eliteAnchors = weightedRated.filter(m => Number(m.userRating || 0) >= anchorCutoff);
  let anchorTmdbId = null;
  if (eliteAnchors.length > 0) {
    anchorTmdbId = eliteAnchors[0].tmdbId || (await findTmdbByImdbId(eliteAnchors[0].imdbID))?.tmdbId || null;
  }

  // Top Directors (2+ high rated films)
  const dirMap = {};
  rated.filter(m => Number(m.userRating || 0) >= 7).forEach(m => {
    const d = (m.director || m.Director || "").trim();
    if (d && d !== "N/A" && d !== "Unknown") {
      dirMap[d] = (dirMap[d] || 0) + 1;
    }
  });

  const topDirectors = Object.entries(dirMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([d]) => d);

  // Watchlist Intent Genres
  const watchlistGenreCounts = {};
  (watchlist || []).forEach(m => {
    const genreIds = m.tmdbGenreIds || mapOmdbToTmdbGenreIds(m.genre || m.Genre || "");
    genreIds.forEach(id => {
      watchlistGenreCounts[id] = (watchlistGenreCounts[id] || 0) + 1;
    });
  });

  const watchlistGenreIds = Object.entries(watchlistGenreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => Number(id));

  return {
    lovedGenreIds,
    lovedGenreNames: lovedGenreIds.map(id => TMDB_ID_TO_GENRE[id] || `Genre ${id}`),
    topDirectors,
    topCastIds,
    topCrewMemberId,
    topCrewIds,
    lovedKeywordIds,
    genreAffinities,
    keywordAffinities,
    crewAffinities,
    castAffinities,
    anchorTmdbId,
    hatedKeywordIds,
    watchlistGenreIds,
    weightedRatings: zScoredList,
    userStats,
    totalRated: rated.length
  };
}

function resolveEffectiveTmdbKey(options = {}) {
  if (typeof options.apiKey === "string" && options.apiKey.trim()) {
    return options.apiKey.trim();
  }
  return getTmdbKey();
}

function shouldSkipTmdbCandidate(m, collisionSets = {}) {
  if (!m || !m.title || !m.overview) return true;
  const { watchedIdSet, watchedTitleSet, watchlistTitleSet, excludeIdSet } = collisionSets;
  const idStr = String(m.id ?? "");
  if (watchedIdSet?.has(idStr) || excludeIdSet?.has(idStr)) return true;

  const titleClean = m.title.toLowerCase().trim();
  const yearClean = m.release_date ? m.release_date.slice(0, 4) : "";
  const titleYearKey = yearClean ? `${titleClean}::${yearClean}` : titleClean;
  if (watchedTitleSet?.has(titleYearKey) || watchedTitleSet?.has(titleClean)) return true;
  if (watchlistTitleSet?.has(titleYearKey) || watchlistTitleSet?.has(titleClean)) return true;
  return false;
}

/**
 * Fetch keywords and creative crew for an anchor film
 */
export async function fetchMovieKeywordsAndCrew(tmdbId, options = {}) {
  if (!hasTmdbBackend(options) || !tmdbId) return { keywords: [], crewPersonIds: [] };

  try {
    const key = resolveEffectiveTmdbKey(options);
    const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : undefined;
    const data = await fetchTmdbJson(
      `/3/movie/${tmdbId}`,
      {
        append_to_response: "keywords,credits",
        language: "en-US"
      },
      { apiKey: key, fetchFn, forceProxy: options.forceProxy }
    );
    if (!data) return { keywords: [], crewPersonIds: [] };

    const keywords = (data.keywords?.keywords || []).slice(0, 5).map(k => k.id);

    // Extract Cinematographer, Composer, Screenplay
    const crewPersonIds = (data.credits?.crew || [])
      .filter(c => ["Director of Photography", "Original Music Composer", "Screenplay", "Writer", "Director"].includes(c.job))
      .slice(0, 3)
      .map(c => c.id);

    return { keywords, crewPersonIds };
  } catch (err) {
    console.warn("Failed to fetch keywords/crew for anchor movie:", tmdbId, err);
    return { keywords: [], crewPersonIds: [] };
  }
}

/**
 * Builds URLSearchParams for Bucket A Semantic Discover (pipe OR for genres, keywords, and cast)
 */
export function buildBucketAParams(profile = {}, mood = "any", options = {}, apiKey = "") {
  const { userRegion = "US", userProviders = [] } = options;
  const rawMood = (typeof mood === "string" ? mood : mood?.id || "any").toLowerCase().trim();
  const moodFilters = normalizeMoodFilters(options.moodFilters);
  const effectiveMood =
    moodFilters?.moodId && moodFilters.moodId !== "any" && rawMood === "any"
      ? moodFilters.moodId
      : rawMood;
  const explicitMood = isExplicitMoodActive(effectiveMood, moodFilters);
  const preset = getMoodPreset(effectiveMood);

  const sortParam = explicitMood ? preset.sortBy : "popularity.desc";
  const voteCountGte = explicitMood ? String(preset.voteCountGte) : "150";
  const voteAverageGte = explicitMood ? String(preset.voteAverageGte) : "6.8";

  let combinedLoved;
  if (!explicitMood) {
    combinedLoved = Array.from(new Set([
      ...(profile.lovedGenreIds || []).slice(0, 4),
      ...(profile.watchlistGenreIds || []).slice(0, 3)
    ]));
  } else if (moodFilters?.withGenreIds?.length > 0) {
    combinedLoved = [...moodFilters.withGenreIds];
  } else if (preset.preferredGenreIds.length > 0) {
    const preferredSet = new Set(preset.preferredGenreIds);
    const alignedLoved = (profile.lovedGenreIds || []).filter(id => preferredSet.has(id));
    combinedLoved = Array.from(new Set([...alignedLoved, ...preset.preferredGenreIds]));
  } else {
    combinedLoved = Array.from(new Set([
      ...(profile.lovedGenreIds || []).slice(0, 4),
      ...(profile.watchlistGenreIds || []).slice(0, 3)
    ]));
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    include_adult: "false",
    include_video: "false",
    language: "en-US",
    sort_by: sortParam,
    "vote_count.gte": voteCountGte,
    "vote_average.gte": voteAverageGte
  });

  if (explicitMood && preset.voteCountLte) {
    params.set("vote_count.lte", String(preset.voteCountLte));
  }

  if (combinedLoved.length > 0) {
    params.set("with_genres", combinedLoved.join("|"));
  }

  if (explicitMood && preset.withoutGenreIds?.length > 0) {
    params.set("without_genres", preset.withoutGenreIds.join(","));
  }

  if (moodFilters?.minYear) {
    params.set("primary_release_date.gte", `${moodFilters.minYear}-01-01`);
  }
  if (moodFilters?.maxYear) {
    params.set("primary_release_date.lte", `${moodFilters.maxYear}-12-31`);
  }

  const startPage = Math.floor(Number(options.page) || 1);
  if (startPage > 1) {
    params.set("page", String(startPage));
  }

  if (profile.hatedKeywordIds && profile.hatedKeywordIds.length > 0) {
    params.set("without_keywords", profile.hatedKeywordIds.join("|"));
  }

  // Only restrict by top actors when in unconstrained "any" mode so mood searches stay wide
  if (!(explicitMood || preset.relaxCastLock) && profile.topCastIds && profile.topCastIds.length > 0) {
    params.set("with_cast", profile.topCastIds.join("|"));
  }

  const providerFilter = buildProviderFilter(userProviders, { expandAliases: true });
  if (providerFilter) {
    params.set("with_watch_providers", providerFilter);
    params.set("with_watch_monetization_types", "flatrate|free|ads");
    params.set("watch_region", (!userRegion || userRegion === "GLOBAL") ? "US" : userRegion);
  } else if (userRegion && userRegion !== "GLOBAL") {
    params.set("watch_region", userRegion);
  }

  return params;
}

/**
 * BUCKET A: Semantic Discover with Conditional Genre Guard & Pipe OR with_cast
 */
export async function fetchBucketA(profile, mood = "any", options = {}, collisionSets = {}, targetCount = 8) {
  if (!hasTmdbBackend(options)) return [];

  const key = resolveEffectiveTmdbKey(options);
  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : undefined;
  const params = buildBucketAParams(profile, mood, options, key);
  const sortParam = params.get("sort_by") || "popularity.desc";
  const hasProviderFilter = Boolean(params.get("with_watch_providers"));
  const startPage = Math.max(1, Math.floor(Number(options.page) || 1));

  let candidates = [];
  let page = startPage;

  while (candidates.length < targetCount && page < startPage + 5) {
    try {
      const data = await fetchTmdbJson(
        "/3/discover/movie",
        { ...Object.fromEntries(params), page: String(page) },
        { apiKey: key, fetchFn, forceProxy: options.forceProxy }
      );
      if (!data?.results || data.results.length === 0) break;

      for (const m of data.results) {
        if (shouldSkipTmdbCandidate(m, collisionSets)) continue;
        if (candidates.some(c => c.id === m.id)) continue;

        candidates.push(normalizeTmdbItem(m, "Bucket A: Semantic", hasProviderFilter));
        if (candidates.length >= targetCount) break;
      }
      page++;
    } catch (err) {
      break;
    }
  }

  // CINEPHILE FALLBACK: If user has seen all popular titles, switch to deep critical acclaim
  if (candidates.length < Math.min(targetCount, 5) && sortParam === "popularity.desc") {
    params.set("sort_by", "vote_average.desc");
    params.set("vote_count.gte", "500");
    page = startPage;

    while (candidates.length < targetCount && page < startPage + 5) {
      try {
        const data = await fetchTmdbJson(
          "/3/discover/movie",
          { ...Object.fromEntries(params), page: String(page) },
          { apiKey: key, fetchFn, forceProxy: options.forceProxy }
        );
        if (!data?.results || data.results.length === 0) break;

        for (const m of data.results) {
          if (shouldSkipTmdbCandidate(m, collisionSets)) continue;
          if (candidates.some(c => c.id === m.id)) continue;

          candidates.push(normalizeTmdbItem(m, "Bucket A: Cinephile Critical", hasProviderFilter));
          if (candidates.length >= targetCount) break;
        }
        page++;
      } catch (err) {
        break;
      }
    }
  }

  return candidates;
}

/**
 * BUCKET B: Keyword Spiritual Successor (Safe Keyword Match without Genre Blacklisting)
 */
export async function fetchBucketB(anchorTmdbId, options = {}, collisionSets = {}, targetCount = 8) {
  if (!hasTmdbBackend(options) || !anchorTmdbId) return [];

  const key = resolveEffectiveTmdbKey(options);
  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : undefined;
  const { userRegion = "US", userProviders = [] } = options;

  const { keywords } = await fetchMovieKeywordsAndCrew(anchorTmdbId, options);
  if (!keywords || keywords.length === 0) return [];

  const params = new URLSearchParams({
    api_key: key,
    with_keywords: keywords.slice(0, 3).join("|"),
    sort_by: "vote_average.desc",
    "vote_count.gte": "500",
    "vote_average.gte": "7.0",
    include_adult: "false"
  });

  const providerFilter = buildProviderFilter(userProviders, { expandAliases: true });
  if (providerFilter) {
    params.set("with_watch_providers", providerFilter);
    params.set("with_watch_monetization_types", "flatrate|free|ads");
    params.set("watch_region", (!userRegion || userRegion === "GLOBAL") ? "US" : userRegion);
  } else if (userRegion && userRegion !== "GLOBAL") {
    params.set("watch_region", userRegion);
  }

  const candidates = [];
  let page = 1;

  while (candidates.length < targetCount && page <= 4) {
    try {
      const data = await fetchTmdbJson(
        "/3/discover/movie",
        { ...Object.fromEntries(params), page: String(page) },
        { apiKey: key, fetchFn, forceProxy: options.forceProxy }
      );
      if (!data?.results || data.results.length === 0) break;

      for (const m of data.results) {
        if (shouldSkipTmdbCandidate(m, collisionSets)) continue;
        if (candidates.some(c => c.id === m.id)) continue;

        candidates.push(normalizeTmdbItem(m, "Bucket B: Spiritual Successor", Boolean(providerFilter)));
        if (candidates.length >= targetCount) break;
      }
      page++;
    } catch (err) {
      break;
    }
  }

  return candidates;
}

/**
 * BUCKET C: Single Auteur Crew Member Query (with_crew={singleId})
 */
export async function fetchBucketC(profile, options = {}, collisionSets = {}, targetCount = 4) {
  if (!hasTmdbBackend(options)) return [];

  const key = resolveEffectiveTmdbKey(options);
  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : undefined;
  const { topCrewMemberId } = profile;
  if (!topCrewMemberId) return [];

  const { userRegion = "US", userProviders = [] } = options;

  const params = new URLSearchParams({
    api_key: key,
    with_crew: String(topCrewMemberId),
    sort_by: "vote_average.desc",
    "vote_count.gte": "150",
    include_adult: "false"
  });

  const providerFilter = buildProviderFilter(userProviders, { expandAliases: true });
  if (providerFilter) {
    params.set("with_watch_providers", providerFilter);
    params.set("with_watch_monetization_types", "flatrate|free|ads");
    params.set("watch_region", (!userRegion || userRegion === "GLOBAL") ? "US" : userRegion);
  } else if (userRegion && userRegion !== "GLOBAL") {
    params.set("watch_region", userRegion);
  }

  const candidates = [];
  let page = 1;

  while (candidates.length < targetCount && page <= 3) {
    try {
      const data = await fetchTmdbJson(
        "/3/discover/movie",
        { ...Object.fromEntries(params), page: String(page) },
        { apiKey: key, fetchFn, forceProxy: options.forceProxy }
      );
      if (!data?.results || data.results.length === 0) break;

      for (const m of data.results) {
        if (shouldSkipTmdbCandidate(m, collisionSets)) continue;
        if (candidates.some(c => c.id === m.id)) continue;

        candidates.push(normalizeTmdbItem(m, "Bucket C: Auteur Crew", Boolean(providerFilter)));
        if (candidates.length >= targetCount) break;
      }
      page++;
    } catch (err) {
      break;
    }
  }

  return candidates;
}

/**
 * Computes YYYY-MM-DD for (now minus N calendar months) in UTC, clamping end-of-month dates.
 */
export function getRecentReleaseDateFloor(months = 18, now = Date.now()) {
  const base = new Date(Number.isFinite(now) ? now : Date.now());
  const origDay = base.getUTCDate();
  base.setUTCDate(1);
  base.setUTCMonth(base.getUTCMonth() - months);
  const daysInMonth = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(origDay, daysInMonth));
  return base.toISOString().slice(0, 10);
}

/**
 * Attaches watch provider and region query parameters onto a TMDB discover URLSearchParams.
 */
function applyProviderAndRegionParams(params, userRegion = "US", userProviders = []) {
  const providerFilter = buildProviderFilter(userProviders);
  if (providerFilter) {
    params.set("with_watch_providers", providerFilter);
    params.set("with_watch_monetization_types", "flatrate|free|ads");
    params.set("watch_region", (!userRegion || userRegion === "GLOBAL") ? "US" : userRegion);
  } else if (userRegion && userRegion !== "GLOBAL") {
    params.set("watch_region", userRegion);
  }
  return Boolean(providerFilter);
}

/**
 * Builds URLSearchParams for Bucket D (Recent Releases within the last 18 months, no with_cast).
 */
export function buildBucketDParams(profile = {}, options = {}, apiKey = "") {
  const { userRegion = "US", userProviders = [], now = Date.now(), minReleaseDate } = options;
  const params = new URLSearchParams({
    api_key: apiKey,
    "primary_release_date.gte": minReleaseDate || getRecentReleaseDateFloor(18, now),
    sort_by: "popularity.desc",
    "vote_count.gte": "150",
    "vote_average.gte": "7.0",
    include_adult: "false"
  });

  const top3Genres = (profile.lovedGenreIds || []).slice(0, 3);
  if (top3Genres.length > 0) {
    params.set("with_genres", top3Genres.join("|"));
  }
  if (profile.hatedKeywordIds && profile.hatedKeywordIds.length > 0) {
    params.set("without_keywords", profile.hatedKeywordIds.join("|"));
  }
  applyProviderAndRegionParams(params, userRegion, userProviders);
  return params;
}

/**
 * BUCKET D: Recent popular releases (last 18 months) aligned to top 3 loved genres without cast lock-in.
 */
export async function fetchBucketD(profile = {}, options = {}, collisionSets = {}, existingIdSet = new Set()) {
  if (!hasTmdbBackend(options)) return [];

  const key = resolveEffectiveTmdbKey(options);
  const fetchFn = typeof options.fetchFn === "function" ? options.fetchFn : undefined;
  const params = buildBucketDParams(profile, options, key);
  const hasProviderFilter = Boolean(params.get("with_watch_providers"));
  const maxResults = 12;
  const startPage = Math.max(1, Math.floor(Number(options.page) || 1));

  const candidates = [];
  const seenLocal = new Set();

  for (let page = startPage; page <= startPage + 1 && candidates.length < maxResults; page++) {
    try {
      const data = await fetchTmdbJson(
        "/3/discover/movie",
        { ...Object.fromEntries(params), page: String(page) },
        { apiKey: key, fetchFn, forceProxy: options.forceProxy }
      );
      if (!data?.results || data.results.length === 0) break;

      for (const m of data.results) {
        if (shouldSkipTmdbCandidate(m, collisionSets)) continue;
        const idNum = Number(m.id);
        if (existingIdSet?.has(idNum) || seenLocal.has(idNum)) continue;

        seenLocal.add(idNum);
        candidates.push(normalizeTmdbItem(m, "D", hasProviderFilter));
        if (candidates.length >= maxResults) break;
      }
    } catch (_) {
      break;
    }
  }

  return candidates;
}

/**
 * 3-Bucket Dynamic Waterfall Candidate Pool Orchestrator with Cold-Start Bypass
 */
export async function fetchCandidatePool(profile, mood = "any", watchedMovies = [], watchlistMovies = [], options = {}) {
  if (!hasTmdbBackend(options)) {
    throw new Error("TMDB_KEY_MISSING");
  }

  const watchedIdSet = new Set(
    (watchedMovies || []).map(m => String(m.id || m.imdbID || m.tmdbId || "")).filter(Boolean)
  );
  const excludeIdSet = new Set(
    (Array.isArray(options.excludeIds) ? options.excludeIds : [])
      .map(id => String(id).trim())
      .filter(Boolean)
  );

  const watchedTitleSet = new Set(
    (watchedMovies || []).map(m => {
      const t = (m.title || m.Title || "").toLowerCase().trim();
      const y = String(m.year || m.Year || "").match(/\d{4}/)?.[0] || "";
      return y ? `${t}::${y}` : t;
    }).filter(Boolean)
  );

  const watchlistTitleSet = new Set(
    (watchlistMovies || []).map(m => {
      const t = (m.title || m.Title || "").toLowerCase().trim();
      const y = String(m.year || m.Year || "").match(/\d{4}/)?.[0] || "";
      return y ? `${t}::${y}` : t;
    }).filter(Boolean)
  );

  const collisionSets = { watchedIdSet, watchedTitleSet, watchlistTitleSet, excludeIdSet };
  const moodFilters = normalizeMoodFilters(options.moodFilters);
  const explicitMood = isExplicitMoodActive(mood, moodFilters);
  const cleanMood = String(mood || "any").trim().toLowerCase();
  const currentYear = new Date().getUTCFullYear();
  const skipRecentLane = Boolean(
    (explicitMood && cleanMood === "hidden-gem") ||
    (moodFilters?.maxYear && moodFilters.maxYear < currentYear - 2)
  );

  // COLD-START BYPASS: If user has < 3 ratings, route entirely to expanded Bucket A + Bucket D
  const targetPoolSize = Math.max(20, Math.min(500, Number(options.poolSize) || 60));
  if ((watchedMovies || []).length < 3) {
    const coldPool = await fetchBucketA(profile, mood, options, collisionSets, targetPoolSize);
    const existingIds = new Set(coldPool.map(item => Number(item?.id ?? item?.tmdbId ?? 0)));
    const rawColdBucketD = skipRecentLane ? [] : await fetchBucketD(profile, options, collisionSets, existingIds);
    const bucketD = explicitMood
      ? rawColdBucketD.filter(m => matchesMoodCandidateGate(m, mood, moodFilters))
      : rawColdBucketD;
    return bucketD.length > 0 ? [...coldPool, ...bucketD] : coldPool;
  }

  const bucketBTarget = explicitMood
    ? Math.min(12, Math.max(2, Math.floor(targetPoolSize * 0.2)))
    : Math.min(40, Math.max(8, Math.floor(targetPoolSize * 0.35)));
  const bucketCTarget = explicitMood
    ? Math.min(8, Math.max(2, Math.floor(targetPoolSize * 0.12)))
    : Math.min(20, Math.max(4, Math.floor(targetPoolSize * 0.2)));

  // 1. Concurrently fetch specific Keyword and Auteur/Cast buckets
  const [bucketB, bucketC] = await Promise.all([
    profile.anchorTmdbId ? fetchBucketB(profile.anchorTmdbId, options, collisionSets, bucketBTarget) : Promise.resolve([]),
    profile.topCrewMemberId ? fetchBucketC(profile, options, collisionSets, bucketCTarget) : Promise.resolve([])
  ]);

  // 2. Merge and deduplicate specific pool (applying mood gate when explicit mood is active)
  const filteredB = explicitMood ? bucketB.filter(m => matchesMoodCandidateGate(m, mood, moodFilters)) : bucketB;
  const filteredC = explicitMood ? bucketC.filter(m => matchesMoodCandidateGate(m, mood, moodFilters)) : bucketC;

  const specificPool = [];
  const seenIds = new Set();
  const addSpecific = (list) => {
    for (const item of list) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        specificPool.push(item);
      }
    }
  };
  addSpecific(filteredB);
  addSpecific(filteredC);

  // 3. Dynamic Waterfall Sizing: Bucket A fetches enough to fill targetPoolSize
  const remainingSlots = Math.max(targetPoolSize - specificPool.length, 12);
  const bucketA = await fetchBucketA(profile, mood, options, collisionSets, remainingSlots);

  // 4. Return unified candidate pool, then append Bucket D without displacing existing buckets
  const combined = [...specificPool];
  for (const item of bucketA) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      combined.push(item);
    }
  }

  // Final top-up if needed (preserving mood filter rather than silently resetting to "any" when explicit mood active)
  if (combined.length < targetPoolSize) {
    const topUp = await fetchBucketA(profile, mood, options, collisionSets, targetPoolSize - combined.length);
    for (const item of topUp) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        combined.push(item);
      }
    }
  }

  const basePool = combined.slice(0, targetPoolSize);
  const existingIds = new Set(basePool.map(item => Number(item?.id ?? item?.tmdbId ?? 0)));
  const rawBucketD = skipRecentLane ? [] : await fetchBucketD(profile, options, collisionSets, existingIds);
  const bucketD = explicitMood ? rawBucketD.filter(m => matchesMoodCandidateGate(m, mood, moodFilters)) : rawBucketD;
  return bucketD.length > 0 ? [...basePool, ...bucketD] : basePool;
}

export function normalizeTmdbItem(m, sourceBucket = "TMDB", providerMatchedByQuery = false) {
  const genreNames = (m.genre_ids || [])
    .map(id => TMDB_ID_TO_GENRE[id])
    .filter(Boolean);

  const yearClean = m.release_date ? m.release_date.slice(0, 4) : "N/A";

  return {
    id: m.id,
    tmdbId: m.id,
    title: m.title,
    year: yearClean,
    release_date: m.release_date,
    overview: m.overview,
    vote_average: m.vote_average ? Number(m.vote_average.toFixed(1)) : null,
    vote_count: m.vote_count || 0,
    popularity: m.popularity || 0,
    genre_ids: m.genre_ids || [],
    tmdbGenreIds: m.genre_ids || [],
    genre_names: genreNames,
    genre: genreNames.join(", ") || "Cinema",
    poster_path: m.poster_path,
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
    backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null,
    spokenLanguages: m.original_language ? String(m.original_language).trim() : null,
    sourceBucket,
    providerMatchedByQuery: Boolean(providerMatchedByQuery)
  };
}

/**
 * Extract Exact Official Trailer with strict hierarchical scoring
 */
export function extractOfficialTrailerKey(videosList = []) {
  if (!Array.isArray(videosList) || videosList.length === 0) return null;

  const youtubeVideos = videosList.filter(v => v && v.site === "YouTube" && v.key);
  if (youtubeVideos.length === 0) return null;

  const scored = [...youtubeVideos].sort((a, b) => {
    const scoreVideo = (v) => {
      let score = 0;
      const isTrailer = v.type === "Trailer";
      const isTeaser = v.type === "Teaser";
      const isOfficial = v.official === true || (v.name && /official/i.test(v.name));
      const isEnglish = v.iso_639_1 === "en" || !v.iso_639_1;
      const isMain = v.name && /(main|official|theatrical|final trailer)/i.test(v.name);
      const isBehindScenes = v.type === "Behind the Scenes" || v.type === "Featurette" || v.type === "Clip";

      if (isTrailer) score += 200;
      else if (isTeaser) score += 80;
      else if (isBehindScenes) score -= 50;

      if (isOfficial) score += 100;
      if (isEnglish) score += 40;
      if (isMain) score += 30;

      return score;
    };
    return scoreVideo(b) - scoreVideo(a);
  });

  return scored[0]?.key || null;
}

/**
 * Formats a raw TMDB /3/movie/{id}?append_to_response=... payload into CinemaVault's detail shape.
 */
export function formatTmdbMovieDetails(data, userRegion = "US") {
  if (!data || !data.id) return null;

  const directorObj = data.credits?.crew?.find(c => c.job === "Director");
  const director = directorObj?.name || "Unknown";
  const cinematographer = data.credits?.crew?.find(c => c.job === "Director of Photography")?.name || null;
  const composer = data.credits?.crew?.find(c => c.job === "Original Music Composer" || c.job === "Music")?.name || null;
  const writers = data.credits?.crew?.filter(c => ["Screenplay", "Writer", "Story"].includes(c.job)).map(c => c.name).slice(0, 3).join(", ") || null;

  const fallbackCrew = data.credits?.crew?.find(c => ["Director of Photography", "Original Music Composer", "Screenplay", "Writer"].includes(c.job));
  const crewPersonId = (directorObj || fallbackCrew)?.id || null;

  const cast = (data.credits?.cast || []).slice(0, 6).map(c => c.name).join(", ") || "N/A";
  const castIds = (data.credits?.cast || []).slice(0, 6).map(c => c.id);
  const castDetails = (data.credits?.cast || []).slice(0, 8).map(c => ({
    id: c.id,
    name: c.name,
    character: c.character,
    profile: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
  }));

  const tmdbKeywords = (data.keywords?.keywords || []).slice(0, 10).map(k => k.id);
  const keywordNames = (data.keywords?.keywords || []).slice(0, 10).map(k => k.name);
  const tmdbGenreIds = (data.genres || []).map(g => g.id);

  const trailerKey = extractOfficialTrailerKey(data.videos?.results || []);
  const trailerUrl = trailerKey ? `https://www.youtube.com/watch?v=${trailerKey}` : null;
  const imdbId = data.external_ids?.imdb_id || null;

  const providerRegion = (userRegion && userRegion !== "GLOBAL")
    ? (data["watch/providers"]?.results?.[userRegion] || data["watch/providers"]?.results?.US)
    : (data["watch/providers"]?.results?.US || Object.values(data["watch/providers"]?.results || {})[0]);

  const streamProviders = (providerRegion?.flatrate || []).map(p => ({
    id: p.provider_id,
    name: p.provider_name,
    logo: `https://image.tmdb.org/t/p/original${p.logo_path}`
  }));
  const buyRentProviders = (providerRegion?.rent || providerRegion?.buy || []).map(p => ({
    id: p.provider_id,
    name: p.provider_name,
    logo: `https://image.tmdb.org/t/p/original${p.logo_path}`
  }));
  const freeProviders = (providerRegion?.free || providerRegion?.ads || []).map(p => ({
    id: p.provider_id,
    name: p.provider_name,
    logo: `https://image.tmdb.org/t/p/original${p.logo_path}`
  }));

  // Extract US / Regional certification rating
  let mpaaRating = null;
  const usRelease = data.release_dates?.results?.find(r => r.iso_3166_1 === "US");
  if (usRelease?.release_dates) {
    const cert = usRelease.release_dates.find(d => d.certification)?.certification;
    if (cert) mpaaRating = cert;
  }

  return {
    tmdbId: data.id,
    imdbID: imdbId,
    title: data.title,
    original_title: data.original_title,
    year: data.release_date ? data.release_date.slice(0, 4) : "N/A",
    release_date: data.release_date,
    runtime: data.runtime ? `${data.runtime} min` : "N/A",
    runtimeMinutes: data.runtime || null,
    poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
    backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
    director,
    cinematographer,
    composer,
    writers,
    crewPersonId,
    cast,
    castIds,
    castDetails,
    tmdbKeywords,
    keywordNames,
    tmdbGenreIds,
    trailerUrl,
    trailerKey: trailerKey || null,
    genre: (data.genres || []).map(g => g.name).join(", ") || "Cinema",
    plot: data.overview || "",
    tagline: data.tagline || "",
    vote_average: data.vote_average ? Number(data.vote_average.toFixed(1)) : null,
    vote_count: data.vote_count || 0,
    popularity: data.popularity || 0,
    budget: data.budget ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(data.budget) : null,
    revenue: data.revenue ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(data.revenue) : null,
    productionCompanies: (data.production_companies || []).slice(0, 3).map(c => c.name).join(", ") || null,
    originCountry: (data.origin_country || data.production_countries?.map(c => c.iso_3166_1) || []).join(", ") || null,
    spokenLanguages: (data.spoken_languages || []).map(l => l.english_name).join(", ") || null,
    mpaaRating,
    streamProviders,
    buyRentProviders,
    freeProviders
  };
}

/**
 * Fetch detailed movie data with append_to_response=videos,credits,external_ids,watch/providers,keywords,release_dates
 */
export async function fetchTmdbMovieDetails(tmdbId, userRegion = "US") {
  if (!hasTmdbBackend() || !tmdbId) return null;

  try {
    const data = await fetchTmdbJson(`/3/movie/${tmdbId}`, {
      append_to_response: "videos,credits,external_ids,keywords,watch/providers,release_dates",
      language: "en-US"
    });
    return formatTmdbMovieDetails(data, userRegion);
  } catch (err) {
    console.warn("Failed to fetch detailed TMDB movie data:", err);
    return null;
  }
}

const SERIES_YEAR_RANGE_RE = /^\d{4}\s*[\u2013\u2014-]\s*(?:\d{4})?\s*$/;

function formatTmdbSearchStub(movie) {
  if (!movie || !Number.isSafeInteger(Number(movie.id))) return null;
  return {
    tmdbId: movie.id,
    title: movie.title,
    year: movie.release_date ? movie.release_date.slice(0, 4) : "N/A",
    poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
    backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
    overview: movie.overview,
    vote_average: movie.vote_average
  };
}

function normalizeMatchTitle(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^["']|["']$/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function selectStrictTitleYearCandidate(results, title, year) {
  const targetTitle = normalizeMatchTitle(title);
  const targetYearStr = normalizeYearKey(year);
  const targetYear = targetYearStr ? Number(targetYearStr) : NaN;
  if (!targetTitle || !Number.isInteger(targetYear)) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const candidate of Array.isArray(results) ? results : []) {
    if (!candidate || !Number.isSafeInteger(Number(candidate.id))) continue;
    const candYearStr = normalizeYearKey(candidate.release_date);
    if (!candYearStr) continue;
    const candYear = Number(candYearStr);
    const yearDiff = Math.abs(candYear - targetYear);
    if (yearDiff > 1) continue;

    const candTitle = normalizeMatchTitle(candidate.title);
    const candOriginal = normalizeMatchTitle(candidate.original_title);
    if (candTitle !== targetTitle && candOriginal !== targetTitle) continue;

    const score = (yearDiff === 0 ? 1000 : 0) + (candTitle === targetTitle ? 100 : 0) + Math.min(99, Number(candidate.popularity || 0));
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

async function lookupTmdbByImdbInternal(imdbId, options = {}) {
  if (!hasTmdbBackend(options) || !imdbId) return { kind: "error", match: null };
  try {
    const data = await fetchTmdbJson(`/3/find/${imdbId}`, {
      external_source: "imdb_id"
    }, options);
    if (!data || typeof data !== "object") return { kind: "error", match: null };
    const movie = data.movie_results?.[0];
    if (movie) return { kind: "movie", match: formatTmdbSearchStub(movie) };
    const hasTvMatch =
      (Array.isArray(data.tv_results) && data.tv_results.length > 0) ||
      (Array.isArray(data.tv_episode_results) && data.tv_episode_results.length > 0) ||
      (Array.isArray(data.tv_season_results) && data.tv_season_results.length > 0);
    if (hasTvMatch) return { kind: "series", match: null };
    return { kind: "none", match: null };
  } catch (err) {
    console.warn("TMDB find by IMDb ID failed:", err);
    return { kind: "error", match: null };
  }
}

/**
 * Reverse lookup TMDB movie by IMDb ID using /find/{external_id}
 */
export async function findTmdbByImdbId(imdbId, options = {}) {
  const res = await lookupTmdbByImdbInternal(imdbId, options);
  return res.kind === "movie" ? res.match : null;
}

async function lookupTmdbByTitleAndYearInternal(title, year, options = {}) {
  if (!hasTmdbBackend(options) || !title) return { kind: "error", match: null };
  const strict = options.strict === true;
  const cleanTitle = String(title).replace(/^["']|["']$/g, "").trim();
  const cleanYear = normalizeYearKey(year);
  if (strict && (!cleanTitle || !cleanYear)) {
    return { kind: "none", match: null };
  }
  try {
    const data = await fetchTmdbJson("/3/search/movie", {
      query: cleanTitle,
      include_adult: "false",
      ...(cleanYear ? { year: cleanYear } : {})
    }, options);
    if (!data || typeof data !== "object") return { kind: "error", match: null };
    const movie = strict
      ? selectStrictTitleYearCandidate(data.results, cleanTitle, cleanYear)
      : data.results?.[0];
    if (!movie) return { kind: "none", match: null };
    return { kind: "movie", match: formatTmdbSearchStub(movie) };
  } catch (err) {
    console.warn("TMDB search by title/year failed:", err);
    return { kind: "error", match: null };
  }
}

/**
 * Lookup TMDB movie by title and year
 */
export async function findTmdbByTitleAndYear(title, year, options = {}) {
  const res = await lookupTmdbByTitleAndYearInternal(title, year, options);
  return res.kind === "movie" ? res.match : null;
}

/**
 * Fallback luxury offline SVG poster
 */
export const getFallbackPoster = (title = "Film") => {
  const clean = String(title || "Film").replace(/["<>]/g, "");
  const displayTitle = clean.length > 20 ? clean.substring(0, 18) + '...' : clean;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 450" width="100%" height="100%"><rect width="100%" height="100%" fill="#141416"/><rect x="10" y="10" width="280" height="430" fill="none" stroke="#e2b13c" stroke-width="1.5" stroke-opacity="0.2" rx="4"/><path d="M150 130 L180 190 L120 190 Z" fill="#e2b13c" fill-opacity="0.2"/><circle cx="150" cy="160" r="40" fill="none" stroke="#e2b13c" stroke-opacity="0.35" stroke-width="1.5"/><text x="50%" y="275" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="18" font-weight="600" fill="#f4f4f2" text-anchor="middle">${displayTitle}</text><text x="50%" y="310" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="500" fill="#b6b6b2" letter-spacing="2" text-anchor="middle">CINEMAVAULT</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/**
 * TMDB-to-OMDb Schema Bridge
 * Enriches saved records with castIds, tmdbKeywords, tmdbGenreIds, streamProviders, and trailerKey
 */
export async function bridgeTmdbToOmdb(tmdbMovie, userRegion = "US") {
  if (!tmdbMovie) return null;

  const tmdbId = tmdbMovie.tmdbId || tmdbMovie.id;

  if (tmdbId) {
    const details = await fetchTmdbMovieDetails(tmdbId, userRegion);
    if (details && details.imdbID) {
      return {
        imdbID: details.imdbID,
        tmdbId: details.tmdbId,
        title: details.title || tmdbMovie.title,
        year: details.year || tmdbMovie.year || "N/A",
        poster: details.poster || tmdbMovie.poster || getFallbackPoster(tmdbMovie.title),
        backdrop: details.backdrop || tmdbMovie.backdrop || null,
        runtime: details.runtime || "N/A",
        genre: details.genre || tmdbMovie.genre || "N/A",
        tmdbGenreIds: details.tmdbGenreIds || [],
        imdbRating: details.vote_average ? String(details.vote_average) : (tmdbMovie.imdbRating || "N/A"),
        director: details.director || "Unknown",
        cast: details.cast || "N/A",
        castIds: details.castIds || [],
        crewPersonId: details.crewPersonId || null,
        tmdbKeywords: details.tmdbKeywords || [],
        trailerKey: details.trailerKey || null,
        streamProviders: details.streamProviders || [],
        userRating: 0
      };
    }
  }

  // Fallback: search OMDb by title and year
  const cleanTitle = (tmdbMovie.title || tmdbMovie.Title || "").replace(/^["']|["']$/g, "").trim();
  const cleanYear = tmdbMovie.year || tmdbMovie.release_date
    ? String(tmdbMovie.year || tmdbMovie.release_date).match(/\d{4}/)?.[0]
    : "";

  try {
    const data = await fetchOmdbJson({
      t: cleanTitle,
      ...(cleanYear ? { y: cleanYear } : {})
    });

    if (data?.Response === "True" && data.imdbID) {
      return {
        imdbID: data.imdbID,
        tmdbId: tmdbId || null,
        title: data.Title || cleanTitle,
        year: data.Year || cleanYear || "N/A",
        poster: tmdbMovie.poster || (data.Poster !== "N/A" ? data.Poster : getFallbackPoster(cleanTitle)),
        runtime: data.Runtime && data.Runtime !== "N/A" ? data.Runtime : "N/A",
        genre: data.Genre && data.Genre !== "N/A" ? data.Genre : (tmdbMovie.genre || "N/A"),
        tmdbGenreIds: mapOmdbToTmdbGenreIds(data.Genre || ""),
        imdbRating: data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : (tmdbMovie.imdbRating || "N/A"),
        director: data.Director || "Unknown",
        cast: data.Actors || "N/A",
        castIds: [],
        tmdbKeywords: [],
        userRating: 0
      };
    }
  } catch (e) {
    console.warn("Bridge OMDb lookup failed for TMDB candidate:", cleanTitle, e);
  }

  return {
    imdbID: `tmdb_${tmdbId || cleanTitle.replace(/\s+/g, '_')}`,
    tmdbId: tmdbId || null,
    title: cleanTitle,
    year: cleanYear || "N/A",
    poster: tmdbMovie.poster || getFallbackPoster(cleanTitle),
    runtime: "N/A",
    genre: tmdbMovie.genre || "Cinema",
    tmdbGenreIds: [],
    imdbRating: tmdbMovie.imdbRating || "N/A",
    castIds: [],
    tmdbKeywords: [],
    userRating: 0
  };
}


const embeddingDetailCache = new Map();

async function getCachedTmdbDetails(id, userRegion = "US", detailFetcher = null) {
  if (!id) return null;
  if (typeof detailFetcher === "function") {
    return await detailFetcher(id, userRegion);
  }
  const cacheKey = `${userRegion}:${id}`;
  if (embeddingDetailCache.has(cacheKey)) {
    return embeddingDetailCache.get(cacheKey);
  }
  const details = await fetchTmdbMovieDetails(id, userRegion);
  if (details) embeddingDetailCache.set(cacheKey, details);
  return details;
}

export async function fetchBatchFormattedDetailsMap(ids = [], userRegion = "US", options = {}) {
  const resultMap = new Map();
  const useMemCache = !options.fetchFn && !options.cacheStore && options.bypassCache !== true;
  const uncachedIds = [];
  for (const rawId of ids) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const cacheKey = `${userRegion}:${id}`;
    if (useMemCache && embeddingDetailCache.has(cacheKey)) {
      resultMap.set(id, embeddingDetailCache.get(cacheKey));
    } else if (!resultMap.has(id)) {
      uncachedIds.push(id);
    }
  }

  if (uncachedIds.length === 0) return resultMap;

  const rawBatch = await getMovieDetailsBatch(uncachedIds, {
    language: "en-US",
    concurrency: options.concurrency,
    fetchFn: options.fetchFn,
    apiKey: options.apiKey,
    forceProxy: options.forceProxy,
    cacheStore: options.cacheStore,
    indexedDB: options.indexedDB,
    signal: options.signal
  });

  for (const [key, rawMovie] of Object.entries(rawBatch || {})) {
    const formatted = formatTmdbMovieDetails(rawMovie, userRegion);
    if (formatted && formatted.tmdbId) {
      embeddingDetailCache.set(`${userRegion}:${formatted.tmdbId}`, formatted);
      resultMap.set(Number(formatted.tmdbId || key), formatted);
    }
  }

  return resultMap;
}

function pickRichValue(detailsVal, existingVal, maxArrayItems = null) {
  const normalize = (val) => {
    if (Array.isArray(val)) {
      return val.length > 0 ? (maxArrayItems ? val.slice(0, maxArrayItems) : val) : null;
    }
    if (typeof val === "string") {
      const cleaned = val.trim();
      return cleaned && !/^n\/a$/i.test(cleaned) ? cleaned : null;
    }
    return null;
  };
  return normalize(detailsVal) ?? normalize(existingVal);
}

function pickEnrichedDetails(existing = {}, details = {}) {
  const cast = pickRichValue(details.cast, existing.cast, 5);
  const writers = pickRichValue(details.writers, existing.writers, 3);
  const keywordNames = pickRichValue(details.keywordNames, existing.keywordNames);
  const spokenLanguages = pickRichValue(details.spokenLanguages, existing.spokenLanguages);
  const originCountry = pickRichValue(details.originCountry, existing.originCountry);
  const tagline = pickRichValue(details.tagline, existing.tagline);
  const mpaaRating = pickRichValue(details.mpaaRating, existing.mpaaRating);
  const rawRuntime = Number(details.runtimeMinutes);
  const existingRuntime = Number(existing.runtimeMinutes);
  const runtimeMinutes = Number.isFinite(rawRuntime) && rawRuntime > 0
    ? rawRuntime
    : (Number.isFinite(existingRuntime) && existingRuntime > 0 ? existingRuntime : null);

  return {
    ...(cast ? { cast } : {}),
    ...(writers ? { writers } : {}),
    ...(keywordNames ? { keywordNames } : {}),
    ...(spokenLanguages ? { spokenLanguages } : {}),
    ...(originCountry ? { originCountry } : {}),
    ...(tagline ? { tagline } : {}),
    ...(mpaaRating ? { mpaaRating } : {}),
    runtimeMinutes
  };
}

export function applyDetailsToCandidate(existing, details) {
  if (!details) {
    return {
      ...existing,
      hydrated: false,
      features: {
        ...(existing.features || {}),
        hydrated: false
      }
    };
  }
  return {
    ...existing,
    ...pickEnrichedDetails(existing, details),
    overview: existing.overview || details.plot || details.overview || "",
    director: details.director || existing.director,
    crewPersonId: details.crewPersonId ?? existing.crewPersonId ?? null,
    castIds: Array.isArray(details.castIds) ? details.castIds : (existing.castIds || []),
    tmdbKeywords: Array.isArray(details.tmdbKeywords) ? details.tmdbKeywords : (existing.tmdbKeywords || []),
    keywordNames: Array.isArray(details.keywordNames) ? details.keywordNames : (existing.keywordNames || []),
    tmdbGenreIds: Array.isArray(details.tmdbGenreIds) ? details.tmdbGenreIds : (existing.tmdbGenreIds || existing.genre_ids || []),
    streamProviders: Array.isArray(details.streamProviders) ? details.streamProviders : (existing.streamProviders || []),
    freeProviders: Array.isArray(details.freeProviders) ? details.freeProviders : (existing.freeProviders || []),
    providersHydrated: true,
    hydrated: true,
    features: {
      ...(existing.features || {}),
      hydrated: true
    },
    imdbID: details.imdbID ?? existing.imdbID ?? null,
    sourceBucket: existing.sourceBucket,
    providerMatchedByQuery: existing.providerMatchedByQuery,
    collabSim: existing.collabSim
  };
}

/**
 * Batch metadata enrichment for Bucket A-D candidates so the ranker receives real
 * tmdbKeywords, castIds, crewPersonId, and streamProviders without exhausting TMDB/proxy rate limits.
 * Uses IndexedDB-cached /api/tmdb-batch lookups by default (and respects injected options.detailFetcher).
 */
export async function enrichCandidatePoolMetadata(candidates = [], options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const maxEnrich = Math.max(0, options.maxEnrich ?? candidates.length);
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const userRegion = options.userRegion || "US";
  const detailFetcher = typeof options.detailFetcher === "function" ? options.detailFetcher : null;

  const out = candidates.map((c) => {
    if (!c) return c;
    const alreadyHydrated =
      c.hydrated ??
      c.features?.hydrated ??
      (Array.isArray(c.tmdbKeywords) && Array.isArray(c.castIds));
    return {
      ...c,
      hydrated: Boolean(alreadyHydrated),
      features: {
        ...(c.features || {}),
        hydrated: Boolean(alreadyHydrated)
      }
    };
  });

  const pendingIndices = [];
  for (let i = 0; i < out.length && pendingIndices.length < maxEnrich; i++) {
    const c = out[i];
    if (!c) continue;
    const tmdbId = Number(c.tmdbId ?? c.id ?? 0);
    if (!tmdbId) continue;
    const needsEnrich = !Array.isArray(c.tmdbKeywords) || !Array.isArray(c.castIds);
    if (needsEnrich) {
      pendingIndices.push({ idx: i, tmdbId });
    }
  }

  if (pendingIndices.length === 0) return out;

  if (!detailFetcher) {
    try {
      const detailsMap = await fetchBatchFormattedDetailsMap(
        pendingIndices.map((p) => p.tmdbId),
        userRegion,
        options
      );
      for (const { idx, tmdbId } of pendingIndices) {
        out[idx] = applyDetailsToCandidate(out[idx], detailsMap.get(tmdbId) || null);
      }
    } catch (_) {
      // Keep unhydrated candidates intact on batch failure
    }
    return out;
  }

  let cursor = 0;
  async function worker() {
    while (true) {
      const slot = cursor++;
      if (slot >= pendingIndices.length) return;
      const { idx, tmdbId } = pendingIndices[slot];
      try {
        const details = await getCachedTmdbDetails(tmdbId, userRegion, detailFetcher);
        out[idx] = applyDetailsToCandidate(out[idx], details || null);
      } catch (_) {
        // Keep unhydrated candidate intact when detail lookup fails
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pendingIndices.length) }, worker));
  return out;
}

/**
 * Enriches top embedding-retrieved neighbor IDs with TMDB metadata (batched & cached)
 * and tags them as "Bucket E (Embedding)" so they enter the candidate pool with full features.
 */
export async function fetchEmbeddingCandidates(
  neighbors = [],
  watchedMovies = [],
  watchlistMovies = [],
  existingCandidates = [],
  options = {}
) {
  if (!Array.isArray(neighbors) || neighbors.length === 0) return [];

  const maxNeighbors = options.maxNeighbors ?? 30;
  const maxScan = options.maxScan ?? Math.max(maxNeighbors * 2, 80);
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const userRegion = options.userRegion || "US";
  const userProviders = options.userProviders || [];
  const mood = options.mood || "any";
  const moodFilters = options.moodFilters || null;
  const explicitMood = isExplicitMoodActive(mood, moodFilters);
  const hasProviderFilter = Array.isArray(userProviders) && userProviders.length > 0;
  const customFetcher = typeof options.detailFetcher === "function" ? options.detailFetcher : null;

  const seenIds = new Set([
    ...(watchedMovies || []).map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
    ...(watchlistMovies || []).map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
    ...(existingCandidates || []).map(m => Number(m?.tmdbId ?? m?.id ?? 0))
  ]);
  seenIds.delete(0);

  const unseen = [];
  for (const n of neighbors) {
    const id = Number(n?.tmdbId ?? n?.id ?? 0);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    unseen.push({ tmdbId: id, collabSim: Number(n?.collabSim ?? 0) });
    if (unseen.length >= maxScan) break;
  }

  if (unseen.length === 0) return [];

  const detailsById = !customFetcher
    ? await fetchBatchFormattedDetailsMap(unseen.map((u) => u.tmdbId), userRegion, options)
    : null;

  const results = new Array(unseen.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= unseen.length) return;
      const item = unseen[idx];
      try {
        const details = customFetcher
          ? await getCachedTmdbDetails(item.tmdbId, userRegion, customFetcher)
          : (detailsById?.get(item.tmdbId) || null);
        if (!details) continue;
        const candidate = {
          id: details.tmdbId || item.tmdbId,
          tmdbId: details.tmdbId || item.tmdbId,
          imdbID: details.imdbID || null,
          title: details.title || "Unknown",
          year: details.year || "N/A",
          release_date: details.release_date || null,
          overview: details.plot || details.overview || "",
          vote_average: details.vote_average ?? null,
          vote_count: details.vote_count ?? 0,
          popularity: details.popularity ?? 0,
          genre_ids: details.tmdbGenreIds || details.genre_ids || [],
          tmdbGenreIds: details.tmdbGenreIds || details.genre_ids || [],
          tmdbKeywords: details.tmdbKeywords || [],
          keywordNames: details.keywordNames || [],
          castIds: details.castIds || [],
          crewPersonId: details.crewPersonId || null,
          director: details.director || "Unknown",
          genre: details.genre || "Cinema",
          poster: details.poster || null,
          backdrop: details.backdrop || null,
          streamProviders: details.streamProviders || [],
          freeProviders: details.freeProviders || [],
          ...pickEnrichedDetails({}, details),
          providersHydrated: true,
          hydrated: true,
          features: { hydrated: true },
          collabSim: item.collabSim,
          sourceBucket: "Bucket E (Embedding)",
          providerMatchedByQuery: hasProviderFilter ? matchesWatchProviders(details, userProviders) : false
        };
        if (explicitMood && !matchesMoodCandidateGate(candidate, mood, moodFilters)) {
          continue;
        }
        if (hasProviderFilter && !matchesWatchProviders(candidate, userProviders)) {
          continue;
        }
        results[idx] = candidate;
      } catch (_) {
        // Skip failed neighbor fetches gracefully
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, unseen.length) }, worker));
  return results.filter(Boolean).slice(0, maxNeighbors);
}

/**
 * Returns true when a vault record represents a TV series or episode via Type or year range.
 */
export function isSeriesVaultItem(item) {
  if (!item || typeof item !== "object") return false;
  const explicitType = String(item.Type ?? item.type ?? item.mediaType ?? item.media_type ?? "")
    .trim()
    .toLowerCase();
  if (
    explicitType === "series" ||
    explicitType === "tv" ||
    explicitType === "episode" ||
    explicitType === "mini-series"
  ) {
    return true;
  }
  const rawYear = String(item.year ?? item.Year ?? "").trim();
  return SERIES_YEAR_RANGE_RE.test(rawYear);
}

/**
 * Returns true when an entry already carries a positive integer tmdbId plus keyword and cast arrays.
 */
export function hasCompleteTmdbMetadata(item) {
  const tmdbId = extractTmdbNumericId(item?.tmdbId);
  if (!tmdbId) return false;
  return Array.isArray(item?.tmdbKeywords) && Array.isArray(item?.castIds);
}

/**
 * Computes a stable key for backfill deduplication across mounts/sessions.
 */
export function getVaultBackfillItemKey(item) {
  if (!item || typeof item !== "object") return "";
  const rawImdb = String(item.imdbID || "").trim();
  if (/^tt\d+$/i.test(rawImdb)) return `imdb:${rawImdb.toLowerCase()}`;
  const tmdbId = extractTmdbNumericId(item.tmdbId);
  if (tmdbId) return `tmdb:${tmdbId}`;
  const titleKey = normalizeTitleKey(item.title || item.Title);
  const yearKey = normalizeYearKey(item.year || item.Year || item.release_date);
  if (titleKey) return yearKey ? `ty:${titleKey}::${yearKey}` : `ty:${titleKey}`;
  const rawId = item.id !== null && item.id !== undefined ? String(item.id).trim().toLowerCase() : "";
  return rawId ? `raw:${rawId}` : "";
}

export function mergeBackfilledMovieMetadata(item, tmdbId, details, stub) {
  const existingImdb = String(item.imdbID || "").trim();
  const safeImdbId = /^tt\d+$/i.test(existingImdb)
    ? existingImdb
    : (details?.imdbID || item.imdbID || undefined);

  const hasValidLowerPoster =
    typeof item.poster === "string" && item.poster.trim() !== "" && item.poster !== "N/A";
  const upperPoster =
    typeof item.Poster === "string" && item.Poster.trim() !== "" && item.Poster !== "N/A"
      ? item.Poster
      : null;
  const resolvedPoster = hasValidLowerPoster
    ? item.poster
    : (details?.poster || stub?.poster || upperPoster || "N/A");

  const next = {
    ...item,
    tmdbId,
    poster: resolvedPoster,
    ...(safeImdbId ? { imdbID: safeImdbId } : {}),
    ...(!item.Type && !item.type ? { Type: "movie" } : {}),
    ...(!item.title ? { title: item.Title || details?.title || stub?.title } : {}),
    ...(!item.year ? { year: item.Year || details?.year || stub?.year || "N/A" } : {})
  };

  if (details) {
    Object.assign(next, pickEnrichedDetails(next, details));
    if (Array.isArray(details.tmdbGenreIds)) next.tmdbGenreIds = details.tmdbGenreIds;
    if (Array.isArray(details.tmdbKeywords)) next.tmdbKeywords = details.tmdbKeywords;
    if (Array.isArray(details.castIds)) next.castIds = details.castIds;
    if (details.crewPersonId !== undefined) next.crewPersonId = details.crewPersonId;
    if (!next.genre && details.genre) next.genre = details.genre;
    if ((!next.director || next.director === "Unknown") && details.director) next.director = details.director;
    if (!next.release_date && details.release_date) next.release_date = details.release_date;
    if (!next.backdrop && details.backdrop) next.backdrop = details.backdrop;
  } else if (!next.backdrop && stub?.backdrop) {
    next.backdrop = stub.backdrop;
  }

  return next;
}

/**
 * Lazily resolves missing TMDB IDs and metadata on watched/watchlist items without ever
 * attaching movie IDs to TV series or overwriting user ratings/dates.
 */
export async function backfillMissingTmdbIds(watched = [], watchlist = [], options = {}) {
  const safeWatched = Array.isArray(watched) ? watched : [];
  const safeWatchlist = Array.isArray(watchlist) ? watchlist : [];
  const nextWatched = safeWatched.slice();
  const nextWatchlist = safeWatchlist.slice();

  const detailFetcher = typeof options.detailFetcher === "function" ? options.detailFetcher : null;
  if (!hasTmdbBackend(options) && !detailFetcher) {
    return {
      watched: nextWatched,
      watchlist: nextWatchlist,
      updatedCount: 0,
      enrichedCount: 0,
      seriesTaggedCount: 0,
      skippedCount: safeWatched.length + safeWatchlist.length,
      resolvedIds: [],
      checkedKeys: [],
      rateLimited: false
    };
  }

  const maxItems = Math.max(0, Number.isFinite(Number(options.maxItems)) ? Number(options.maxItems) : 40);
  const maxLookups = Math.max(0, Number.isFinite(Number(options.maxLookups)) ? Number(options.maxLookups) : maxItems);
  const lookupConcurrency = Math.max(1, Math.min(4, Number(options.lookupConcurrency) || 3));
  const userRegion = options.userRegion || "US";
  const checkedSet = new Set(options.alreadyChecked ? [...options.alreadyChecked] : []);
  const newlyCheckedKeys = [];

  let updatedCount = 0;
  let enrichedCount = 0;
  let seriesTaggedCount = 0;
  let skippedCount = 0;
  let lookupCount = 0;
  const pending = [];

  const scanList = (listRef, listName) => {
    for (let idx = 0; idx < listRef.length; idx++) {
      const item = listRef[idx];
      if (!item || typeof item !== "object") {
        skippedCount++;
        continue;
      }

      const checkKey = getVaultBackfillItemKey(item);
      if (isSeriesVaultItem(item)) {
        if (!item.Type && !item.type) {
          listRef[idx] = { ...item, Type: "series" };
          seriesTaggedCount++;
          updatedCount++;
        } else {
          skippedCount++;
        }
        if (checkKey && !checkedSet.has(checkKey)) {
          checkedSet.add(checkKey);
          newlyCheckedKeys.push(checkKey);
        }
        continue;
      }

      if (hasCompleteTmdbMetadata(item)) {
        skippedCount++;
        continue;
      }

      if (checkKey && checkedSet.has(checkKey)) {
        skippedCount++;
        continue;
      }

      const existingTmdbId = extractTmdbNumericId(item.tmdbId);
      if (pending.length >= maxItems || (!existingTmdbId && lookupCount >= maxLookups)) {
        skippedCount++;
        continue;
      }
      if (!existingTmdbId) lookupCount++;

      pending.push({
        listRef,
        listName,
        idx,
        item,
        checkKey,
        existingTmdbId,
        tmdbId: existingTmdbId,
        stub: null,
        detectedSeries: false,
        definitiveMiss: false
      });
    }
  };

  scanList(nextWatched, "watched");
  scanList(nextWatchlist, "watchlist");

  if (pending.length === 0) {
    return {
      watched: nextWatched,
      watchlist: nextWatchlist,
      updatedCount,
      enrichedCount,
      seriesTaggedCount,
      skippedCount,
      resolvedIds: [],
      checkedKeys: newlyCheckedKeys,
      rateLimited: false
    };
  }

  let rateLimited = false;
  const lookupOptions = {
    ...options,
    onHttpError: (status, res) => {
      if (status === 429) rateLimited = true;
      options.onHttpError?.(status, res);
    }
  };

  const toLookup = pending.filter((p) => !p.existingTmdbId);
  let cursor = 0;
  async function lookupWorker() {
    while (true) {
      if (rateLimited || options.signal?.aborted) return;
      const slot = cursor++;
      if (slot >= toLookup.length) return;
      const entry = toLookup[slot];
      const item = entry.item;

      const rawImdb = String(item.imdbID || "").trim();
      const validImdb = /^tt\d+$/i.test(rawImdb) ? rawImdb : "";
      let imdbOutcome = null;

      if (validImdb) {
        imdbOutcome = await lookupTmdbByImdbInternal(validImdb, lookupOptions);
        if (rateLimited || options.signal?.aborted) return;
        if (imdbOutcome.kind === "series") {
          entry.detectedSeries = true;
          continue;
        }
        if (imdbOutcome.kind === "movie" && imdbOutcome.match?.tmdbId) {
          entry.tmdbId = imdbOutcome.match.tmdbId;
          entry.stub = imdbOutcome.match;
          continue;
        }
      }

      if (!entry.tmdbId && !entry.detectedSeries && (!validImdb || imdbOutcome?.kind === "none")) {
        const searchTitle = item.title || item.Title || "";
        const searchYear = item.year || item.Year || item.release_date || "";
        const titleOutcome = await lookupTmdbByTitleAndYearInternal(searchTitle, searchYear, {
          ...lookupOptions,
          strict: true
        });
        if (rateLimited || options.signal?.aborted) return;
        if (titleOutcome.kind === "movie" && titleOutcome.match?.tmdbId) {
          entry.tmdbId = titleOutcome.match.tmdbId;
          entry.stub = titleOutcome.match;
        } else if (titleOutcome.kind === "none") {
          entry.definitiveMiss = true;
        }
      }
    }
  }

  if (toLookup.length > 0 && hasTmdbBackend(options)) {
    await Promise.all(
      Array.from({ length: Math.min(lookupConcurrency, toLookup.length) }, lookupWorker)
    );
  }

  const batchIds = [];
  const seenBatchIds = new Set();
  for (const entry of pending) {
    if (!entry.detectedSeries && entry.tmdbId && !seenBatchIds.has(entry.tmdbId)) {
      seenBatchIds.add(entry.tmdbId);
      batchIds.push(entry.tmdbId);
    }
  }

  let detailsById = new Map();
  if (batchIds.length > 0 && !rateLimited && !options.signal?.aborted) {
    try {
      if (detailFetcher) {
        await Promise.all(
          batchIds.map(async (id) => {
            const d = await getCachedTmdbDetails(id, userRegion, detailFetcher);
            if (d && d.tmdbId) detailsById.set(id, d);
          })
        );
      } else {
        detailsById = await fetchBatchFormattedDetailsMap(batchIds, userRegion, lookupOptions);
      }
    } catch (_) {
      // Preserve ID resolution results even if detail batch hydration fails partially
    }
  }

  const resolvedIds = [];
  for (const entry of pending) {
    const { listRef, idx, item, checkKey } = entry;
    if (entry.detectedSeries) {
      listRef[idx] = { ...item, Type: "series" };
      seriesTaggedCount++;
      updatedCount++;
      if (checkKey && !checkedSet.has(checkKey)) {
        checkedSet.add(checkKey);
        newlyCheckedKeys.push(checkKey);
      }
      continue;
    }

    const details = entry.tmdbId ? (detailsById.get(entry.tmdbId) || null) : null;
    if (entry.tmdbId && (!entry.existingTmdbId || details)) {
      const merged = mergeBackfilledMovieMetadata(item, entry.tmdbId, details, entry.stub);
      listRef[idx] = merged;
      updatedCount++;
      enrichedCount++;
      resolvedIds.push(entry.tmdbId);
      if (checkKey && hasCompleteTmdbMetadata(merged) && !checkedSet.has(checkKey)) {
        checkedSet.add(checkKey);
        newlyCheckedKeys.push(checkKey);
      }
      continue;
    }

    if (entry.definitiveMiss && !rateLimited && checkKey && !checkedSet.has(checkKey)) {
      checkedSet.add(checkKey);
      newlyCheckedKeys.push(checkKey);
    }
  }

  return {
    watched: nextWatched,
    watchlist: nextWatchlist,
    updatedCount,
    enrichedCount,
    seriesTaggedCount,
    skippedCount,
    resolvedIds,
    checkedKeys: newlyCheckedKeys,
    rateLimited
  };
}
