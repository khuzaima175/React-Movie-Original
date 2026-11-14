import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bookmark,
  Check,
  Film,
  Loader2,
  Plus,
  Search,
  Star,
  X
} from "lucide-react";
import { useApp } from "../context/AppContext";
import PosterImage from "./PosterImage";
import { prepareWatchlistPayload } from "../services/ratingTiers";
import {
  loadSearchTrendingPosters,
  searchCatalogMovies
} from "../services/searchService";

const QUICK_FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "vault", label: "In My Vault" },
  { id: "watchlist", label: "Watchlisted" }
];

export default function SearchModal({
  isOpen,
  onClose,
  onSelectMovie,
  onQuickRate
}) {
  const { apiKey, watched = [], watchlist = [], addToWatchlist } = useApp();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [trendingPosters, setTrendingPosters] = useState([]);
  const [activeFilter, setActiveFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef(null);
  const rowRefs = useRef([]);

  useEffect(() => {
    if (!isOpen) return undefined;
    setError("");
    setActiveFilter("all");
    setSelectedIndex(0);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 40);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    loadSearchTrendingPosters({ watched, watchlist, limit: 8 }).then((items) => {
      if (!cancelled) setTrendingPosters(items);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, watched, watchlist]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      setError("");
      setSelectedIndex(0);
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoading(true);
      setError("");
      try {
        const merged = await searchCatalogMovies({
          query: trimmed,
          watched,
          watchlist,
          apiKey,
          signal: controller.signal
        });
        if (!controller.signal.aborted) {
          setResults(merged);
          setSelectedIndex(0);
          setIsLoading(false);
        }
      } catch (err) {
        if (err?.name !== "AbortError") {
          setError("Search hit a temporary hiccup. Local Vault matches are still shown.");
          setIsLoading(false);
        }
      }
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, isOpen, apiKey, watched, watchlist]);

  const filteredResults = useMemo(() => {
    if (activeFilter === "vault") return results.filter((item) => item.inVault);
    if (activeFilter === "watchlist") return results.filter((item) => item.inWatchlist);
    return results;
  }, [results, activeFilter]);

  const filterCounts = useMemo(
    () => ({
      all: results.length,
      vault: results.filter((item) => item.inVault).length,
      watchlist: results.filter((item) => item.inWatchlist).length
    }),
    [results]
  );

  useEffect(() => {
    if (selectedIndex >= filteredResults.length && filteredResults.length > 0) {
      setSelectedIndex(0);
    }
  }, [filteredResults.length, selectedIndex]);

  useEffect(() => {
    const activeRow = rowRefs.current[selectedIndex];
    if (activeRow && typeof activeRow.scrollIntoView === "function") {
      activeRow.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const activePreview = filteredResults[selectedIndex] || filteredResults[0] || null;

  function openFilmDetails(movie) {
    const targetId = movie?.imdbID || movie?.id || (movie?.tmdbId ? `tmdb_${movie.tmdbId}` : "");
    if (!targetId) return;
    onSelectMovie?.(targetId);
    onClose?.();
  }

  function handleQuickRateClick(movie, e) {
    if (e) e.stopPropagation();
    if (!movie) return;
    onQuickRate?.(movie);
    onClose?.();
  }

  function handleSaveWatchlist(movie, e) {
    if (e) e.stopPropagation();
    const payload = prepareWatchlistPayload(movie);
    if (payload) addToWatchlist?.(payload);
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
      return;
    }
    if (filteredResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredResults.length) % filteredResults.length);
    } else if (e.key === "Enter" && activePreview) {
      e.preventDefault();
      openFilmDetails(activePreview);
    }
  }

  if (!isOpen) return null;

  const trimmedQuery = query.trim();

  const content = (
    <div
      className="search-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Search films"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="search-spotlight-card search-theater-card" onClick={(e) => e.stopPropagation()}>
        {/* Search Input Header */}
        <div className="search-input-header">
          <span className="search-input-icon-wrap" aria-hidden="true">
            {isLoading ? (
              <Loader2 size={20} className="search-spinner-icon" />
            ) : (
              <Search size={20} />
            )}
          </span>
          <input
            ref={inputRef}
            type="text"
            className="search-theater-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search films by title, director, or IMDb ID..."
            aria-label="Search films by title, director, or IMDb ID"
          />
          {query && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search query"
            >
              <X size={16} />
            </button>
          )}
          <button
            type="button"
            className="search-esc-btn"
            onClick={onClose}
            aria-label="Close search"
          >
            ESC
          </button>
        </div>

        {/* Source Filter Pills */}
        {trimmedQuery.length > 0 && (
          <div className="search-filter-bar" role="tablist" aria-label="Filter search results">
            {QUICK_FILTER_TABS.map((tab) => {
              const count = filterCounts[tab.id];
              const isSelected = activeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`search-filter-pill ${isSelected ? "active" : ""}`}
                  onClick={() => {
                    setActiveFilter(tab.id);
                    setSelectedIndex(0);
                  }}
                >
                  <span>{tab.label}</span>
                  <span className="search-filter-count">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        {!trimmedQuery ? (
          <div className="search-theater-empty">
            <div className="search-section-header">
              <span className="search-section-label">Popular Right Now</span>
              <span className="search-section-sub">Click a poster to open or hover to rate</span>
            </div>

            <div className="search-trending-grid">
              {trendingPosters.map((item) => (
                <div
                  key={item.id || item.imdbID}
                  role="button"
                  tabIndex={0}
                  className="search-trending-tile"
                  onClick={() => openFilmDetails(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openFilmDetails(item);
                    }
                  }}
                >
                  <div className="search-trending-poster-wrap">
                    <PosterImage
                      src={item.Poster}
                      title={item.Title}
                      alt={`${item.Title} poster`}
                      className="search-trending-poster"
                    />
                    <div className="search-trending-overlay">
                      <button
                        type="button"
                        className={`search-tile-rate-btn ${item.inVault ? "rated" : ""}`}
                        onClick={(e) => handleQuickRateClick(item, e)}
                        title={item.inVault ? `Rated ${item.userRating}/10` : `Rate ${item.Title}`}
                      >
                        {item.inVault ? (
                          <>
                            <Star size={12} fill="currentColor" aria-hidden="true" />
                            <span>{item.userRating}/10</span>
                          </>
                        ) : (
                          <>
                            <Plus size={12} aria-hidden="true" />
                            <span>Rate</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="search-trending-meta">
                    <span className="search-trending-title">{item.Title}</span>
                    <span className="search-trending-year">{item.Year}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="search-theater-body">
            {/* Results Column */}
            <div className="search-results-pane">
              {error && <div className="search-status-banner">{error}</div>}

              {isLoading && filteredResults.length === 0 ? (
                <div className="search-empty-state">
                  <Loader2 size={24} className="search-spinner-icon" aria-hidden="true" />
                  <p>Searching catalog...</p>
                </div>
              ) : filteredResults.length === 0 ? (
                <div className="search-empty-state">
                  <Film size={28} aria-hidden="true" />
                  <p>
                    {results.length > 0
                      ? "No matches under this filter. Try switching to All."
                      : `No films found matching "${trimmedQuery}".`}
                  </p>
                </div>
              ) : (
                <div className="search-results-list" role="listbox" aria-label="Search results">
                  {filteredResults.map((movie, idx) => {
                    const isFocused = idx === selectedIndex;
                    return (
                      <div
                        key={movie.id || movie.imdbID}
                        ref={(el) => {
                          rowRefs.current[idx] = el;
                        }}
                        role="option"
                        aria-selected={isFocused}
                        className={`search-result-item ${isFocused ? "selected" : ""}`}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        onClick={() => openFilmDetails(movie)}
                      >
                        <div className="search-result-thumb">
                          {movie.Poster && movie.Poster !== "N/A" ? (
                            <PosterImage
                              src={movie.Poster}
                              title={movie.Title}
                              alt={`${movie.Title} poster`}
                            />
                          ) : (
                            <div className="search-result-fallback" aria-hidden="true">
                              <Film size={18} />
                            </div>
                          )}
                        </div>

                        <div className="search-result-info">
                          <div className="search-item-title-row">
                            <span className="search-item-title">{movie.Title}</span>
                            {movie.inVault && movie.userRating != null && (
                              <span className="search-badge-vault">★ {movie.userRating}/10</span>
                            )}
                            {!movie.inVault && movie.inWatchlist && (
                              <span className="search-badge-watchlist">Watchlist</span>
                            )}
                          </div>
                          <div className="search-item-sub">
                            {movie.Year && <span>{movie.Year}</span>}
                            {movie.imdbRating && (
                              <span className="search-item-score">
                                <Star size={11} fill="currentColor" aria-hidden="true" />
                                {movie.imdbRating}
                              </span>
                            )}
                            {movie.genre && (
                              <span className="search-item-genre">
                                {movie.genre.split(",").slice(0, 2).join(" • ")}
                              </span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          className={`search-row-rate-btn ${movie.inVault ? "rated" : ""}`}
                          onClick={(e) => handleQuickRateClick(movie, e)}
                          title={movie.inVault ? `Update rating (${movie.userRating}/10)` : `Rate ${movie.Title}`}
                        >
                          {movie.inVault ? (
                            <>
                              <Check size={13} aria-hidden="true" />
                              <span>Edit</span>
                            </>
                          ) : (
                            <>
                              <Plus size={13} aria-hidden="true" />
                              <span>Rate</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Live Preview Pane (Desktop) */}
            {activePreview && (
              <aside className="search-preview-pane" aria-label="Selected film preview">
                {activePreview.backdrop && (
                  <div className="search-preview-backdrop">
                    <img src={activePreview.backdrop} alt="" aria-hidden="true" />
                    <div className="search-preview-backdrop-scrim" />
                  </div>
                )}

                <div className="search-preview-content">
                  <div className="search-preview-top">
                    <div className="search-preview-poster">
                      <PosterImage
                        src={activePreview.Poster}
                        title={activePreview.Title}
                        alt={`${activePreview.Title} poster`}
                      />
                    </div>
                    <div className="search-preview-meta">
                      <h3 className="search-preview-title">{activePreview.Title}</h3>
                      <div className="search-preview-pills">
                        {activePreview.Year && (
                          <span className="search-preview-pill">{activePreview.Year}</span>
                        )}
                        {activePreview.imdbRating && (
                          <span className="search-preview-pill accent">
                            <Star size={11} fill="currentColor" aria-hidden="true" />
                            {activePreview.imdbRating}
                          </span>
                        )}
                        {activePreview.inVault && (
                          <span className="search-preview-pill vault">
                            Rated {activePreview.userRating}/10
                          </span>
                        )}
                      </div>
                      {activePreview.genre && (
                        <p className="search-preview-genres">{activePreview.genre}</p>
                      )}
                    </div>
                  </div>

                  {activePreview.plot ? (
                    <p className="search-preview-plot">{activePreview.plot}</p>
                  ) : (
                    <p className="search-preview-plot muted">
                      Open the film page to load full cast, streaming providers, and trailer details.
                    </p>
                  )}

                  <div className="search-preview-actions">
                    <button
                      type="button"
                      className="search-preview-primary-btn"
                      onClick={() => openFilmDetails(activePreview)}
                    >
                      Open Film Page
                    </button>
                    <button
                      type="button"
                      className="search-preview-rate-btn"
                      onClick={(e) => handleQuickRateClick(activePreview, e)}
                    >
                      <Star size={14} aria-hidden="true" />
                      <span>{activePreview.inVault ? "Update Score" : "Rate Film"}</span>
                    </button>
                    {!activePreview.inVault && (
                      <button
                        type="button"
                        className={`search-preview-watchlist-btn ${activePreview.inWatchlist ? "saved" : ""}`}
                        onClick={(e) => handleSaveWatchlist(activePreview, e)}
                        disabled={activePreview.inWatchlist}
                      >
                        <Bookmark size={14} aria-hidden="true" />
                        <span>{activePreview.inWatchlist ? "In Watchlist" : "+ Watchlist"}</span>
                      </button>
                    )}
                  </div>
                </div>
              </aside>
            )}
          </div>
        )}

        {/* Minimal Navigation Hint Footer */}
        <div className="search-hint-footer">
          <div className="search-hint-keys">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
          {trimmedQuery && (
            <span className="search-hint-count">
              {filteredResults.length} {filteredResults.length === 1 ? "result" : "results"}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(content, document.body);
  }
  return content;
}
