import {
  fetchOmdbJson,
  fetchTmdbJson,
  hasOmdbBackend,
  hasTmdbBackend
} from "./apiTransport.js";
import { TMDB_ID_TO_GENRE } from "./tmdbService.js";

const CURATED_TRENDING_FALLBACK = [
  {
    imdbID: "tt15239678",
    Title: "Dune: Part Two",
    Year: "2024",
    imdbRating: "8.5",
    genre: "Sci-Fi, Adventure, Drama",
    plot: "Paul Atreides unites with the Fremen on a warpath of revenge against the conspirators who destroyed his family.",
    Poster: "https://m.media-amazon.com/images/M/MV5BNTc0YmQxMjEtODI5MC00NjFiLTlkMWUtOGQ5NjFmYWUyZGJhXkEyXkFqcGc@._V1_SX300.jpg"
  },
  {
    imdbID: "tt0816692",
    Title: "Interstellar",
    Year: "2014",
    imdbRating: "8.7",
    genre: "Sci-Fi, Drama, Adventure",
    plot: "When Earth becomes uninhabitable, explorers undertake a mission beyond this galaxy in search of a new home.",
    Poster: "https://m.media-amazon.com/images/M/MV5BYzdjMDAxZGItMjI2My00ODA1LTlkNzItOWFjMDU5ZDJlYWY3XkEyXkFqcGc@._V1_SX300.jpg"
  },
  {
    imdbID: "tt0468569",
    Title: "The Dark Knight",
    Year: "2008",
    imdbRating: "9.0",
    genre: "Action, Crime, Drama",
    plot: "The Joker wreaks havoc on Gotham City, testing Batman's resolve to uphold justice.",
    Poster: "https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_SX300.jpg"
  },
  {
    imdbID: "tt6751668",
    Title: "Parasite",
    Year: "2019",
    imdbRating: "8.5",
    genre: "Drama, Thriller",
    plot: "Greed and class discrimination threaten a symbiotic relationship between two Seoul families.",
    Poster: "https://m.media-amazon.com/images/M/MV5BYjk1Y2U4MjQtY2ZiNS00OWQyLWI3MmYtZWUwNmRjYWRiNWNhXkEyXkFqcGc@._V1_SX300.jpg"
  },
  {
    imdbID: "tt1856101",
    Title: "Blade Runner 2049",
    Year: "2017",
    imdbRating: "8.0",
    genre: "Sci-Fi, Mystery, Drama",
    plot: "A young blade runner unearths a long-buried secret that leads him to seek Rick Deckard.",
    Poster: "https://m.media-amazon.com/images/M/MV5BNzA1Njg4NzYxOV5BMl5BanBnXkFtZTgwODk5NjU3MzI@._V1_QL75_UX380_CR0,0,380,562_.jpg"
  },
  {
    imdbID: "tt1375666",
    Title: "Inception",
    Year: "2010",
    imdbRating: "8.8",
    genre: "Action, Sci-Fi, Thriller",
    plot: "A skilled extractor is offered a chance to regain his old life by planting an idea in a target's subconscious.",
    Poster: "https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_SX300.jpg"
  },
  {
    imdbID: "tt9362722",
    Title: "Spider-Man: Across the Spider-Verse",
    Year: "2023",
    imdbRating: "8.5",
    genre: "Animation, Action, Adventure",
    plot: "Miles Morales catapults across the Multiverse and confronts a team of Spider-People charged with protecting it.",
    Poster: "https://m.media-amazon.com/images/M/MV5BNThiZjA3MjItZGY5Ni00ZmJhLWEwN2EtOTBlYTA4Y2E0M2ZmXkEyXkFqcGc@._V1_SX300.jpg"
  },
  {
    imdbID: "tt15398776",
    Title: "Oppenheimer",
    Year: "2023",
    imdbRating: "8.3",
    genre: "Biography, Drama, History",
    plot: "The story of physicist J. Robert Oppenheimer and his pivotal role in developing the atomic bomb.",
    Poster: "https://m.media-amazon.com/images/M/MV5BN2JkMDc5MGQtZjg3YS00NmFiLWIyZmQtZTJmNTM5MjVmYTQ4XkEyXkFqcGc@._V1_SX300.jpg"
  }
];

