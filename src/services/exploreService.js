import {
  TMDB_ID_TO_GENRE,
  POPULAR_WATCH_PROVIDERS,
  buildProviderFilter
} from "./tmdbService.js";
import { findMatchingMovie } from "./movieIdentity.js";

export const DEFAULT_EXPLORE_FILTERS = Object.freeze({
  genres: [],
  genreMode: "and",
  withoutGenres: [],
  yearFrom: "",
  yearTo: "",
  runtimeMin: "",
  runtimeMax: "",
  minImdb: 6.5,
  minVotes: 150,
  language: "",
  country: "",
  keywords: [],
  person: null,
  providers: [],
  region: "US",
  sortBy: "popularity.desc",
  hideWatched: false,
  page: 1
});

export const EXPLORE_GENRE_OPTIONS = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" },
  { id: 36, name: "History" },
  { id: 27, name: "Horror" },
  { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Sci-Fi" },
  { id: 53, name: "Thriller" },
  { id: 10752, name: "War" },
  { id: 37, name: "Western" }
];

const GENRE_NAME_BY_ID = new Map(EXPLORE_GENRE_OPTIONS.map((g) => [g.id, g.name]));
const PROVIDER_NAME_BY_ID = new Map(POPULAR_WATCH_PROVIDERS.map((p) => [p.id, p.name]));

export const DECADE_PRESETS = [
  { id: "2020s", label: "2020s", yearFrom: "2020", yearTo: "2029" },
  { id: "2010s", label: "2010s", yearFrom: "2010", yearTo: "2019" },
  { id: "2000s", label: "2000s", yearFrom: "2000", yearTo: "2009" },
  { id: "1990s", label: "1990s", yearFrom: "1990", yearTo: "1999" },
  { id: "1980s", label: "1980s", yearFrom: "1980", yearTo: "1989" },
  { id: "classic", label: "Classic (<1980)", yearFrom: "", yearTo: "1979" }
];

export const RUNTIME_PRESETS = [
  { id: "quick", label: "Quick (<95m)", runtimeMin: "", runtimeMax: 95 },
  { id: "feature", label: "Feature (95-135m)", runtimeMin: 95, runtimeMax: 135 },
  { id: "epic", label: "Epic (150m+)", runtimeMin: 150, runtimeMax: "" }
];

export const EXPLORE_SORT_OPTIONS = [
  { id: "popularity.desc", label: "Most Popular" },
  { id: "vote_average.desc", label: "Highest Rated" },
  { id: "primary_release_date.desc", label: "Newest Releases" },
  { id: "revenue.desc", label: "Highest Box Office" },
  { id: "vote_count.desc", label: "Most Reviewed" }
];

const VALID_SORT_SET = new Set(EXPLORE_SORT_OPTIONS.map((o) => o.id));
const SORT_LABEL_BY_ID = new Map(EXPLORE_SORT_OPTIONS.map((o) => [o.id, o.label]));

export const LANGUAGE_OPTIONS = [
  { code: "", label: "Any Language" },
  { code: "en", label: "English" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "hi", label: "Hindi" }
];

const LANGUAGE_LABEL_BY_CODE = new Map(LANGUAGE_OPTIONS.map((l) => [l.code, l.label]));

export const COUNTRY_OPTIONS = [
  { code: "", label: "Any Country" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "JP", label: "Japan" },
  { code: "KR", label: "South Korea" },
  { code: "FR", label: "France" },
  { code: "DE", label: "Germany" },
  { code: "IN", label: "India" },
  { code: "CA", label: "Canada" },
  { code: "ES", label: "Spain" },
  { code: "IT", label: "Italy" }
];

