/**
 * Canonical mood presets, recommendation count constants, and custom vibe
 * normalization shared across retrieval, ranking, Gemini curation, and UI.
 */

export const DEFAULT_RECOMMENDATION_COUNT = 10;
export const MIN_VALID_CACHE_COUNT = 7;

export const GENRE_NAME_TO_ID = {
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
  "sci fi": 878,
  "science fiction": 878,
  scifi: 878,
  "tv movie": 10770,
  thriller: 53,
  war: 10752,
  western: 37
};

export const GENRE_ID_TO_NAME = Object.entries(GENRE_NAME_TO_ID).reduce((acc, [name, id]) => {
  if (!acc[id]) {
    acc[id] = name === "sci-fi" ? "Sci-Fi" : name.charAt(0).toUpperCase() + name.slice(1);
  }
  return acc;
}, {});

export const MOOD_OPTIONS = [
  {
    id: "any",
    label: "Any Vibe",
    desc: "Peak curated cinema",
    preferredGenreIds: [],
    requiredAnyGenreIds: [],
    discouragedGenreIds: [],
    withoutGenreIds: [],
    sortBy: "vote_average.desc",
    voteAverageGte: 6.8,
    voteCountGte: 200,
    voteCountLte: null,
    relaxCastLock: false,
    promptDirective: "Match the viewer's core taste profile across top-tier cinema."
  },
  {
    id: "mind-bending",
    label: "Mind-Bending",
    desc: "Plot twists & cerebral puzzles",
    preferredGenreIds: [9648, 878],
    requiredAnyGenreIds: [9648, 878, 53],
    discouragedGenreIds: [10751, 35, 10749, 10402, 12, 80, 36, 10752],
    withoutGenreIds: [10751, 35, 10749],
    sortBy: "vote_average.desc",
    voteAverageGte: 7.5,
    voteCountGte: 250,
    voteCountLte: null,
    relaxCastLock: true,
    promptDirective:
      "Prioritize twisty, reality-bending, nonlinear, or intellectually demanding puzzle films (Mystery, Sci-Fi, Psychological Drama)."
  },
  {
    id: "dark-thriller",
    label: "Dark Thriller",
    desc: "Gritty neo-noir & tension",
    preferredGenreIds: [80, 53, 9648],
    requiredAnyGenreIds: [80, 53, 9648, 27],
    discouragedGenreIds: [10751, 35, 16, 10402, 10749, 12, 878, 14],
    withoutGenreIds: [10751, 35, 16, 10402, 12, 878, 14],
    sortBy: "popularity.desc",
    voteAverageGte: 6.8,
    voteCountGte: 120,
    voteCountLte: null,
    relaxCastLock: true,
    promptDirective:
      "Prioritize brooding tension, neo-noir dread, crime, psychological menace, and morally gray stakes."
  },
  {
    id: "fun-popcorn",
    label: "Fun Popcorn",
    desc: "High-energy crowd pleasers",
    preferredGenreIds: [28, 12, 35, 16],
    requiredAnyGenreIds: [28, 12, 35, 16],
    discouragedGenreIds: [99, 27, 10752, 36, 53, 80],
    withoutGenreIds: [99, 27, 10752, 36],
    sortBy: "popularity.desc",
    voteAverageGte: 6.5,
    voteCountGte: 250,
    voteCountLte: null,
    relaxCastLock: true,
    promptDirective:
      "Prioritize brisk pacing, spectacle, charisma, humor, and thrilling entertainment value."
  },
  {
    id: "comfort-watch",
    label: "Comfort Watch",
    desc: "Heartwarming & rewatchable",
    preferredGenreIds: [35, 10751, 10749, 16],
    requiredAnyGenreIds: [35, 10751, 10749, 16],
    discouragedGenreIds: [27, 53, 80, 10752],
    withoutGenreIds: [27, 53, 80, 10752],
    sortBy: "vote_average.desc",
    voteAverageGte: 7.2,
    voteCountGte: 180,
    voteCountLte: null,
    relaxCastLock: true,
    promptDirective:
      "Prioritize warmth, wit, emotional uplift, charm, and rewatchability; avoid bleak horror, serial-killer grimness, or suffocating dread."
  },
  {
    id: "hidden-gem",
    label: "Hidden Gem",
    desc: "Underrated masterworks",
    preferredGenreIds: [],
    requiredAnyGenreIds: [],
    discouragedGenreIds: [],
    withoutGenreIds: [],
    sortBy: "vote_average.desc",
    voteAverageGte: 7.0,
    voteCountGte: 50,
    voteCountLte: 2000,
    relaxCastLock: true,
    promptDirective:
      "Prioritize underseen, lesser-known, cult, international, or indie standouts (<2,000 TMDB votes where possible) over ubiquitous blockbusters."
  }
];

