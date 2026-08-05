import { useState, useEffect, useRef } from "react";
import { Search, X, Film, Star, Command, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PosterImage from "./PosterImage";

const POPULAR_SUGGESTIONS = [
  "Inception", "The Dark Knight", "Interstellar", "Dune", "Oppenheimer", "Pulp Fiction", "Avatar", "The Matrix"
];

export default function SearchModal({ isOpen, onClose, onSelectMovie, API_KEY }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
      setResults([]);
    }
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) onClose();
        else {
          // Open signal handled by parent or modal
        }
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    async function searchMovies() {
      try {
        setIsLoading(true);
        setError("");
        const keyToUse = API_KEY || "b78bdecd";
        const res = await fetch(
          `https://www.omdbapi.com/?apikey=${keyToUse}&s=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("Search network failed");
        const data = await res.json();
        if (data.Response === "True") {
          setResults(data.Search || []);
        } else {
          setResults([]);
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setError("No matching films found");
        }
      } finally {
        setIsLoading(false);
      }
    }

    const timer = setTimeout(searchMovies, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, API_KEY]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="search-modal-backdrop" onClick={onClose} aria-label="Close search overlay">
        <motion.div
          className="search-modal-container"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -20 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-label="Command palette search"
        >
          <div className="search-modal-input-bar">
            <Search className="search-modal-icon" size={20} aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className="search-modal-input"
              placeholder="Search movies, series, or directors..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search movies input"
            />
            {query && (
              <button
                className="search-modal-clear"
                onClick={() => setQuery("")}
                aria-label="Clear search text"
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
            <button className="search-modal-close" onClick={onClose} aria-label="Close search modal">
              <kbd>ESC</kbd>
            </button>
          </div>

          <div className="search-modal-body">
            {isLoading && (
              <div className="search-modal-loading">
                <Sparkles size={24} className="icon-spin-sparkle" aria-hidden="true" />
                <span>Searching cinema database...</span>
              </div>
            )}

            {!isLoading && results.length > 0 && (
              <div className="search-modal-results">
                <div className="search-modal-section-title">
                  <Film size={14} aria-hidden="true" /> Search Results ({results.length})
                </div>
                {results.map((m) => (
                  <div
                    key={m.imdbID}
                    className="search-modal-result-item"
                    onClick={() => {
                      onSelectMovie(m.imdbID);
                      onClose();
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <div className="search-result-poster">
                      <PosterImage src={m.Poster} title={m.Title} alt="" />
                    </div>
                    <div className="search-result-info">
                      <h4 className="search-result-title">{m.Title}</h4>
                      <div className="search-result-meta">
                        <span>{m.Year}</span>
                        <span className="search-result-type">{m.Type}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isLoading && query.length < 3 && (
              <div className="search-modal-suggestions">
                <div className="search-modal-section-title">
                  <Command size={14} aria-hidden="true" /> Trending Queries
                </div>
                <div className="search-modal-chips">
                  {POPULAR_SUGGESTIONS.map((term) => (
                    <button
                      key={term}
                      className="search-modal-chip"
                      onClick={() => setQuery(term)}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