function safeDecode(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function getGenreLabel(id) {
  const num = Number(id);
  if (GENRE_NAME_BY_ID.has(num)) return GENRE_NAME_BY_ID.get(num);
  const raw = TMDB_ID_TO_GENRE[num];
  return raw ? raw.replace(/\b\w/g, (ch) => ch.toUpperCase()) : `Genre #${num}`;
}

function parseIntIdList(rawValue) {
  if (Array.isArray(rawValue)) {
    const out = [];
    const seen = new Set();
    for (const item of rawValue) {
      const id = Number(item);
      if (Number.isSafeInteger(id) && id > 0 && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }
  const str = String(rawValue || "").trim();
  if (!str) return [];
  const out = [];
  const seen = new Set();
  for (const part of str.split(/[,|]/)) {
    const id = Number(part.trim());
    if (Number.isSafeInteger(id) && id > 0 && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function parseYearString(rawValue) {
  const s = String(rawValue ?? "").trim();
  return /^\d{4}$/.test(s) ? s : "";
}

function parseOptionalPositiveInt(rawValue) {
  if (rawValue === "" || rawValue === null || rawValue === undefined) return "";
  const num = Number(rawValue);
  if (!Number.isFinite(num) || num <= 0) return "";
  return Math.floor(num);
}

function parseKeywordList(rawValue) {
  if (Array.isArray(rawValue)) {
    const out = [];
    const seen = new Set();
    for (const item of rawValue) {
      const id = Number(item?.id ?? item);
      const name = String(item?.name || "").trim();
      if (Number.isSafeInteger(id) && id > 0 && name && !seen.has(id)) {
        seen.add(id);
        out.push({ id, name });
      }
    }
    return out;
  }
  const str = String(rawValue || "").trim();
  if (!str) return [];
  const out = [];
  const seen = new Set();
  for (const token of str.split(",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx <= 0) continue;
    const id = Number(trimmed.slice(0, colonIdx));
    const name = safeDecode(trimmed.slice(colonIdx + 1)).trim();
    if (Number.isSafeInteger(id) && id > 0 && name && !seen.has(id)) {
      seen.add(id);
      out.push({ id, name });
    }
  }
  return out;
}

function escapeTokenValue(raw, escapeComma = false) {
  const withPct = String(raw || "").replace(/%/g, "%25");
  return escapeComma ? withPct.replace(/,/g, "%2C") : withPct;
}

function encodeKeywordList(keywords = []) {
  return parseKeywordList(keywords)
    .map((k) => `${k.id}:${escapeTokenValue(k.name, true)}`)
    .join(",");
}

function parsePersonParam(rawValue) {
  if (!rawValue) return null;
  if (typeof rawValue === "object") {
    const id = Number(rawValue.id);
    const name = String(rawValue.name || "").trim();
    return Number.isSafeInteger(id) && id > 0 && name ? { id, name } : null;
  }
  const str = String(rawValue).trim();
  const colonIdx = str.indexOf(":");
  if (colonIdx <= 0) return null;
  const id = Number(str.slice(0, colonIdx));
  const name = safeDecode(str.slice(colonIdx + 1)).trim();
  return Number.isSafeInteger(id) && id > 0 && name ? { id, name } : null;
}

function normalizeRegion(region, fallback = "US") {
  const clean = String(region || "").trim().toUpperCase();
  return clean || fallback;
}

function toSearchParams(searchOrString) {
  if (searchOrString instanceof URLSearchParams) return searchOrString;
  const raw = String(searchOrString || "").trim();
  const idx = raw.indexOf("?");
  const qs = idx >= 0 ? raw.slice(idx + 1) : raw;
  return new URLSearchParams(qs);
}

/**
 * Parse URL query string or URLSearchParams into canonical Explore filter state.
 */
export function parseExploreSearchParams(searchOrString = "", defaultRegion = "US") {
  const sp = toSearchParams(searchOrString);
  const fallbackRegion = normalizeRegion(defaultRegion, "US");

  const minImdbRaw = sp.get("minImdb");
  const minImdbParsed = minImdbRaw !== null && minImdbRaw !== "" && Number.isFinite(Number(minImdbRaw))
    ? Math.max(0, Math.min(9.5, Number(minImdbRaw)))
    : DEFAULT_EXPLORE_FILTERS.minImdb;

  const minVotesRaw = sp.get("minVotes");
  const minVotesParsed = minVotesRaw !== null && minVotesRaw !== "" && Number.isFinite(Number(minVotesRaw))
    ? Math.max(0, Math.floor(Number(minVotesRaw)))
    : DEFAULT_EXPLORE_FILTERS.minVotes;

  const sortRaw = String(sp.get("sortBy") || "").trim();
  const pageRaw = Number(sp.get("page"));

  return {
    genres: parseIntIdList(sp.get("genres")),
    genreMode: sp.get("genreMode") === "or" ? "or" : "and",
    withoutGenres: parseIntIdList(sp.get("withoutGenres")),
    yearFrom: parseYearString(sp.get("yearFrom")),
    yearTo: parseYearString(sp.get("yearTo")),
    runtimeMin: parseOptionalPositiveInt(sp.get("runtimeMin")),
    runtimeMax: parseOptionalPositiveInt(sp.get("runtimeMax")),
    minImdb: minImdbParsed,
    minVotes: minVotesParsed,
    language: String(sp.get("language") || "").trim().toLowerCase(),
    country: String(sp.get("country") || "").trim().toUpperCase(),
    keywords: parseKeywordList(sp.get("keywords") || sp.get("kw")),
    person: parsePersonParam(sp.get("person")),
    providers: parseIntIdList(sp.get("providers")),
    region: sp.has("region") ? normalizeRegion(sp.get("region"), fallbackRegion) : fallbackRegion,
    sortBy: VALID_SORT_SET.has(sortRaw) ? sortRaw : DEFAULT_EXPLORE_FILTERS.sortBy,
    hideWatched: sp.get("hideWatched") === "1" || sp.get("hideWatched") === "true",
    page: Number.isSafeInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1
  };
}

/**
 * Serialize Explore filters into URLSearchParams for shareable deep links.
 */
export function buildExploreSearchParams(filters = {}, { defaultRegion = DEFAULT_EXPLORE_FILTERS.region } = {}) {
  const sp = new URLSearchParams();
  const effectiveDefaultRegion = normalizeRegion(defaultRegion, DEFAULT_EXPLORE_FILTERS.region);

  const genres = parseIntIdList(filters.genres);
  if (genres.length > 0) sp.set("genres", genres.join(","));

  if (filters.genreMode === "or") sp.set("genreMode", "or");

  const withoutGenres = parseIntIdList(filters.withoutGenres);
  if (withoutGenres.length > 0) sp.set("withoutGenres", withoutGenres.join(","));

  const yearFrom = parseYearString(filters.yearFrom);
  if (yearFrom) sp.set("yearFrom", yearFrom);

  const yearTo = parseYearString(filters.yearTo);
  if (yearTo) sp.set("yearTo", yearTo);

  const runtimeMin = parseOptionalPositiveInt(filters.runtimeMin);
  if (runtimeMin !== "") sp.set("runtimeMin", String(runtimeMin));

  const runtimeMax = parseOptionalPositiveInt(filters.runtimeMax);
  if (runtimeMax !== "") sp.set("runtimeMax", String(runtimeMax));

  if (filters.minImdb !== undefined && filters.minImdb !== null && filters.minImdb !== "") {
    const minImdb = Number(filters.minImdb);
    if (Number.isFinite(minImdb) && minImdb !== DEFAULT_EXPLORE_FILTERS.minImdb) {
      sp.set("minImdb", String(Math.max(0, Math.min(9.5, minImdb))));
    }
  }

  if (filters.minVotes !== undefined && filters.minVotes !== null && filters.minVotes !== "") {
    const minVotes = Math.floor(Number(filters.minVotes));
    if (Number.isFinite(minVotes) && minVotes >= 0 && minVotes !== DEFAULT_EXPLORE_FILTERS.minVotes) {
      sp.set("minVotes", String(minVotes));
    }
  }

  const language = String(filters.language || "").trim().toLowerCase();
  if (language) sp.set("language", language);

  const country = String(filters.country || "").trim().toUpperCase();
  if (country) sp.set("country", country);

  const keywordsEncoded = encodeKeywordList(filters.keywords);
  if (keywordsEncoded) sp.set("keywords", keywordsEncoded);

  const person = parsePersonParam(filters.person);
  if (person) sp.set("person", `${person.id}:${escapeTokenValue(person.name)}`);

  const providers = parseIntIdList(filters.providers);
  if (providers.length > 0) sp.set("providers", providers.join(","));

  const region = String(filters.region || "").trim().toUpperCase();
  if (region && region !== effectiveDefaultRegion) sp.set("region", region);

  if (filters.sortBy && VALID_SORT_SET.has(filters.sortBy) && filters.sortBy !== DEFAULT_EXPLORE_FILTERS.sortBy) {
    sp.set("sortBy", filters.sortBy);
  }

  if (filters.hideWatched) sp.set("hideWatched", "1");

  const page = Number(filters.page);
  if (Number.isSafeInteger(page) && page > 1) sp.set("page", String(page));

  return sp;
}

/**
 * Build a full "/explore?..." route from partial Explore filter overrides.
 */
export function buildExploreRoute(partialFilters = {}, options = {}) {
  const merged = {
    ...DEFAULT_EXPLORE_FILTERS,
    ...(partialFilters && typeof partialFilters === "object" ? partialFilters : {})
  };
  const qs = buildExploreSearchParams(merged, options).toString();
  return qs ? `/explore?${qs}` : "/explore";
}

/**
 * Validate and merge debounced year drafts onto the latest filter snapshot cleanly.
 */
export function mergeYearDraftIntoFilters(filters = {}, yearFromDraft = "", yearToDraft = "") {
  const trimmedFrom = String(yearFromDraft ?? "").trim();
  const trimmedTo = String(yearToDraft ?? "").trim();
  return {
    ...filters,
    yearFrom: /^\d{4}$/.test(trimmedFrom) ? trimmedFrom : "",
    yearTo: /^\d{4}$/.test(trimmedTo) ? trimmedTo : "",
    page: 1
  };
}

/**
 * Derive glitch-free grid, empty-state, and loading visibility from current query signature.
 */
export function deriveExploreViewState({
  rawPagesState,
  filterSignature,
  filteredResults = [],
  isLoading = false,
  isLoadingMore = false,
  errorMsg = "",
  hideWatched = false,
  page = 1
} = {}) {
  const hasFreshData = Boolean(
    rawPagesState &&
    rawPagesState.signature !== null &&
    rawPagesState.signature !== undefined &&
    rawPagesState.signature === filterSignature
  );
  const visibleItems = hasFreshData && Array.isArray(filteredResults) ? filteredResults : [];
  const displayTotalResults = hasFreshData ? (Number(rawPagesState?.totalResults) || 0) : 0;
  const displayTotalPages = hasFreshData ? Math.max(1, Number(rawPagesState?.totalPages) || 1) : 1;
  const hiddenWatchedCount = hasFreshData
    ? Math.max(0, (rawPagesState?.items?.length || 0) - visibleItems.length)
    : 0;
  const isFetching = Boolean(isLoading || isLoadingMore);
  const currentPage = Number.isSafeInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const shouldAutoAdvance = Boolean(
    !errorMsg &&
    !isFetching &&
    hideWatched &&
    hasFreshData &&
    (rawPagesState?.items?.length || 0) > 0 &&
    visibleItems.length === 0 &&
    currentPage < displayTotalPages &&
    currentPage < 3
  );

  return {
    hasFreshData,
    visibleItems,
    displayTotalResults,
    displayTotalPages,
    hiddenWatchedCount,
    shouldAutoAdvance,
    showSkeleton: !errorMsg && (isFetching || shouldAutoAdvance) && visibleItems.length === 0,
    showEmptyState: !errorMsg && !isFetching && !shouldAutoAdvance && hasFreshData && visibleItems.length === 0,
    showGrid: visibleItems.length > 0
  };
}

/**
 * Compile Explore filter state into query params for TMDB /3/discover/movie.
 */
export function buildTmdbDiscoverParams(filters = {}, options = {}) {
  const sortBy = VALID_SORT_SET.has(filters.sortBy)
    ? filters.sortBy
    : DEFAULT_EXPLORE_FILTERS.sortBy;

  const page = Number.isSafeInteger(Number(filters.page)) && Number(filters.page) > 0
    ? Number(filters.page)
    : 1;

  const params = {
    language: "en-US",
    include_adult: false,
    include_video: false,
    sort_by: sortBy,
    page
  };

  const genres = parseIntIdList(filters.genres);
  if (genres.length > 0) {
    params.with_genres = genres.join(filters.genreMode === "or" ? "|" : ",");
  }

  const withoutGenres = parseIntIdList(filters.withoutGenres);
  if (withoutGenres.length > 0) {
    params.without_genres = withoutGenres.join(",");
  }

  const yearFrom = parseYearString(filters.yearFrom);
  if (yearFrom) params["primary_release_date.gte"] = `${yearFrom}-01-01`;

  const yearTo = parseYearString(filters.yearTo);
  if (yearTo) params["primary_release_date.lte"] = `${yearTo}-12-31`;

  const runtimeMin = parseOptionalPositiveInt(filters.runtimeMin);
  if (runtimeMin !== "") params["with_runtime.gte"] = String(runtimeMin);

  const runtimeMax = parseOptionalPositiveInt(filters.runtimeMax);
  if (runtimeMax !== "") params["with_runtime.lte"] = String(runtimeMax);

  const minImdb = filters.minImdb === "" || filters.minImdb === null || filters.minImdb === undefined
    ? DEFAULT_EXPLORE_FILTERS.minImdb
    : Number(filters.minImdb);
  if (Number.isFinite(minImdb) && minImdb > 0) {
    params["vote_average.gte"] = String(minImdb);
  }

  const rawVotes = filters.minVotes === "" || filters.minVotes === null || filters.minVotes === undefined
    ? DEFAULT_EXPLORE_FILTERS.minVotes
    : Number(filters.minVotes);
  let minVotes = Number.isFinite(rawVotes) && rawVotes >= 0 ? Math.floor(rawVotes) : DEFAULT_EXPLORE_FILTERS.minVotes;

  // Enforce acclaim floor on vote_average.desc so 1-vote 10.0 anomalies don't flood Top Rated
  if (sortBy === "vote_average.desc" && !options.allowUnflooredVotes) {
    minVotes = Math.max(150, minVotes);
  }
  if (minVotes > 0) {
    params["vote_count.gte"] = String(minVotes);
  }

  const language = String(filters.language || "").trim().toLowerCase();
  if (language) params.with_original_language = language;

  const country = String(filters.country || "").trim().toUpperCase();
  if (country) params.with_origin_country = country;

  const keywords = parseKeywordList(filters.keywords);
  if (keywords.length > 0) {
    params.with_keywords = keywords.map((k) => k.id).join(",");
  }

  const person = parsePersonParam(filters.person);
  if (person) {
    params.with_people = String(person.id);
  }

  const providers = parseIntIdList(filters.providers);
  const providerFilter = providers.length > 0
    ? buildProviderFilter(providers, { expandAliases: true })
    : null;
  const region = normalizeRegion(filters.region, "US");
  const effectiveWatchRegion = region === "GLOBAL" ? "US" : region;

  if (providerFilter) {
    params.with_watch_providers = providerFilter;
    params.with_watch_monetization_types = "flatrate|free|ads";
    params.watch_region = effectiveWatchRegion;
  } else if (region && region !== "GLOBAL") {
    params.watch_region = region;
  }

  return params;
}

/**
 * Annotate Explore cards with user Vault state and optionally strip watched entries.
 */
export function filterExploreResults(movies = [], watched = [], watchlist = [], { hideWatched = false } = {}) {
  const watchedList = Array.isArray(watched) ? watched : [];
  const watchlistList = Array.isArray(watchlist) ? watchlist : [];

  const results = [];
  for (const movie of Array.isArray(movies) ? movies : []) {
    if (!movie) continue;
    const matchedWatched = findMatchingMovie(watchedList, movie);
    if (matchedWatched) {
      if (hideWatched) continue;
      results.push({
        ...movie,
        _watched: true,
        userRating: matchedWatched.userRating,
        dateWatched: matchedWatched.dateWatched || movie.dateWatched,
        reviewTags: matchedWatched.reviewTags || movie.reviewTags,
        userNote: matchedWatched.userNote ?? movie.userNote
      });
      continue;
    }

    const matchedWatchlist = findMatchingMovie(watchlistList, movie);
    if (matchedWatchlist) {
      results.push({
        ...movie,
        _inWatchlist: true
      });
      continue;
    }

    results.push({ ...movie });
  }
  return results;
}

/**
 * Build removable filter chips summarizing all active non-default Explore filters.
 */
export function getActiveFilterChips(filters = {}) {
  const chips = [];
  const genres = parseIntIdList(filters.genres);
  const withoutGenres = parseIntIdList(filters.withoutGenres);
  const keywords = parseKeywordList(filters.keywords);
  const providers = parseIntIdList(filters.providers);
  const person = parsePersonParam(filters.person);

  for (const id of genres) {
    chips.push({
      key: `genre-${id}`,
      label: getGenreLabel(id),
      clearPatch: { genres: genres.filter((g) => g !== id) }
    });
  }

  if (genres.length > 1 && filters.genreMode === "or") {
    chips.push({
      key: "genreMode",
      label: "Genres: Any (OR)",
      clearPatch: { genreMode: "and" }
    });
  }

  for (const id of withoutGenres) {
    chips.push({
      key: `withoutGenre-${id}`,
      label: `Exclude ${getGenreLabel(id)}`,
      clearPatch: { withoutGenres: withoutGenres.filter((g) => g !== id) }
    });
  }

  const yearFrom = parseYearString(filters.yearFrom);
  const yearTo = parseYearString(filters.yearTo);
  if (yearFrom || yearTo) {
    const label = yearFrom && yearTo
      ? `${yearFrom}-${yearTo}`
      : yearFrom
        ? `From ${yearFrom}`
        : `Up to ${yearTo}`;
    chips.push({
      key: "years",
      label,
      clearPatch: { yearFrom: "", yearTo: "" }
    });
  }

  const runtimeMin = parseOptionalPositiveInt(filters.runtimeMin);
  const runtimeMax = parseOptionalPositiveInt(filters.runtimeMax);
  if (runtimeMin !== "" || runtimeMax !== "") {
    const label = runtimeMin !== "" && runtimeMax !== ""
      ? `${runtimeMin}-${runtimeMax}m`
      : runtimeMin !== ""
        ? `${runtimeMin}m+`
        : `<=${runtimeMax}m`;
    chips.push({
      key: "runtime",
      label: `Runtime: ${label}`,
      clearPatch: { runtimeMin: "", runtimeMax: "" }
    });
  }

  if (
    filters.minImdb !== undefined &&
    filters.minImdb !== null &&
    filters.minImdb !== "" &&
    Number(filters.minImdb) !== DEFAULT_EXPLORE_FILTERS.minImdb
  ) {
    const score = Number(filters.minImdb);
    chips.push({
      key: "minImdb",
      label: score > 0 ? `IMDb ${score.toFixed(1)}+` : "Any IMDb Score",
      clearPatch: { minImdb: DEFAULT_EXPLORE_FILTERS.minImdb }
    });
  }

  if (
    filters.minVotes !== undefined &&
    filters.minVotes !== null &&
    filters.minVotes !== "" &&
    Number(filters.minVotes) !== DEFAULT_EXPLORE_FILTERS.minVotes
  ) {
    chips.push({
      key: "minVotes",
      label: `Min ${Number(filters.minVotes)} votes`,
      clearPatch: { minVotes: DEFAULT_EXPLORE_FILTERS.minVotes }
    });
  }

  const language = String(filters.language || "").trim().toLowerCase();
  if (language) {
    chips.push({
      key: "language",
      label: `Language: ${LANGUAGE_LABEL_BY_CODE.get(language) || language.toUpperCase()}`,
      clearPatch: { language: "" }
    });
  }

  const country = String(filters.country || "").trim().toUpperCase();
  if (country) {
    chips.push({
      key: "country",
      label: `Origin: ${country}`,
      clearPatch: { country: "" }
    });
  }

  for (const kw of keywords) {
    chips.push({
      key: `keyword-${kw.id}`,
      label: `#${kw.name}`,
      clearPatch: { keywords: keywords.filter((item) => item.id !== kw.id) }
    });
  }

  if (person) {
    chips.push({
      key: "person",
      label: `Person: ${person.name}`,
      clearPatch: { person: null }
    });
  }

  for (const pid of providers) {
    chips.push({
      key: `provider-${pid}`,
      label: PROVIDER_NAME_BY_ID.get(pid) || `Provider #${pid}`,
      clearPatch: { providers: providers.filter((p) => p !== pid) }
    });
  }

  if (filters.sortBy && filters.sortBy !== DEFAULT_EXPLORE_FILTERS.sortBy) {
    chips.push({
      key: "sortBy",
      label: `Sort: ${SORT_LABEL_BY_ID.get(filters.sortBy) || filters.sortBy}`,
      clearPatch: { sortBy: DEFAULT_EXPLORE_FILTERS.sortBy }
    });
  }

  if (filters.hideWatched) {
    chips.push({
      key: "hideWatched",
      label: "Hide Watched",
      clearPatch: { hideWatched: false }
    });
  }

  return chips;
}
