import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Film,
  GitCompareArrows,
  Globe,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Tv,
  Users,
  X
} from "lucide-react";
import { useApp } from "../context/AppContext";
import {
  COMPARE_MAX_ITEMS,
  buildCompareMatrix,
  buildCompareUrl,
  dedupeHydratedMovies,
  hydrateCompareMovieSlot,
  resolveExploreGenreId,
  toCompareStub
} from "../services/compareService";
import { buildExploreRoute } from "../services/exploreService";
import { loadDefaultEmbeddingIndex } from "../services/embeddingService";
import { extractTmdbNumericId, findMatchingMovie, isSameMovie } from "../services/movieIdentity";
import { searchCatalogMovies } from "../services/searchService";
import { getCanonicalMovieKey } from "../services/vaultSyncService";
import { resolveProviderLaunchUrl } from "../services/watchLinkService";
import PosterImage from "./PosterImage";
import { Button } from "./ui";

// In-memory session cache keyed by "<canonicalId>::<region>" so reopening modal/route stays instant
const compareHydrationCache = new Map();

function getSlotKey(itemOrId) {
  if (!itemOrId) return "";
  if (typeof itemOrId === "string" || typeof itemOrId === "number") {
    return String(itemOrId).trim().toLowerCase();
  }
  const canonical = getCanonicalMovieKey(itemOrId);
  if (canonical) return canonical.toLowerCase();
  const tmdb = extractTmdbNumericId(itemOrId.tmdbId ?? itemOrId.id ?? itemOrId.imdbID);
  return tmdb ? `tmdb_${tmdb}` : "";
}

