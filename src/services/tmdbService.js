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

const getTmdbKey = () => {
  const key = import.meta.env.VITE_TMDB_KEY;
  if (!key || key === "undefined" || key === "null" || key.trim() === "") {
    return "";
  }
  return key.trim();
};

const getOmdbKey = () => {
  const key = import.meta.env.VITE_OMDB_KEY;
  if (!key || key === "undefined" || key === "null" || key.trim() === "") {
    return "b78bdecd";
  }
  return key.trim();
};

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

export function buildProviderFilter(selectedProviders) {
  if (!selectedProviders || selectedProviders.length === 0) return null;
  const providerIds = selectedProviders
    .map(p => typeof p === "number" ? p : PROVIDER_MAP[p])
    .filter(Boolean);
  return providerIds.length > 0 ? providerIds.join("|") : null;
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

/**
 * Mathematical Weighted Taste Profiler
 * Integrates Continuous Rating Weights + Exponential Time-Decay + Surgical Trope Math
 */
export async function extractTasteProfile(watched = [], watchlist = []) {
  const rated = (watched || []).filter(m => {
    const r = Number(m.userRating || m.UserRating || 0);
    return !isNaN(r) && r > 0;
  });

  const genreScores = {};
  const hatedKeywordCounts = {};
  const castScores = {};
  const crewScores = {};
  const DECAY_RATE = 0.002; // ~346 day (~11.5 month) cinema-appropriate half-life

  // Calculate continuous weights with exponential time decay
  const weightedRated = rated.map(movie => {
    const rating = Number(movie.userRating || movie.UserRating || 0);
    const addedTime = new Date(movie.dateWatched || movie.addedAt || Date.now()).getTime();
    const daysSince = Math.max(0, (Date.now() - addedTime) / (1000 * 60 * 60 * 24));
    const timeDecay = Math.exp(-DECAY_RATE * daysSince);

    // Continuous Weight: 10/10 = 1.0, 9/10 = 0.8, 8/10 = 0.6, 7/10 = 0.4, <=5 = 0
    const baseWeight = Math.max(0, (rating - 5) / 5);
    const finalWeight = baseWeight * timeDecay;

    // 1. Positive Genre Weighting (Direct TMDB IDs or string fallback)
    const genreIds = movie.tmdbGenreIds || mapOmdbToTmdbGenreIds(movie.genre || movie.Genre || "");
    genreIds.forEach(id => {
      genreScores[id] = (genreScores[id] || 0) + finalWeight;
    });

    // 2. Surgical Negative Trope Extraction (from 1-3 star films with slower psychological dislike decay)
    if (rating <= 3 && movie.tmdbKeywords && Array.isArray(movie.tmdbKeywords)) {
      const negativeDecay = Math.exp(-(DECAY_RATE / 2) * daysSince);
      movie.tmdbKeywords.forEach(kId => {
        hatedKeywordCounts[kId] = (hatedKeywordCounts[kId] || 0) + negativeDecay;
      });
    }

    // 3. Star Power Cast & Auteur Crew Scoring (from >= 8/10 films)
    if (rating >= 8) {
      if (movie.castIds && Array.isArray(movie.castIds)) {
        movie.castIds.slice(0, 3).forEach(cId => {
          castScores[cId] = (castScores[cId] || 0) + finalWeight;
        });
      }
      if (movie.crewPersonId) {
        crewScores[movie.crewPersonId] = (crewScores[movie.crewPersonId] || 0) + finalWeight;
      }
    }

    return { ...movie, finalWeight };
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

  const topCrewMemberId = Object.entries(crewScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 1)
    .map(([id]) => Number(id))[0] || null;

  const hatedKeywordIds = Object.entries(hatedKeywordCounts)
    .filter(([_, count]) => count >= 1)
    .slice(0, 5)
    .map(([id]) => Number(id));

  // Top anchor film selected from highest finalWeight
  const eliteAnchors = weightedRated.filter(m => Number(m.userRating || 0) >= 9);
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
    anchorTmdbId,
    hatedKeywordIds,
    watchlistGenreIds,
    totalRated: rated.length
  };
}

/**
 * Fetch keywords and creative crew for an anchor film
 */
export async function fetchMovieKeywordsAndCrew(tmdbId) {
  const key = getTmdbKey();
  if (!key || !tmdbId) return { keywords: [], crewPersonIds: [] };

  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&append_to_response=keywords,credits&language=en-US`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { keywords: [], crewPersonIds: [] };
    const data = await res.json();

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
 * BUCKET A: Semantic Discover with Conditional Genre Guard & Comma with_cast
 */
export async function fetchBucketA(profile, mood = "any", options = {}, collisionSets = {}, targetCount = 8) {
  const key = getTmdbKey();
  if (!key) return [];

  const { userRegion = "US", userProviders = [] } = options;
  const { watchedIdSet, watchedTitleSet, watchlistTitleSet } = collisionSets;

  const cleanMood = (typeof mood === "string" ? mood : mood?.id || "any").toLowerCase().trim();

  let sortParam = "popularity.desc";
  let voteCountGte = "150";
  let voteAverageGte = "6.8";
  let moodBoostGenreIds = [];

  switch (cleanMood) {
    case "mind-bending":
      sortParam = "vote_average.desc";
      voteCountGte = "250";
      voteAverageGte = "7.5";
      moodBoostGenreIds = [9648, 878];
      break;
    case "dark-thriller":
      sortParam = "popularity.desc";
      voteCountGte = "120";
      voteAverageGte = "6.8";
      moodBoostGenreIds = [80, 53];
      break;
    case "hidden-gem":
      sortParam = "vote_average.desc";
      voteCountGte = "50";
      voteAverageGte = "7.3";
      break;
    case "comfort-watch":
      sortParam = "vote_average.desc";
      voteCountGte = "180";
      voteAverageGte = "7.2";
      moodBoostGenreIds = [35, 18, 10751];
      break;
    case "fun-popcorn":
      sortParam = "popularity.desc";
      voteCountGte = "250";
      voteAverageGte = "6.5";
      moodBoostGenreIds = [28, 12];
      break;
    default:
      sortParam = "popularity.desc";
      voteCountGte = "150";
      voteAverageGte = "6.8";
      break;
  }

  const combinedLoved = Array.from(new Set([
    ...(profile.lovedGenreIds || []).slice(0, 4),
    ...(profile.watchlistGenreIds || []).slice(0, 2),
    ...moodBoostGenreIds
  ]));

  const params = new URLSearchParams({
    api_key: key,
    include_adult: "false",
    include_video: "false",
    language: "en-US",
    sort_by: sortParam,
    "vote_count.gte": voteCountGte,
    "vote_average.gte": voteAverageGte
  });

  // CONDITIONAL GENRE GUARD: Never append empty with_genres
  if (combinedLoved.length > 0) {
    params.set("with_genres", combinedLoved.join("|"));
  }

  // SURGICAL TROPE EXCLUSION: Pipe-separated for keyword OR logic (excludes films matching ANY hated trope)
  if (profile.hatedKeywordIds && profile.hatedKeywordIds.length > 0) {
    params.set("without_keywords", profile.hatedKeywordIds.join("|"));
  }

  // STAR POWER INJECTION: Comma-separated for people OR logic
  if (profile.topCastIds && profile.topCastIds.length > 0) {
    params.set("with_cast", profile.topCastIds.join(","));
  }

  // WATCH PROVIDER FILTERING & REGION BINDING
  const providerFilter = buildProviderFilter(userProviders);
  if (providerFilter) {
    params.set("with_watch_providers", providerFilter);
    params.set("watch_region", (!userRegion || userRegion === "GLOBAL") ? "US" : userRegion);
  } else if (userRegion && userRegion !== "GLOBAL") {
    params.set("watch_region", userRegion);
  }

  let candidates = [];
  let page = 1;

  while (candidates.length < targetCount && page <= 5) {
    const q = new URLSearchParams({ ...Object.fromEntries(params), page: String(page) });
    try {
      const res = await fetch(`https://api.themoviedb.org/3/discover/movie?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) break;
      const data = await res.json();
      if (!data.results || data.results.length === 0) break;

      for (const m of data.results) {
        if (!m || !m.title || !m.overview) continue;
        const titleClean = m.title.toLowerCase().trim();
        const yearClean = m.release_date ? m.release_date.slice(0, 4) : "";
        const titleYearKey = yearClean ? `${titleClean}::${yearClean}` : titleClean;

        if (watchedIdSet?.has(String(m.id))) continue;
        if (watchedTitleSet?.has(titleYearKey) || watchedTitleSet?.has(titleClean)) continue;
        if (watchlistTitleSet?.has(titleYearKey) || watchlistTitleSet?.has(titleClean)) continue;
        if (candidates.some(c => c.id === m.id)) continue;

        candidates.push(normalizeTmdbItem(m, "Bucket A: Semantic"));
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
    page = 1;

    while (candidates.length < targetCount && page <= 5) {
      const q = new URLSearchParams({ ...Object.fromEntries(params), page: String(page) });
      try {
        const res = await fetch(`https://api.themoviedb.org/3/discover/movie?${q.toString()}`, { cache: "no-store" });
        if (!res.ok) break;
        const data = await res.json();
        if (!data.results || data.results.length === 0) break;

        for (const m of data.results) {
          if (!m || !m.title || !m.overview) continue;
          const titleClean = m.title.toLowerCase().trim();
          const yearClean = m.release_date ? m.release_date.slice(0, 4) : "";
          const titleYearKey = yearClean ? `${titleClean}::${yearClean}` : titleClean;

          if (watchedIdSet?.has(String(m.id))) continue;
          if (watchedTitleSet?.has(titleYearKey) || watchedTitleSet?.has(titleClean)) continue;
          if (watchlistTitleSet?.has(titleYearKey) || watchlistTitleSet?.has(titleClean)) continue;
          if (candidates.some(c => c.id === m.id)) continue;

          candidates.push(normalizeTmdbItem(m, "Bucket A: Cinephile Critical"));
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
  const key = getTmdbKey();
  if (!key || !anchorTmdbId) return [];

  const { userRegion = "US", userProviders = [] } = options;
  const { watchedIdSet, watchedTitleSet, watchlistTitleSet } = collisionSets;

  const { keywords } = await fetchMovieKeywordsAndCrew(anchorTmdbId);
  if (!keywords || keywords.length === 0) return [];

  const params = new URLSearchParams({
    api_key: key,
    with_keywords: keywords.slice(0, 3).join("|"),
    sort_by: "vote_average.desc",
    "vote_count.gte": "500",
    "vote_average.gte": "7.0",
    include_adult: "false"
  });

  const providerFilter = buildProviderFilter(userProviders);
  if (providerFilter) {
    params.set("with_watch_providers", providerFilter);
    params.set("watch_region", (!userRegion || userRegion === "GLOBAL") ? "US" : userRegion);
  } else if (userRegion && userRegion !== "GLOBAL") {
    params.set("watch_region", userRegion);
  }

  const candidates = [];
  let page = 1;

  while (candidates.length < targetCount && page <= 4) {
    const q = new URLSearchParams({ ...Object.fromEntries(params), page: String(page) });
    try {
      const res = await fetch(`https://api.themoviedb.org/3/discover/movie?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) break;
      const data = await res.json();
      if (!data.results || data.results.length === 0) break;

      for (const m of data.results) {
        if (!m || !m.title || !m.overview) continue;
        const titleClean = m.title.toLowerCase().trim();
        const yearClean = m.release_date ? m.release_date.slice(0, 4) : "";
        const titleYearKey = yearClean ? `${titleClean}::${yearClean}` : titleClean;

        if (watchedIdSet?.has(String(m.id))) continue;
        if (watchedTitleSet?.has(titleYearKey) || watchedTitleSet?.has(titleClean)) continue;
        if (watchlistTitleSet?.has(titleYearKey) || watchlistTitleSet?.has(titleClean)) continue;
        if (candidates.some(c => c.id === m.id)) continue;

        candidates.push(normalizeTmdbItem(m, "Bucket B: Spiritual Successor"));
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
  const key = getTmdbKey();
  if (!key) return [];

  const { topCrewMemberId } = profile;
  if (!topCrewMemberId) return [];

  const { userRegion = "US", userProviders = [] } = options;
  const { watchedIdSet, watchedTitleSet, watchlistTitleSet } = collisionSets;

  const params = new URLSearchParams({
    api_key: key,
    with_crew: String(topCrewMemberId),
    sort_by: "vote_average.desc",
    "vote_count.gte": "150",
    include_adult: "false"
  });

  const providerFilter = buildProviderFilter(userProviders);
  if (providerFilter) {
    params.set("with_watch_providers", providerFilter);
    params.set("watch_region", (!userRegion || userRegion === "GLOBAL") ? "US" : userRegion);
  } else if (userRegion && userRegion !== "GLOBAL") {
    params.set("watch_region", userRegion);
  }

  const candidates = [];
  let page = 1;

  while (candidates.length < targetCount && page <= 3) {
    const q = new URLSearchParams({ ...Object.fromEntries(params), page: String(page) });
    try {
      const res = await fetch(`https://api.themoviedb.org/3/discover/movie?${q.toString()}`, { cache: "no-store" });
      if (!res.ok) break;
      const data = await res.json();
      if (!data.results || data.results.length === 0) break;

      for (const m of data.results) {
        if (!m || !m.title || !m.overview) continue;
        const titleClean = m.title.toLowerCase().trim();
        const yearClean = m.release_date ? m.release_date.slice(0, 4) : "";
        const titleYearKey = yearClean ? `${titleClean}::${yearClean}` : titleClean;

        if (watchedIdSet?.has(String(m.id))) continue;
        if (watchedTitleSet?.has(titleYearKey) || watchedTitleSet?.has(titleClean)) continue;
        if (watchlistTitleSet?.has(titleYearKey) || watchlistTitleSet?.has(titleClean)) continue;
        if (candidates.some(c => c.id === m.id)) continue;

        candidates.push(normalizeTmdbItem(m, "Bucket C: Auteur Crew"));
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
 * 3-Bucket Dynamic Waterfall Candidate Pool Orchestrator with Cold-Start Bypass
 */
export async function fetchCandidatePool(profile, mood = "any", watchedMovies = [], watchlistMovies = [], options = {}) {
  const key = getTmdbKey();
  if (!key) {
    throw new Error("TMDB_KEY_MISSING");
  }

  const watchedIdSet = new Set(
    (watchedMovies || []).map(m => String(m.id || m.imdbID || m.tmdbId || "")).filter(Boolean)
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

  const collisionSets = { watchedIdSet, watchedTitleSet, watchlistTitleSet };

  // COLD-START BYPASS: If user has < 3 ratings, route entirely to expanded Bucket A
  if ((watchedMovies || []).length < 3) {
    return fetchBucketA(profile, mood, options, collisionSets, 20);
  }

  // 1. Concurrently fetch specific Keyword and Auteur/Cast buckets
  const [bucketB, bucketC] = await Promise.all([
    profile.anchorTmdbId ? fetchBucketB(profile.anchorTmdbId, options, collisionSets, 8) : Promise.resolve([]),
    profile.topCrewMemberId ? fetchBucketC(profile, options, collisionSets, 4) : Promise.resolve([])
  ]);

  // 2. Merge and deduplicate specific pool
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
  addSpecific(bucketB);
  addSpecific(bucketC);

  // 3. Dynamic Waterfall Sizing: Bucket A fetches exactly enough to reach 20
  const remainingSlots = Math.max(20 - specificPool.length, 8);
  const bucketA = await fetchBucketA(profile, mood, options, collisionSets, remainingSlots);

  // 4. Return unified 20-film candidate pool
  const combined = [...specificPool];
  for (const item of bucketA) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      combined.push(item);
    }
  }

  // Final top-up if needed
  if (combined.length < 20) {
    const topUp = await fetchBucketA(profile, "any", options, collisionSets, 20 - combined.length);
    for (const item of topUp) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        combined.push(item);
      }
    }
  }

  return combined.slice(0, 20);
}

function normalizeTmdbItem(m, sourceBucket = "TMDB") {
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
    genre_names: genreNames,
    genre: genreNames.join(", ") || "Cinema",
    poster_path: m.poster_path,
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
    backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null,
    sourceBucket
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
 * Fetch detailed movie data with append_to_response=videos,credits,external_ids,watch/providers,keywords,release_dates
 */
export async function fetchTmdbMovieDetails(tmdbId, userRegion = "US") {
  const key = getTmdbKey();
  if (!key || !tmdbId) return null;

  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&append_to_response=videos,credits,external_ids,keywords,watch/providers,release_dates&language=en-US`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();

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
  } catch (err) {
    console.warn("Failed to fetch detailed TMDB movie data:", err);
    return null;
  }
}

/**
 * Reverse lookup TMDB movie by IMDb ID using /find/{external_id}
 */
export async function findTmdbByImdbId(imdbId) {
  const key = getTmdbKey();
  if (!key || !imdbId) return null;

  try {
    const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${key}&external_source=imdb_id`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const movie = data.movie_results?.[0];
    if (!movie) return null;

    return {
      tmdbId: movie.id,
      title: movie.title,
      year: movie.release_date ? movie.release_date.slice(0, 4) : "N/A",
      poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
      backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
      overview: movie.overview,
      vote_average: movie.vote_average
    };
  } catch (err) {
    console.warn("TMDB find by IMDb ID failed:", err);
    return null;
  }
}

/**
 * Lookup TMDB movie by title and year
 */
export async function findTmdbByTitleAndYear(title, year) {
  const key = getTmdbKey();
  if (!key || !title) return null;

  try {
    const cleanTitle = String(title).replace(/^["']|["']$/g, "").trim();
    const cleanYear = year ? String(year).match(/\d{4}/)?.[0] : "";
    let url = `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(cleanTitle)}&include_adult=false`;
    if (cleanYear) url += `&year=${cleanYear}`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const movie = data.results?.[0];
    if (!movie) return null;

    return {
      tmdbId: movie.id,
      title: movie.title,
      year: movie.release_date ? movie.release_date.slice(0, 4) : "N/A",
      poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
      backdrop: movie.backdrop_path ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}` : null,
      overview: movie.overview,
      vote_average: movie.vote_average
    };
  } catch (err) {
    console.warn("TMDB search by title/year failed:", err);
    return null;
  }
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

  const omdbKey = getOmdbKey();

  try {
    const url = `https://www.omdbapi.com/?apikey=${omdbKey}&t=${encodeURIComponent(cleanTitle)}${cleanYear ? `&y=${cleanYear}` : ''}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (data.Response === "True" && data.imdbID) {
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
