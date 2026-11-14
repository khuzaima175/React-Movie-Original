import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronRight,
  Compass,
  Grid,
  Layers,
  SkipForward,
  Star,
  Upload,
  X
} from "lucide-react";
import { useApp } from "../context/AppContext";
import PosterImage from "./PosterImage";
import { MetaLine } from "./ui";
import {
  getRatingTier,
  prepareQuickRatePayload,
  prepareWatchlistPayload,
  RATING_TIERS
} from "../services/ratingTiers";
import { buildTasteDeck } from "../services/tasteDeckService";

const QUICK_SCORE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export default function TasteDeckModal({
  isOpen,
  initialMode = "flashcards",
  livePool = [],
  onClose,
  onDismissForever,
  onOpenImport
}) {
  const navigate = useNavigate();
  const { watched = [], watchlist = [], addWatched, addToWatchlist } = useApp();

  const [mode, setMode] = useState(initialMode);
  const [deck, setDeck] = useState([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [hoverScore, setHoverScore] = useState(null);
  const [feedbackToast, setFeedbackToast] = useState("");
  const [sessionRatings, setSessionRatings] = useState({});
  const [sessionWatchlistIds, setSessionWatchlistIds] = useState({});

  const advanceTimerRef = useRef(null);
  const isAdvancingRef = useRef(false);

  const rebuildSessionDeck = () => {
    const nextDeck = buildTasteDeck({ watched, watchlist, livePool, deckSize: 30 });
    setDeck(nextDeck);
    setCardIndex(0);
    setHoverScore(null);
    setFeedbackToast("");
    isAdvancingRef.current = false;
  };

  useEffect(() => {
    if (!isOpen) {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      isAdvancingRef.current = false;
      return undefined;
    }

    setMode(initialMode || "flashcards");
    setSessionRatings({});
    setSessionWatchlistIds({});
    rebuildSessionDeck();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
    // Intentionally snapshot deck only when modal opens or initialMode changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialMode]);

  const currentCard = cardIndex < deck.length ? deck[cardIndex] : null;
  const sessionRatedCount = Object.keys(sessionRatings).length;

  const sessionTopGenres = useMemo(() => {
    const scores = new Map();
    for (const [id, score] of Object.entries(sessionRatings)) {
      if (score < 7) continue;
      const movie = deck.find((d) => d.imdbID === id);
      if (!movie?.primaryGenre) continue;
      scores.set(movie.primaryGenre, (scores.get(movie.primaryGenre) || 0) + score);
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([genre]) => genre);
  }, [sessionRatings, deck]);

  function handleRateMovie(movie, score, advanceCard = false) {
    if (!movie) return;
    if (advanceCard && isAdvancingRef.current) return;

    const payload = prepareQuickRatePayload(movie, score);
    if (!payload) return;
    addWatched?.(payload);

    const key = movie.imdbID || movie.id;
    setSessionRatings((prev) => ({ ...prev, [key]: score }));

    if (advanceCard) {
      isAdvancingRef.current = true;
      setFeedbackToast(`Saved ★ ${score}/10`);
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => {
        setFeedbackToast("");
        setHoverScore(null);
        setCardIndex((prev) => prev + 1);
        isAdvancingRef.current = false;
      }, 170);
    }
  }

  function handleSaveWatchlist(movie, advanceCard = false) {
    if (!movie) return;
    if (advanceCard && isAdvancingRef.current) return;

    const payload = prepareWatchlistPayload(movie);
    if (payload) addToWatchlist?.(payload);
    const key = movie.imdbID || movie.id;
    setSessionWatchlistIds((prev) => ({ ...prev, [key]: true }));

    if (advanceCard) {
      isAdvancingRef.current = true;
      setFeedbackToast("Saved to Watchlist");
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = setTimeout(() => {
        setFeedbackToast("");
        setCardIndex((prev) => prev + 1);
        isAdvancingRef.current = false;
      }, 150);
    }
  }

  function handleSkipCard() {
    if (isAdvancingRef.current) return;
    setHoverScore(null);
    setFeedbackToast("");
    setCardIndex((prev) => prev + 1);
  }

  function handlePrevCard() {
    if (isAdvancingRef.current || cardIndex <= 0) return;
    setHoverScore(null);
    setFeedbackToast("");
    setCardIndex((prev) => Math.max(0, prev - 1));
  }

  function handleDismissAll() {
    onDismissForever?.();
    onClose?.();
  }

  useEffect(() => {
    if (!isOpen) return undefined;

    function onKeyDown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = String(document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      if (e.key === "Escape") {
        e.preventDefault();
        handleDismissAll();
        return;
      }

      if (mode !== "flashcards" || !currentCard) return;

      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault();
        handleRateMovie(currentCard, Number(e.key), true);
      } else if (e.key === "0") {
        e.preventDefault();
        handleRateMovie(currentCard, 10, true);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrevCard();
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSkipCard();
      } else if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        handleSaveWatchlist(currentCard, true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, currentCard, cardIndex]);

  if (!isOpen) return null;

  const currentExistingScore = currentCard
    ? sessionRatings[currentCard.imdbID || currentCard.id] ?? null
    : null;
  const displayedScore = hoverScore ?? currentExistingScore ?? 0;
  const activeTier = getRatingTier(displayedScore);
  const progressPct = deck.length > 0
    ? Math.min(100, Math.round((Math.min(cardIndex, deck.length) / deck.length) * 100))
    : 100;

  const modalNode = (
    <div
      className="taste-deck-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Taste calibration deck"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismissAll();
      }}
    >
      <div className="taste-deck-shell" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="taste-deck-header">
          <div className="taste-deck-brand">
            <div className="taste-deck-title-row">
              <h2 className="taste-deck-title">Taste Calibration</h2>
              <span className="taste-deck-counter">
                Rated {sessionRatedCount} this session • {watched.length} in Vault
              </span>
            </div>
            <p className="taste-deck-subtitle">
              Score a handful of recognizable films so recommendations know your taste right away.
            </p>
          </div>

          <div className="taste-deck-header-controls">
            <div className="taste-deck-mode-tabs" role="tablist" aria-label="Calibration view mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "flashcards"}
                className={`taste-deck-mode-btn ${mode === "flashcards" ? "active" : ""}`}
                onClick={() => setMode("flashcards")}
              >
                <Layers size={14} aria-hidden="true" />
                <span>Flashcard Deck (Fast 30)</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "grid"}
                className={`taste-deck-mode-btn ${mode === "grid" ? "active" : ""}`}
                onClick={() => setMode("grid")}
              >
                <Grid size={14} aria-hidden="true" />
                <span>20+ Film Wall</span>
              </button>
            </div>

            {onOpenImport && (
              <button
                type="button"
                className="taste-deck-import-btn"
                onClick={() => {
                  onClose?.();
                  onOpenImport();
                }}
              >
                <Upload size={14} aria-hidden="true" />
                <span>Import Ratings (CSV / JSON)</span>
              </button>
            )}

            <button
              type="button"
              className="taste-deck-skip-btn"
              onClick={handleDismissAll}
            >
              <span>Done / Skip</span>
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Body */}
        {mode === "flashcards" ? (
          <div className="taste-deck-flash-body">
            {currentCard ? (
              <>
                <div className="taste-deck-progress-wrap">
                  <div className="taste-deck-progress-bar">
                    <div
                      className="taste-deck-progress-fill"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="taste-deck-progress-meta">
                    <span>
                      Film {cardIndex + 1} of {deck.length} • {currentCard.primaryGenre}
                    </span>
                    {feedbackToast && (
                      <span className="taste-deck-feedback-pill">
                        <Check size={12} aria-hidden="true" />
                        {feedbackToast}
                      </span>
                    )}
                  </div>
                </div>

                <div className="taste-deck-card-stage">
                  <div className="taste-deck-stage-poster">
                    <PosterImage
                      src={currentCard.poster}
                      title={currentCard.title}
                      alt={`${currentCard.title} poster`}
                    />
                  </div>

                  <div className="taste-deck-stage-info">
                    <MetaLine
                      items={[currentCard.primaryGenre, currentCard.year, currentCard.runtime]}
                      rating={currentCard.imdbRating}
                      ratingTone="neutral"
                    />

                    <h3 className="taste-deck-movie-title display-title">{currentCard.title}</h3>
                    {currentCard.director && (
                      <p className="taste-deck-director">Directed by {currentCard.director}</p>
                    )}
                    {currentCard.plot && (
                      <p className="taste-deck-plot">{currentCard.plot}</p>
                    )}

                    {/* 1-Click 1-10 Rating Bar */}
                    <div className="taste-deck-rating-panel">
                      <div className="taste-deck-rating-caption">
                        <span>Click 1–10 or press keys 1–9, 0 (=10)</span>
                        <span
                          className="taste-deck-tier-label"
                          style={{ color: activeTier.color }}
                        >
                          {displayedScore > 0 ? `${displayedScore}/10 — ${activeTier.label}` : activeTier.label}
                        </span>
                      </div>

                      <div className="taste-deck-score-row">
                        {QUICK_SCORE_VALUES.map((num) => {
                          const tierColor = RATING_TIERS[num]?.color || "#e5b84b";
                          const isSelected = currentExistingScore === num;
                          return (
                            <button
                              key={num}
                              type="button"
                              className={`taste-deck-score-btn ${isSelected ? "selected" : ""}`}
                              style={{ "--tier-accent": tierColor }}
                              onMouseEnter={() => setHoverScore(num)}
                              onMouseLeave={() => setHoverScore(null)}
                              onClick={() => handleRateMovie(currentCard, num, true)}
                              aria-label={`Rate ${currentCard.title} ${num} out of 10`}
                            >
                              {num}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="taste-deck-actions">
                      <button
                        type="button"
                        className="taste-deck-nav-btn"
                        onClick={handlePrevCard}
                        disabled={cardIndex === 0}
                      >
                        <ArrowLeft size={15} aria-hidden="true" />
                        <span>Previous</span>
                      </button>

                      <button
                        type="button"
                        className={`taste-deck-nav-btn ${sessionWatchlistIds[currentCard.imdbID || currentCard.id] || currentCard.inWatchlist ? "saved" : ""}`}
                        onClick={() => handleSaveWatchlist(currentCard, true)}
                      >
                        <Bookmark size={15} aria-hidden="true" />
                        <span>
                          {sessionWatchlistIds[currentCard.imdbID || currentCard.id] || currentCard.inWatchlist
                            ? "Watchlisted (Next)"
                            : "Watchlist (W)"}
                        </span>
                      </button>

                      <button
                        type="button"
                        className="taste-deck-nav-btn skip"
                        onClick={handleSkipCard}
                      >
                        <span>Skip / Haven&apos;t Seen (S)</span>
                        <SkipForward size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="taste-deck-complete">
                <div className="taste-deck-complete-badge">
                  <Check size={24} aria-hidden="true" />
                </div>
                <h3>Deck Complete</h3>
                <p>
                  You logged <strong>{sessionRatedCount}</strong> {sessionRatedCount === 1 ? "rating" : "ratings"} this session
                  {watched.length > 0 ? ` (${watched.length} total in Vault)` : ""}.
                </p>

                {sessionTopGenres.length > 0 && (
                  <div className="taste-deck-summary-genres">
                    {sessionTopGenres.map((genre) => (
                      <span key={genre} className="taste-deck-genre-badge">{genre}</span>
                    ))}
                  </div>
                )}

                <div className="taste-deck-complete-actions">
                  <button
                    type="button"
                    className="taste-deck-primary-cta"
                    onClick={() => {
                      handleDismissAll();
                      navigate("/ai");
                    }}
                  >
                    <Compass size={16} aria-hidden="true" />
                    <span>View Personalized Recommendations</span>
                  </button>
                  <button
                    type="button"
                    className="taste-deck-secondary-cta"
                    onClick={() => {
                      handleDismissAll();
                      navigate("/");
                    }}
                  >
                    <span>Explore Home</span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="taste-deck-secondary-cta"
                    onClick={rebuildSessionDeck}
                  >
                    <span>Load Fresh Deck</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Mode B: 20+ Film Multi-Genre Grid Wall */
          <div className="taste-deck-grid-body">
            <div className="taste-deck-wall-grid">
              {deck.map((movie) => {
                const key = movie.imdbID || movie.id;
                const ratedValue = sessionRatings[key] ?? null;
                const isSavedWatchlist = Boolean(sessionWatchlistIds[key] || movie.inWatchlist);

                return (
                  <article key={key} className="taste-deck-wall-card">
                    <div className="taste-deck-wall-poster">
                      <PosterImage
                        src={movie.poster}
                        title={movie.title}
                        alt={`${movie.title} poster`}
                      />
                      <span className="taste-deck-wall-genre">{movie.primaryGenre}</span>
                      {ratedValue != null && (
                        <span className="taste-deck-wall-rated-badge">★ {ratedValue}/10</span>
                      )}
                      {ratedValue == null && (
                        <button
                          type="button"
                          className={`taste-deck-wall-bookmark ${isSavedWatchlist ? "saved" : ""}`}
                          onClick={() => handleSaveWatchlist(movie, false)}
                          title={isSavedWatchlist ? "In Watchlist" : "Save to Watchlist"}
                          aria-label={`Save ${movie.title} to watchlist`}
                        >
                          <Bookmark size={13} fill={isSavedWatchlist ? "currentColor" : "none"} />
                        </button>
                      )}
                    </div>

                    <div className="taste-deck-wall-meta">
                      <h4 className="taste-deck-wall-title" title={movie.title}>{movie.title}</h4>
                      <span className="taste-deck-wall-year">{movie.year}</span>
                    </div>

                    <div className="taste-deck-wall-scores" aria-label={`Rate ${movie.title}`}>
                      {QUICK_SCORE_VALUES.map((num) => (
                        <button
                          key={num}
                          type="button"
                          className={`taste-deck-wall-score-btn ${ratedValue === num ? "selected" : ""}`}
                          onClick={() => handleRateMovie(movie, num, false)}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>

            <footer className="taste-deck-grid-footer">
              <button
                type="button"
                className="taste-deck-secondary-cta"
                onClick={() => setMode("flashcards")}
              >
                <Layers size={15} aria-hidden="true" />
                <span>Switch to Flashcards</span>
              </button>
              <button
                type="button"
                className="taste-deck-primary-cta"
                onClick={() => {
                  handleDismissAll();
                  navigate("/ai");
                }}
              >
                <Compass size={16} aria-hidden="true" />
                <span>Done — View Picks ({sessionRatedCount} rated)</span>
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(modalNode, document.body);
  }
  return modalNode;
}
