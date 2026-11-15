import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  SlidersHorizontal,
  X,
  RotateCcw,
  Search,
  Sparkles,
  Check,
  ChevronDown,
  ChevronUp,
  Film,
  Tv
} from "lucide-react";
import { useApp } from "../context/AppContext";
import MovieCard from "../components/MovieCard";
import { Button } from "../components/ui";
import { fetchTmdbJson, hasTmdbBackend } from "../services/apiTransport";
import {
  POPULAR_WATCH_PROVIDERS,
  PROVIDER_MAP,
  searchTmdbKeywords
} from "../services/tmdbService";
import { toDashboardCardItem } from "../services/dashboardService";
import {
  DEFAULT_EXPLORE_FILTERS,
  EXPLORE_GENRE_OPTIONS,
  DECADE_PRESETS,
  RUNTIME_PRESETS,
  EXPLORE_SORT_OPTIONS,
  LANGUAGE_OPTIONS,
  COUNTRY_OPTIONS,
  parseExploreSearchParams,
  buildExploreSearchParams,
  buildTmdbDiscoverParams,
  filterExploreResults,
  getActiveFilterChips
} from "../services/exploreService";

const VOTE_FLOOR_OPTIONS = [
  { value: 150, label: "Popular (150+ votes)" },
  { value: 500, label: "Acclaimed (500+ votes)" },
  { value: 25, label: "Hidden Gems (25+ votes)" },
  { value: 0, label: "All Films (0+ votes)" }
];

function serializeFilterSignature(filters) {
  const sp = buildExploreSearchParams({ ...filters, page: 1 });
  sp.delete("page");
  return sp.toString();
}

