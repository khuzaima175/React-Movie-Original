import { fetchTmdbJson } from "./apiTransport.js";
import { findMatchingMovie } from "./movieIdentity.js";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const SELF_APPEARANCE_RE = /\b(?:self|himself|herself|themselves|archive footage|uncredited cameo)\b/i;

export const PERSON_DEPARTMENT_TABS = [
  { id: "all", label: "All Credits" },
  { id: "acting", label: "Acting" },
  { id: "directing", label: "Directing" },
  { id: "writing", label: "Writing" },
  { id: "crew", label: "Crew" }
];

const personSessionCache = new Map();

export function clearPersonCache() {
  personSessionCache.clear();
}

function parsePositiveIntId(value) {
  const num = Number(value);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
}

function mapDepartmentToBucket(department) {
  const norm = String(department || "").trim().toLowerCase();
  if (norm === "acting") return "acting";
  if (norm === "directing") return "directing";
  if (norm === "writing") return "writing";
  return "crew";
}

function isUnavailableText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return lower === "n/a" || lower === "unknown" || lower === "none";
}

function extractCreditGroup({ structuredList, fallbackText, defaultJob, defaultDepartment, roleHint }) {
  if (Array.isArray(structuredList) && structuredList.length > 0) {
    const seen = new Set();
    const out = [];
    for (const entry of structuredList) {
      if (!entry) continue;
      const name = String(entry.name || "").trim();
      if (isUnavailableText(name)) continue;
      const id = parsePositiveIntId(entry.id);
      const dedupeKey = id !== null ? `id:${id}` : `name:${name.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        id,
        name,
        job: entry.job || defaultJob,
        department: entry.department || defaultDepartment,
        roleHint
      });
    }
    if (out.length > 0) return out;
  }

  if (typeof fallbackText !== "string" || isUnavailableText(fallbackText)) {
    return [];
  }

  const seenNames = new Set();
  const out = [];
  for (const part of fallbackText.split(",")) {
    const name = part.trim();
    if (isUnavailableText(name)) continue;
    const lower = name.toLowerCase();
    if (seenNames.has(lower)) continue;
    seenNames.add(lower);
    out.push({
      id: null,
      name,
      job: defaultJob,
      department: defaultDepartment,
      roleHint
    });
  }
  return out;
}

/**
 * Extracts structured, clickable cast and creative crew descriptors from a movie object,
 * preserving TMDB person IDs when available and tagging OMDb text fallbacks with id: null.
 */
export function extractMovieCreditPeople(movie) {
  if (!movie || typeof movie !== "object") {
    return {
      cast: [],
      directors: [],
      writers: [],
      cinematographers: [],
      composers: []
    };
  }

  const rawCast = Array.isArray(movie.castDetails) ? movie.castDetails : [];
  const castSeen = new Set();
  const cast = [];

  for (const actor of rawCast) {
    if (!actor) continue;
    const name = String(actor.name || "").trim();
    if (isUnavailableText(name)) continue;
    const id = parsePositiveIntId(actor.id);
    const dedupeKey = id !== null ? `id:${id}` : `name:${name.toLowerCase()}`;
    if (castSeen.has(dedupeKey)) continue;
    castSeen.add(dedupeKey);
    cast.push({
      id,
      name,
      character: String(actor.character || "").trim(),
      profile: actor.profile || null,
      department: "Acting",
      roleHint: "Acting"
    });
  }

  return {
    cast,
    directors: extractCreditGroup({
      structuredList: movie.directorDetails,
      fallbackText: movie.director,
      defaultJob: "Director",
      defaultDepartment: "Directing",
      roleHint: "Directing"
    }),
    writers: extractCreditGroup({
      structuredList: movie.writerDetails,
      fallbackText: movie.writers,
      defaultJob: "Writer",
      defaultDepartment: "Writing",
      roleHint: "Writing"
    }),
    cinematographers: extractCreditGroup({
      structuredList: movie.cinematographerDetails,
      fallbackText: movie.cinematographer,
      defaultJob: "Cinematographer",
      defaultDepartment: "Camera",
      roleHint: "Crew"
    }),
    composers: extractCreditGroup({
      structuredList: movie.composerDetails,
      fallbackText: movie.composer,
      defaultJob: "Composer",
      defaultDepartment: "Sound",
      roleHint: "Crew"
    })
  };
}

/**
 * Picks the clicked person's department tab only if at least one normalized credit matches it;
 * otherwise safely falls back to "all".
 */
export function resolvePersonDefaultDepartment(roleHint, credits = []) {
  const raw = String(roleHint || "").trim().toLowerCase();
  if (!raw || raw === "all") return "all";
  const bucket = mapDepartmentToBucket(raw);
  const hasMatch = Array.isArray(credits) && credits.some(
    (c) => Array.isArray(c?.departments) && c.departments.includes(bucket)
  );
  return hasMatch ? bucket : "all";
}

function appendUniqueString(list, seenSet, rawValue) {
  const cleaned = String(rawValue || "").trim();
  if (!cleaned) return;
  const lower = cleaned.toLowerCase();
  if (seenSet.has(lower)) return;
  seenSet.add(lower);
  list.push(cleaned);
}

/**
 * Deduplicates and normalizes TMDB `/person/:id/movie_credits` cast + crew rows by tmdbId.
 * Filters out "Self"/talk-show/making-of cameo entries unless no other credits exist or enabled.
 */
export function normalizePersonCredits(rawMovieCredits, options = {}) {
  if (!rawMovieCredits || typeof rawMovieCredits !== "object") return [];
  const { includeSelfAppearances = false } = options;

  const castList = Array.isArray(rawMovieCredits.cast) ? rawMovieCredits.cast : [];
  const crewList = Array.isArray(rawMovieCredits.crew) ? rawMovieCredits.crew : [];
  const byTmdbId = new Map();

  const ensureEntry = (raw) => {
    const tmdbId = parsePositiveIntId(raw?.id ?? raw?.tmdbId);
    const title = String(raw?.title || "").trim();
    if (!tmdbId || !title) return null;

    let entry = byTmdbId.get(tmdbId);
    if (!entry) {
      const releaseDate = String(raw.release_date || raw.releaseDate || "").trim();
      const yearMatch = releaseDate.match(/^(\d{4})/);
      const posterPath = raw.poster_path || raw.posterPath || null;
      entry = {
        id: tmdbId,
        tmdbId,
        imdbId: raw.imdb_id || raw.imdbId || null,
        title,
        originalTitle: String(raw.original_title || raw.originalTitle || "").trim() || null,
        year: yearMatch ? yearMatch[1] : "N/A",
        releaseDate,
        posterPath,
        poster: raw.poster || (posterPath ? `${TMDB_IMAGE_BASE}/w342${posterPath}` : null),
        popularity: Number(raw.popularity) || 0,
        voteAverage: Number(raw.vote_average ?? raw.voteAverage) || 0,
        voteCount: Number(raw.vote_count ?? raw.voteCount) || 0,
        genreIds: Array.isArray(raw.genre_ids) ? raw.genre_ids : (Array.isArray(raw.genreIds) ? raw.genreIds : []),
        overview: String(raw.overview || "").trim(),
        departments: [],
        characters: [],
        jobs: [],
        _deptSet: new Set(),
        _roleList: [],
        _roleSet: new Set(),
        _hasNonSelfRole: false
      };
      byTmdbId.set(tmdbId, entry);
    } else {
      if (!entry.poster && (raw.poster_path || raw.poster)) {
        const posterPath = raw.poster_path || null;
        entry.posterPath = posterPath || entry.posterPath;
        entry.poster = raw.poster || (posterPath ? `${TMDB_IMAGE_BASE}/w342${posterPath}` : null);
      }
      if (!entry.releaseDate && (raw.release_date || raw.releaseDate)) {
        const rd = String(raw.release_date || raw.releaseDate).trim();
        entry.releaseDate = rd;
        const ym = rd.match(/^(\d{4})/);
        if (ym) entry.year = ym[1];
      }
      entry.popularity = Math.max(entry.popularity, Number(raw.popularity) || 0);
      entry.voteCount = Math.max(entry.voteCount, Number(raw.vote_count ?? raw.voteCount) || 0);
      if (entry.voteAverage === 0 && (raw.vote_average || raw.voteAverage)) {
        entry.voteAverage = Number(raw.vote_average ?? raw.voteAverage) || 0;
      }
    }
    return entry;
  };

  for (const item of castList) {
    const entry = ensureEntry(item);
    if (!entry) continue;
    if (!entry._deptSet.has("acting")) {
      entry._deptSet.add("acting");
      entry.departments.push("acting");
    }
    const character = String(item.character || "").trim();
    if (character) {
      entry.characters.push(character);
      appendUniqueString(entry._roleList, entry._roleSet, character);
    } else {
      appendUniqueString(entry._roleList, entry._roleSet, "Actor");
    }
    if (!SELF_APPEARANCE_RE.test(character)) {
      entry._hasNonSelfRole = true;
    }
  }

  for (const item of crewList) {
    const entry = ensureEntry(item);
    if (!entry) continue;
    const job = String(item.job || "").trim();
    const bucket = mapDepartmentToBucket(item.department || "crew");
    if (!entry._deptSet.has(bucket)) {
      entry._deptSet.add(bucket);
      entry.departments.push(bucket);
    }
    if (job) {
      entry.jobs.push(job);
      appendUniqueString(entry._roleList, entry._roleSet, job);
    } else {
      appendUniqueString(entry._roleList, entry._roleSet, item.department || "Crew");
    }
    if (!SELF_APPEARANCE_RE.test(job)) {
      entry._hasNonSelfRole = true;
    }
  }

  const merged = Array.from(byTmdbId.values()).map((entry) => ({
    id: entry.id,
    tmdbId: entry.tmdbId,
    imdbId: entry.imdbId,
    title: entry.title,
    originalTitle: entry.originalTitle,
    year: entry.year,
    releaseDate: entry.releaseDate,
    posterPath: entry.posterPath,
    poster: entry.poster,
    popularity: entry.popularity,
    voteAverage: entry.voteAverage,
    voteCount: entry.voteCount,
    genreIds: entry.genreIds,
    overview: entry.overview,
    departments: entry.departments,
    primaryDepartment: entry.departments[0] || "crew",
    rolesLabel: entry._roleList.join(" · "),
    characters: entry.characters,
    jobs: entry.jobs,
    isSelfAppearance: !entry._hasNonSelfRole
  }));

  if (includeSelfAppearances) return merged;
  const nonSelf = merged.filter((c) => !c.isSelfAppearance);
  return nonSelf.length > 0 ? nonSelf : merged;
}

/**
 * Matches each filmography credit against the user's watched Vault and Watchlist
 * using strict identity rules (preventing same-year title collisions when tmdbId differs).
 */
export function annotateCreditsWithVaultState(credits = [], watched = [], watchlist = []) {
  if (!Array.isArray(credits)) return [];
  const safeWatched = Array.isArray(watched) ? watched : [];
  const safeWatchlist = Array.isArray(watchlist) ? watchlist : [];

  return credits.map((credit) => {
    const probe = {
      id: credit.tmdbId ?? credit.id,
      tmdbId: credit.tmdbId ?? credit.id,
      imdbID: credit.imdbId || null,
      title: credit.title,
      year: credit.year
    };

    const watchedMatch = findMatchingMovie(safeWatched, probe);
    const watchlistMatch = findMatchingMovie(safeWatchlist, probe);

    if (watchedMatch) {
      const numericRating = Number(watchedMatch.userRating);
      const userRating = Number.isFinite(numericRating) && numericRating > 0 ? numericRating : null;
      return {
        ...credit,
        vaultStatus: "watched",
        userRating,
        watchedEntry: watchedMatch,
        inWatchlist: Boolean(watchlistMatch)
      };
    }

    if (watchlistMatch) {
      return {
        ...credit,
        vaultStatus: "watchlist",
        userRating: null,
        watchedEntry: null,
        inWatchlist: true
      };
    }

    return {
      ...credit,
      vaultStatus: "unseen",
      userRating: null,
      watchedEntry: null,
      inWatchlist: false
    };
  });
}

/**
 * Aggregates personal Vault affinity statistics across an annotated filmography list.
 */
export function computePersonVaultStats(annotatedCredits = []) {
  if (!Array.isArray(annotatedCredits) || annotatedCredits.length === 0) {
    return {
      totalCredits: 0,
      watchedCount: 0,
      watchlistCount: 0,
      averageVaultRating: null,
      highestRatedFilm: null
    };
  }

  let watchedCount = 0;
  let watchlistCount = 0;
  let ratingSum = 0;
  let ratedCount = 0;
  let highestRatedFilm = null;

  for (const credit of annotatedCredits) {
    if (!credit) continue;
    if (credit.vaultStatus === "watched") {
      watchedCount += 1;
      const rating = Number(credit.userRating);
      if (Number.isFinite(rating) && rating > 0) {
        ratingSum += rating;
        ratedCount += 1;
        if (!highestRatedFilm || rating > Number(highestRatedFilm.userRating)) {
          highestRatedFilm = credit;
        }
      }
    } else if (credit.vaultStatus === "watchlist") {
      watchlistCount += 1;
    }
  }

  return {
    totalCredits: annotatedCredits.length,
    watchedCount,
    watchlistCount,
    averageVaultRating: ratedCount > 0 ? Math.round((ratingSum / ratedCount) * 10) / 10 : null,
    highestRatedFilm
  };
}

function getComparableReleaseKey(credit) {
  if (credit?.releaseDate) return String(credit.releaseDate);
  if (/^\d{4}$/.test(String(credit?.year || ""))) return `${credit.year}-00-00`;
  return "0000-00-00";
}

/**
 * Filters annotated credits by department, Vault status, search query, and applies stable sorting.
 */
export function filterAndSortPersonCredits(annotatedCredits = [], options = {}) {
  if (!Array.isArray(annotatedCredits)) return [];
  const {
    department = "all",
    vaultFilter = "all",
    sortBy = "popular",
    searchQuery = ""
  } = options;

  const query = String(searchQuery || "").trim().toLowerCase();

  const filtered = annotatedCredits.filter((credit) => {
    if (!credit) return false;
    if (department && department !== "all") {
      if (!Array.isArray(credit.departments) || !credit.departments.includes(department)) {
        return false;
      }
    }

    if (vaultFilter === "watched" && credit.vaultStatus !== "watched") return false;
    if (vaultFilter === "watchlist" && credit.vaultStatus !== "watchlist") return false;
    if (vaultFilter === "unwatched" && credit.vaultStatus === "watched") return false;

    if (query) {
      const hay = `${credit.title || ""} ${credit.originalTitle || ""} ${credit.rolesLabel || ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }

    return true;
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    if (sortBy === "top_rated") {
      const aSolid = (Number(a.voteCount) || 0) >= 50 ? 1 : 0;
      const bSolid = (Number(b.voteCount) || 0) >= 50 ? 1 : 0;
      if (bSolid !== aSolid) return bSolid - aSolid;
      const avgDiff = (Number(b.voteAverage) || 0) - (Number(a.voteAverage) || 0);
      if (avgDiff !== 0) return avgDiff;
      const cntDiff = (Number(b.voteCount) || 0) - (Number(a.voteCount) || 0);
      if (cntDiff !== 0) return cntDiff;
      return (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
    }

    if (sortBy === "newest") {
      const aDate = getComparableReleaseKey(a);
      const bDate = getComparableReleaseKey(b);
      if (bDate !== aDate) return bDate.localeCompare(aDate);
      return (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
    }

    // Default: "popular"
    const popDiff = (Number(b.popularity) || 0) - (Number(a.popularity) || 0);
    if (popDiff !== 0) return popDiff;
    const cntDiff = (Number(b.voteCount) || 0) - (Number(a.voteCount) || 0);
    if (cntDiff !== 0) return cntDiff;
    return (Number(b.voteAverage) || 0) - (Number(a.voteAverage) || 0);
  });

  return sorted;
}

/**
 * Builds the canonical full-profile route path preserving non-"all" department selection.
 */
export function buildPersonProfileRoute(personId, department = "all") {
  const id = parsePositiveIntId(personId);
  if (!id) return null;
  const dept = String(department || "").trim().toLowerCase();
  if (!dept || dept === "all") {
    return `/person/${id}`;
  }
  return `/person/${id}?dept=${encodeURIComponent(dept)}`;
}

/**
 * Prevents the underlying MovieDetails Escape handler from navigating away while a Person overlay
 * or nested Quick Rate dialog is open.
 */
export function shouldCloseMovieDetailOnEscape({ activePerson = null, hasOpenDialog = false } = {}) {
  return !activePerson && !hasOpenDialog;
}

function selectBestSearchCandidate(results = [], targetNameLower, roleHint) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const desiredBucket = roleHint ? mapDepartmentToBucket(roleHint) : null;
  let best = null;
  let bestScore = -1;

  for (const item of results) {
    const id = parsePositiveIntId(item?.id);
    if (!id) continue;
    const candName = String(item.name || "").trim().toLowerCase();
    let score = 0;
    if (candName === targetNameLower) score += 1000;
    else if (candName.startsWith(targetNameLower)) score += 200;
    if (desiredBucket && mapDepartmentToBucket(item.known_for_department) === desiredBucket) {
      score += 100;
    }
    score += Math.min(50, Number(item.popularity) || 0);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best;
}

/**
 * Fetches a person's TMDB profile, external IDs, and merged movie credits.
 * Resolves OMDb name-only targets via `/3/search/person` and caches complete results in session memory.
 */
export async function fetchPersonProfileAndCredits(target, options = {}) {
  if (!target) return null;
  const targetObj = (typeof target === "number" || typeof target === "string")
    ? { id: target }
    : target;

  const {
    forceProxy,
    fetchFn,
    signal,
    onHttpError,
    apiKey,
    forceRefresh = false,
    includeSelfAppearances = false
  } = options;

  if (signal?.aborted) return null;

  let personId = parsePositiveIntId(targetObj.id);
  const targetName = String(targetObj.name || "").trim();
  const targetNameLower = targetName ? targetName.toLowerCase() : "";

  if (!forceRefresh) {
    if (personId && personSessionCache.has(`id:${personId}`)) {
      return personSessionCache.get(`id:${personId}`);
    }
    if (!personId && targetNameLower && personSessionCache.has(`name:${targetNameLower}`)) {
      return personSessionCache.get(`name:${targetNameLower}`);
    }
  }

  const transportOpts = {
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(forceProxy !== undefined ? { forceProxy } : {}),
    ...(fetchFn !== undefined ? { fetchFn } : {}),
    ...(signal !== undefined ? { signal } : {}),
    ...(onHttpError !== undefined ? { onHttpError } : {})
  };

  try {
    if (!personId) {
      if (!targetName) return null;
      const searchRes = await fetchTmdbJson(
        "/3/search/person",
        {
          query: targetName,
          include_adult: "false",
          language: "en-US",
          page: "1"
        },
        transportOpts
      );
      if (signal?.aborted || !searchRes) return null;
      const match = selectBestSearchCandidate(searchRes.results, targetNameLower, targetObj.roleHint);
      personId = parsePositiveIntId(match?.id);
      if (!personId) return null;
    }

    const rawPerson = await fetchTmdbJson(
      `/3/person/${personId}`,
      {
        append_to_response: "movie_credits,external_ids",
        language: "en-US"
      },
      transportOpts
    );

    if (signal?.aborted || !rawPerson || !parsePositiveIntId(rawPerson.id)) {
      return null;
    }

    const imdbId = rawPerson.external_ids?.imdb_id || rawPerson.imdb_id || null;
    const person = {
      id: parsePositiveIntId(rawPerson.id),
      name: rawPerson.name || targetName || "Unknown",
      biography: rawPerson.biography || "",
      knownForDepartment: rawPerson.known_for_department || "",
      birthday: rawPerson.birthday || null,
      deathday: rawPerson.deathday || null,
      placeOfBirth: rawPerson.place_of_birth || null,
      profilePath: rawPerson.profile_path || null,
      profileUrl: rawPerson.profile_path ? `${TMDB_IMAGE_BASE}/w185${rawPerson.profile_path}` : null,
      heroProfileUrl: rawPerson.profile_path ? `${TMDB_IMAGE_BASE}/h632${rawPerson.profile_path}` : null,
      imdbId,
      imdbUrl: imdbId ? `https://www.imdb.com/name/${imdbId}/` : null
    };

    const credits = normalizePersonCredits(rawPerson.movie_credits || {}, { includeSelfAppearances });
    const payload = {
      person,
      credits,
      fetchedAt: Date.now()
    };

    personSessionCache.set(`id:${person.id}`, payload);
    if (person.name) {
      personSessionCache.set(`name:${person.name.trim().toLowerCase()}`, payload);
    }
    if (targetNameLower) {
      personSessionCache.set(`name:${targetNameLower}`, payload);
    }

    return payload;
  } catch (err) {
    if (err?.name === "AbortError" || signal?.aborted) {
      return null;
    }
    throw err;
  }
}