function normalizeTitle(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeYear(value = "") {
  const match = String(value || "").match(/\d{4}/);
  return match ? match[0] : "";
}

function buildTitleYearKey(title, year) {
  const cleanTitle = normalizeTitle(title);
  if (!cleanTitle) return "";
  const cleanYear = normalizeYear(year);
  return cleanYear ? `${cleanTitle}::${cleanYear}` : cleanTitle;
}

function buildRecordKeys(item = {}) {
  const keys = [];
  const imdb = String(item.imdbID || "").trim().toLowerCase();
  if (imdb) keys.push(`imdb:${imdb}`);
  const tmdb = Number(item.tmdbId || item.id);
  if (Number.isFinite(tmdb) && tmdb > 0) keys.push(`tmdb:${tmdb}`);
  const tyKey = buildTitleYearKey(item.Title || item.title, item.Year || item.year);
  if (tyKey) keys.push(`ty:${tyKey}`);
  return keys;
}

function resolvePosterValue(rawPoster) {
  if (!rawPoster || rawPoster === "N/A") return "N/A";
  return String(rawPoster);
}

function normalizeSearchRecord(raw = {}, sourceHint = "local") {
  const title = raw.Title || raw.title || raw.original_title || "Untitled";
  const year = normalizeYear(raw.Year || raw.year || raw.release_date || "");
  const tmdbId = Number(raw.tmdbId ?? (raw.poster_path !== undefined || sourceHint === "tmdb" ? raw.id : 0)) || null;
  const rawImdb = raw.imdbID || raw.imdb_id || "";
  const imdbID = rawImdb || (tmdbId ? `tmdb_${tmdbId}` : `local_${buildTitleYearKey(title, year)}`);
  const poster = resolvePosterValue(raw.Poster || raw.poster);
  const genreIds = Array.isArray(raw.genre_ids)
    ? raw.genre_ids
    : (Array.isArray(raw.tmdbGenreIds) ? raw.tmdbGenreIds : []);
  const genre = raw.genre
    || raw.Genre
    || genreIds.map((gid) => TMDB_ID_TO_GENRE[gid]).filter(Boolean).join(", ");
  const voteNum = Number(raw.vote_average ?? raw.imdbRating);
  const imdbRating = Number.isFinite(voteNum) && voteNum > 0 ? voteNum.toFixed(1) : null;

  return {
    id: imdbID,
    imdbID,
    tmdbId,
    tmdbGenreIds: genreIds,
    Title: title,
    title,
    Year: year,
    year,
    imdbRating,
    Poster: poster,
    poster: poster !== "N/A" ? poster : null,
    backdrop: raw.backdrop || null,
    genre: genre || "",
    plot: raw.plot || raw.overview || raw.Plot || "",
    popularity: Number(raw.popularity || 0),
    Type: raw.Type || "movie",
    userRating: raw.userRating ?? null,
    source: raw.source || sourceHint
  };
}

/**
 * Maps a raw TMDB /3/search/movie or trending movie object to the unified search record.
 */
export function mapTmdbSearchItem(tmdbItem = {}) {
  const tmdbId = Number(tmdbItem.id ?? tmdbItem.tmdbId) || null;
  const imdbID = tmdbItem.imdb_id || tmdbItem.imdbID || (tmdbId ? `tmdb_${tmdbId}` : "");
  const title = tmdbItem.title || tmdbItem.Title || tmdbItem.original_title || "Untitled";
  const year = normalizeYear(tmdbItem.release_date || tmdbItem.Year || tmdbItem.year || "");
  const voteAvg = Number(tmdbItem.vote_average ?? tmdbItem.imdbRating);
  const imdbRating = Number.isFinite(voteAvg) && voteAvg > 0 ? voteAvg.toFixed(1) : null;
  const poster = tmdbItem.poster_path
    ? `https://image.tmdb.org/t/p/w342${tmdbItem.poster_path}`
    : resolvePosterValue(tmdbItem.Poster || tmdbItem.poster);
  const backdrop = tmdbItem.backdrop_path
    ? `https://image.tmdb.org/t/p/w780${tmdbItem.backdrop_path}`
    : (tmdbItem.backdrop || null);
  const genreIds = Array.isArray(tmdbItem.genre_ids)
    ? tmdbItem.genre_ids
    : (Array.isArray(tmdbItem.tmdbGenreIds) ? tmdbItem.tmdbGenreIds : []);
  const genre = tmdbItem.genre
    || genreIds.map((gid) => TMDB_ID_TO_GENRE[gid]).filter(Boolean).join(", ");

  return {
    id: imdbID || (tmdbId ? `tmdb_${tmdbId}` : `${title}::${year}`),
    imdbID,
    tmdbId,
    tmdbGenreIds: genreIds,
    Title: title,
    title,
    Year: year,
    year,
    imdbRating,
    Poster: poster,
    poster: poster !== "N/A" ? poster : null,
    backdrop,
    genre,
    plot: tmdbItem.overview || tmdbItem.plot || "",
    popularity: Number(tmdbItem.popularity || 0),
    voteCount: Number(tmdbItem.vote_count || 0),
    Type: "movie",
    source: "tmdb"
  };
}

function buildLookupIndex(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item) continue;
    for (const key of buildRecordKeys(item)) {
      if (!map.has(key)) map.set(key, item);
    }
  }
  return map;
}

