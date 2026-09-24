/**
 * CinemaVault TMDB Service
 * Deterministic candidate retrieval, genre mapping, schema bridge, and append_to_response details.
 */

const getTmdbKey = () => {
  const key = import.meta.env.VITE_TMDB_KEY;
  if (!key || key === "undefined" || key === "null" || key.trim() === "") {
    return "c4986237398b7da8ee34b9ec66779623";
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
 * Optional runtime sync of live TMDB genre definitions
 */
export async function initializeTmdbGenres() {
  const key = getTmdbKey();
  if (!key) return;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/genre/movie/list?api_key=${key}&language=en-US`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.genres && Array.isArray(data.genres)) {
      data.genres.forEach(g => {
        TMDB_GENRE_MAP[g.name.toLowerCase()] = g.id;
        TMDB_ID_TO_GENRE[g.id] = g.name;
      });
    }
  } catch (err) {
    console.warn("TMDB Live Genre Sync skipped, using static dictionary fallback:", err);
  }
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
 * Extracts statistical taste profile and anti-patterns directly in JavaScript
 */
export function extractTasteProfile(watched = [], watchlist = []) {
  const rated = (watched || []).filter(m => {
    const r = Number(m.userRating || m.UserRating || 0);
    return !isNaN(r) && r > 0;
  });

  const liked = rated.filter(m => (Number(m.userRating || m.UserRating || 0)) >= 7);
  const disliked = rated.filter(m => (Number(m.userRating || m.UserRating || 0)) <= 5);

  // Genre Frequency Calculation for Liked Films
  const likedGenreCounts = {};
  liked.forEach(m => {
    const rawGenre = m.genre || m.Genre || "";
    const ids = mapOmdbToTmdbGenreIds(rawGenre);
    ids.forEach(id => {
      likedGenreCounts[id] = (likedGenreCounts[id] || 0) + 1;
    });
  });

  // Top Loved Genre IDs sorted by frequency
  const lovedGenreIds = Object.entries(likedGenreCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => Number(id));

  // Genre Frequency Calculation for Disliked Films (Anti-Patterns)
  const dislikedGenreCounts = {};
  disliked.forEach(m => {
    const rawGenre = m.genre || m.Genre || "";
    const ids = mapOmdbToTmdbGenreIds(rawGenre);
    ids.forEach(id => {
      dislikedGenreCounts[id] = (dislikedGenreCounts[id] || 0) + 1;
    });
  });

  // Hated Genre IDs (appear in disliked films and NOT among top loved genres)
  const hatedGenreIds = Object.entries(dislikedGenreCounts)
    .filter(([id, count]) => count >= 1 && !lovedGenreIds.slice(0, 3).includes(Number(id)))
    .map(([id]) => Number(id));

  // Top Directors (2+ high rated films)
  const dirMap = {};
  liked.forEach(m => {
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
    const rawGenre = m.genre || m.Genre || "";
    const ids = mapOmdbToTmdbGenreIds(rawGenre);
    ids.forEach(id => {
      watchlistGenreCounts[id] = (watchlistGenreCounts[id] || 0) + 1;
    });
  });

  const watchlistGenreIds = Object.entries(watchlistGenreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => Number(id));

  const lovedGenreNames = lovedGenreIds.slice(0, 4).map(id => TMDB_ID_TO_GENRE[id] || `Genre ${id}`);
  const hatedGenreNames = hatedGenreIds.slice(0, 3).map(id => TMDB_ID_TO_GENRE[id] || `Genre ${id}`);

  return {
    lovedGenreIds,
    lovedGenreNames,
    hatedGenreIds,
    hatedGenreNames,
    topDirectors,
    watchlistGenreIds,
    totalRated: rated.length,
    totalLiked: liked.length
  };
}

/**
 * Builds dynamic TMDB /discover/movie query parameters mapped to User Mood
 */
export function buildDiscoverParams(profile, mood = "any", tmdbKey = TMDB_KEY) {
  const cleanMood = (typeof mood === "string" ? mood : mood?.id || "any").toLowerCase().trim();

  let sortParam = "popularity.desc";
  let voteCountGte = "150";
  let voteCountLte = null;
  let voteAverageGte = "6.8";
  let moodBoostGenreIds = [];

  switch (cleanMood) {
    case "mind-bending":
      sortParam = "vote_average.desc";
      voteCountGte = "250";
      voteAverageGte = "7.5";
      moodBoostGenreIds = [9648, 878]; // Mystery, Sci-Fi
      break;
    case "dark-thriller":
      sortParam = "popularity.desc";
      voteCountGte = "120";
      voteAverageGte = "6.8";
      moodBoostGenreIds = [80, 53]; // Crime, Thriller
      break;
    case "hidden-gem":
      sortParam = "vote_average.desc";
      voteCountGte = "50";
      voteCountLte = "800";
      voteAverageGte = "7.3";
      break;
    case "comfort-watch":
      sortParam = "vote_average.desc";
      voteCountGte = "180";
      voteAverageGte = "7.2";
      moodBoostGenreIds = [35, 18, 10751]; // Comedy, Drama, Family
      break;
    case "fun-popcorn":
      sortParam = "popularity.desc";
      voteCountGte = "250";
      voteAverageGte = "6.5";
      moodBoostGenreIds = [28, 12]; // Action, Adventure
      break;
    case "any":
    default:
      sortParam = "popularity.desc";
      voteCountGte = "150";
      voteAverageGte = "6.8";
      break;
  }

  // Combine loved genres + watchlist intent + mood boost into single OR list
  const combinedLoved = Array.from(new Set([
    ...(profile.lovedGenreIds || []).slice(0, 4),
    ...(profile.watchlistGenreIds || []).slice(0, 2),
    ...moodBoostGenreIds
  ]));

  const params = {
    api_key: tmdbKey,
    include_adult: "false",
    include_video: "false",
    language: "en-US",
    sort_by: sortParam,
    "vote_count.gte": voteCountGte,
    "vote_average.gte": voteAverageGte
  };

  if (voteCountLte) {
    params["vote_count.lte"] = voteCountLte;
  }

  // Pipe | for with_genres (OR) and without_genres (OR exclusion)
  if (combinedLoved.length > 0) {
    params.with_genres = combinedLoved.join("|");
  }

  if (profile.hatedGenreIds && profile.hatedGenreIds.length > 0) {
    params.without_genres = profile.hatedGenreIds.join("|");
  }

  return params;
}

/**
 * Paginated Candidate Pool Retrieval
 * Paginates up to 5 pages until exactly 20 unwatched candidate movies are found.
 */
export async function fetchCandidatePool(profile, mood = "any", watchedMovies = [], watchlistMovies = []) {
  const key = getTmdbKey();
  if (!key) {
    throw new Error("TMDB_KEY_MISSING");
  }

  const watchedIdSet = new Set(
    (watchedMovies || []).map(m => String(m.id || m.imdbID || "")).filter(Boolean)
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

  let page = 1;
  const maxPages = 5;
  const unwatchedCandidates = [];
  const baseParams = buildDiscoverParams(profile, mood, key);

  while (unwatchedCandidates.length < 20 && page <= maxPages) {
    const queryParams = new URLSearchParams({ ...baseParams, page: String(page) });
    const url = `https://api.themoviedb.org/3/discover/movie?${queryParams.toString()}`;

    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.warn(`TMDB discover request failed on page ${page}: status ${res.status}`);
        break;
      }
      const data = await res.json();
      if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
        break;
      }

      for (const m of data.results) {
        if (!m || !m.title || !m.overview) continue;

        const titleClean = m.title.toLowerCase().trim();
        const yearClean = m.release_date ? m.release_date.slice(0, 4) : "";
        const titleYearKey = yearClean ? `${titleClean}::${yearClean}` : titleClean;

        // Skip if already in watched or watchlist
        if (watchedIdSet.has(String(m.id))) continue;
        if (watchedTitleSet.has(titleYearKey) || watchedTitleSet.has(titleClean)) continue;
        if (watchlistTitleSet.has(titleYearKey) || watchlistTitleSet.has(titleClean)) continue;

        // Avoid duplicate additions in candidate pool
        if (unwatchedCandidates.some(c => c.id === m.id || c.title.toLowerCase() === titleClean)) continue;

        const genreNames = (m.genre_ids || [])
          .map(id => TMDB_ID_TO_GENRE[id])
          .filter(Boolean);

        unwatchedCandidates.push({
          id: m.id,
          tmdbId: m.id,
          title: m.title,
          year: yearClean || "N/A",
          release_date: m.release_date,
          overview: m.overview,
          vote_average: m.vote_average ? Number(m.vote_average.toFixed(1)) : null,
          vote_count: m.vote_count || 0,
          popularity: m.popularity || 0,
          genre_names: genreNames,
          genre: genreNames.join(", ") || "Cinema",
          poster_path: m.poster_path,
          poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
          backdrop: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null
        });

        if (unwatchedCandidates.length >= 20) break;
      }

      page++;
    } catch (err) {
      console.warn("TMDB Candidate fetch loop encountered error:", err);
      break;
    }
  }

  return unwatchedCandidates.slice(0, 20);
}