const MOOD_PRESET_MAP = new Map(MOOD_OPTIONS.map((m) => [m.id, m]));

/**
 * Resolve a canonical mood preset object, defaulting to `"any"`.
 */
export function getMoodPreset(moodId = "any") {
  const key = String(moodId || "any").trim().toLowerCase();
  return MOOD_PRESET_MAP.get(key) || MOOD_PRESET_MAP.get("any");
}

function clampYear(val) {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  const yr = Math.round(num);
  return yr >= 1900 && yr <= 2100 ? yr : null;
}

function resolveGenreId(token) {
  if (typeof token === "number" && Number.isFinite(token) && token > 0) {
    return token;
  }
  const str = String(token || "").trim().toLowerCase();
  if (!str) return null;
  if (/^\d+$/.test(str)) return Number(str);
  return GENRE_NAME_TO_ID[str] ?? null;
}

/**
 * Normalize free-text / Gemini-parsed custom mood filters into a canonical object,
 * or return `null` when no effective constraints exist.
 */
export function normalizeMoodFilters(raw = null) {
  if (!raw || typeof raw !== "object") return null;

  const query = typeof raw.query === "string" ? raw.query.trim() : "";
  const rawMood = typeof raw.moodId === "string" ? raw.moodId.trim().toLowerCase() : "any";
  const moodId = MOOD_PRESET_MAP.has(rawMood) ? rawMood : "any";

  const idSet = new Set();
  const genreTokens = [
    ...(Array.isArray(raw.withGenreIds) ? raw.withGenreIds : []),
    ...(Array.isArray(raw.withGenres) ? raw.withGenres : [])
  ];
  for (const token of genreTokens) {
    const id = resolveGenreId(token);
    if (id) idSet.add(id);
  }
  const withGenreIds = Array.from(idSet).sort((a, b) => a - b);

  const rawGenreNames = Array.isArray(raw.withGenres) ? raw.withGenres : [];
  const genreNameSet = new Set(
    rawGenreNames.map((g) => String(g || "").trim()).filter(Boolean)
  );
  for (const id of withGenreIds) {
    if (GENRE_ID_TO_NAME[id] && genreNameSet.size < withGenreIds.length) {
      genreNameSet.add(GENRE_ID_TO_NAME[id]);
    }
  }
  const withGenres = withGenreIds
    .map((id) => GENRE_ID_TO_NAME[id])
    .filter(Boolean);

  const kwSet = new Set();
  for (const kw of Array.isArray(raw.withoutKeywords) ? raw.withoutKeywords : []) {
    const clean = String(kw || "").trim().toLowerCase();
    if (clean) kwSet.add(clean);
  }
  const withoutKeywords = Array.from(kwSet).sort();

  let minYear = clampYear(raw.minYear);
  let maxYear = clampYear(raw.maxYear);
  if (minYear !== null && maxYear !== null && minYear > maxYear) {
    [minYear, maxYear] = [maxYear, minYear];
  }

  const hasCustomConstraint =
    Boolean(query) ||
    withGenreIds.length > 0 ||
    withoutKeywords.length > 0 ||
    minYear !== null ||
    maxYear !== null;

  if (!hasCustomConstraint) {
    return null;
  }

  return {
    query,
    moodId,
    withGenreIds,
    withGenres: withGenres.length > 0 ? withGenres : Array.from(genreNameSet),
    withoutKeywords,
    minYear,
    maxYear
  };
}

/**
 * Extracts normalized numeric TMDB genre IDs from a candidate across TMDB/OMDb shapes.
 */
