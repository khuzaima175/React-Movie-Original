import { fetchTmdbJson, hasTmdbBackend } from "./apiTransport.js";
import {
  buildMovieKeys,
  extractTmdbNumericId,
  findMatchingMovie,
  isSameMovie
} from "./movieIdentity.js";
import {
  extractTasteProfile,
  getRecentReleaseDateFloor,
  TMDB_ID_TO_GENRE
} from "./tmdbService.js";

export { buildMovieKeys, extractTmdbNumericId, findMatchingMovie, isSameMovie };

const HOME_FEEDS_CACHE_KEY = "cinemavault_home_feeds_v2";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export const FALLBACK_ROWS = [
  {
    key: "trending",
    title: "Trending Cinema Picks",
    subtitle: "Audience favorites and modern blockbusters",
    movies: [
      { imdbID: "tt15239678", title: "Dune: Part Two", year: "2024", imdbRating: "8.5", genre: "Sci-Fi • Adventure • Drama", poster: "https://m.media-amazon.com/images/M/MV5BNTc0YmQxMjEtODI5MC00NjFiLTlkMWUtOGQ5NjFmYWUyZGJhXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt15398776", title: "Oppenheimer", year: "2023", imdbRating: "8.3", genre: "Biography • Drama • History", poster: "https://m.media-amazon.com/images/M/MV5BN2JkMDc5MGQtZjg3YS00NmFiLWIyZmQtZTJmNTM5MjVmYTQ4XkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt9362722", title: "Spider-Man: Across the Spider-Verse", year: "2023", imdbRating: "8.5", genre: "Animation • Action • Adventure", poster: "https://m.media-amazon.com/images/M/MV5BNThiZjA3MjItZGY5Ni00ZmJhLWEwN2EtOTBlYTA4Y2E0M2ZmXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt6710474", title: "Everything Everywhere All at Once", year: "2022", imdbRating: "7.8", genre: "Action • Adventure • Comedy", poster: "https://m.media-amazon.com/images/M/MV5BOWNmMzAzZmQtNDQ1NC00Nzk5LTkyMmUtNGI2N2NkOWM4MzEyXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt1745960", title: "Top Gun: Maverick", year: "2022", imdbRating: "8.2", genre: "Action • Drama", poster: "https://m.media-amazon.com/images/M/MV5BMDBkZDNjMWEtOTdmMi00NmExLTg5MmMtNTFlYTJlNWY5YTdmXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt6751668", title: "Parasite", year: "2019", imdbRating: "8.5", genre: "Drama • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BYjk1Y2U4MjQtY2ZiNS00OWQyLWI3MmYtZWUwNmRjYWRiNWNhXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt1856101", title: "Blade Runner 2049", year: "2017", imdbRating: "8.0", genre: "Sci-Fi • Mystery • Drama", poster: "https://m.media-amazon.com/images/M/MV5BNzA1Njg4NzYxOV5BMl5BanBnXkFtZTgwODk5NjU3MzI@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
      { imdbID: "tt1392190", title: "Mad Max: Fury Road", year: "2015", imdbRating: "8.1", genre: "Action • Adventure • Sci-Fi", poster: "https://m.media-amazon.com/images/M/MV5BZDRkODJhOTgtOTc1OC00NTgzLTk4NjItNDgxZDY4YjlmNDY2XkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0816692", title: "Interstellar", year: "2014", imdbRating: "8.7", genre: "Sci-Fi • Drama • Adventure", poster: "https://m.media-amazon.com/images/M/MV5BYzdjMDAxZGItMjI2My00ODA1LTlkNzItOWFjMDU5ZDJlYWY3XkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt1375666", title: "Inception", year: "2010", imdbRating: "8.8", genre: "Action • Sci-Fi • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_SX300.jpg" },
      { imdbID: "tt0468569", title: "The Dark Knight", year: "2008", imdbRating: "9.0", genre: "Action • Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_SX300.jpg" },
      { imdbID: "tt0172495", title: "Gladiator", year: "2000", imdbRating: "8.5", genre: "Action • Adventure • Drama", poster: "https://m.media-amazon.com/images/M/MV5BYWQ4YmNjYjEtOWE1Zi00Y2U4LWI4NTAtMTU0MjkxNWQ1ZmJiXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg" }
    ]
  },
  {
    key: "acclaimed",
    title: "All-Time Essential Classics",
    subtitle: "Landmarks that define great cinema",
    movies: [
      { imdbID: "tt0068646", title: "The Godfather", year: "1972", imdbRating: "9.2", genre: "Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BNGEwYjgwOGQtYjg5ZS00Njc1LTk2ZGEtM2QwZWQ2NjdhZTE5XkEyXkFqcGc@._V1_QL75_UY562_CR8,0,380,562_.jpg" },
      { imdbID: "tt0111161", title: "The Shawshank Redemption", year: "1994", imdbRating: "9.3", genre: "Drama", poster: "https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00MDNlLThiMGUtY2UxYWVkNGY2ZjljXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
      { imdbID: "tt0110912", title: "Pulp Fiction", year: "1994", imdbRating: "8.9", genre: "Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BYTViYTE3ZGQtNDBlMC00ZTAyLTkyODMtZGRiZDg0MjA2YThkXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0108052", title: "Schindler's List", year: "1994", imdbRating: "9.0", genre: "Biography • Drama • History", poster: "https://m.media-amazon.com/images/M/MV5BNjM1ZDQxYWUtMzQyZS00MTE1LWJmZGYtNGUyNTdlYjM3ZmVmXkEyXkFqcGc@._V1_QL75_UX380_CR0,4,380,562_.jpg" },
      { imdbID: "tt0050083", title: "12 Angry Men", year: "1957", imdbRating: "9.0", genre: "Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BYjE4NzdmOTYtYjc5Yi00YzBiLWEzNDEtNTgxZGQ2MWVkN2NiXkEyXkFqcGc@._V1_QL75_UX380_CR0,11,380,562_.jpg" },
      { imdbID: "tt0109830", title: "Forrest Gump", year: "1994", imdbRating: "8.8", genre: "Drama • Romance", poster: "https://m.media-amazon.com/images/M/MV5BNDYwNzVjMTItZmU5YS00YjQ5LTljYjgtMjY2NDVmYWMyNWFmXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0137523", title: "Fight Club", year: "1999", imdbRating: "8.8", genre: "Drama", poster: "https://m.media-amazon.com/images/M/MV5BOTgyOGQ1NDItNGU3Ny00MjU3LTg2YWEtNmEyYjBiMjI1Y2M5XkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt2582802", title: "Whiplash", year: "2014", imdbRating: "8.5", genre: "Drama • Music", poster: "https://m.media-amazon.com/images/M/MV5BMDFjOWFkYzktYzhhMC00NmYyLTkwY2EtYjViMDhmNzg0OGFkXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0245429", title: "Spirited Away", year: "2003", imdbRating: "8.6", genre: "Animation • Adventure • Family", poster: "https://m.media-amazon.com/images/M/MV5BNTEyNmEwOWUtYzkyOC00ZTQ4LTllZmUtMjk0Y2YwOGUzYjRiXkEyXkFqcGc@._V1_QL75_UX380_CR0,0,380,562_.jpg" },
      { imdbID: "tt0477348", title: "No Country for Old Men", year: "2007", imdbRating: "8.2", genre: "Crime • Drama • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BMjA5Njk3MjM4OV5BMl5BanBnXkFtZTcwMTc5MTE1MQ@@._V1_SX300.jpg" },
      { imdbID: "tt0482571", title: "The Prestige", year: "2006", imdbRating: "8.5", genre: "Drama • Mystery • Sci-Fi", poster: "https://m.media-amazon.com/images/M/MV5BZWU0NWZhYzMtZmNlYy00MjA1LTgyZWEtYmNjNzdjYmRkOTkzXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0910970", title: "WALL·E", year: "2008", imdbRating: "8.4", genre: "Animation • Adventure • Sci-Fi", poster: "https://m.media-amazon.com/images/M/MV5BMjExMTg5OTU0NF5BMl5BanBnXkFtZTcwMjMxMzMzMw@@._V1_SX300.jpg" }
    ]
  },
  {
    key: "genreClassics",
    title: "Sci-Fi, Crime & Tension",
    subtitle: "High-stakes mysteries, neo-noir, and speculative worlds",
    movies: [
      { imdbID: "tt0133093", title: "The Matrix", year: "1999", imdbRating: "8.7", genre: "Action • Sci-Fi", poster: "https://m.media-amazon.com/images/M/MV5BN2NmN2VhMTQtMDNiOS00NDlhLTliMjgtODE2ZTY0ODQyNDRhXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0078748", title: "Alien", year: "1979", imdbRating: "8.5", genre: "Horror • Sci-Fi", poster: "https://m.media-amazon.com/images/M/MV5BN2NhMDk2MmEtZDQzOC00MmY5LThhYzAtMDdjZGFjOGZjMjdjXkEyXkFqcGc@._V1_QL75_UX380_CR0,6,380,562_.jpg" },
      { imdbID: "tt0103064", title: "Terminator 2: Judgment Day", year: "1991", imdbRating: "8.6", genre: "Action • Sci-Fi", poster: "https://m.media-amazon.com/images/M/MV5BNGMyMGNkMDUtMjc2Ni00NWFlLTgyODEtZTY2MzBiZTg0OWZiXkEyXkFqcGc@._V1_QL75_UX380_CR0,1,380,562_.jpg" },
      { imdbID: "tt0102926", title: "The Silence of the Lambs", year: "1991", imdbRating: "8.6", genre: "Crime • Drama • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BNDdhOGJhYzctYzYwZC00YmI2LWI0MjctYjg4ODdlMDExYjBlXkEyXkFqcGc@._V1_QL75_UY562_CR1,0,380,562_.jpg" },
      { imdbID: "tt0099685", title: "GoodFellas", year: "1990", imdbRating: "8.7", genre: "Biography • Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BN2E5NzI2ZGMtY2VjNi00YTRjLWI1MDUtZGY5OWU1MWJjZjRjXkEyXkFqcGc@._V1_QL75_UX380_CR0,3,380,562_.jpg" },
      { imdbID: "tt0105236", title: "Reservoir Dogs", year: "1992", imdbRating: "8.3", genre: "Crime • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BMmMzYjg4NDctYWY0Mi00OGViLWIzMTMtYWNlZGY5ZDJmYjk3XkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0080684", title: "Star Wars: The Empire Strikes Back", year: "1980", imdbRating: "8.7", genre: "Action • Adventure • Fantasy", poster: "https://m.media-amazon.com/images/M/MV5BMTkxNGFlNDktZmJkNC00MDdhLTg0MTEtZjZiYWI3MGE5NWIwXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0114369", title: "Se7en", year: "1995", imdbRating: "8.6", genre: "Crime • Drama • Mystery", poster: "https://m.media-amazon.com/images/M/MV5BY2IzNzMxZjctZjUxZi00YzAxLTk3ZjMtODFjODdhMDU5NDM1XkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0209144", title: "Memento", year: "2000", imdbRating: "8.4", genre: "Mystery • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BMGQ3Y2Q4NjktN2E4Ny00Y2Q2LTliZDUtZTNiNjRhY2I0NGIyXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt2543164", title: "Arrival", year: "2016", imdbRating: "7.9", genre: "Drama • Mystery • Sci-Fi", poster: "https://m.media-amazon.com/images/M/MV5BMTExMzU0ODcxNDheQTJeQWpwZ15BbWU4MDE1OTI4MzAy._V1_SX300.jpg" },
      { imdbID: "tt0470752", title: "Ex Machina", year: "2014", imdbRating: "7.7", genre: "Drama • Sci-Fi • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BMTUxNzc0OTIxMV5BMl5BanBnXkFtZTgwNDI3NzU2NDE@._V1_SX300.jpg" },
      { imdbID: "tt0113277", title: "Heat", year: "1995", imdbRating: "8.3", genre: "Action • Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BMTkxYjU1OTMtYWViZC00ZjAzLWI3MDktZGQ2N2VmMjVjNDRlXkEyXkFqcGc@._V1_SX300.jpg" }
    ]
  },
  {
    key: "worldAndModern",
    title: "World Cinema & Modern Gems",
    subtitle: "Festival winners and acclaimed contemporary stories",
    movies: [
      { imdbID: "tt1392214", title: "Prisoners", year: "2013", imdbRating: "8.1", genre: "Crime • Drama • Mystery", poster: "https://m.media-amazon.com/images/M/MV5BMTg0NTIzMjQ1NV5BMl5BanBnXkFtZTcwNDc3MzM5OQ@@._V1_SX300.jpg" },
      { imdbID: "tt0443706", title: "Zodiac", year: "2007", imdbRating: "7.7", genre: "Crime • Drama • Mystery", poster: "https://m.media-amazon.com/images/M/MV5BNDFkMTRkZmQtM2I0NC00NjJjLWJlMDctNTNiZWYxYzhjZDZiXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0407887", title: "The Departed", year: "2006", imdbRating: "8.5", genre: "Crime • Drama • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BMTI1MTY2OTIxNV5BMl5BanBnXkFtZTYwNjQ4NjY3._V1_SX300.jpg" },
      { imdbID: "tt0364569", title: "Oldboy", year: "2003", imdbRating: "8.3", genre: "Action • Drama • Mystery", poster: "https://m.media-amazon.com/images/M/MV5BMTAwNzNjYWItZmI0Ni00ZTcyLWIwNWMtZjlmNGMxZTEyYTJmXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0353969", title: "Memories of Murder", year: "2003", imdbRating: "8.1", genre: "Crime • Drama • Mystery", poster: "https://m.media-amazon.com/images/M/MV5BYmRjOWE5NmMtYTdkYS00ODFlLWJiMTMtYzE2NDZlZjlkZDQ0XkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0118694", title: "In the Mood for Love", year: "2000", imdbRating: "8.1", genre: "Drama • Romance", poster: "https://m.media-amazon.com/images/M/MV5BN2Q4NjllMDgtOTk2Zi00YzM1LWJmOTMtNmRiZDgyZGJmMjQzXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0317248", title: "City of God", year: "2002", imdbRating: "8.6", genre: "Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BYjY4NGI5OTUtY2ZlZS00Zjk4LTk5N2MtN2JmYWVjNGNmMGRlXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt0211915", title: "Amélie", year: "2001", imdbRating: "8.3", genre: "Comedy • Romance", poster: "https://m.media-amazon.com/images/M/MV5BOTNmYzY0MWQtZGZmNy00Y2Y4LWFmMDQtMTZjYTdiYzEwZGQ2XkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt8613070", title: "Portrait of a Lady on Fire", year: "2019", imdbRating: "8.1", genre: "Drama • Romance", poster: "https://m.media-amazon.com/images/M/MV5BZjJlYWJlYmMtNjMyMS00ZDgxLTlmNjAtOTJhMzBiZWM5N2VmXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt3783958", title: "La La Land", year: "2016", imdbRating: "8.0", genre: "Comedy • Drama • Music", poster: "https://m.media-amazon.com/images/M/MV5BMDllYjliOTUtMDJjZC00ODIzLWJmNGMtOWI2NzQxMjA2NzdlXkEyXkFqcGc@._V1_SX300.jpg" },
      { imdbID: "tt5052448", title: "Get Out", year: "2017", imdbRating: "7.8", genre: "Horror • Mystery • Thriller", poster: "https://m.media-amazon.com/images/M/MV5BMjUxMDQwNjcyNl5BMl5BanBnXkFtZTgwNzcwMzc0MTI@._V1_SX300.jpg" },
      { imdbID: "tt8946378", title: "Knives Out", year: "2019", imdbRating: "7.9", genre: "Comedy • Crime • Drama", poster: "https://m.media-amazon.com/images/M/MV5BZDU5ZTRkYmItZjg0Mi00ZTQwLThjMWItNWM3MTMxMzVjZmVjXkEyXkFqcGc@._V1_SX300.jpg" }
    ]
  }
];

function normalizeTmdbBackdropUrl(rawUrl) {
  if (!rawUrl || /unsplash\.com/i.test(rawUrl)) return null;
  return String(rawUrl).replace("/t/p/original/", "/t/p/w1280/");
}

export function buildSeenCollisionSet(watched = [], watchlist = []) {
  const seen = new Set();
  for (const movie of [...(watched || []), ...(watchlist || [])]) {
    if (!movie) continue;
    buildMovieKeys(movie).forEach((key) => seen.add(key));
  }
  return seen;
}

export function excludeSeenAndPlaced(items = [], seenSet = new Set(), placedSet = new Set()) {
  const kept = [];
  for (const item of items) {
    if (!item) continue;
    const keys = buildMovieKeys(item);
    if (keys.length === 0) continue;
    if (keys.some((k) => seenSet.has(k) || placedSet.has(k))) continue;
    keys.forEach((k) => placedSet.add(k));
    kept.push(item);
  }
  return kept;
}

export function toDashboardCardItem(tmdbItem = {}) {
  const tmdbId = Number(tmdbItem.tmdbId ?? tmdbItem.id) || null;
  const imdbID = tmdbItem.imdbID || (tmdbId ? `tmdb_${tmdbId}` : "");
  const title = tmdbItem.title || tmdbItem.Title || tmdbItem.original_title || "Untitled";
  const year = tmdbItem.year || tmdbItem.Year || (tmdbItem.release_date ? String(tmdbItem.release_date).slice(0, 4) : "");
  const backdrop = normalizeTmdbBackdropUrl(
    tmdbItem.backdrop || (tmdbItem.backdrop_path ? `https://image.tmdb.org/t/p/w1280${tmdbItem.backdrop_path}` : null)
  );
  const poster =
    tmdbItem.poster || tmdbItem.Poster || (tmdbItem.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbItem.poster_path}` : null);
  const genre =
    tmdbItem.genre
    || (Array.isArray(tmdbItem.genre_ids)
      ? tmdbItem.genre_ids.map((id) => TMDB_ID_TO_GENRE[id]).filter(Boolean).join(" • ")
      : "");
  const rawVote = tmdbItem.vote_average;
  const imdbRating = rawVote != null && Number.isFinite(Number(rawVote))
    ? Number(rawVote).toFixed(1)
    : (tmdbItem.imdbRating != null ? String(tmdbItem.imdbRating) : null);

  return {
    id: imdbID || (tmdbId ? `tmdb_${tmdbId}` : `${title}::${year}`),
    imdbID,
    tmdbId,
    title,
    year,
    poster,
    backdrop,
    genre,
    imdbRating,
    plot: tmdbItem.plot || tmdbItem.overview || "",
    runtime: tmdbItem.runtime || null
  };
}

export function buildHeroSlides(liveRows = [], watchlist = [], watched = [], fallbackPool = [], limit = 5) {
  const watchedSet = buildSeenCollisionSet(watched, []);
  const placedHero = new Set();
  const slides = [];

  const normalizeSlideItem = (rawItem, badge, requireBackdrop) => {
    if (!rawItem) return null;
    const card = rawItem.backdrop && !rawItem.tmdbId
      ? { ...rawItem, backdrop: normalizeTmdbBackdropUrl(rawItem.backdrop) }
      : toDashboardCardItem(rawItem);
    const normalized = {
      ...rawItem,
      ...card,
      backdrop: normalizeTmdbBackdropUrl(rawItem.backdrop || card.backdrop),
      badge: rawItem.badge || badge
    };
    if (requireBackdrop && !normalized.backdrop) return null;
    if (!requireBackdrop && !normalized.backdrop && !normalized.poster) return null;
    return normalized;
  };

  const pushFromPool = (pool, badge, requireBackdrop) => {
    for (const rawItem of pool || []) {
      if (slides.length >= limit) break;
      const item = normalizeSlideItem(rawItem, badge, requireBackdrop);
      if (!item) continue;
      const keys = buildMovieKeys(item);
      if (keys.some((k) => watchedSet.has(k) || placedHero.has(k))) continue;
      keys.forEach((k) => placedHero.add(k));
      slides.push(item);
    }
  };

  const liveFlat = (liveRows || []).flatMap((row) => row?.movies || []);

  pushFromPool(liveFlat, "Featured Spotlight", true);
  pushFromPool(watchlist, "From Your Watchlist", true);
  pushFromPool(fallbackPool, "Curated Classic", true);
  pushFromPool(liveFlat, "Featured Spotlight", false);
  pushFromPool(watchlist, "From Your Watchlist", false);
  pushFromPool(fallbackPool, "Curated Classic", false);

  if (slides.length === 0) {
    return [...(watchlist || []), ...(fallbackPool || [])]
      .slice(0, limit)
      .map((item) => ({
        ...toDashboardCardItem(item),
        ...item,
        backdrop: normalizeTmdbBackdropUrl(item.backdrop)
      }));
  }

  return slides.slice(0, limit);
}

export function shouldShowCarouselArrows(scrollWidth = 0, clientWidth = 0) {
  return Number(scrollWidth || 0) - Number(clientWidth || 0) > 4;
}

async function fetchMultiPageTmdb(tmdbCaller, path, queryParams = {}, pages = [1, 2]) {
  const pageResponses = await Promise.all(
    pages.map((page) =>
      tmdbCaller(path, { ...queryParams, page }).catch(() => null)
    )
  );
  return pageResponses.flatMap((res) => (Array.isArray(res?.results) ? res.results : []));
}

function buildCacheStorageKey(watched = [], watchlist = [], userRegion = "US", now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const signature = `${watched.length}:${watchlist.length}:${watched[0]?.imdbID || ""}:${watchlist[0]?.imdbID || ""}`;
  return `${HOME_FEEDS_CACHE_KEY}::${day}::${userRegion}::${signature}`;
}

export async function loadHomeDiscoveryFeeds({
  watched = [],
  watchlist = [],
  userRegion = "US",
  hasBackend,
  fetchTmdb,
  now = Date.now(),
  storage
} = {}) {
  const resolveStorage = storage || (typeof window !== "undefined" ? window.localStorage : null);
  const cacheKey = buildCacheStorageKey(watched, watchlist, userRegion, now);

  if (resolveStorage) {
    try {
      const raw = resolveStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rows) && now - Number(parsed.cachedAt || 0) < CACHE_TTL_MS) {
          return {
            heroSlides: parsed.heroSlides || [],
            rows: parsed.rows,
            mosaicPool: parsed.mosaicPool || parsed.rows.flatMap((r) => r.movies || []),
            isLive: Boolean(parsed.isLive)
          };
        }
      }
    } catch {
      // ignore corrupted storage entry
    }
  }

  const backendEnabled = typeof hasBackend === "boolean" ? hasBackend : hasTmdbBackend();
  const tmdbCaller = typeof fetchTmdb === "function"
    ? fetchTmdb
    : (backendEnabled ? fetchTmdbJson : null);

  const seenSet = buildSeenCollisionSet(watched, watchlist);
  const placedSet = new Set();

  if (tmdbCaller) {
    try {
      const profile = await extractTasteProfile(watched, watchlist, { now }).catch(() => null);
      const lovedGenres = Array.isArray(profile?.lovedGenreIds) && profile.lovedGenreIds.length > 0
        ? profile.lovedGenreIds.slice(0, 3).join("|")
        : "";
      const recentFloor = getRecentReleaseDateFloor(18, now);
      const regionParam = userRegion && userRegion !== "GLOBAL" ? { watch_region: userRegion } : {};

      const laneConfigs = [
        {
          key: "taste",
          title: lovedGenres ? "Picked For Your Taste" : "Acclaimed Cinema Picks",
          subtitle: lovedGenres ? "Matched to genres and auteurs you rate highest" : "Critically celebrated films across eras",
          path: "/3/discover/movie",
          params: {
            ...(lovedGenres ? { with_genres: lovedGenres } : {}),
            "vote_average.gte": 7.6,
            "vote_count.gte": 1000,
            sort_by: "vote_average.desc",
            ...regionParam
          }
        },
        {
          key: "trending",
          title: "Trending This Week",
          subtitle: "What film lovers are talking about right now",
          path: "/3/trending/movie/week",
          params: { language: "en-US" }
        },
        {
          key: "recent",
          title: "New & Notable Releases",
          subtitle: "Standout releases from the past 18 months",
          path: "/3/discover/movie",
          params: {
            "primary_release_date.gte": recentFloor,
            "vote_count.gte": 80,
            sort_by: "popularity.desc",
            ...regionParam
          }
        },
        {
          key: "classics",
          title: "All-Time Essential Classics",
          subtitle: "Timeless masterworks before 2015",
          path: "/3/discover/movie",
          params: {
            "vote_average.gte": 8.0,
            "vote_count.gte": 3000,
            "primary_release_date.lte": "2014-12-31",
            sort_by: "vote_average.desc"
          }
        },
        {
          key: "gems",
          title: "Hidden Gems",
          subtitle: "High-craft discoveries away from the mainstream",
          path: "/3/discover/movie",
          params: {
            "vote_average.gte": 7.4,
            "vote_count.gte": 300,
            "vote_count.lte": 4500,
            sort_by: "vote_average.desc"
          }
        },
        {
          key: "thrillers",
          title: "Crime, Noir & Thrillers",
          subtitle: "Sharp tension, detectives, and moral ambiguity",
          path: "/3/discover/movie",
          params: {
            with_genres: "53|80|9648",
            "vote_count.gte": 600,
            sort_by: "vote_average.desc"
          }
        },
        {
          key: "scifi",
          title: "Sci-Fi & Speculative Worlds",
          subtitle: "Bold ideas, futures, and visionary filmmaking",
          path: "/3/discover/movie",
          params: {
            with_genres: "878|14",
            "vote_count.gte": 600,
            sort_by: "vote_average.desc"
          }
        },
        {
          key: "world",
          title: "World Cinema & Festival Picks",
          subtitle: "International voices and award-winning storytelling",
          path: "/3/discover/movie",
          params: {
            without_original_language: "en",
            "vote_average.gte": 7.4,
            "vote_count.gte": 400,
            sort_by: "vote_average.desc"
          }
        }
      ];

      const laneResults = await Promise.all(
        laneConfigs.map(async (lane) => {
          const raw = await fetchMultiPageTmdb(tmdbCaller, lane.path, lane.params, [1, 2]);
          return { lane, raw };
        })
      );

      const liveRows = [];
      for (const { lane, raw } of laneResults) {
        const cards = raw
          .map(toDashboardCardItem)
          .filter((item) => item.poster);
        const deduped = excludeSeenAndPlaced(cards, seenSet, placedSet).slice(0, 20);
        if (deduped.length > 0) {
          liveRows.push({
            key: lane.key,
            title: lane.title,
            subtitle: lane.subtitle,
            movies: deduped
          });
        }
      }

      if (liveRows.length > 0) {
        const mosaicPool = liveRows.flatMap((r) => r.movies);
        const heroSlides = buildHeroSlides(liveRows, watchlist, watched, mosaicPool, 5);
        const payload = { heroSlides, rows: liveRows, mosaicPool, isLive: true };
        if (resolveStorage) {
          try {
            resolveStorage.setItem(cacheKey, JSON.stringify({ ...payload, cachedAt: now }));
          } catch {
            // storage quota exhausted is non-fatal
          }
        }
        return payload;
      }
    } catch {
      // fall back cleanly to offline rows below
    }
  }

  const offlineRows = FALLBACK_ROWS.map((row) => ({
    ...row,
    movies: excludeSeenAndPlaced(
      row.movies.map((m) => toDashboardCardItem(m)),
      seenSet,
      placedSet
    )
  })).filter((row) => row.movies.length > 0);

  const mosaicPool = offlineRows.flatMap((r) => r.movies);
  const heroSlides = buildHeroSlides(offlineRows, watchlist, watched, mosaicPool, 5);
  return { heroSlides, rows: offlineRows, mosaicPool, isLive: false };
}

const PREFERRED_GENRE_ORDER = [
  "Drama",
  "Sci-Fi",
  "Thriller",
  "Crime",
  "Action",
  "Adventure",
  "Mystery",
  "Animation",
  "Comedy",
  "Romance",
  "Horror",
  "Biography",
  "History",
  "Fantasy"
];

function parseGenreList(genreString = "") {
  return String(genreString || "")
    .split(/[,•|/]/)
    .map((g) => g.trim())
    .filter(Boolean);
}

/**
 * Collects deduplicated catalog items across discovery rows and filters by genre chip.
 */
export function collectCatalogMosaic({
  rows = [],
  selectedGenre = "All",
  limit = 36
} = {}) {
  const seenKeys = new Set();
  const uniqueItems = [];
  const genreCounts = new Map();

  for (const row of rows || []) {
    for (const movie of row?.movies || []) {
      if (!movie) continue;
      const keys = buildMovieKeys(movie);
      if (keys.some((k) => seenKeys.has(k))) continue;
      keys.forEach((k) => seenKeys.add(k));
      uniqueItems.push(movie);

      for (const g of parseGenreList(movie.genre)) {
        genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
      }
    }
  }

  const availableGenres = [
    "All",
    ...[...genreCounts.keys()].sort((a, b) => {
      const idxA = PREFERRED_GENRE_ORDER.indexOf(a);
      const idxB = PREFERRED_GENRE_ORDER.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return (genreCounts.get(b) || 0) - (genreCounts.get(a) || 0);
    })
  ];

  const cleanTarget = String(selectedGenre || "All").trim().toLowerCase();
  const filtered = cleanTarget === "all" || !cleanTarget
    ? uniqueItems
    : uniqueItems.filter((item) =>
      parseGenreList(item.genre).some((g) => g.toLowerCase() === cleanTarget)
    );

  return {
    items: filtered.slice(0, limit),
    totalCount: filtered.length,
    availableGenres
  };
}
