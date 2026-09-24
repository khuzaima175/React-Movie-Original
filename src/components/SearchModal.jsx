import { useState, useEffect, useRef } from "react";
import { Search, X, Film, Sparkles, Command } from "lucide-react";
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
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 80);
      document.body.style.overflow = "hidden";
    } else {
      setQuery("");
      setResults([]);
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

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
        setError("");
        const keyToUse = API_KEY || import.meta.env.VITE_OMDB_KEY || "b78bdecd";
        const res = await fetch(
          `https://www.omdbapi.com/?apikey=${keyToUse}&s=${encodeURIComponent(debouncedQuery.trim())}`,
          { signal: controller.signal, cache: "no-store" }
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

    searchMovies();
    return () => {
      controller.abort();
    };
  }, [debouncedQuery, API_KEY]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-start justify-center p-4 pt-20 md:pt-28 bg-black/80 backdrop-blur-md overflow-y-auto"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Search movies"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="w-full max-w-2xl rounded-2xl bg-[#141416] border border-white/10 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -16 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Borderless Search Input Bar */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 bg-[#1c1d20]">
              <Search className="text-[#8a8a86] flex-shrink-0" size={20} aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                className="flex-1 bg-transparent text-base md:text-lg text-[#f4f4f2] placeholder:text-[#8a8a86] outline-none border-none focus:outline-none focus:ring-0"
                placeholder="Search films, series, or directors..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search movies query"
              />
              {query && (
                <button
                  className="p-1 rounded-md text-[#8a8a86] hover:text-[#f4f4f2] hover:bg-[#242528] transition-colors"
                  onClick={() => setQuery("")}
                  aria-label="Clear search query"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
              <button
                onClick={onClose}
                className="px-2 py-0.5 text-xs font-mono font-medium rounded border border-white/10 bg-[#242528] text-[#8a8a86] hover:text-[#f4f4f2] transition-colors"
                aria-label="Close search"
              >
                ESC
              </button>
            </div>

            {/* Results / Suggestions Body */}
            <div className="max-h-[60vh] overflow-y-auto p-4 custom-scrollbar">
              {isLoading && (
                <div className="flex items-center justify-center gap-3 py-12 text-sm text-[#8a8a86]">
                  <Sparkles size={18} className="animate-spin text-[#e2b13c]" aria-hidden="true" />
                  <span>Searching cinema database...</span>
                </div>
              )}

              {!isLoading && results.length > 0 && (
                <div className="space-y-1.5">
                  <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-[#8a8a86] flex items-center gap-1.5">
                    <Film size={13} aria-hidden="true" />
                    <span>Search Results ({results.length})</span>
                  </div>
                  <div className="space-y-1">
                    {results.map((m) => (
                      <div
                        key={m.imdbID}
                        className="group flex items-center gap-3.5 p-2 rounded-lg hover:bg-[#1c1d20] transition-colors cursor-pointer border border-transparent hover:border-white/10"
                        onClick={() => {
                          onSelectMovie(m.imdbID);
                          onClose();
                        }}
                        tabIndex={0}
                        role="button"
                      >
                        {/* 40x60 poster thumbnail */}
                        <div className="w-10 h-[60px] flex-shrink-0 rounded overflow-hidden bg-[#242528] border border-white/10">
                          <PosterImage
                            src={m.Poster}
                            title={m.Title}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold text-[#f4f4f2] truncate group-hover:text-[#e2b13c] transition-colors">
                            {m.Title}
                          </h4>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-[#8a8a86]">
                            <span className="tabular-nums font-mono">{m.Year}</span>
                            <span className="text-white/20">•</span>
                            <span className="capitalize">{m.Type || "Movie"}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isLoading && query.length >= 3 && results.length === 0 && (
                <div className="py-12 text-center text-sm text-[#8a8a86]">
                  <p>No films found matching "{query}"</p>
                  <p className="text-xs mt-1 text-[#8a8a86]/70">Try checking the spelling or searching by a different title</p>
                </div>
              )}

              {!isLoading && query.length < 3 && (
                <div className="py-2 space-y-3">
                  <div className="px-2 text-xs font-semibold uppercase tracking-wider text-[#8a8a86] flex items-center gap-1.5">
                    <Command size={13} aria-hidden="true" />
                    <span>Trending Searches</span>
                  </div>
                  <div className="flex flex-wrap gap-2 px-2">
                    {POPULAR_SUGGESTIONS.map((term) => (
                      <button
                        key={term}
                        onClick={() => setQuery(term)}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-white/10 bg-[#1c1d20] text-[#b6b6b2] hover:text-[#f4f4f2] hover:bg-[#242528] hover:border-white/20 transition-all"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