/**
 * Fetch detailed movie data with append_to_response=videos,credits,external_ids
 */
export async function fetchTmdbMovieDetails(tmdbId) {
  const key = getTmdbKey();
  if (!key || !tmdbId) return null;

  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&append_to_response=videos,credits,external_ids&language=en-US`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();

    const director = data.credits?.crew?.find(c => c.job === "Director")?.name || "Unknown";
    const cast = (data.credits?.cast || []).slice(0, 5).map(c => c.name).join(", ") || "N/A";
    const trailerObj = (data.videos?.results || []).find(v => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"));
    const trailerUrl = trailerObj ? `https://www.youtube.com/watch?v=${trailerObj.key}` : null;
    const imdbId = data.external_ids?.imdb_id || null;

    return {
      tmdbId: data.id,
      imdbID: imdbId,
      title: data.title,
      year: data.release_date ? data.release_date.slice(0, 4) : "N/A",
      release_date: data.release_date,
      runtime: data.runtime ? `${data.runtime} min` : "N/A",
      runtimeMinutes: data.runtime || null,
      poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      backdrop: data.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : null,
      director,
      cast,
      trailerUrl,
      trailerKey: trailerObj?.key || null,
      genre: (data.genres || []).map(g => g.name).join(", ") || "Cinema",
      plot: data.overview || "",
      tagline: data.tagline || "",
      vote_average: data.vote_average ? Number(data.vote_average.toFixed(1)) : null,
      vote_count: data.vote_count || 0
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
 * Uses TMDB append_to_response=external_ids for instant zero-roundtrip IMDb ID resolution,
 * with graceful fallback to OMDb.
 */
export async function bridgeTmdbToOmdb(tmdbMovie) {
  if (!tmdbMovie) return null;

  // 1. If already has verified imdbID (e.g. from OMDb), return standard format
  if (tmdbMovie.imdbID && tmdbMovie.imdbID.startsWith("tt")) {
    return {
      imdbID: tmdbMovie.imdbID,
      title: tmdbMovie.title || tmdbMovie.Title,
      year: tmdbMovie.year || tmdbMovie.Year || "N/A",
      poster: tmdbMovie.poster || tmdbMovie.Poster || getFallbackPoster(tmdbMovie.title),
      runtime: tmdbMovie.runtime || tmdbMovie.Runtime || "N/A",
      genre: tmdbMovie.genre || tmdbMovie.Genre || "N/A",
      imdbRating: tmdbMovie.imdbRating || "N/A",
      userRating: 0
    };
  }

  const tmdbId = tmdbMovie.tmdbId || tmdbMovie.id;

  // 2. High-performance native TMDB lookup using append_to_response=external_ids,credits
  if (tmdbId) {
    const details = await fetchTmdbMovieDetails(tmdbId);
    if (details && details.imdbID) {
      return {
        imdbID: details.imdbID,
        title: details.title || tmdbMovie.title,
        year: details.year || tmdbMovie.year || "N/A",
        poster: details.poster || tmdbMovie.poster || getFallbackPoster(tmdbMovie.title),
        backdrop: details.backdrop || tmdbMovie.backdrop || null,
        runtime: details.runtime || "N/A",
        genre: details.genre || tmdbMovie.genre || "N/A",
        imdbRating: details.vote_average ? String(details.vote_average) : (tmdbMovie.imdbRating || "N/A"),
        director: details.director || "Unknown",
        userRating: 0
      };
    }
  }

  // 3. Fallback: Search OMDb by title and year
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
        title: data.Title || cleanTitle,
        year: data.Year || cleanYear || "N/A",
        poster: tmdbMovie.poster || (data.Poster !== "N/A" ? data.Poster : getFallbackPoster(cleanTitle)),
        runtime: data.Runtime && data.Runtime !== "N/A" ? data.Runtime : "N/A",
        genre: data.Genre && data.Genre !== "N/A" ? data.Genre : (tmdbMovie.genre || "N/A"),
        imdbRating: data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : (tmdbMovie.imdbRating || "N/A"),
        userRating: 0
      };
    }
  } catch (e) {
    console.warn("Bridge OMDb lookup failed for TMDB candidate:", cleanTitle, e);
  }

  // 4. Ultimate deterministic fallback
  return {
    imdbID: `tmdb_${tmdbId || cleanTitle.replace(/\s+/g, '_')}`,
    title: cleanTitle,
    year: cleanYear || "N/A",
    poster: tmdbMovie.poster || getFallbackPoster(cleanTitle),
    runtime: "N/A",
    genre: tmdbMovie.genre || "N/A",
    imdbRating: tmdbMovie.imdbRating || "N/A",
    userRating: 0
  };
}
