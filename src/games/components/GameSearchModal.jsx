import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Gamepad2, ArrowRight } from "lucide-react";
import { searchGames } from "../services/igdbService";
import { loadGameModelBundle } from "../services/gameModelService";
import { loadGameVault } from "../services/gameVaultStorage";
import { rankGameCandidates } from "../services/gameRankerService";
import { EASE } from "../../motion";
import "../styles/games.css";

export default function GameSearchModal({ isOpen, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const mlCtxRef = useRef({ loaded: false, played: [], backlog: [], models: null });
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen) return undefined;
    window.setTimeout(() => inputRef.current?.focus(), 40);

    // Lazily warm local ML models + vault so search results display instant personal Match %
    if (!mlCtxRef.current.loaded) {
      Promise.all([loadGameVault(), loadGameModelBundle()])
        .then(([vault, models]) => {
          mlCtxRef.current = {
            loaded: true,
            played: vault.played || [],
            backlog: vault.backlog || [],
            models
          };
        })
        .catch(() => {});
    }

    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) {
      setResults([]);
      setError("");
      setLoading(false);
      setActiveIdx(0);
      return undefined;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      searchGames(clean, { limit: 12, signal: ctrl.signal })
        .then((items) => {
          const ctx = mlCtxRef.current;
          if (ctx.loaded && ctx.played.length > 0 && ctx.models && items.length > 0) {
            const ranked = rankGameCandidates(items, ctx.played, ctx.backlog, ctx.models);
            const scoreById = new Map(ranked.map((r) => [r.igdbId, r]));
            setResults(
              items.map((g) => ({
                ...g,
                matchScore: scoreById.get(g.igdbId)?.matchScore ?? null,
                estRating: scoreById.get(g.igdbId)?.estRating ?? null
              }))
            );
          } else {
            setResults(items);
          }
          setActiveIdx(0);
        })
        .catch((err) => {
          if (err?.name !== "AbortError") setError("Could not search IGDB right now.");
        })
        .finally(() => setLoading(false));
    }, 200);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  function openGame(igdbId) {
    onClose?.();
    navigate(`/game/${igdbId}`);
  }

  function handleInputKeyDown(e) {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && results[activeIdx]) {
      e.preventDefault();
      openGame(results[activeIdx].igdbId);
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="gv-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Search games"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <motion.div
            className="gv-modal"
            style={{ maxWidth: "62rem" }}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            <div className="flex items-center gap-3 pb-4 border-b border-hairline">
              <Search size={18} className="text-text-3 shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search IGDB games (e.g. Bloodborne, Balatro, Zelda, Elden Ring)..."
                className="w-full bg-transparent text-[1.55rem] text-text-1 placeholder:text-text-3 focus:outline-none"
              />
              <button type="button" className="gv-btn gv-btn-sm shrink-0" onClick={onClose} aria-label="Close search">
                <X size={15} />
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-2" style={{ minHeight: "18rem" }}>
              {loading && <p className="text-[1.3rem] text-text-3 py-6 text-center">Searching IGDB catalog...</p>}
              {error && <p className="text-[1.3rem] text-danger py-4 text-center">{error}</p>}
              {!loading && !error && query.trim().length < 2 && (
                <p className="text-[1.3rem] text-text-3 py-8 text-center">
                  Type at least 2 characters to search PC, PlayStation, Nintendo &amp; Xbox games.
                </p>
              )}
              {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
                <p className="text-[1.3rem] text-text-3 py-8 text-center">No matching games found.</p>
              )}

              {results.map((game, idx) => (
                <button
                  key={game.igdbId}
                  type="button"
                  onClick={() => openGame(game.igdbId)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={`gv-search-result-row ${idx === activeIdx ? "is-highlighted" : ""}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {game.coverUrl ? (
                      <img
                        src={game.coverUrl}
                        alt={game.title}
                        className="shrink-0 bg-surface-3"
                        style={{ width: "4.2rem", height: "5.6rem", objectFit: "cover", borderRadius: "5px", display: "block" }}
                      />
                    ) : (
                      <div className="shrink-0 flex items-center justify-center bg-surface-3 rounded" style={{ width: "4.2rem", height: "5.6rem" }}>
                        <Gamepad2 size={18} className="text-text-3" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-[1.45rem] font-semibold text-text-1 truncate">{game.title}</div>
                      <div className="text-[1.2rem] text-text-3 truncate">
                        {[game.year, ...(game.genres || []).slice(0, 2), ...(game.platforms || []).slice(0, 3)]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {Number.isFinite(Number(game.matchScore)) && (
                      <span className="gv-badge-match tabular-num">{game.matchScore}%</span>
                    )}
                    {game.rating10 && <span className="gv-badge-rating tabular-num">{game.rating10.toFixed(1)}</span>}
                    <ArrowRight size={15} className="text-text-3" />
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-hairline flex items-center justify-between text-[1.15rem] text-text-3">
              <span>↑↓ navigate · ↵ open dossier · esc close</span>
              <span>Powered by IGDB v4 + Local ML Match</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
