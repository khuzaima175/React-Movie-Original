/**
 * Pure domain & routing helpers for Movie-Aware AI Chat ("Discuss This Film").
 * Handles /ai?tab=chat URL encoding/decoding, sanitized dossier prompts,
 * spoiler-safety directives, tailored prompts, and sessionStorage focus cache.
 */
import { extractTmdbNumericId } from "./movieIdentity.js";
import { getCanonicalMovieKey } from "./vaultSyncService.js";

export const FILM_CHAT_CACHE_PREFIX = "cinemavault_film_chat_focus_v1:";

export function sanitizeLine(raw, maxLen = 200) {
  if (raw === null || raw === undefined) return "";
  const cleaned = String(raw)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

export { sanitizeLine as sanitizePromptLine };

function getStorage(explicitStorage) {
  if (explicitStorage !== undefined) return explicitStorage;
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Builds the canonical deep link into Film Companion focused on a specific film.
 */
export function buildFilmChatRoute(movieOrId) {
  if (!movieOrId) return "/ai?tab=chat";
  const isObj = typeof movieOrId === "object";
  const movie = isObj ? movieOrId : { imdbID: String(movieOrId) };
  const canonicalKey = getCanonicalMovieKey(movie) || sanitizeLine(String(movie.imdbID || movie.id || ""), 40);
  const tmdbId = extractTmdbNumericId(movie.tmdbId ?? movie.imdbID ?? movie.id);
  const title = sanitizeLine(movie.title || movie.Title || "", 120);

  const params = new URLSearchParams();
  params.set("tab", "chat");
  if (canonicalKey) params.set("movie", canonicalKey);
  if (tmdbId) params.set("tmdbId", String(tmdbId));
  if (title) params.set("title", title);
  return `/ai?${params.toString()}`;
}

/**
 * Parses URLSearchParams or search query string into normalized AIPage focus params.
 */
export function parseAiPageParams(searchString = "") {
  const params =
    searchString instanceof URLSearchParams
      ? searchString
      : new URLSearchParams(String(searchString || "").replace(/^\?/, ""));

  const rawTab = String(params.get("tab") || "").trim().toLowerCase();
  const rawMovie = sanitizeLine(params.get("movie") || "", 80);
  const rawTmdb = params.get("tmdbId");
  const parsedTmdb = extractTmdbNumericId(rawTmdb) ?? extractTmdbNumericId(rawMovie);
  const imdbMatch = /^tt\d+$/i.test(rawMovie) ? rawMovie : null;
  const tab = rawTab === "recs"
    ? "recs"
    : (rawTab === "chat" || Boolean(rawMovie || parsedTmdb) ? "chat" : "recs");

  return {
    tab,
    movieKey: rawMovie || (parsedTmdb ? `tmdb_${parsedTmdb}` : null),
    tmdbId: parsedTmdb || null,
    imdbID: imdbMatch,
    title: sanitizeLine(params.get("title") || "", 120)
  };
}

/**
 * Serializes a rich film dossier + Vault status into a concise, injection-safe system block.
 */
export function serializeFilmDossierForPrompt(
  movie = null,
  vaultEntry = null,
  watchlistEntry = null,
  options = {}
) {
  if (!movie || typeof movie !== "object") return "";
  const isWatched = Boolean(
    vaultEntry ||
    movie.isWatched ||
    (Number(movie.userRating) >= 1 && Number(movie.userRating) <= 10)
  );
  const spoilerSafe =
    typeof options.spoilerSafe === "boolean" ? options.spoilerSafe : !isWatched;

  const title = sanitizeLine(movie.title || movie.Title || "Untitled", 120);
  const year = sanitizeLine(movie.year || movie.Year || "", 10);
  const director = sanitizeLine(movie.director || movie.Director || "", 120);
  const writers = sanitizeLine(movie.writers || "", 120);
  const genres = sanitizeLine(
    Array.isArray(movie.genres) ? movie.genres.join(", ") : movie.genre || movie.Genre || "",
    120
  );
  const runtime = sanitizeLine(movie.runtime ? String(movie.runtime) : "", 30);
  const castArr = Array.isArray(movie.cast)
    ? movie.cast.slice(0, 5).map((c) => sanitizeLine(c, 50)).filter(Boolean)
    : [];
  const keywordsArr = Array.isArray(movie.keywords)
    ? movie.keywords.slice(0, 8).map((k) => `#${sanitizeLine(k, 40)}`).filter((k) => k.length > 1)
    : [];
  const plot = sanitizeLine(movie.plot || movie.Plot || movie.overview || "", 500);

  const activeRating = Number(vaultEntry?.userRating ?? movie.userRating);
  const activeNote = sanitizeLine(vaultEntry?.userNote ?? movie.userNote ?? "", 280);
  let vaultStatusLine = "Not logged in Vault yet";
  if (isWatched && Number.isFinite(activeRating) && activeRating > 0) {
    vaultStatusLine = `Watched & rated ${Math.round(activeRating)}/10 by user${activeNote ? ` (User note: "${activeNote}")` : ""}`;
  } else if (isWatched) {
    vaultStatusLine = `Marked watched${activeNote ? ` (User note: "${activeNote}")` : ""}`;
  } else if (watchlistEntry || movie.isWatchlist) {
    vaultStatusLine = "Queued in user's Watchlist";
  }

  const lines = [
    `Title: ${title}${year ? ` (${year})` : ""}`,
    genres ? `Genres: ${genres}` : null,
    director ? `Director: ${director}` : null,
    writers ? `Writers: ${writers}` : null,
    castArr.length > 0 ? `Key Cast: ${castArr.join(", ")}` : null,
    runtime ? `Runtime: ${runtime}` : null,
    keywordsArr.length > 0 ? `Motifs & Themes: ${keywordsArr.join(" ")}` : null,
    plot ? `Synopsis: ${plot}` : null,
    `User Vault Status: ${vaultStatusLine}`,
    spoilerSafe
      ? "Spoiler Policy: SPOILER-SAFE MODE ACTIVE — strictly never reveal major plot twists, endings, or late-act surprises under any phrasing; if the user asks for spoilers, instruct them to click 'Spoilers: Allowed' in the film focus bar first."
      : "Spoiler Policy: Deep analysis enabled — you may discuss plot twists, symbolism, and the ending directly."
  ].filter(Boolean);

  return lines.join("\n    ");
}

/**
 * Generates 4 contextual starter prompts tailored to whether the user has already seen the film.
 */
export function buildMovieChatStarterPrompts(
  movie = null,
  { isWatched = false, spoilerSafe = true } = {}
) {
  if (!movie || typeof movie !== "object") return [];
  const title = sanitizeLine(movie.title || movie.Title || "this film", 60);
  const director = sanitizeLine(movie.director || movie.Director || "", 40);

  if (!spoilerSafe) {
    return [
      `Analyze the ending & hidden symbolism of ${title}`,
      `Best behind-the-scenes trivia for ${title}`,
      director && director !== "N/A" && director !== "Unknown"
        ? `How does ${director}'s craft show up in ${title}?`
        : `Break down the direction and visual style of ${title}`,
      `3 next watches based on what worked in ${title}`
    ];
  }

  return [
    `Should I watch ${title} based on my Vault?`,
    director && director !== "N/A" && director !== "Unknown"
      ? `Break down ${director}'s style in ${title} (no spoilers)`
      : `Set the mood & filmmaking style of ${title} (no spoilers)`,
    `Compare ${title}'s themes to my top-rated films`,
    `Give me 3 movies with a similar vibe to ${title}`
  ];
}

/**
 * Caches normalized movie focus payload in sessionStorage under both IMDb and TMDB keys.
 */
export function saveFilmFocusCache(movie, explicitStorage) {
  const storage = getStorage(explicitStorage);
  if (!storage || !movie || typeof movie !== "object") return;

  const snapshot = {
    imdbID: movie.imdbID || null,
    tmdbId: extractTmdbNumericId(movie.tmdbId ?? movie.imdbID ?? movie.id) || null,
    title: sanitizeLine(movie.title || movie.Title || "Movie", 120),
    year: sanitizeLine(movie.year || movie.Year || "", 12),
    poster: movie.poster || movie.Poster || null,
    director: sanitizeLine(movie.director || movie.Director || "", 120),
    writers: sanitizeLine(movie.writers || "", 120),
    genre: sanitizeLine(Array.isArray(movie.genres) ? movie.genres.join(", ") : movie.genre || "", 120),
    runtime: movie.runtime || null,
    imdbRating: movie.imdbRating ?? null,
    plot: sanitizeLine(movie.plot || movie.overview || "", 500),
    cast: Array.isArray(movie.cast) ? movie.cast.slice(0, 6) : [],
    keywords: Array.isArray(movie.keywords) ? movie.keywords.slice(0, 10) : [],
    savedAt: Date.now()
  };

  const keys = new Set();
  const canonical = getCanonicalMovieKey(snapshot);
  if (canonical) keys.add(canonical);
  if (snapshot.imdbID) keys.add(snapshot.imdbID);
  if (snapshot.tmdbId) keys.add(`tmdb_${snapshot.tmdbId}`);

  const serialized = JSON.stringify(snapshot);
  for (const key of keys) {
    try {
      storage.setItem(`${FILM_CHAT_CACHE_PREFIX}${key}`, serialized);
    } catch {
      // ignore quota/private-mode errors
    }
  }
}

/**
 * Loads cached movie focus payload from sessionStorage gracefully on reload.
 */
export function loadFilmFocusCache(movieKey, explicitStorage) {
  const storage = getStorage(explicitStorage);
  const cleanKey = sanitizeLine(movieKey || "", 80);
  if (!storage || !cleanKey) return null;

  const candidates = [cleanKey];
  const numeric = extractTmdbNumericId(cleanKey);
  if (numeric && !cleanKey.startsWith("tmdb_")) {
    candidates.push(`tmdb_${numeric}`);
  }

  for (const key of candidates) {
    try {
      const raw = storage.getItem(`${FILM_CHAT_CACHE_PREFIX}${key}`);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.title) {
        return parsed;
      }
    } catch {
      // ignore corrupted cache entries
    }
  }
  return null;
}