function findInLookup(index, item) {
  for (const key of buildRecordKeys(item)) {
    if (index.has(key)) return index.get(key);
  }
  return null;
}

function mergeTwoSearchRecords(existing, incoming) {
  const preferIncomingRichness = incoming.source === "tmdb" && existing.source !== "tmdb";
  const primary = preferIncomingRichness ? incoming : existing;
  const secondary = preferIncomingRichness ? existing : incoming;
  const canonicalImdb =
    [existing.imdbID, incoming.imdbID].find((id) => id && /^tt\d+$/i.test(id))
    || primary.imdbID
    || secondary.imdbID;
  const poster =
    primary.Poster && primary.Poster !== "N/A"
      ? primary.Poster
      : (secondary.Poster && secondary.Poster !== "N/A" ? secondary.Poster : "N/A");

  return {
    ...secondary,
    ...primary,
    id: canonicalImdb || primary.id || secondary.id,
    imdbID: canonicalImdb,
    tmdbId: primary.tmdbId || secondary.tmdbId || null,
    Poster: poster,
    poster: poster !== "N/A" ? poster : null,
    backdrop: primary.backdrop || secondary.backdrop || null,
    genre: primary.genre || secondary.genre || "",
    plot: primary.plot || secondary.plot || "",
    imdbRating: primary.imdbRating || secondary.imdbRating || null,
    popularity: Math.max(Number(primary.popularity || 0), Number(secondary.popularity || 0)),
    userRating: existing.userRating ?? incoming.userRating ?? null
  };
}

function annotateVaultState(record, watchedIndex, watchlistIndex) {
  const watchedHit = findInLookup(watchedIndex, record);
  const watchlistHit = findInLookup(watchlistIndex, record);
  const canonicalImdb =
    [record.imdbID, watchedHit?.imdbID, watchlistHit?.imdbID].find((id) => id && /^tt\d+$/i.test(id))
    || record.imdbID;

  return {
    ...record,
    id: canonicalImdb || record.id,
    imdbID: canonicalImdb,
    tmdbId: record.tmdbId || watchedHit?.tmdbId || watchlistHit?.tmdbId || null,
    Poster: record.Poster !== "N/A" ? record.Poster : resolvePosterValue(watchedHit?.poster || watchlistHit?.poster),
    poster: record.poster || watchedHit?.poster || watchlistHit?.poster || null,
    inVault: Boolean(watchedHit),
    inWatchlist: Boolean(watchlistHit),
    userRating: watchedHit?.userRating ?? record.userRating ?? null
  };
}

function scoreSearchRelevance(item, normQuery) {
  const normTitle = normalizeTitle(item.Title || item.title);
  let score = 0;
  if (normQuery) {
    if (normTitle === normQuery) score += 1000;
    else if (normTitle.startsWith(normQuery)) score += 600;
    else if (normTitle.includes(normQuery)) score += 300;
  }
  if (item.inVault || item.inWatchlist) score += 120;
  if (item.Poster && item.Poster !== "N/A") score += 45;
  score += Math.min(250, Number(item.popularity || 0));
  if (item.imdbRating) score += Number(item.imdbRating) * 5;
  return score;
}

/**
 * Merges, deduplicates, annotates Vault/Watchlist membership, and ranks search hits.
 */
export function mergeAndRankSearchResults({
  query = "",
  localMatches = [],
  tmdbResults = [],
  omdbResults = [],
  watched = [],
  watchlist = []
} = {}) {
  const watchedIndex = buildLookupIndex(watched);
  const watchlistIndex = buildLookupIndex(watchlist);

  const combined = [
    ...tmdbResults.map((item) => normalizeSearchRecord(item, "tmdb")),
    ...localMatches.map((item) => normalizeSearchRecord(item, "local")),
    ...omdbResults.map((item) => normalizeSearchRecord(item, "omdb"))
  ];

  const deduped = [];
  const keyToSlot = new Map();

  for (const record of combined) {
    const keys = buildRecordKeys(record);
    let existingSlot = -1;
    for (const key of keys) {
      if (keyToSlot.has(key)) {
        existingSlot = keyToSlot.get(key);
        break;
      }
    }

    if (existingSlot === -1) {
      const slot = deduped.length;
      deduped.push(record);
      keys.forEach((key) => keyToSlot.set(key, slot));
    } else {
      const merged = mergeTwoSearchRecords(deduped[existingSlot], record);
      deduped[existingSlot] = merged;
      buildRecordKeys(merged).forEach((key) => keyToSlot.set(key, existingSlot));
    }
  }

  const normQuery = normalizeTitle(query);
  return deduped
    .map((item) => annotateVaultState(item, watchedIndex, watchlistIndex))
    .sort((a, b) => scoreSearchRelevance(b, normQuery) - scoreSearchRelevance(a, normQuery));
}