export default function ExplorePage({ onQuickRate }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    watched = [],
    watchlist = [],
    userRegion = "GLOBAL",
    userWatchProviders = []
  } = useApp();

  const defaultRegion = userRegion && userRegion !== "GLOBAL" ? userRegion : "US";

  const filters = useMemo(
    () => parseExploreSearchParams(searchParams, defaultRegion),
    [searchParams, defaultRegion]
  );

  const filterSignature = useMemo(() => serializeFilterSignature(filters), [filters]);

  const [rawPagesState, setRawPagesState] = useState({
    signature: "",
    items: [],
    loadedPage: 0,
    totalResults: 0,
    totalPages: 1
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [showExcludeGenres, setShowExcludeGenres] = useState(() => filters.withoutGenres.length > 0);

  // Local controlled inputs for debounced year typing
  const [yearFromDraft, setYearFromDraft] = useState(filters.yearFrom);
  const [yearToDraft, setYearToDraft] = useState(filters.yearTo);

  // Live autocomplete states
  const [personQuery, setPersonQuery] = useState("");
  const [personSuggestions, setPersonSuggestions] = useState([]);
  const [isSearchingPerson, setIsSearchingPerson] = useState(false);

  const [keywordQuery, setKeywordQuery] = useState("");
  const [keywordSuggestions, setKeywordSuggestions] = useState([]);
  const [isSearchingKeywords, setIsSearchingKeywords] = useState(false);

  const requestSeqRef = useRef(0);
  const rawStateRef = useRef(rawPagesState);
  rawStateRef.current = rawPagesState;

  useEffect(() => {
    setYearFromDraft(filters.yearFrom);
    setYearToDraft(filters.yearTo);
  }, [filters.yearFrom, filters.yearTo]);

  useEffect(() => {
    if (filters.withoutGenres.length > 0) {
      setShowExcludeGenres(true);
    }
  }, [filters.withoutGenres.length]);

  useEffect(() => {
    document.title = "Explore Catalog | CinemaVault";
  }, []);

  // Close mobile filter sheet with Escape
  useEffect(() => {
    if (!isMobileFiltersOpen) return undefined;
    function onKeyDown(e) {
      if (e.key === "Escape") setIsMobileFiltersOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobileFiltersOpen]);

  function updateFilters(patch, { resetPage = true, replace = false } = {}) {
    const next = {
      ...filters,
      ...patch,
      page: resetPage ? 1 : (patch.page ?? filters.page)
    };
    const nextParams = buildExploreSearchParams(next);
    setSearchParams(nextParams, { replace });
  }

  function toggleArrayFilter(key, id) {
    const current = Array.isArray(filters[key]) ? filters[key] : [];
    const exists = current.includes(id);
    const updated = exists ? current.filter((x) => x !== id) : [...current, id];
    const oppositeKey = key === "genres" ? "withoutGenres" : key === "withoutGenres" ? "genres" : null;
    if (oppositeKey && !exists && Array.isArray(filters[oppositeKey])) {
      updateFilters({
        [key]: updated,
        [oppositeKey]: filters[oppositeKey].filter((x) => x !== id)
      });
      return;
    }
    updateFilters({ [key]: updated });
  }

  function handleResetFilters() {
    setPersonQuery("");
    setPersonSuggestions([]);
    setKeywordQuery("");
    setKeywordSuggestions([]);
    setSearchParams(buildExploreSearchParams({ ...DEFAULT_EXPLORE_FILTERS, region: defaultRegion }));
  }

  function applyYearDrafts(nextFrom, nextTo) {
    const cleanFrom = /^\d{4}$/.test(String(nextFrom || "").trim()) ? String(nextFrom).trim() : "";
    const cleanTo = /^\d{4}$/.test(String(nextTo || "").trim()) ? String(nextTo).trim() : "";
    if (cleanFrom !== filters.yearFrom || cleanTo !== filters.yearTo) {
      updateFilters({ yearFrom: cleanFrom, yearTo: cleanTo }, { replace: true });
    }
  }

  // Sync debounced 4-digit year edits automatically
  useEffect(() => {
    const trimmedFrom = String(yearFromDraft || "").trim();
    const trimmedTo = String(yearToDraft || "").trim();
    const validFrom = trimmedFrom === "" || /^\d{4}$/.test(trimmedFrom);
    const validTo = trimmedTo === "" || /^\d{4}$/.test(trimmedTo);
    if (!validFrom || !validTo) return undefined;
    if (trimmedFrom === filters.yearFrom && trimmedTo === filters.yearTo) return undefined;

    const timer = setTimeout(() => {
      updateFilters({ yearFrom: trimmedFrom, yearTo: trimmedTo }, { replace: true });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearFromDraft, yearToDraft]);

  // Normalized user configured provider IDs for "My Providers" 1-click button
  const configuredUserProviderIds = useMemo(() => {
    const knownIds = new Set(POPULAR_WATCH_PROVIDERS.map((p) => p.id));
    const resolved = [];
    for (const raw of Array.isArray(userWatchProviders) ? userWatchProviders : []) {
      const mapped = typeof raw === "string" && PROVIDER_MAP[raw] ? PROVIDER_MAP[raw] : Number(raw);
      if (knownIds.has(mapped) && !resolved.includes(mapped)) {
        resolved.push(mapped);
      }
    }
    return resolved;
  }, [userWatchProviders]);

  // Fetch /3/discover/movie with request-sequence & AbortController protection
  useEffect(() => {
    const seq = ++requestSeqRef.current;
    const controller = new AbortController();

    if (!hasTmdbBackend()) {
      setIsLoading(false);
      setIsLoadingMore(false);
      setErrorMsg("TMDB backend key or proxy is unavailable in this environment.");
      return () => controller.abort();
    }

    const prev = rawStateRef.current;
    const isAppending =
      filters.page > 1 &&
      prev.signature === filterSignature &&
      filters.page === prev.loadedPage + 1;

    setErrorMsg("");
    if (isAppending) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }

    const discoverParams = buildTmdbDiscoverParams(filters);

    fetchTmdbJson("/3/discover/movie", discoverParams, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted || requestSeqRef.current !== seq) return;
        if (!data || !Array.isArray(data.results)) {
          setErrorMsg("Could not load catalog results right now. Try adjusting filters or retrying.");
          return;
        }

        const normalizedBatch = data.results.map((item) => toDashboardCardItem(item));
        setRawPagesState((curr) => {
          const baseItems =
            isAppending && curr.signature === filterSignature ? curr.items : [];
          const seen = new Set(baseItems.map((m) => Number(m.tmdbId || m.id)));
          const merged = [...baseItems];
          for (const card of normalizedBatch) {
            const cardId = Number(card.tmdbId || card.id);
            if (!cardId || seen.has(cardId)) continue;
            seen.add(cardId);
            merged.push(card);
          }
          return {
            signature: filterSignature,
            items: merged,
            loadedPage: filters.page,
            totalResults: Number(data.total_results) || merged.length,
            totalPages: Math.max(1, Number(data.total_pages) || 1)
          };
        });
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        if (requestSeqRef.current !== seq) return;
        setErrorMsg("Failed to fetch matching films from TMDB.");
      })
      .finally(() => {
        if (controller.signal.aborted || requestSeqRef.current !== seq) return;
        setIsLoading(false);
        setIsLoadingMore(false);
      });

    return () => controller.abort();
  }, [filters, filterSignature]);

  // Debounced Person search autocomplete
  useEffect(() => {
    const clean = personQuery.trim();
    if (clean.length < 2 || !hasTmdbBackend()) {
      setPersonSuggestions([]);
      setIsSearchingPerson(false);
      return undefined;
    }

    const controller = new AbortController();
    setIsSearchingPerson(true);
    const timer = setTimeout(() => {
      fetchTmdbJson(
        "/3/search/person",
        { query: clean, include_adult: "false", language: "en-US", page: 1 },
        { signal: controller.signal }
      )
        .then((res) => {
          if (controller.signal.aborted) return;
          const picks = (res?.results || []).slice(0, 6).map((p) => ({
            id: p.id,
            name: p.name,
            dept: p.known_for_department || "",
            profile: p.profile_path ? `https://image.tmdb.org/t/p/w185${p.profile_path}` : null
          }));
          setPersonSuggestions(picks);
        })
        .catch(() => {
          if (!controller.signal.aborted) setPersonSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearchingPerson(false);
        });
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [personQuery]);

  // Debounced Motif / Keyword search autocomplete
  useEffect(() => {
    const clean = keywordQuery.trim();
    if (clean.length < 2 || !hasTmdbBackend()) {
      setKeywordSuggestions([]);
      setIsSearchingKeywords(false);
      return undefined;
    }

    const controller = new AbortController();
    setIsSearchingKeywords(true);
    const timer = setTimeout(() => {
      searchTmdbKeywords(clean, { signal: controller.signal, limit: 8 })
        .then((res) => {
          if (controller.signal.aborted) return;
          setKeywordSuggestions(Array.isArray(res) ? res : []);
        })
        .catch(() => {
          if (!controller.signal.aborted) setKeywordSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearchingKeywords(false);
        });
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [keywordQuery]);

  const filteredResults = useMemo(
    () =>
      filterExploreResults(rawPagesState.items, watched, watchlist, {
        hideWatched: filters.hideWatched
      }),
    [rawPagesState.items, watched, watchlist, filters.hideWatched]
  );

  const hiddenWatchedCount = Math.max(0, rawPagesState.items.length - filteredResults.length);
  const activeChips = useMemo(() => getActiveFilterChips(filters), [filters]);
  const hasMorePages = filters.page < rawPagesState.totalPages;

  // Auto-advance once if hideWatched hides everything on page 1 cleanly
  useEffect(() => {
    if (
      !isLoading &&
      !isLoadingMore &&
      !errorMsg &&
      filters.hideWatched &&
      rawPagesState.signature === filterSignature &&
      rawPagesState.items.length > 0 &&
      filteredResults.length === 0 &&
      hasMorePages &&
      filters.page < 3
    ) {
      updateFilters({ page: filters.page + 1 }, { resetPage: false, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, isLoadingMore, errorMsg, filters.hideWatched, filters.page, rawPagesState.signature, rawPagesState.items.length, filteredResults.length, hasMorePages, filterSignature]);

  function renderFilterControls() {
    return (
      <div className="explore-filter-stack">
        {/* Quick Era / Decade Presets */}
        <section className="explore-facet-group">
          <div className="explore-facet-header">
            <h3 className="explore-facet-title">Era &amp; Decade</h3>
            {(filters.yearFrom || filters.yearTo) && (
              <button
                type="button"
                className="explore-facet-clear"
                onClick={() => updateFilters({ yearFrom: "", yearTo: "" })}
              >
                Clear
              </button>
            )}
          </div>
          <div className="explore-preset-grid">
            {DECADE_PRESETS.map((preset) => {
              const isActive =
                filters.yearFrom === preset.yearFrom && filters.yearTo === preset.yearTo;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`explore-chip-btn ${isActive ? "active" : ""}`}
                  onClick={() =>
                    updateFilters(
                      isActive
                        ? { yearFrom: "", yearTo: "" }
                        : { yearFrom: preset.yearFrom, yearTo: preset.yearTo }
                    )
                  }
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="explore-year-inputs">
            <label className="explore-mini-field">
              <span>From</span>
              <input
                type="number"
                min="1900"
                max="2030"
                placeholder="1990"
                value={yearFromDraft}
                onChange={(e) => setYearFromDraft(e.target.value)}
                onBlur={() => applyYearDrafts(yearFromDraft, yearToDraft)}
                aria-label="Release year from"
              />
            </label>
            <label className="explore-mini-field">
              <span>To</span>
              <input
                type="number"
                min="1900"
                max="2030"
                placeholder="2026"
                value={yearToDraft}
                onChange={(e) => setYearToDraft(e.target.value)}
                onBlur={() => applyYearDrafts(yearFromDraft, yearToDraft)}
                aria-label="Release year to"
              />
            </label>
          </div>
        </section>

        {/* Runtime Presets */}
        <section className="explore-facet-group">
          <div className="explore-facet-header">
            <h3 className="explore-facet-title">Runtime</h3>
            {(filters.runtimeMin !== "" || filters.runtimeMax !== "") && (
              <button
                type="button"
                className="explore-facet-clear"
                onClick={() => updateFilters({ runtimeMin: "", runtimeMax: "" })}
              >
                Clear
              </button>
            )}
          </div>
          <div className="explore-preset-grid">
            {RUNTIME_PRESETS.map((preset) => {
              const isActive =
                filters.runtimeMin === preset.runtimeMin &&
                filters.runtimeMax === preset.runtimeMax;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`explore-chip-btn ${isActive ? "active" : ""}`}
                  onClick={() =>
                    updateFilters(
                      isActive
                        ? { runtimeMin: "", runtimeMax: "" }
                        : { runtimeMin: preset.runtimeMin, runtimeMax: preset.runtimeMax }
                    )
                  }
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Genres + AND/OR Mode + Exclude Genres */}
        <section className="explore-facet-group">
          <div className="explore-facet-header">
            <h3 className="explore-facet-title">Genres</h3>
            {filters.genres.length >= 2 && (
              <div className="explore-mode-toggle" role="group" aria-label="Genre match mode">
                <button
                  type="button"
                  className={filters.genreMode === "and" ? "active" : ""}
                  onClick={() => updateFilters({ genreMode: "and" })}
                >
                  All (AND)
                </button>
                <button
                  type="button"
                  className={filters.genreMode === "or" ? "active" : ""}
                  onClick={() => updateFilters({ genreMode: "or" })}
                >
                  Any (OR)
                </button>
              </div>
            )}
          </div>
          <div className="explore-chip-pool">
            {EXPLORE_GENRE_OPTIONS.map((genre) => {
              const active = filters.genres.includes(genre.id);
              return (
                <button
                  key={genre.id}
                  type="button"
                  aria-pressed={active}
                  className={`explore-chip-btn ${active ? "active" : ""}`}
                  onClick={() => toggleArrayFilter("genres", genre.id)}
                >
                  {genre.name}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="explore-disclosure-btn"
            onClick={() => setShowExcludeGenres((prev) => !prev)}
            aria-expanded={showExcludeGenres}
          >
            <span>
              Exclude Genres
              {filters.withoutGenres.length > 0 ? ` (${filters.withoutGenres.length})` : ""}
            </span>
            {showExcludeGenres ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>

          {showExcludeGenres && (
            <div className="explore-chip-pool explore-exclude-pool">
              {EXPLORE_GENRE_OPTIONS.map((genre) => {
                const excluded = filters.withoutGenres.includes(genre.id);
                return (
                  <button
                    key={genre.id}
                    type="button"
                    aria-pressed={excluded}
                    className={`explore-chip-btn exclude ${excluded ? "active" : ""}`}
                    onClick={() => toggleArrayFilter("withoutGenres", genre.id)}
                  >
                    − {genre.name}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Minimum Score + Vote Floor */}
        <section className="explore-facet-group">
          <div className="explore-facet-header">
            <h3 className="explore-facet-title">Acclaim Threshold</h3>
            <span className="explore-rating-readout tabular-num">
              {filters.minImdb > 0 ? `${Number(filters.minImdb).toFixed(1)}+` : "Any"}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="9"
            step="0.5"
            value={filters.minImdb}
            onChange={(e) => updateFilters({ minImdb: Number(e.target.value) })}
            className="explore-range-slider"
            aria-label="Minimum IMDb rating"
          />
          <div className="explore-select-field">
            <label htmlFor="explore-min-votes">Minimum Vote Count</label>
            <select
              id="explore-min-votes"
              value={filters.minVotes}
              onChange={(e) => updateFilters({ minVotes: Number(e.target.value) })}
            >
              {VOTE_FLOOR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {filters.sortBy === "vote_average.desc" && filters.minVotes < 150 && (
              <p className="explore-facet-hint">
                Highest Rated sort applies a 150-vote minimum floor so 1-vote anomalies don&apos;t crowd results.
              </p>
            )}
          </div>
        </section>

        {/* Director / Actor Search */}
        <section className="explore-facet-group">
          <div className="explore-facet-header">
            <h3 className="explore-facet-title">Director or Actor</h3>
            {filters.person && (
              <button
                type="button"
                className="explore-facet-clear"
                onClick={() => updateFilters({ person: null })}
              >
                Clear
              </button>
            )}
          </div>
          {filters.person ? (
            <div className="explore-selected-pill">
              <span>{filters.person.name}</span>
              <button
                type="button"
                aria-label={`Remove ${filters.person.name}`}
                onClick={() => updateFilters({ person: null })}
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="explore-autocomplete">
              <div className="explore-search-input-wrap">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="e.g. Denis Villeneuve, Cillian Murphy"
                  value={personQuery}
                  onChange={(e) => setPersonQuery(e.target.value)}
                  aria-label="Filter by director or actor"
                />
              </div>
              {(personSuggestions.length > 0 || isSearchingPerson) && (
                <ul className="explore-autocomplete-list" role="listbox">
                  {isSearchingPerson && <li className="explore-autocomplete-status">Searching cast &amp; crew…</li>}
                  {personSuggestions.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          updateFilters({ person: { id: p.id, name: p.name } });
                          setPersonQuery("");
                          setPersonSuggestions([]);
                        }}
                      >
                        <span className="suggestion-name">{p.name}</span>
                        {p.dept && <span className="suggestion-meta">{p.dept}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Motif / Keyword Search */}
        <section className="explore-facet-group">
          <div className="explore-facet-header">
            <h3 className="explore-facet-title">Cinematic Motifs &amp; Themes</h3>
            {filters.keywords.length > 0 && (
              <button
                type="button"
                className="explore-facet-clear"
                onClick={() => updateFilters({ keywords: [] })}
              >
                Clear
              </button>
            )}
          </div>
          {filters.keywords.length > 0 && (
            <div className="explore-selected-list">
              {filters.keywords.map((kw) => (
                <span key={kw.id} className="explore-selected-pill">
                  <span>#{kw.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove motif ${kw.name}`}
                    onClick={() =>
                      updateFilters({
                        keywords: filters.keywords.filter((k) => k.id !== kw.id)
                      })
                    }
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="explore-autocomplete">
            <div className="explore-search-input-wrap">
              <Sparkles size={14} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search theme: time loop, neo noir..."
                value={keywordQuery}
                onChange={(e) => setKeywordQuery(e.target.value)}
                aria-label="Filter by cinematic motif or keyword"
              />
            </div>
            {(keywordSuggestions.length > 0 || isSearchingKeywords) && (
              <ul className="explore-autocomplete-list" role="listbox">
                {isSearchingKeywords && <li className="explore-autocomplete-status">Searching motifs…</li>}
                {keywordSuggestions.map((kw) => (
                  <li key={kw.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!filters.keywords.some((existing) => existing.id === kw.id)) {
                          updateFilters({ keywords: [...filters.keywords, kw] });
                        }
                        setKeywordQuery("");
                        setKeywordSuggestions([]);
                      }}
                    >
                      <span className="suggestion-name">#{kw.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Language & Origin Country */}
        <section className="explore-facet-group">
          <h3 className="explore-facet-title">Language &amp; Region</h3>
          <div className="explore-select-pair">
            <div className="explore-select-field">
              <label htmlFor="explore-language">Language</label>
              <select
                id="explore-language"
                value={filters.language}
                onChange={(e) => updateFilters({ language: e.target.value })}
              >
                {LANGUAGE_OPTIONS.map((lang) => (
                  <option key={lang.code || "any"} value={lang.code}>
                    {lang.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="explore-select-field">
              <label htmlFor="explore-country">Country</label>
              <select
                id="explore-country"
                value={filters.country}
                onChange={(e) => updateFilters({ country: e.target.value })}
              >
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code || "any"} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Streaming Providers */}
        <section className="explore-facet-group">
          <div className="explore-facet-header">
            <h3 className="explore-facet-title">
              <Tv size={14} aria-hidden="true" /> Streaming ({filters.region === "GLOBAL" ? "US" : filters.region})
            </h3>
            {configuredUserProviderIds.length > 0 && (
              <button
                type="button"
                className="explore-facet-clear"
                onClick={() => updateFilters({ providers: configuredUserProviderIds })}
              >
                My Providers
              </button>
            )}
          </div>
          <div className="explore-chip-pool">
            {POPULAR_WATCH_PROVIDERS.map((provider) => {
              const active = filters.providers.includes(provider.id);
              return (
                <button
                  key={provider.id}
                  type="button"
                  aria-pressed={active}
                  className={`explore-chip-btn ${active ? "active" : ""}`}
                  onClick={() => toggleArrayFilter("providers", provider.id)}
                >
                  {provider.name}
                </button>
              );
            })}
          </div>
        </section>

        {/* Hide Already Watched */}
        <section className="explore-facet-group">
          <label className="explore-toggle-row">
            <span>Hide already watched films</span>
            <input
              type="checkbox"
              checked={filters.hideWatched}
              onChange={(e) => updateFilters({ hideWatched: e.target.checked })}
            />
          </label>
        </section>
      </div>
    );
  }

  return (
    <div className="explore-page page-rail">
      <div className="explore-layout">
        {/* Sticky Desktop Sidebar */}
        <aside className="explore-sidebar" aria-label="Catalog Filters">
          <div className="explore-sidebar-head">
            <div className="explore-sidebar-title">
              <SlidersHorizontal size={16} aria-hidden="true" />
              <h2>Deep Filter</h2>
            </div>
            {activeChips.length > 0 && (
              <button
                type="button"
                className="explore-reset-link"
                onClick={handleResetFilters}
              >
                <RotateCcw size={13} aria-hidden="true" />
                Reset
              </button>
            )}
          </div>
          {renderFilterControls()}
        </aside>

        {/* Main Results Workbench */}
        <section className="explore-main" aria-label="Explore Results">
          <header className="explore-header">
            <div className="explore-header-copy">
              <div className="explore-kicker">Precision Catalog Workbench</div>
              <h1 className="explore-title">Explore Films</h1>
              <p className="explore-subtitle tabular-num">
                {isLoading && rawPagesState.items.length === 0
                  ? "Querying TMDB catalog…"
                  : `${rawPagesState.totalResults.toLocaleString()} matching ${
                      rawPagesState.totalResults === 1 ? "film" : "films"
                    }`}
                {hiddenWatchedCount > 0 && ` · ${hiddenWatchedCount} watched hidden`}
              </p>
            </div>

            <div className="explore-header-actions">
              <button
                type="button"
                className="explore-mobile-filter-trigger"
                onClick={() => setIsMobileFiltersOpen(true)}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
                <span>Filters</span>
                {activeChips.length > 0 && (
                  <span className="explore-filter-count tabular-num">{activeChips.length}</span>
                )}
              </button>

              <label className="explore-sort-control">
                <span className="sr-only">Sort results</span>
                <select
                  value={filters.sortBy}
                  onChange={(e) => updateFilters({ sortBy: e.target.value })}
                  aria-label="Sort results"
                >
                  {EXPLORE_SORT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </header>

          {/* Active Filter Chips */}
          {activeChips.length > 0 && (
            <div className="explore-active-chips" role="region" aria-label="Active Filters">
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="explore-active-chip"
                  onClick={() => updateFilters(chip.clearPatch)}
                >
                  <span>{chip.label}</span>
                  <X size={13} aria-hidden="true" />
                </button>
              ))}
              <button
                type="button"
                className="explore-clear-all-btn"
                onClick={handleResetFilters}
              >
                Clear all
              </button>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div className="explore-state-card error" role="alert">
              <p>{errorMsg}</p>
              <Button variant="secondary" onClick={() => updateFilters({}, { resetPage: false })}>
                Retry
              </Button>
            </div>
          )}

          {/* Loading Skeleton */}
          {isLoading && filteredResults.length === 0 ? (
            <div className="explore-grid" aria-busy="true">
              {Array.from({ length: 12 }).map((_, idx) => (
                <div key={idx} className="explore-skeleton-card">
                  <div className="explore-skeleton-poster" />
                  <div className="explore-skeleton-line" />
                  <div className="explore-skeleton-line short" />
                </div>
              ))}
            </div>
          ) : !errorMsg && filteredResults.length === 0 ? (
            <div className="explore-state-card">
              <Film size={32} className="explore-empty-icon" aria-hidden="true" />
              <h3>No matching films found</h3>
              <p>
                {hiddenWatchedCount > 0 && hasMorePages
                  ? `All ${hiddenWatchedCount} matches from this page are already in your Vault.`
                  : "Try widening your score threshold, removing a motif, or relaxing genre filters."}
              </p>
              <div className="explore-empty-actions">
                {hiddenWatchedCount > 0 && hasMorePages && (
                  <Button
                    variant="primary"
                    onClick={() => updateFilters({ page: filters.page + 1 }, { resetPage: false })}
                  >
                    Load Next Page
                  </Button>
                )}
                <Button variant="secondary" onClick={handleResetFilters}>
                  Reset All Filters
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="explore-grid">
                {filteredResults.map((movie) => {
                  const id = movie.imdbID || movie.id || `tmdb_${movie.tmdbId}`;
                  return (
                    <div key={id} className="explore-card-wrap">
                      {movie._inWatchlist && !movie._watched && (
                        <span className="explore-watchlist-badge" title="In your Watchlist">
                          <Check size={11} aria-hidden="true" /> Watchlist
                        </span>
                      )}
                      <MovieCard
                        movie={movie}
                        showCaption={true}
                        isWatched={Boolean(movie._watched)}
                        onSelectMovie={(movieId) => navigate(`/movie/${movieId}`)}
                        onQuickAdd={onQuickRate}
                      />
                    </div>
                  );
                })}
              </div>

              {hasMorePages && (
                <div className="explore-pagination">
                  <Button
                    variant="secondary"
                    disabled={isLoadingMore}
                    onClick={() => updateFilters({ page: filters.page + 1 }, { resetPage: false })}
                  >
                    {isLoadingMore ? "Loading more films…" : "Load More Films"}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* Mobile Filter Drawer Sheet */}
      {isMobileFiltersOpen && (
        <div
          className="explore-mobile-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Filter catalog"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMobileFiltersOpen(false);
          }}
        >
          <div className="explore-mobile-sheet">
            <div className="explore-mobile-sheet-head">
              <div className="explore-sidebar-title">
                <SlidersHorizontal size={16} aria-hidden="true" />
                <h2>Filters</h2>
              </div>
              <div className="explore-mobile-sheet-actions">
                <button
                  type="button"
                  className="explore-reset-link"
                  onClick={handleResetFilters}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="explore-sheet-close"
                  onClick={() => setIsMobileFiltersOpen(false)}
                  aria-label="Close filters"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="explore-mobile-sheet-body">{renderFilterControls()}</div>
            <div className="explore-mobile-sheet-foot">
              <Button
                variant="primary"
                onClick={() => setIsMobileFiltersOpen(false)}
              >
                Show {rawPagesState.totalResults.toLocaleString()} Films
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