export function extractGenreIdsFromCandidate(candidate = {}) {
  const ids = new Set();
  for (const arr of [candidate.tmdbGenreIds, candidate.genre_ids, candidate.genres]) {
    if (!Array.isArray(arr)) continue;
    for (const g of arr) {
      if (typeof g === "number" && Number.isFinite(g) && g > 0) {
        ids.add(g);
      } else if (g && typeof g === "object" && Number.isFinite(Number(g.id))) {
        ids.add(Number(g.id));
      } else if (typeof g === "string") {
        const mapped = resolveGenreId(g);
        if (mapped) ids.add(mapped);
      }
    }
  }
  for (const strField of [candidate.genre, candidate.Genre]) {
    if (typeof strField === "string" && strField.trim() && strField !== "N/A") {
      for (const token of strField.split(",")) {
        const mapped = resolveGenreId(token);
        if (mapped) ids.add(mapped);
      }
    }
  }
  return ids;
}

/**
 * Hard eligibility gate for candidates under an explicit mood or custom vibe filter.
 * Always returns true in unconstrained "any" mode.
 */
export function matchesMoodCandidateGate(candidate = {}, mood = "any", moodFilters = null) {
  const normalizedFilters = normalizeMoodFilters(moodFilters);
  const rawMood = typeof mood === "string" ? mood.trim().toLowerCase() : "any";
  const effectiveMood =
    normalizedFilters?.moodId && normalizedFilters.moodId !== "any" && (!rawMood || rawMood === "any")
      ? normalizedFilters.moodId
      : rawMood;

  if (!isExplicitMoodActive(effectiveMood, normalizedFilters)) {
    return true;
  }

  const preset = getMoodPreset(effectiveMood);
  const genreIds = extractGenreIdsFromCandidate(candidate);
  const hasGenreMetadata = genreIds.size > 0;

  if (hasGenreMetadata && Array.isArray(preset.withoutGenreIds) && preset.withoutGenreIds.length > 0) {
    for (const forbidden of preset.withoutGenreIds) {
      if (genreIds.has(Number(forbidden))) return false;
    }
  }

  const requiredAny =
    normalizedFilters?.withGenreIds?.length > 0
      ? normalizedFilters.withGenreIds
      : preset.requiredAnyGenreIds || preset.preferredGenreIds || [];
  if (hasGenreMetadata && requiredAny.length > 0) {
    const hitsRequired = requiredAny.some((id) => genreIds.has(Number(id)));
    if (!hitsRequired) return false;
  }

  const voteCount = Number(candidate.vote_count ?? candidate.voteCount ?? NaN);
  if (Number.isFinite(voteCount)) {
    if (Number.isFinite(preset.voteCountLte) && preset.voteCountLte !== null && voteCount > preset.voteCountLte) {
      return false;
    }
    if (Number.isFinite(preset.voteCountGte) && preset.voteCountGte !== null && voteCount > 0 && voteCount < preset.voteCountGte) {
      return false;
    }
  }

  const rating = Number(candidate.vote_average ?? candidate.imdbRating ?? NaN);
  if (Number.isFinite(rating) && rating > 0 && Number.isFinite(preset.voteAverageGte)) {
    if (rating < preset.voteAverageGte - 0.3) return false;
  }

  if (normalizedFilters) {
    const yearMatch = String(candidate.release_date || candidate.year || candidate.Year || "").match(/\d{4}/);
    const year = yearMatch ? Number(yearMatch[0]) : NaN;
    if (Number.isFinite(year) && year > 1880) {
      if (normalizedFilters.minYear && year < normalizedFilters.minYear) return false;
      if (normalizedFilters.maxYear && year > normalizedFilters.maxYear) return false;
    }
    if (normalizedFilters.withoutKeywords?.length > 0) {
      const haystack = [
        candidate.title,
        candidate.overview,
        candidate.plot,
        candidate.genre,
        ...(Array.isArray(candidate.keywordNames) ? candidate.keywordNames : [])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      for (const kw of normalizedFilters.withoutKeywords) {
        if (kw && haystack.includes(kw)) return false;
      }
    }
  }

  return true;
}

/**
 * Returns true when either a non-default preset mood OR custom mood constraints are active.
 */
export function isExplicitMoodActive(mood = "any", moodFilters = null) {
  const cleanMood = String(mood || "any").trim().toLowerCase();
  if (cleanMood && cleanMood !== "any" && MOOD_PRESET_MAP.has(cleanMood)) {
    return true;
  }
  return Boolean(normalizeMoodFilters(moodFilters));
}

function inferDecadeYears(text) {
  let minYear = null;
  let maxYear = null;

  const fullDecade = text.match(/\b(19\d0|20\d0)s\b/i);
  if (fullDecade) {
    minYear = Number(fullDecade[1]);
    maxYear = minYear + 9;
  } else {
    const shortDecade = text.match(/\b([2-9]0|00|10)s\b/i);
    if (shortDecade) {
      const yy = Number(shortDecade[1]);
      minYear = yy >= 20 ? 1900 + yy : 2000 + yy;
      maxYear = minYear + 9;
    }
  }

  const afterMatch = text.match(/\b(?:after|since|from)\s+(19\d{2}|20\d{2})\b/i);
  if (afterMatch) minYear = Number(afterMatch[1]);

  const beforeMatch = text.match(/\b(?:before|until|pre[-\s]?)(19\d{2}|20\d{2})\b/i);
  if (beforeMatch) maxYear = Number(beforeMatch[1]);

  return { minYear, maxYear };
}

/**
 * Deterministic zero-network fallback parser for free-text "Match Vibe" prompts
 * when Gemini is offline or unavailable.
 */
export function parseFreeTextMoodFallback(rawQuery = "") {
  const cleanQuery = String(rawQuery || "").trim();
  if (!cleanQuery) return null;
  const lower = cleanQuery.toLowerCase();

  let moodId = "any";
  if (/\b(comfort|cozy|warm|feel[-\s]?good|wholesome|heartwarming|rewatchable|lighthearted)\b/.test(lower)) {
    moodId = "comfort-watch";
  } else if (/\b(mind[-\s]?bending|twist|cerebral|puzzle|surreal|nonlinear|heady)\b/.test(lower)) {
    moodId = "mind-bending";
  } else if (/\b(dark|noir|gritty|bleak|tense|brooding|thriller)\b/.test(lower)) {
    moodId = "dark-thriller";
  } else if (/\b(hidden|underrated|obscure|indie|underseen|cult)\b/.test(lower)) {
    moodId = "hidden-gem";
  } else if (/\b(fun|popcorn|exciting|fast[-\s]?paced|blockbuster|entertaining)\b/.test(lower)) {
    moodId = "fun-popcorn";
  }

  const withoutKeywords = [];
  const negPattern = /\b(?:no|without|avoid|not)\s+([a-z0-9\s-]{2,24}?)(?=(?:\s+(?:with|from|and|or|but|in)\b|[,.!?]|$))/gi;
  let match;
  while ((match = negPattern.exec(lower)) !== null) {
    const phrase = match[1].trim();
    if (phrase) withoutKeywords.push(phrase);
  }
  if (/\bquieter\b/.test(lower) && !withoutKeywords.includes("loud action")) {
    withoutKeywords.push("loud action");
  }

  const negativeTokenSet = new Set(withoutKeywords.join(" ").split(/\s+/));
  const withGenres = [];
  for (const [name, id] of Object.entries(GENRE_NAME_TO_ID)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(lower) && !negativeTokenSet.has(name)) {
      const canonical = GENRE_ID_TO_NAME[id];
      if (canonical && !withGenres.includes(canonical)) {
        withGenres.push(canonical);
      }
    }
  }

  const { minYear, maxYear } = inferDecadeYears(lower);

  return normalizeMoodFilters({
    query: cleanQuery,
    moodId,
    withGenres,
    withoutKeywords,
    minYear,
    maxYear
  });
}

/**
 * Deterministic hash suffix for custom mood filters, or empty string if inactive.
 */
export function buildMoodFilterHashSegment(moodFilters = null) {
  const norm = normalizeMoodFilters(moodFilters);
  if (!norm) return "";

  const gStr = norm.withGenreIds.join("-") || "none";
  const kwStr = norm.withoutKeywords.join("|") || "none";
  const yrStr = `${norm.minYear ?? ""}-${norm.maxYear ?? ""}`;
  const qStr = norm.query.toLowerCase().replace(/\s+/g, "_").slice(0, 48);
  return `mf_${norm.moodId}_${gStr}_${yrStr}_${kwStr}_${qStr}`;
}
