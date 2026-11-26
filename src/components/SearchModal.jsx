import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bookmark,
  Check,
  Compass,
  Film,
  ListChecks,
  Loader2,
  Plus,
  Search,
  Star,
  User,
  Users,
  X
} from "lucide-react";
import { useApp } from "../context/AppContext";
import PosterImage from "./PosterImage";
import { prepareWatchlistPayload } from "../services/ratingTiers";
import {
  loadSearchTrendingPosters,
  searchMultiEntity
} from "../services/searchService";
import { loadDefaultEmbeddingIndex } from "../services/embeddingService";
import { loadDefaultEaseIndex } from "../services/easeService";
import { loadDefaultContentIndex } from "../services/contentSimService";
import { buildTasteMatchContext, predictMovieMatch } from "../services/tasteMatchService";

const QUICK_FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "vault", label: "In My Vault" },
  { id: "watchlist", label: "Watchlisted" },
  { id: "people", label: "People" },
  { id: "community", label: "Community" }
];

export default function SearchModal({
  isOpen,
  onClose,
  onSelectMovie,
  onQuickRate,
  onExploreQuery
}) {
  const navigate = useNavigate();
  const { watched = [], watchlist = [], tasteRules = [], addToWatchlist } = useApp();
  const [embeddingIndex, setEmbeddingIndex] = useState(null);
  const [easeIndex, setEaseIndex] = useState(null);
  const [contentIndex, setContentIndex] = useState(null);

  useEffect(() => {
    if (!isOpen || (embeddingIndex && easeIndex && contentIndex)) return undefined;
    let active = true;
    Promise.all([
      embeddingIndex ? Promise.resolve(embeddingIndex) : loadDefaultEmbeddingIndex().catch(() => null),
      easeIndex ? Promise.resolve(easeIndex) : loadDefaultEaseIndex().catch(() => null),
      contentIndex ? Promise.resolve(contentIndex) : loadDefaultContentIndex().catch(() => null)
    ]).then(([svdIdx, easeIdx, contIdx]) => {
      if (!active) return;
      if (svdIdx && !embeddingIndex) setEmbeddingIndex(svdIdx);
      if (easeIdx && !easeIndex) setEaseIndex(easeIdx);
      if (contIdx && !contentIndex) setContentIndex(contIdx);
    });
    return () => {
      active = false;
    };
  }, [isOpen, embeddingIndex, easeIndex, contentIndex]);

  const tasteMatchCtx = useMemo(
    () =>
      buildTasteMatchContext({
        watched,
        watchlist,
        tasteRules,
        embeddingIndex,
        easeIndex,
        contentIndex
      }),
    [watched, watchlist, tasteRules, embeddingIndex, easeIndex, contentIndex]
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [peopleResults, setPeopleResults] = useState([]);
  const [userResults, setUserResults] = useState([]);
  const [listResults, setListResults] = useState([]);
  const [trendingPosters, setTrendingPosters] = useState([]);
  const [activeFilter, setActiveFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const matchPredictionsById = useMemo(() => {
    const map = new Map();
    if (!tasteMatchCtx?.ready) return map;
    for (const item of results) {
      if (!item || item.inVault) continue;
      const key = item.imdbID || item.tmdbId || item.Title;
      if (!key || map.has(key)) continue;
      const pred = predictMovieMatch({ movie: item, cachedContext: tasteMatchCtx });
      if (pred.available) map.set(key, pred);
    }
    return map;
  }, [results, tasteMatchCtx]);

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
      setPeopleResults([]);
      setUserResults([]);
      setListResults([]);
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
        const multi = await searchMultiEntity({
          query: trimmed,
          watched,
          watchlist,
          signal: controller.signal
        });
        if (!controller.signal.aborted) {
          setResults(multi.movies);
          setPeopleResults(multi.people);
          setUserResults(multi.users);
          setListResults(multi.lists);
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
  }, [query, isOpen, watched, watchlist]);

  const filteredResults = useMemo(() => {
    if (activeFilter === "people" || activeFilter === "community") return [];
    if (activeFilter === "vault") return results.filter((item) => item.inVault);
    if (activeFilter === "watchlist") return results.filter((item) => item.inWatchlist);
    return results;
  }, [results, activeFilter]);

  const navigableItems = useMemo(() => {
    if (activeFilter === "people") {
      return peopleResults.map((person) => ({ type: "person", item: person }));
    }
    if (activeFilter === "community") {
      return [
        ...userResults.map((user) => ({ type: "user", item: user })),
        ...listResults.map((list) => ({ type: "list", item: list }))
      ];
    }
    return filteredResults.map((movie) => ({ type: "movie", item: movie }));
  }, [activeFilter, peopleResults, userResults, listResults, filteredResults]);

  const filterCounts = useMemo(
    () => ({
      all: results.length + peopleResults.length + userResults.length + listResults.length,
      vault: results.filter((item) => item.inVault).length,
      watchlist: results.filter((item) => item.inWatchlist).length,
      people: peopleResults.length,
      community: userResults.length + listResults.length
    }),
    [results, peopleResults.length, userResults.length, listResults.length]
  );

  useEffect(() => {
    if (selectedIndex >= navigableItems.length && navigableItems.length > 0) {
      setSelectedIndex(0);
    }
  }, [navigableItems.length, selectedIndex]);

  useEffect(() => {
    if (activeFilter === "people" || activeFilter === "community") return;
    const activeRow = rowRefs.current[selectedIndex];
    if (activeRow && typeof activeRow.scrollIntoView === "function") {
      activeRow.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, activeFilter]);

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

  function openInExplore() {
    const clean = query.trim();
    if (!clean || !onExploreQuery) return;
    onExploreQuery(clean);
    onClose?.();
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose?.();
      return;
    }
    if (e.key === "Enter" && e.shiftKey && query.trim() && onExploreQuery) {
      e.preventDefault();
      openInExplore();
      return;
    }
    if (navigableItems.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % navigableItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + navigableItems.length) % navigableItems.length);
    } else if (e.key === "Enter") {
      const target = navigableItems[selectedIndex] || navigableItems[0];
      if (!target) return;
      e.preventDefault();
      if (target.type === "person") {
        navigate(`/person/${target.item.id}`);
        onClose?.();
      } else if (target.type === "user") {
        navigate(`/u/${target.item.username}`);
        onClose?.();
      } else if (target.type === "list") {
        navigate(`/list/${target.item.slug}`);
        onClose?.();
      } else {
        openFilmDetails(target.item);
      }
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
            placeholder="Search films, people, @users, or lists..."
            aria-label="Search films, people, users, or lists"
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
            <span className="search-esc-label-desktop">ESC</span>
            <X size={18} className="search-esc-icon-mobile" aria-hidden="true" />
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
            {onExploreQuery && (
              <button
                type="button"
                className="search-explore-all-btn"
                onClick={openInExplore}
                title={`Browse all "${trimmedQuery}" posters in Explore`}
              >
                <Compass size={13} aria-hidden="true" />
                <span>View all in Explore</span>
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        {!trimmedQuery ? (
          <div className="search-theater-empty">
            <div className="search-section-header">
              <span className="search-section-label">Popular Right Now</span>
              <span className="search-section-sub">
                <span className="search-sub-desktop">Click a poster to open or hover to rate</span>
                <span className="search-sub-mobile">Tap a poster to open</span>
              </span>
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

              {isLoading && filterCounts[activeFilter] === 0 ? (
                <div className="search-empty-state">
                  <Loader2 size={24} className="search-spinner-icon" aria-hidden="true" />
                  <p>Searching catalog...</p>
                </div>
              ) : filterCounts[activeFilter] === 0 ? (
                <div className="search-empty-state">
                  <Film size={28} aria-hidden="true" />
                  <p>
                    {results.length + peopleResults.length + userResults.length + listResults.length > 0
                      ? "No matches under this filter. Try switching to All."
                      : `No results found matching "${trimmedQuery}".`}
                  </p>
                </div>
              ) : (
                <div className="search-results-list" role="listbox" aria-label="Search results">
                  {(activeFilter === "all" || activeFilter === "people") && peopleResults.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2 px-1">
                      {peopleResults.map((person, idx) => {
                        const isFocused = activeFilter === "people" && idx === selectedIndex;
                        return (
                          <button
                            key={`person-${person.id}`}
                            type="button"
                            onMouseEnter={() => activeFilter === "people" && setSelectedIndex(idx)}
                            onClick={() => {
                              navigate(`/person/${person.id}`);
                              onClose?.();
                            }}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] border text-[1.25rem] text-[#f4f4f2] hover:border-white/30 cursor-pointer ${
                              isFocused ? "border-amber-300/75 ring-1 ring-amber-300/40" : "border-white/12"
                            }`}
                          >
                            <User size={13} className="text-amber-300" aria-hidden="true" />
                            <span>{person.name}</span>
                            <span className="text-[1.1rem] text-[#9e9e99]">{person.department}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {(activeFilter === "all" || activeFilter === "community") && (userResults.length > 0 || listResults.length > 0) && (
                    <div className="mb-3 flex flex-wrap gap-2 px-1">
                      {userResults.map((u, idx) => {
                        const isFocused = activeFilter === "community" && idx === selectedIndex;
                        return (
                          <button
                            key={`user-${u.user_id}`}
                            type="button"
                            onMouseEnter={() => activeFilter === "community" && setSelectedIndex(idx)}
                            onClick={() => {
                              navigate(`/u/${u.username}`);
                              onClose?.();
                            }}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border text-[1.25rem] text-emerald-200 hover:border-emerald-400/60 cursor-pointer ${
                              isFocused ? "border-emerald-300 ring-1 ring-emerald-300/40" : "border-emerald-500/30"
                            }`}
                          >
                            <Users size={13} aria-hidden="true" />
                            <span>@{u.username}</span>
                          </button>
                        );
                      })}
                      {listResults.map((l, idx) => {
                        const navIdx = userResults.length + idx;
                        const isFocused = activeFilter === "community" && navIdx === selectedIndex;
                        return (
                          <button
                            key={`list-${l.id}`}
                            type="button"
                            onMouseEnter={() => activeFilter === "community" && setSelectedIndex(navIdx)}
                            onClick={() => {
                              navigate(`/list/${l.slug}`);
                              onClose?.();
                            }}
                            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.05] border text-[1.25rem] text-[#f4f4f2] hover:border-white/30 cursor-pointer ${
                              isFocused ? "border-amber-300/75 ring-1 ring-amber-300/40" : "border-white/12"
                            }`}
                          >
                            <ListChecks size={13} className="text-amber-300" aria-hidden="true" />
                            <span>{l.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {(activeFilter === "all" || activeFilter === "vault" || activeFilter === "watchlist") &&
                    filteredResults.map((movie, idx) => {
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
                            {movie.inVault && movie.userRating != null ? (
                              <span className="search-badge-vault">★ {movie.userRating}/10</span>
                            ) : (() => {
                              const pred = matchPredictionsById.get(movie.imdbID || movie.tmdbId || movie.Title);
                              return pred ? (
                                <span
                                  className="text-[1.1rem] font-semibold text-[#46d369] bg-[#46d369]/10 border border-[#46d369]/25 px-[0.65rem] py-[0.15rem] rounded-[0.45rem] tabular-num shrink-0"
                                  title={pred.summary}
                                >
                                  {pred.matchPct}% match
                                </span>
                              ) : null;
                            })()}
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
            {trimmedQuery && onExploreQuery && (
              <span><kbd>Shift</kbd><kbd>Enter</kbd> view all in Explore</span>
            )}
            <span><kbd>Esc</kbd> close</span>
          </div>
          {trimmedQuery && (
            <span className="search-hint-count">
              {navigableItems.length} {navigableItems.length === 1 ? "result" : "results"}
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