function createProviderBucket(movie) {
  const seen = new Set();
  const list = [];
  const pushProviders = (arr, kind) => {
    for (const p of Array.isArray(arr) ? arr : []) {
      if (!p?.name) continue;
      const key = `${p.id || p.name}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ ...p, kind });
    }
  };
  pushProviders(movie.streamProviders, "Stream");
  pushProviders(movie.freeProviders, "Free");
  pushProviders(movie.buyRentProviders, "Rent/Buy");
  return list.slice(0, 6);
}

function toQuickRateStub(movie) {
  const base = toCompareStub(movie) || {};
  return {
    ...base,
    id: movie?.imdbID || movie?.canonicalId || movie?.id || base.id,
    imdbID: movie?.imdbID || base.imdbID || null,
    tmdbId: movie?.tmdbId || base.tmdbId || null,
    title: movie?.title || base.title || "Untitled Film",
    year: movie?.year || base.year || null,
    poster: movie?.poster || base.poster || null,
    backdrop: movie?.backdrop || null,
    genre: movie?.genre || base.genre || null,
    runtime: movie?.runtime || base.runtime || null,
    imdbRating: movie?.imdbRating || base.imdbRating || null,
    streamProviders: Array.isArray(movie?.streamProviders) ? movie.streamProviders : []
  };
}

export default function CompareWorkbench({
  movieIdsOrItems = [],
  onResolvedSlotsChange,
  onNavigatePerson,
  onNavigateMovie,
  onNavigateExplore,
  onAddFilm,
  onRemoveSlot,
  onQuickRate
}) {
  const {
    watched = [],
    watchlist = [],
    userRegion = "GLOBAL",
    addToWatchlist
  } = useApp();

  const effectiveRegion = userRegion && userRegion !== "GLOBAL" ? userRegion : "US";

  const slotDescriptors = useMemo(
    () =>
      (Array.isArray(movieIdsOrItems) ? movieIdsOrItems : [])
        .map((raw) => ({ raw, key: getSlotKey(raw) }))
        .filter((s) => Boolean(s.key))
        .slice(0, COMPARE_MAX_ITEMS),
    [movieIdsOrItems]
  );

  const slotsKey = useMemo(() => slotDescriptors.map((s) => s.key).join("|"), [slotDescriptors]);
  const latestDescriptorsRef = useRef(slotDescriptors);
  latestDescriptorsRef.current = slotDescriptors;

  const [hydratedByKey, setHydratedByKey] = useState({});
  const [embeddingIndex, setEmbeddingIndex] = useState(null);
  const [isHydrating, setIsHydrating] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [copyStatus, setCopyStatus] = useState("idle");

  // Inline quick-search state for empty state or filling remaining comparison slots
  const [isAddSearchOpen, setIsAddSearchOpen] = useState(false);
  const [addSearchQuery, setAddSearchQuery] = useState("");
  const [addSearchResults, setAddSearchResults] = useState([]);
  const [isSearchingAdd, setIsSearchingAdd] = useState(false);

  const copyTimerRef = useRef(null);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  // Load 64-D CVEM index lazily for Vault Taste Resonance & pairwise similarity
  useEffect(() => {
    let active = true;
    loadDefaultEmbeddingIndex()
      .then((idx) => {
        if (active && idx) setEmbeddingIndex(idx);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Hydrate docked slots / URL IDs concurrently with cache reuse & AbortController cancellation
  useEffect(() => {
    const descriptors = latestDescriptorsRef.current;
    if (descriptors.length === 0) {
      setHydratedByKey({});
      setIsHydrating(false);
      return undefined;
    }

    const immediateMap = {};
    const pendingDescriptors = [];
    for (const desc of descriptors) {
      const cacheKey = `${desc.key}::${effectiveRegion}`;
      if (compareHydrationCache.has(cacheKey)) {
        immediateMap[desc.key] = compareHydrationCache.get(cacheKey);
      } else {
        pendingDescriptors.push(desc);
      }
    }

    setHydratedByKey((prev) => ({ ...prev, ...immediateMap }));
    if (pendingDescriptors.length === 0) {
      setIsHydrating(false);
      return undefined;
    }

    const controller = new AbortController();
    setIsHydrating(true);

    Promise.all(
      pendingDescriptors.map(async (desc) => {
        try {
          const result = await hydrateCompareMovieSlot(desc.raw, {
            userRegion: effectiveRegion,
            signal: controller.signal
          });
          if (controller.signal.aborted) return null;
          if (result && !result._notFound && !result._partial) {
            compareHydrationCache.set(`${desc.key}::${effectiveRegion}`, result);
          }
          return [desc.key, result];
        } catch (err) {
          if (err?.name === "AbortError" || controller.signal.aborted) return null;
          return [desc.key, { id: desc.key, title: desc.raw?.title || desc.key, _notFound: true }];
        }
      })
    )
      .then((pairs) => {
        if (controller.signal.aborted) return;
        const nextEntries = {};
        for (const pair of pairs) {
          if (pair && pair[0] && pair[1]) nextEntries[pair[0]] = pair[1];
        }
        setHydratedByKey((prev) => ({ ...prev, ...nextEntries }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsHydrating(false);
      });

    return () => controller.abort();
  }, [slotsKey, effectiveRegion, retryNonce]);

  // Inline quick search to add a 2nd/3rd film straight inside the workbench
  useEffect(() => {
    const clean = addSearchQuery.trim();
    if (!clean) {
      setAddSearchResults([]);
      setIsSearchingAdd(false);
      return undefined;
    }

    const controller = new AbortController();
    setIsSearchingAdd(true);
    const timer = setTimeout(() => {
      searchCatalogMovies({
        query: clean,
        watched,
        watchlist,
        signal: controller.signal
      })
        .then((res) => {
          if (!controller.signal.aborted) {
            setAddSearchResults(Array.isArray(res) ? res.slice(0, 6) : []);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setAddSearchResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsSearchingAdd(false);
        });
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [addSearchQuery, watched, watchlist]);

  const resolvedSlots = useMemo(
    () =>
      slotDescriptors.map((desc) => {
        const cachedOrHydrated = hydratedByKey[desc.key];
        if (cachedOrHydrated) {
          return { ...cachedOrHydrated, _rawSlotKey: desc.key };
        }
        return typeof desc.raw === "object"
          ? { ...desc.raw, _rawSlotKey: desc.key, _hydrating: true }
          : { id: desc.key, _rawSlotKey: desc.key, title: desc.key, _hydrating: true };
      }),
    [slotDescriptors, hydratedByKey]
  );

  useEffect(() => {
    onResolvedSlotsChange?.(resolvedSlots);
  }, [resolvedSlots, onResolvedSlotsChange]);

  const validMovies = useMemo(
    () => dedupeHydratedMovies(resolvedSlots.filter((m) => m && !m._notFound)),
    [resolvedSlots]
  );
  const notFoundSlots = useMemo(
    () => resolvedSlots.filter((m) => m?._notFound),
    [resolvedSlots]
  );

  const matrix = useMemo(
    () => buildCompareMatrix(validMovies, { watched, watchlist, embeddingIndex }),
    [validMovies, watched, watchlist, embeddingIndex]
  );

  const sharePath = useMemo(() => buildCompareUrl(matrix.items), [matrix.items]);

  async function handleCopyShareLink() {
    if (typeof window === "undefined") return;
    const fullUrl = `${window.location.origin}${sharePath}`;
    let copiedOk = false;

    if (typeof navigator?.clipboard?.writeText === "function") {
      try {
        await navigator.clipboard.writeText(fullUrl);
        copiedOk = true;
      } catch {
        copiedOk = false;
      }
    }

    if (!copiedOk && typeof document !== "undefined") {
      try {
        const textArea = document.createElement("textarea");
        textArea.value = fullUrl;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        copiedOk = Boolean(document.execCommand?.("copy"));
        document.body.removeChild(textArea);
      } catch {
        copiedOk = false;
      }
    }

    setCopyStatus(copiedOk ? "copied" : "failed");
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyStatus("idle"), 2400);
  }

  function handleRetryFailedSlots() {
    for (const desc of slotDescriptors) {
      const cacheKey = `${desc.key}::${effectiveRegion}`;
      const existing = hydratedByKey[desc.key] || compareHydrationCache.get(cacheKey);
      if (!existing || existing._notFound || existing._partial) {
        compareHydrationCache.delete(cacheKey);
      }
    }
    setHydratedByKey((prev) => {
      const next = { ...prev };
      for (const desc of slotDescriptors) {
        if (next[desc.key]?._notFound || next[desc.key]?._partial) {
          delete next[desc.key];
        }
      }
      return next;
    });
    setRetryNonce((n) => n + 1);
  }

  function handleQuickWatchlist(movie) {
    if (!addToWatchlist || !movie) return;
    const rawImdb = Number(movie.imdbRating) || Number(movie.tmdbRating);
    addToWatchlist({
      imdbID: movie.imdbID || movie.canonicalId || movie.id,
      tmdbId: movie.tmdbId || null,
      title: movie.title,
      year: movie.year,
      poster: movie.poster,
      backdrop: movie.backdrop,
      imdbRating: Number.isFinite(rawImdb) && rawImdb > 0 ? rawImdb : null,
      runtime: movie.runtimeMins || 120,
      genre: movie.genre || "Cinema",
      streamProviders: movie.streamProviders || [],
      userRating: 0
    });
  }

  function handlePickFilmFromSearch(film) {
    if (!film) return;
    onAddFilm?.(film);
    setAddSearchQuery("");
    setAddSearchResults([]);
    setIsAddSearchOpen(false);
  }

  const vaultQuickPicks = useMemo(() => {
    const candidates = [...(watched || []), ...(watchlist || [])];
    return candidates
      .filter(
        (c) =>
          !slotDescriptors.some((d) => isSameMovie(d.raw, c)) &&
          !validMovies.some((m) => isSameMovie(m, c))
      )
      .slice(0, 6);
  }, [watched, watchlist, slotDescriptors, validMovies]);

  const colCount = matrix.items.length;
  const occupiedSlots = Math.min(COMPARE_MAX_ITEMS, colCount + notFoundSlots.length);
  const remainingSlots = Math.max(0, COMPARE_MAX_ITEMS - occupiedSlots);

  const warningBanner = notFoundSlots.length > 0 && (
    <div className="compare-warning-bar" role="status">
      <div className="compare-warning-chips">
        <span>Could not resolve from TMDB/OMDb:</span>
        {notFoundSlots.map((slot) => (
          <span key={slot._rawSlotKey || slot.id} className="compare-warning-chip">
            <code>{slot.id}</code>
            {onRemoveSlot && (
              <button
                type="button"
                className="compare-warning-remove"
                onClick={() => onRemoveSlot(slot)}
                aria-label={`Remove unresolvable slot ${slot.id}`}
                title="Remove invalid slot"
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="compare-retry-link"
        onClick={handleRetryFailedSlots}
      >
        <RotateCcw size={13} aria-hidden="true" /> Retry
      </button>
    </div>
  );

  // Render clean empty/selector state when < 1 valid films resolve
  if (colCount === 0) {
    return (
      <div className="compare-workbench">
        {warningBanner}
        <div className="compare-empty-panel">
          <div className="compare-empty-icon">
            <GitCompareArrows size={28} aria-hidden="true" />
          </div>
          <h2 className="compare-empty-title display-title">Build Your Side-by-Side Comparison</h2>
          <p className="compare-empty-subtitle">
            Pick 2 or 3 films to contrast scores, budgets &amp; ROI, shared cast/crew, thematic DNA, and streaming options.
          </p>

          <div className="compare-search-box">
            <div className="compare-search-input-wrap">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search any film title or IMDb ID (e.g. Interstellar, Dune)…"
                value={addSearchQuery}
                onChange={(e) => setAddSearchQuery(e.target.value)}
                aria-label="Search films to compare"
              />
            </div>
            {isSearchingAdd && <p className="compare-search-status">Searching catalog…</p>}
            {addSearchResults.length > 0 && (
              <ul className="compare-search-results" role="listbox" aria-label="Search results to add">
                {addSearchResults.map((film) => {
                  const key = film.imdbID || film.id || `tmdb_${film.tmdbId}`;
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className="compare-search-result-btn"
                        disabled={remainingSlots === 0}
                        onClick={() => handlePickFilmFromSearch(film)}
                      >
                        <div className="compare-search-thumb">
                          <PosterImage src={film.Poster || film.poster} title={film.Title || film.title} />
                        </div>
                        <div className="compare-search-meta">
                          <span className="compare-search-name">{film.Title || film.title}</span>
                          <span className="compare-search-sub tabular-num">
                            {film.Year || film.year || "—"}
                            {film.imdbRating && film.imdbRating !== "N/A" ? ` · ★ ${film.imdbRating}` : ""}
                          </span>
                        </div>
                        <span className="compare-search-add-pill">
                          <Plus size={14} aria-hidden="true" /> Add
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {vaultQuickPicks.length > 0 && remainingSlots > 0 && (
            <div className="compare-quick-picks">
              <div className="compare-quick-picks-label">Quick pick from your Vault</div>
              <div className="compare-quick-picks-row">
                {vaultQuickPicks.map((item) => {
                  const key = getCanonicalMovieKey(item) || item.imdbID || item.id || item.title;
                  return (
                    <button
                      key={key}
                      type="button"
                      className="compare-quick-pick-chip"
                      onClick={() => handlePickFilmFromSearch(item)}
                    >
                      <Plus size={13} aria-hidden="true" />
                      <span>{item.title}</span>
                      {item.year && <span className="tabular-num text-text-3">({item.year})</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const minRuntime = matrix.items.reduce(
    (min, m) => (m.runtimeMins !== null ? Math.min(min, m.runtimeMins) : min),
    Infinity
  );

  const isLeader = (arr, idx) => Array.isArray(arr) && arr.includes(idx);

  return (
    <div className="compare-workbench">
      {/* Top Toolbar */}
      <div className="compare-toolbar">
        <div className="compare-toolbar-status">
          <span className="compare-slot-count tabular-num">
            {colCount} / {COMPARE_MAX_ITEMS} Films
          </span>
          {isHydrating && <span className="compare-hydrating-pill">Syncing metrics &amp; DNA…</span>}
        </div>

        <div className="compare-toolbar-actions">
          {remainingSlots > 0 && onAddFilm && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsAddSearchOpen((prev) => !prev)}
            >
              <Plus size={14} aria-hidden="true" />
              <span>{isAddSearchOpen ? "Close Finder" : `Add Film (${remainingSlots} left)`}</span>
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopyShareLink}
            disabled={colCount < 2}
          >
            {copyStatus === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            <span>
              {copyStatus === "copied"
                ? "Copied Share Link"
                : copyStatus === "failed"
                  ? "Copy Failed — Copy URL"
                  : "Copy Share Link"}
            </span>
          </Button>
        </div>
      </div>

      {/* Unresolvable URL ID warning if applicable */}
      {warningBanner}

      {/* Single-film helpful prompt + inline finder */}
      {((colCount < 2 && remainingSlots > 0) || (isAddSearchOpen && remainingSlots > 0)) && (
        <div className="compare-inline-adder">
          <div className="compare-inline-adder-head">
            <span>
              {colCount < 2
                ? "Add at least one more film to unlock head-to-head metrics and overlap analysis."
                : `Add a 3rd film to compare side-by-side`}
            </span>
          </div>
          <div className="compare-search-box compact">
            <div className="compare-search-input-wrap">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search title or tt-ID to add…"
                value={addSearchQuery}
                onChange={(e) => setAddSearchQuery(e.target.value)}
                aria-label="Search film to add to comparison"
              />
            </div>
            {addSearchResults.length > 0 && (
              <ul className="compare-search-results" role="listbox">
                {addSearchResults.map((film) => {
                  const alreadyIn = matrix.items.some((m) => isSameMovie(m, film));
                  return (
                    <li key={film.imdbID || film.id || film.tmdbId}>
                      <button
                        type="button"
                        className="compare-search-result-btn"
                        disabled={alreadyIn}
                        onClick={() => handlePickFilmFromSearch(film)}
                      >
                        <div className="compare-search-thumb">
                          <PosterImage src={film.Poster || film.poster} title={film.Title || film.title} />
                        </div>
                        <div className="compare-search-meta">
                          <span className="compare-search-name">{film.Title || film.title}</span>
                          <span className="compare-search-sub tabular-num">{film.Year || film.year || "—"}</span>
                        </div>
                        <span className="compare-search-add-pill">
                          {alreadyIn ? "In Compare" : <><Plus size={13} aria-hidden="true" /> Add</>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {!addSearchQuery && vaultQuickPicks.length > 0 && (
            <div className="compare-quick-picks-row compact">
              {vaultQuickPicks.slice(0, 4).map((item) => (
                <button
                  key={getCanonicalMovieKey(item) || item.title}
                  type="button"
                  className="compare-quick-pick-chip"
                  onClick={() => handlePickFilmFromSearch(item)}
                >
                  <Plus size={12} aria-hidden="true" />
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Matrix Table Grid (Sticky Metric Labels + Equal Movie Columns) */}
      <div className="compare-matrix-scroll">
        <div
          className="compare-matrix-grid"
          style={{ "--compare-cols": Math.max(colCount, 1) }}
        >
          {/* 1. Hero Poster Header Columns */}
          <div className="compare-row compare-hero-row">
            <div className="compare-label-cell compare-hero-label">
              <span className="compare-section-kicker">Selected Films</span>
            </div>
            {matrix.items.map((item) => {
              const targetId = item.imdbID || item.canonicalId || item.id || `tmdb_${item.tmdbId}`;
              const alreadySaved = findMatchingMovie(watchlist, item);
              return (
                <article key={targetId} className="compare-hero-card">
                  {onRemoveSlot && (
                    <button
                      type="button"
                      className="compare-slot-remove"
                      onClick={() => onRemoveSlot(item)}
                      aria-label={`Remove ${item.title} from Compare`}
                      title="Remove slot"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  )}

                  <button
                    type="button"
                    className="compare-hero-poster-btn"
                    onClick={() => onNavigateMovie?.(targetId)}
                    aria-label={`Open full details for ${item.title}`}
                  >
                    <PosterImage src={item.poster} title={item.title} alt={`${item.title} poster`} />
                  </button>

                  <div className="compare-hero-card-body">
                    <button
                      type="button"
                      className="compare-hero-title-link"
                      onClick={() => onNavigateMovie?.(targetId)}
                    >
                      {item.title}
                    </button>
                    <div className="compare-hero-sub tabular-num">
                      <span>{item.year || "—"}</span>
                      {item.rated && <span className="compare-mpaa-pill">{item.rated}</span>}
                    </div>
                    {item.genres?.length > 0 && (
                      <div className="compare-hero-genres">{item.genres.slice(0, 3).join(" · ")}</div>
                    )}

                    <div className="compare-hero-card-actions">
                      {!item.isWatched && (
                        <button
                          type="button"
                          className={`compare-mini-btn ${alreadySaved || item.inWatchlist ? "is-saved" : ""}`}
                          disabled={Boolean(alreadySaved || item.inWatchlist)}
                          onClick={() => handleQuickWatchlist(item)}
                        >
                          <Check size={12} aria-hidden="true" />
                          <span>{alreadySaved || item.inWatchlist ? "Watchlist" : "+ Watchlist"}</span>
                        </button>
                      )}
                      {onQuickRate && (
                        <button
                          type="button"
                          className="compare-mini-btn"
                          onClick={() => onQuickRate(toQuickRateStub(item))}
                        >
                          <Star size={12} aria-hidden="true" />
                          <span>{item.vaultRating ? `${item.vaultRating}/10` : "Rate"}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* 2. Critics & Community Consensus */}
          <div className="compare-section-divider">
            <span className="compare-section-divider-label">Critics &amp; Community Consensus</span>
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">IMDb Score</div>
            {matrix.items.map((item, idx) => (
              <div
                key={`imdb-${item.canonicalId}`}
                className={`compare-value-cell ${isLeader(matrix.leaders.imdb, idx) ? "is-leader" : ""}`}
              >
                <span className="compare-value-main tabular-num">{matrix.rows.imdb[idx]}</span>
                {item.imdbVotes && <span className="compare-value-sub tabular-num">{item.imdbVotes} votes</span>}
                {isLeader(matrix.leaders.imdb, idx) && <span className="compare-leader-tag">Highest</span>}
              </div>
            ))}
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">Rotten Tomatoes</div>
            {matrix.items.map((item, idx) => (
              <div
                key={`rt-${item.canonicalId}`}
                className={`compare-value-cell ${isLeader(matrix.leaders.rt, idx) ? "is-leader" : ""}`}
              >
                <span className="compare-value-main tabular-num">{matrix.rows.rt[idx]}</span>
                {isLeader(matrix.leaders.rt, idx) && <span className="compare-leader-tag">Highest</span>}
              </div>
            ))}
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">Metascore</div>
            {matrix.items.map((item, idx) => (
              <div
                key={`meta-${item.canonicalId}`}
                className={`compare-value-cell ${isLeader(matrix.leaders.metascore, idx) ? "is-leader" : ""}`}
              >
                <span className="compare-value-main tabular-num">{matrix.rows.metascore[idx]}</span>
                {isLeader(matrix.leaders.metascore, idx) && <span className="compare-leader-tag">Highest</span>}
              </div>
            ))}
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">TMDB Score</div>
            {matrix.items.map((item, idx) => (
              <div
                key={`tmdb-${item.canonicalId}`}
                className={`compare-value-cell ${isLeader(matrix.leaders.tmdb, idx) ? "is-leader" : ""}`}
              >
                <span className="compare-value-main tabular-num">{matrix.rows.tmdb[idx]}</span>
                {item.tmdbVotes ? (
                  <span className="compare-value-sub tabular-num">
                    {Number(item.tmdbVotes).toLocaleString()} votes
                  </span>
                ) : null}
                {isLeader(matrix.leaders.tmdb, idx) && <span className="compare-leader-tag">Highest</span>}
              </div>
            ))}
          </div>

          {/* 3. Your Vault Fit & Status */}
          <div className="compare-section-divider">
            <span className="compare-section-divider-label">Your Vault Fit &amp; Status</span>
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">Vault Log</div>
            {matrix.items.map((item, idx) => (
              <div key={`vault-${item.canonicalId}`} className="compare-value-cell">
                {item.vaultRating !== null ? (
                  <span className="compare-vault-rating tabular-num">
                    <Star size={13} fill="currentColor" aria-hidden="true" />
                    {item.vaultRating} / 10
                  </span>
                ) : (
                  <span className="compare-value-main">{matrix.rows.vaultScore[idx]}</span>
                )}
                {item.vaultNote && (
                  <span className="compare-vault-note" title={item.vaultNote}>
                    “{item.vaultNote}”
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">CVEM Taste Fit</div>
            {matrix.items.map((item, idx) => (
              <div
                key={`fit-${item.canonicalId}`}
                className={`compare-value-cell ${isLeader(matrix.leaders.vaultMatch, idx) ? "is-leader" : ""}`}
              >
                <span className="compare-value-main tabular-num">{matrix.rows.vaultMatchPct[idx]}</span>
                {item.vaultMatchPct !== null && (
                  <span className="compare-value-sub">64-D Vault vector match</span>
                )}
                {isLeader(matrix.leaders.vaultMatch, idx) && <span className="compare-leader-tag">Best Fit</span>}
              </div>
            ))}
          </div>

          {/* 4. Production & Financials */}
          <div className="compare-section-divider">
            <span className="compare-section-divider-label">Production &amp; Financials</span>
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">Runtime</div>
            {matrix.items.map((item, idx) => {
              const delta =
                item.runtimeMins !== null && Number.isFinite(minRuntime)
                  ? item.runtimeMins - minRuntime
                  : 0;
              return (
                <div
                  key={`rtm-${item.canonicalId}`}
                  className={`compare-value-cell ${isLeader(matrix.leaders.runtimeShortest, idx) ? "is-leader" : ""}`}
                >
                  <span className="compare-value-main tabular-num">{matrix.rows.runtime[idx]}</span>
                  {delta > 0 && <span className="compare-value-sub tabular-num">+{delta}m longer</span>}
                  {isLeader(matrix.leaders.runtimeShortest, idx) && (
                    <span className="compare-leader-tag">Shortest</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">Budget</div>
            {matrix.items.map((item, idx) => (
              <div key={`bgt-${item.canonicalId}`} className="compare-value-cell">
                <span className="compare-value-main tabular-num">{matrix.rows.budget[idx]}</span>
              </div>
            ))}
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">Worldwide Revenue</div>
            {matrix.items.map((item, idx) => (
              <div
                key={`rev-${item.canonicalId}`}
                className={`compare-value-cell ${isLeader(matrix.leaders.revenue, idx) ? "is-leader" : ""}`}
              >
                <span className="compare-value-main tabular-num">{matrix.rows.revenue[idx]}</span>
                {isLeader(matrix.leaders.revenue, idx) && <span className="compare-leader-tag">Highest</span>}
              </div>
            ))}
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">ROI Multiple</div>
            {matrix.items.map((item, idx) => (
              <div
                key={`roi-${item.canonicalId}`}
                className={`compare-value-cell ${isLeader(matrix.leaders.roi, idx) ? "is-leader" : ""}`}
              >
                <span className="compare-value-main tabular-num">{matrix.rows.roi[idx]}</span>
                {isLeader(matrix.leaders.roi, idx) && <span className="compare-leader-tag">Best ROI</span>}
              </div>
            ))}
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">Origin &amp; Audio</div>
            {matrix.items.map((item) => (
              <div key={`orig-${item.canonicalId}`} className="compare-value-cell">
                <span className="compare-value-main compare-wrap-text">
                  <Globe size={12} aria-hidden="true" style={{ display: "inline", marginRight: "0.4rem" }} />
                  {item.originCountry || "—"}
                </span>
                <span className="compare-value-sub compare-wrap-text">
                  {item.spokenLanguages || "—"}
                </span>
              </div>
            ))}
          </div>

          {/* 6. Regional Availability */}
          <div className="compare-section-divider">
            <span className="compare-section-divider-label">Where to Watch ({effectiveRegion})</span>
          </div>

          <div className="compare-row">
            <div className="compare-label-cell">
              <Tv size={14} aria-hidden="true" /> Streaming &amp; Rent
            </div>
            {matrix.items.map((item) => {
              const bucket = createProviderBucket(item);
              return (
                <div key={`prov-${item.canonicalId}`} className="compare-value-cell">
                  {bucket.length === 0 ? (
                    <span className="compare-value-sub">No regional offers listed</span>
                  ) : (
                    <div className="compare-providers-stack">
                      {bucket.map((p) => {
                        const launch = resolveProviderLaunchUrl({
                          providerId: p.id,
                          providerName: p.name,
                          title: item.title,
                          year: item.year,
                          watchProviderLink: item.watchProviderLink
                        });
                        return (
                          <a
                            key={`${p.id || p.name}-${p.kind}`}
                            href={launch.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="compare-provider-badge compare-provider-badge--interactive"
                            title={launch.label}
                            aria-label={launch.label}
                          >
                            {p.logo && <img src={p.logo} alt="" aria-hidden="true" />}
                            <span>{p.name}</span>
                            <small>{p.kind}</small>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 5. Shared DNA & Creative Overlap Strip */}
      {colCount >= 2 && (
        <section className="compare-dna-panel" aria-label="Shared DNA and Creative Overlap">
          <div className="compare-dna-header">
            <Sparkles size={15} aria-hidden="true" />
            <h3>Shared DNA &amp; Creative Overlap</h3>
          </div>

          {matrix.overlap.pairVectorSims.length > 0 && (
            <div className="compare-dna-group">
              <div className="compare-dna-group-label">Semantic Similarity (64-D CVEM)</div>
              <div className="compare-pair-sims">
                {matrix.overlap.pairVectorSims.map((pair) => (
                  <div
                    key={`${pair.aIndex}-${pair.bIndex}`}
                    className="compare-pair-sim-card"
                  >
                    <span className="compare-pair-titles">
                      {pair.aTitle} × {pair.bTitle}
                    </span>
                    <span className="compare-pair-pct tabular-num">{pair.similarityPct}% match</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {matrix.overlap.sharedCrew.length > 0 && (
            <div className="compare-dna-group">
              <div className="compare-dna-group-label">
                <Users size={13} aria-hidden="true" /> Shared Crew &amp; Filmmakers
              </div>
              <div className="compare-dna-chips">
                {matrix.overlap.sharedCrew.map((person) => {
                  const roleSummary = person.rolesByMovie
                    .map((r) => `${r.movieTitle}: ${r.role}`)
                    .join(" · ");
                  return person.id ? (
                    <button
                      key={`crew-${person.id}-${person.name}`}
                      type="button"
                      className="compare-dna-chip is-interactive"
                      onClick={() => onNavigatePerson?.(person.id)}
                      title={roleSummary}
                    >
                      <span>{person.name}</span>
                      <span className="compare-dna-meta">
                        {person.rolesByMovie.length}/{colCount}
                      </span>
                    </button>
                  ) : (
                    <span
                      key={`crew-static-${person.name}`}
                      className="compare-dna-chip"
                      title={roleSummary}
                    >
                      {person.name}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {matrix.overlap.sharedActors.length > 0 && (
            <div className="compare-dna-group">
              <div className="compare-dna-group-label">
                <Users size={13} aria-hidden="true" /> Shared Cast
              </div>
              <div className="compare-dna-chips">
                {matrix.overlap.sharedActors.map((person) => {
                  const roleSummary = person.rolesByMovie
                    .map((r) => `${r.movieTitle} (${r.role})`)
                    .join(" · ");
                  return person.id ? (
                    <button
                      key={`cast-${person.id}-${person.name}`}
                      type="button"
                      className="compare-dna-chip is-interactive"
                      onClick={() => onNavigatePerson?.(person.id)}
                      title={roleSummary}
                    >
                      <span>{person.name}</span>
                      <span className="compare-dna-meta">
                        {person.rolesByMovie.length}/{colCount}
                      </span>
                    </button>
                  ) : (
                    <span
                      key={`cast-static-${person.name}`}
                      className="compare-dna-chip"
                      title={roleSummary}
                    >
                      {person.name}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {(matrix.overlap.sharedGenres.length > 0 || matrix.overlap.sharedKeywords.length > 0) && (
            <div className="compare-dna-group">
              <div className="compare-dna-group-label">
                <Film size={13} aria-hidden="true" /> Shared Genres &amp; #Motifs
              </div>
              <div className="compare-dna-chips">
                {matrix.overlap.sharedGenres.map((genre) => {
                  const genreId = resolveExploreGenreId(genre);
                  return genreId ? (
                    <button
                      key={`g-${genre}`}
                      type="button"
                      className="compare-dna-chip is-interactive"
                      onClick={() => onNavigateExplore?.(buildExploreRoute({ genres: [genreId] }))}
                    >
                      {genre}
                    </button>
                  ) : (
                    <span key={`g-static-${genre}`} className="compare-dna-chip">
                      {genre}
                    </span>
                  );
                })}
                {matrix.overlap.sharedKeywords.map((kw) =>
                  kw.id ? (
                    <button
                      key={`kw-${kw.id}-${kw.name}`}
                      type="button"
                      className="compare-dna-chip is-interactive"
                      onClick={() =>
                        onNavigateExplore?.(
                          buildExploreRoute({ keywords: [{ id: kw.id, name: kw.name }] })
                        )
                      }
                    >
                      #{kw.name}
                    </button>
                  ) : (
                    <span key={`kw-static-${kw.name}`} className="compare-dna-chip">
                      #{kw.name}
                    </span>
                  )
                )}
              </div>
            </div>
          )}

          {matrix.overlap.sharedActors.length === 0 &&
            matrix.overlap.sharedCrew.length === 0 &&
            matrix.overlap.sharedGenres.length === 0 &&
            matrix.overlap.sharedKeywords.length === 0 &&
            matrix.overlap.pairVectorSims.length === 0 && (
              <p className="compare-dna-empty">
                Distinct creative circles — no overlapping top-billed cast, crew, or shared motifs detected.
              </p>
            )}
        </section>
      )}
    </div>
  );
}
