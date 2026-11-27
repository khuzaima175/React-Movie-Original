import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Gamepad2, ArrowRight } from "lucide-react";
import { searchGames } from "../services/igdbService";
import "../styles/games.css";

export default function GameSearchModal({ isOpen, onClose }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen) return;
    setTimeout(() => inputRef.current?.focus(), 40);
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
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      searchGames(clean, { limit: 12, signal: ctrl.signal })
        .then((items) => setResults(items))
        .catch((err) => {
          if (err?.name !== "AbortError") setError("Could not search IGDB right now.");
        })
        .finally(() => setLoading(false));
    }, 220);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  if (!isOpen) return null;

  function openGame(igdbId) {
    onClose?.();
    navigate(`/game/${igdbId}`);
  }

  return (
    <div className="gv-modal-backdrop" role="dialog" aria-modal="true" aria-label="Search games" onClick={onClose}>
      <div className="gv-modal" style={{ maxWidth: "60rem" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 pb-4 border-b border-hairline">
          <Search size={18} className="text-text-3 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search IGDB games (e.g. Bloodborne, Balatro, Zelda, Elden Ring)..."
            className="w-full bg-transparent text-[1.55rem] text-text-1 placeholder:text-text-3 focus:outline-none"
          />
          <button type="button" className="gv-btn gv-btn-sm" onClick={onClose} aria-label="Close search">
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

          {results.map((game) => (
            <button
              key={game.igdbId}
              type="button"
              onClick={() => openGame(game.igdbId)}
              className="flex items-center justify-between gap-4 p-3 rounded-lg bg-surface-2/60 hover:bg-surface-3 border border-hairline text-left transition cursor-pointer"
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
              <div className="flex items-center gap-3 shrink-0">
                {game.rating10 && <span className="gv-badge-rating">{game.rating10.toFixed(1)}</span>}
                <ArrowRight size={15} className="text-text-3" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
