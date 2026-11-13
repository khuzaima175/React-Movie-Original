import { fetchTmdbJson, hasTmdbBackend } from "./apiTransport.js";
import { extractTasteProfile, getRecentReleaseDateFloor, normalizeTmdbItem } from "./tmdbService.js";

const HOME_FEEDS_CACHE_KEY = "cinemavault_home_feeds_v1";

const FALLBACK_ROWS = [
  {
    key: "trending",
    title: "Trending Cinema Highlights",
    movies: [
      { imdbID: "tt15239678", title: "Dune: Part Two", year: "2024", imdbRating: "8.5", genre: "Sci-Fi • Adventure • Drama", poster: "https://m.media-amazon.com/images/M/MV5BNTc0YmQxMjEtODI5MC00NjFiLTlkMWUtOGQ5NjFmYWUyZGJhXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt6751668", title: "Parasite", year: "2019", imdbRating: "8.5", genre: "Drama • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BYjk1Y2U4MjQtY2ZiNS00OWQyLWI3MmYtZWUwNmRjYWRiNWNhXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt1856101", title: "Blade Runner 2049", year: "2017", imdbRating: "8.0", genre: "Sci-Fi • Mystery • Drama", poster: "https://m.media-amazon.com/images/M/MV5BNzA1Njg4NzYxOV5BMl5BanBnXkFtZTgwODk5NjU3MzI@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
      { imdbID: "tt1392190", title: "Mad Max: Fury Road", year: "2015", imdbRating: "8.1", genre: "Action • Adventure • Sci-Fi", poster: "https://m.media-amazon.com/images/M/MV5BZDRkODJhOTgtOTc1OC00NTgzLTk4NjItNDgxZDY4YjlmNDY2XkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt9362722", title: "Spider-Man: Across the Spider-Verse", year: "2023", imdbRating: "8.5", genre: "Animation • Action • Adventure", poster: "https://m.media-amazon.com/images/M/MV5BNThiZjA3MjItZGY5Ni00ZmJhLWEwN2EtOTBlYTA4Y2E0M2ZmXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0172495", title: "Gladiator", year: "2000", imdbRating: "8.5", genre: "Action • Adventure • Drama", poster: "https://m.media-amazon.com/images/M/MV5BYWQ4YmNjYjEtOWE1Zi00Y2U4LWI4NTAtMTU0MjkxNWQ1ZmJiXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg" }
    ]
  },
  {
    key: "acclaimed",
    title: "Top Rated Masterpieces",
    movies: [
      { imdbID: "tt0068646", title: "The Godfather", year: "1972", imdbRating: "9.2", genre: "Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BNGEwYjgwOGQtYjg5ZS00Njc1LTk2ZGEtM2QwZWQ2NjdhZTE5XkEyXkFqcGc@._V1_QL75_UY562_CR8,0,380,562_.jpg" },
      { imdbID: "tt0111161", title: "The Shawshank Redemption", year: "1994", imdbRating: "9.3", genre: "Drama", poster: "https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00MDNlLThiMGUtY2UxYWVkNGY2ZjljXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
      { imdbID: "tt0245429", title: "Spirited Away", year: "2003", imdbRating: "8.6", genre: "Animation • Adventure • Family", poster: "https://m.media-amazon.com/images/M/MV5BNTEyNmEwOWUtYzkyOC00ZTQ4LTllZmUtMjk0Y2YwOGUzYjRiXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
      { imdbID: "tt0050083", title: "12 Angry Men", year: "1957", imdbRating: "9.0", genre: "Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BYjE4NzdmOTYtYjc5Yi00YzBiLWEzNDEtNTgxZGQ2MWVkN2NiXkEyXkFqcGc@._V1_QL75_UX380_CR0,11,380,562_.jpg" },
      { imdbID: "tt2582802", title: "Whiplash", year: "2014", imdbRating: "8.5", genre: "Drama • Music", poster: "https://m.media-amazon.com/images/M/MV5BMDFjOWFkYzktYzhhMC00NmYyLTkwY2EtYjViMDhmNzg0OGFkXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0108052", title: "Schindler's List", year: "1994", imdbRating: "9.0", genre: "Biography • Drama • History", poster: "https://m.media-amazon.com/images/M/MV5BNjM1ZDQxYWUtMzQyZS00MTE1LWJmZGYtNGUyNTdlYjM3ZmVmXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" }
    ]
  },
  {
    key: "genreClassics",
    title: "Genre Essentials & Thrillers",
    movies: [
      { imdbID: "tt0078748", title: "Alien", year: "1979", imdbRating: "8.5", genre: "Horror • Sci-Fi", poster: "https://m.media-amazon.com/images/M/MV5BN2NhMDk2MmEtZDQzOC00MmY5LThhYzAtMDdjZGFjOGZjMjdjXkEyXkFqcGc@._V1_QL75_UX380_CR0,6,380,562_.jpg" },
      { imdbID: "tt0103064", title: "Terminator 2: Judgment Day", year: "1991", imdbRating: "8.6", genre: "Action • Sci-Fi", poster: "https://m.media-amazon.com/images/M/MV5BNGMyMGNkMDUtMjc2Ni00NWFlLTgyODEtZTY2MzBiZTg0OWZiXkEyXkFqcGc@._V1_QL75_UX380_CR0,1,380,562_.jpg" },
      { imdbID: "tt0102926", title: "The Silence of the Lambs", year: "1991", imdbRating: "8.6", genre: "Crime • Drama • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BNDdhOGJhYzctYzYwZC00YmI2LWI0MjctYjg4ODdlMDExYjBlXkEyXkFqcGc@._V1_QL75_UY562_CR1,0,380,562_.jpg" },
      { imdbID: "tt0099685", title: "GoodFellas", year: "1990", imdbRating: "8.7", genre: "Biography • Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BN2E5NzI2ZGMtY2VjNi00YTRjLWI1MDUtZGY5OWU1MWJjZjRjXkEyXkFqcGc@._V1_QL75_UX380_CR0,3,380,562_.jpg" },
      { imdbID: "tt0105236", title: "Reservoir Dogs", year: "1992", imdbRating: "8.3", genre: "Crime • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BMmMzYjg4NDctYWY0Mi00OGViLWIzMTMtYWNlZGY5ZDJmYjk3XkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0080684", title: "Star Wars: The Empire Strikes Back", year: "1980", imdbRating: "8.7", genre: "Action • Adventure • Fantasy", poster: "https://m.media-amazon.com/images/M/MV5BMTkxNGFlNDktZmJkNC00MDdhLTg0MTEtZjZiYWI3MGE5NWIwXkEyXkFqcGc@._V1_SX300.jpg" }
    ]
  }
];

function normalizeYearToken(yearValue) {
  return String(yearValue || "").match(/\d{4}/)?.[0] || "0000";
}

function normalizeTitleYearKey(title, year) {
  const cleanTitle = String(title || "").toLowerCase().trim();
  if (!cleanTitle) return "";
  return `title:${cleanTitle}::${normalizeYearToken(year)}`;
}

function getItemCollisionKeys(item) {
  if (!item) return [];
  const keys = [];
  const imdb = item.imdbID ? String(item.imdbID).trim().toLowerCase() : "";
  if (imdb) keys.push(`imdb:${imdb}`);

  const tmdbNum = Number(item.tmdbId ?? (typeof item.id === "number" ? item.id : String(item.id || "").replace(/^tmdb_/, "")));
  if (Number.isFinite(tmdbNum) && tmdbNum > 0) {
    keys.push(`tmdb:${tmdbNum}`);
    keys.push(`imdb:tmdb_${tmdbNum}`);
  }

  const rawId = item.id !== undefined && item.id !== null ? String(item.id).trim().toLowerCase() : "";
  if (rawId) keys.push(`id:${rawId}`);

  const tyKey = normalizeTitleYearKey(item.title || item.Title, item.year || item.Year || item.release_date);
  if (tyKey) keys.push(tyKey);
  return keys;
}

export function buildSeenCollisionSet(watched = [], watchlist = []) {
  const seen = new Set();
  for (const list of [watched, watchlist]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      for (const k of getItemCollisionKeys(item)) {
        seen.add(k);
      }
    }
  }
  return seen;
}

export function excludeSeenAndPlaced(items = [], seenSet = new Set(), placedSet = new Set()) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const out = [];
  for (const item of items) {
    if (!item || !(item.title || item.Title)) continue;
    const keys = getItemCollisionKeys(item);
    if (keys.length === 0) continue;
    if (keys.some((k) => seenSet.has(k) || placedSet.has(k))) continue;
    for (const k of keys) placedSet.add(k);
    out.push(item);
  }
  return out;
}

function upgradeBackdropUrl(url) {
  if (!url) return null;
  const str = String(url).trim();
  if (!str || /unsplash\.com/i.test(str)) return null;
  return str.replace("/t/p/original/", "/t/p/w1280/");
}

export function toDashboardCardItem(tmdbItem = {}) {
  const rawNumericId = Number(tmdbItem.tmdbId ?? tmdbItem.id ?? 0);
  const tmdbId = Number.isFinite(rawNumericId) && rawNumericId > 0 ? rawNumericId : null;
  const imdbID = tmdbItem.imdbID || (tmdbId ? `tmdb_${tmdbId}` : null);
  const year = tmdbItem.year || normalizeYearToken(tmdbItem.release_date) || "N/A";
  const vote = tmdbItem.imdbRating ?? (tmdbItem.vote_average != null ? String(tmdbItem.vote_average) : null);
  const backdrop = upgradeBackdropUrl(
    tmdbItem.backdrop || (tmdbItem.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tmdbItem.backdrop_path}` : null)
  );
  const poster =
    tmdbItem.poster || (tmdbItem.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbItem.poster_path}` : null);

  return {
    id: imdbID || tmdbItem.id,
    tmdbId,
    imdbID,
    title: tmdbItem.title || tmdbItem.Title || "Untitled",
    year: year === "0000" ? "N/A" : year,
    imdbRating: vote,
    poster,
    backdrop,
    genre: String(tmdbItem.genre || "Cinema").replace(/,\s*/g, " • "),
    plot: tmdbItem.plot || tmdbItem.overview || ""
  };
}

export function buildHeroSlides(liveRows = [], watchlist = [], watched = [], fallbackPool = [], limit = 5) {
  const watchedSet = buildSeenCollisionSet(watched, []);
  const placedHero = new Set();

  const liveFlat = (liveRows || []).flatMap((r) => (Array.isArray(r?.movies) ? r.movies : []));
  const watchlistNormalized = (watchlist || []).map((w) => ({
    ...w,
    backdrop: upgradeBackdropUrl(w.backdrop),
    plot: w.plot || w.overview || "",
    genre: String(w.genre || "Cinema").replace(/,\s*/g, " • ")
  }));
  const fallbackNormalized = (fallbackPool || []).map((f) => ({
    ...f,
    backdrop: upgradeBackdropUrl(f.backdrop),
    plot: f.plot || f.overview || "",
    genre: String(f.genre || "Cinema").replace(/,\s*/g, " • ")
  }));

  const candidatePools = [
    liveFlat.filter((m) => Boolean(m?.backdrop)),
    watchlistNormalized.filter((m) => Boolean(m?.backdrop)),
    liveFlat,
    watchlistNormalized,
    fallbackNormalized
  ];

  const picked = [];
  for (const pool of candidatePools) {
    const fresh = excludeSeenAndPlaced(pool, watchedSet, placedHero);
    for (const item of fresh) {
      picked.push(item);
      if (picked.length >= limit) return picked;
    }
  }

  // Last resort when vault already includes every fallback title
  if (picked.length === 0) {
    return excludeSeenAndPlaced([...watchlistNormalized, ...fallbackNormalized], new Set(), new Set()).slice(0, limit);
  }
  return picked;
}

function resolveSessionStorage(explicitStorage) {
  if (explicitStorage) return explicitStorage;
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch (_) {}
  return null;
}

function buildCacheSignature(watched = [], watchlist = [], userRegion = "US", now = Date.now()) {
  const dayKey = new Date(now).toISOString().slice(0, 10);
  const fullSig = [...watched, ...watchlist]
    .map((m) => String(m?.imdbID || m?.tmdbId || m?.id || m?.title || ""))
    .sort()
    .join("|");
  let hash = 2166136261;
  for (let i = 0; i < fullSig.length; i += 1) {
    hash ^= fullSig.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${dayKey}::${userRegion}::${watched.length}::${watchlist.length}::${(hash >>> 0).toString(36)}`;
}

export function shouldShowCarouselArrows(scrollWidth = 0, clientWidth = 0) {
  return Number(scrollWidth) > Number(clientWidth) + 4;
}

export async function loadHomeDiscoveryFeeds({
  watched = [],
  watchlist = [],
  userRegion = "US",
  hasBackend = hasTmdbBackend(),
  fetchTmdb = fetchTmdbJson,
  now = Date.now(),
  storage = null
} = {}) {
  const seenSet = buildSeenCollisionSet(watched, watchlist);
  const store = resolveSessionStorage(storage);
  const sig = buildCacheSignature(watched, watchlist, userRegion, now);

  if (store) {
    try {
      const raw = store.getItem(HOME_FEEDS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.sig === sig && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
          return {
            heroSlides: parsed.heroSlides || [],
            rows: parsed.rows,
            isLive: Boolean(parsed.isLive)
          };
        }
      }
    } catch (_) {}
  }

  let rows = [];
  let isLive = false;

  if (hasBackend && typeof fetchTmdb === "function") {
    try {
      const taste = watched.length >= 2 ? await extractTasteProfile(watched, watchlist).catch(() => null) : null;
      const topGenres = (taste?.lovedGenreIds || []).slice(0, 2).join("|");
      const recentFloor = getRecentReleaseDateFloor(12, now);

      const safeFetch = (path, params) =>
        Promise.resolve(fetchTmdb(path, params)).catch(() => ({ results: [] }));

      const [tasteRes, trendingRes, recentRes, gemsRes] = await Promise.all([
        safeFetch("/3/discover/movie", {
          include_adult: "false",
          language: "en-US",
          sort_by: "vote_average.desc",
          "vote_count.gte": "250",
          ...(topGenres ? { with_genres: topGenres } : {}),
          page: "1"
        }),
        safeFetch("/3/trending/movie/week", { language: "en-US", page: "1" }),
        safeFetch("/3/discover/movie", {
          include_adult: "false",
          language: "en-US",
          sort_by: "popularity.desc",
          "primary_release_date.gte": recentFloor,
          "vote_count.gte": "80",
          page: "1"
        }),
        safeFetch("/3/discover/movie", {
          include_adult: "false",
          language: "en-US",
          sort_by: "vote_average.desc",
          "vote_average.gte": "7.4",
          "vote_count.gte": "300",
          "vote_count.lte": "4500",
          page: "1"
        })
      ]);

      const mapTmdbResults = (res) =>
        (Array.isArray(res?.results) ? res.results : [])
          .filter((m) => m && m.poster_path)
          .map((m) => toDashboardCardItem(normalizeTmdbItem(m)));

      const placedSet = new Set();
      const rawFeedSpecs = [
        {
          key: "taste",
          title: watched.length >= 2 ? "Picked For Your Taste" : "Acclaimed Cinema Picks",
          movies: excludeSeenAndPlaced(mapTmdbResults(tasteRes), seenSet, placedSet).slice(0, 14)
        },
        {
          key: "trending",
          title: "Trending This Week",
          movies: excludeSeenAndPlaced(mapTmdbResults(trendingRes), seenSet, placedSet).slice(0, 14)
        },
        {
          key: "recent",
          title: "Recent Releases",
          movies: excludeSeenAndPlaced(mapTmdbResults(recentRes), seenSet, placedSet).slice(0, 14)
        },
        {
          key: "gems",
          title: "Hidden Gems",
          movies: excludeSeenAndPlaced(mapTmdbResults(gemsRes), seenSet, placedSet).slice(0, 14)
        }
      ];

      rows = rawFeedSpecs.filter((r) => r.movies.length > 0);
      isLive = rows.length > 0;
    } catch (_) {
      rows = [];
      isLive = false;
    }
  }

  if (!isLive) {
    const placedSet = new Set();
    rows = FALLBACK_ROWS.map((row) => ({
      ...row,
      movies: excludeSeenAndPlaced(row.movies, seenSet, placedSet)
    })).filter((row) => row.movies.length > 0);
  }

  const fallbackFlat = FALLBACK_ROWS.flatMap((r) => r.movies);
  const heroSlides = buildHeroSlides(rows, watchlist, watched, fallbackFlat, 5);

  const payload = { heroSlides, rows, isLive };
  if (store && rows.length > 0) {
    try {
      store.setItem(HOME_FEEDS_CACHE_KEY, JSON.stringify({ sig, ...payload }));
    } catch (_) {}
  }

  return payload;
}