function matchLocalVaultItems(query, watched = [], watchlist = []) {
  const trimmed = String(query || "").trim();
  const normQuery = normalizeTitle(trimmed);
  const isImdbId = /^tt\d+$/i.test(trimmed);
  if (!normQuery && !isImdbId) return [];

  const combined = [...(watched || []), ...(watchlist || [])];
  return combined.filter((movie) => {
    const title = normalizeTitle(movie.title || movie.Title);
    const director = normalizeTitle(movie.director || "");
    const genre = normalizeTitle(movie.genre || "");
    const imdb = String(movie.imdbID || "").toLowerCase();
    if (isImdbId) return imdb === trimmed.toLowerCase();
    return title.includes(normQuery) || director.includes(normQuery) || genre.includes(normQuery);
  });
}

/**
 * Searches local Vault first, queries TMDB primary catalog, and falls back to OMDb when sparse.
 */
export async function searchCatalogMovies({
  query = "",
  watched = [],
  watchlist = [],
  fetchTmdb,
  fetchOmdb,
  apiKey = "",
  signal
} = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed) return [];

  const localMatches = matchLocalVaultItems(trimmed, watched, watchlist);
  const isImdbLookup = /^tt\d{5,}$/i.test(trimmed);
  if (trimmed.length < 2 && !isImdbLookup) {
    return mergeAndRankSearchResults({ query: trimmed, localMatches, watched, watchlist });
  }

  const tmdbCaller = typeof fetchTmdb === "function"
    ? fetchTmdb
    : (hasTmdbBackend() ? fetchTmdbJson : null);
  const omdbCaller = typeof fetchOmdb === "function"
    ? fetchOmdb
    : ((hasOmdbBackend({ apiKey }) || Boolean(apiKey))
      ? (params, opts) => fetchOmdbJson({ ...params, ...(apiKey ? { apikey: apiKey } : {}) }, opts)
      : null);

  let tmdbResults = [];
  if (tmdbCaller) {
    try {
      const tmdbPayload = isImdbLookup
        ? await tmdbCaller(`/3/find/${trimmed}`, { external_source: "imdb_id" }, { signal })
        : await tmdbCaller("/3/search/movie", {
          query: trimmed,
          include_adult: false,
          language: "en-US",
          page: 1
        }, { signal });
      const rawTmdbList = isImdbLookup
        ? (tmdbPayload?.movie_results || [])
        : (tmdbPayload?.results || []);
      tmdbResults = rawTmdbList.slice(0, 12).map(mapTmdbSearchItem);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
    }
  }

  let omdbResults = [];
  if (omdbCaller && (isImdbLookup || tmdbResults.length < 3)) {
    try {
      const omdbPayload = await omdbCaller(
        isImdbLookup ? { i: trimmed } : { s: trimmed, type: "movie" },
        { signal }
      );
      if (omdbPayload?.Response === "True") {
        omdbResults = Array.isArray(omdbPayload.Search) ? omdbPayload.Search : [omdbPayload];
      }
    } catch (err) {
      if (err?.name === "AbortError") throw err;
    }
  }

  return mergeAndRankSearchResults({
    query: trimmed,
    localMatches,
    tmdbResults,
    omdbResults,
    watched,
    watchlist
  });
}

/**
 * Loads visual trending posters for the empty search theater state, with reliable fallback.
 */
export async function loadSearchTrendingPosters({
  watched = [],
  watchlist = [],
  fetchTmdb,
  limit = 8
} = {}) {
  const watchedIndex = buildLookupIndex(watched);
  const watchlistIndex = buildLookupIndex(watchlist);

  const tmdbCaller = typeof fetchTmdb === "function"
    ? fetchTmdb
    : (hasTmdbBackend() ? fetchTmdbJson : null);

  let liveItems = [];
  if (tmdbCaller) {
    try {
      const payload = await tmdbCaller("/3/trending/movie/week", { language: "en-US" });
      liveItems = (payload?.results || [])
        .map(mapTmdbSearchItem)
        .filter((item) => item.Poster && item.Poster !== "N/A")
        .slice(0, limit);
    } catch {
      liveItems = [];
    }
  }

  const baseList = liveItems.length > 0
    ? liveItems
    : CURATED_TRENDING_FALLBACK.slice(0, limit).map((item) => normalizeSearchRecord(item, "curated"));

  return baseList
    .slice(0, limit)
    .map((item) => annotateVaultState(item, watchedIndex, watchlistIndex));
}
