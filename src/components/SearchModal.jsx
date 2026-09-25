import { useState, useEffect, useRef } from "react";
import { Search, X, Film, Sparkles, Command, ArrowRight, CornerDownLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import PosterImage from "./PosterImage";
import { useDebounce } from "../hooks/useDebounce";

const POPULAR_SUGGESTIONS = [
  "Inception", "The Dark Knight", "Interstellar", "Dune", "Oppenheimer", "Pulp Fiction", "Avatar", "The Matrix"
];

export default function SearchModal({ isOpen, onClose, onSelectMovie, API_KEY }) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      document.body.style.overflow = "hidden";
      setSelectedIndex(0);
    } else {
      setQuery("");
      setResults([]);
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
      if (!isOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
      } else if (e.key === "Enter" && results.length > 0) {
        e.preventDefault();
        const selected = results[selectedIndex] || results[0];
        if (selected) {
          onSelectMovie(selected.imdbID);
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, results, selectedIndex, onSelectMovie]);

  // Fetch OMDb Search Results
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.trim().length < 3) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    async function searchMovies() {
      try {
        setIsLoading(true);
        const omdbKey = API_KEY || import.meta.env.VITE_OMDB_KEY || "";
        const tmdbKey = import.meta.env.VITE_TMDB_KEY || "";

        // 1. Try OMDb search if key is provided
        if (omdbKey) {
          try {
            const res = await fetch(
              `https://www.omdbapi.com/?apikey=${omdbKey}&s=${encodeURIComponent(debouncedQuery.trim())}`,
              { signal: controller.signal, cache: "no-store" }
            );
            if (res.ok) {
              const data = await res.json();
              if (data.Response === "True" && Array.isArray(data.Search)) {
                setResults(data.Search);
                setSelectedIndex(0);
                setIsLoading(false);
                return;
              }
            }
          } catch (_) {}
        }

        // 2. Fallback to TMDB search if TMDB key is provided
        if (tmdbKey) {
          try {
            const res = await fetch(
              `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${encodeURIComponent(debouncedQuery.trim())}&include_adult=false`,
              { signal: controller.signal, cache: "no-store" }
            );
            if (res.ok) {
              const data = await res.json();
              if (data.results && Array.isArray(data.results) && data.results.length > 0) {
                const mapped = data.results.slice(0, 10).map((m) => ({
                  imdbID: `tmdb_${m.id}`,
                  Title: m.title,
                  Year: m.release_date ? m.release_date.slice(0, 4) : "N/A",
                  Poster: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
                  Type: "movie"
                }));
                setResults(mapped);
                setSelectedIndex(0);
                setIsLoading(false);
                return;
              }
            }
          } catch (_) {}
        }

        setResults([]);
      } catch (err) {
        if (err.name !== "AbortError") {
          setResults([]);
        }
      } finally {
        setIsLoading(false);
      }
    }

    searchMovies();
    return () => {
      controller.abort();
    };
  }, [debouncedQuery, API_KEY]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="search-modal-backdrop"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Search movies"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <motion.div
            className="search-spotlight-card"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -16 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Input Header */}
            <div className="search-input-header">
              <Search className="search-header-icon" size={22} aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                className="search-main-input"
                placeholder="Search films, series, directors, or keywords..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search movies query"
              />
              {query && (
                <button
                  className="search-btn-clear"
                  onClick={() => setQuery("")}
                  aria-label="Clear search query"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              )}
              <button
                onClick={onClose}
                className="search-badge-esc"
                aria-label="Close search"
              >
                ESC
              </button>
            </div>

            {/* Results / Discovery Viewport */}
            <div className="search-results-viewport custom-scrollbar">
              {isLoading && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1.2rem", padding: "4.8rem 0", color: "#8a8a86", fontSize: "1.4rem" }}>
                  <Sparkles size={20} className="spin-icon" style={{ color: "#e2b13c" }} aria-hidden="true" />
                  <span>Searching cinema database...</span>
                </div>
              )}

              {!isLoading && results.length > 0 && (
                <div>
                  <div className="search-section-label">
                    <Film size={14} style={{ color: "#e2b13c" }} aria-hidden="true" />
                    <span>Search Results ({results.length} titles)</span>
                  </div>
                  <div>
                    {results.map((m, index) => {
                      const isSelected = selectedIndex === index;
                      return (
                        <div
                          key={m.imdbID}
                          className="search-result-item"
                          style={{
                            backgroundColor: isSelected ? "#1c1d20" : "transparent",
                            borderColor: isSelected ? "rgba(226, 177, 60, 0.3)" : "transparent"
                          }}
                          onClick={() => {
                            onSelectMovie(m.imdbID);
                            onClose();
                          }}
                          onMouseEnter={() => setSelectedIndex(index)}
                          tabIndex={0}
                          role="button"
                        >
                          <div className="search-poster-thumb">
                            <PosterImage
                              src={m.Poster}
                              title={m.Title}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <div className="search-item-info">
                            <h4 className="search-item-title">{m.Title}</h4>
                            <div className="search-item-meta">
                              <span className="search-item-year">{m.Year}</span>
                              <span style={{ color: "rgba(255,255,255,0.2)" }}>•</span>
                              <span className="search-item-type">{m.Type || "Movie"}</span>
                            </div>
                          </div>
                          <div style={{ opacity: isSelected ? 1 : 0, transition: "opacity 0.2s", color: "#e2b13c" }}>
                            <CornerDownLeft size={16} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!isLoading && query.length >= 3 && results.length === 0 && (
                <div style={{ padding: "4.8rem 0", textAlign: "center", color: "#8a8a86", fontSize: "1.4rem" }}>
                  <p style={{ fontWeight: 600, color: "#f4f4f2", fontSize: "1.5rem" }}>No films found matching "{query}"</p>
                  <p style={{ fontSize: "1.3rem", marginTop: "0.6rem", color: "#8a8a86" }}>
                    Try checking the spelling or searching by a different title
                  </p>
                </div>
              )}

              {!isLoading && query.length < 3 && (
                <div>
                  <div className="search-section-label">
                    <Command size={14} style={{ color: "#e2b13c" }} aria-hidden="true" />
                    <span>Trending Discoveries</span>
                  </div>
                  <div className="search-trending-chips">
                    {POPULAR_SUGGESTIONS.map((term) => (
                      <button
                        key={term}
                        onClick={() => setQuery(term)}
                        className="search-trending-chip"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Keyboard Guide Footer */}
            <div className="search-hint-footer">
              <div style={{ display: "flex", alignItems: "center", gap: "1.4rem" }}>
                <span><kbd style={{ padding: "0.2rem 0.5rem", borderRadius: "0.4rem", background: "rgba(255,255,255,0.08)", fontSize: "1.1rem" }}>↑↓</kbd> to navigate</span>
                <span><kbd style={{ padding: "0.2rem 0.5rem", borderRadius: "0.4rem", background: "rgba(255,255,255,0.08)", fontSize: "1.1rem" }}>↵</kbd> to select</span>
                <span><kbd style={{ padding: "0.2rem 0.5rem", borderRadius: "0.4rem", background: "rgba(255,255,255,0.08)", fontSize: "1.1rem" }}>esc</kbd> to close</span>
              </div>
              <span style={{ color: "#e2b13c", fontWeight: 500 }}>CinemaVault Spotlight</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
