import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Star, Plus, Check, Info, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { buildSeenCollisionSet } from "../services/dashboardService";
import { buildQuickAddWatchedMovie } from "../services/csvImport";

export default function HeroBillboard({
  slides = [],
  watched = [],
  watchlist = [],
  onAddWatched,
  onAddToWatchlist
}) {
  const navigate = useNavigate();
  const activeSlides = Array.isArray(slides) ? slides : [];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    setCurrentIndex((prev) => (activeSlides.length === 0 ? 0 : prev % activeSlides.length));
  }, [activeSlides.length]);

  useEffect(() => {
    if (isPaused || activeSlides.length <= 1) return;
    const isReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (isReducedMotion) return;

    const timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) {
        setCurrentIndex((prev) => (prev + 1) % activeSlides.length);
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [isPaused, activeSlides.length]);

  if (activeSlides.length === 0) {
    return (
      <div className="hero-billboard" aria-label="Featured Film Billboard">
        <div className="hero-scrim-left" />
        <div className="hero-scrim-bottom" />
        <div className="hero-content">
          <div className="hero-text-block">
            <div className="hero-meta-badges">
              <span className="hero-badge-featured">Personal Cinema Vault</span>
            </div>
            <h1 className="hero-title">Discover Your Next Film</h1>
            <p className="hero-plot">
              Curated unwatched spotlights and recommendations calibrated to your vault ratings.
            </p>
            <div className="hero-actions">
              <button
                className="btn-hero-primary"
                onClick={() => navigate("/ai")}
              >
                <Sparkles size={18} aria-hidden="true" /> Ask AI Oracle
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const safeIndex = currentIndex % activeSlides.length;
  const slide = activeSlides[safeIndex];
  const slideId = slide.imdbID || slide.id || (slide.tmdbId ? `tmdb_${slide.tmdbId}` : "");

  const watchedSet = buildSeenCollisionSet(watched, []);
  const watchlistSet = buildSeenCollisionSet([], watchlist);
  const slideKeys = buildSeenCollisionSet([slide], []);

  const isWatched = [...slideKeys].some((k) => watchedSet.has(k));
  const isWatchlisted = [...slideKeys].some((k) => watchlistSet.has(k));

  function handlePrimaryAction() {
    if (!slide) return;
    const payload = buildQuickAddWatchedMovie(slide);
    if (!isWatched && onAddToWatchlist) {
      if (!isWatchlisted) {
        onAddToWatchlist({ ...payload, userRating: 0 });
      }
      return;
    }
    if (!isWatched && onAddWatched) {
      onAddWatched(payload);
    }
  }

  const primaryAdded = isWatched || (onAddToWatchlist ? isWatchlisted : false);
  const primaryLabel = isWatched
    ? "In Vault"
    : onAddToWatchlist
      ? (isWatchlisted ? "In Watchlist" : "Plan to Watch")
      : "Add to Vault";

  const hasBackdrop = Boolean(slide.backdrop && !/unsplash\.com/i.test(slide.backdrop));

  return (
    <div
      className="hero-billboard"
      aria-label="Featured Film Billboard"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      <AnimatePresence mode="wait">
        {hasBackdrop ? (
          <motion.div
            key={`bd-${slideId || safeIndex}`}
            className="hero-backdrop"
            style={{ backgroundImage: `url(${slide.backdrop})` }}
            initial={{ opacity: 0, scale: 1.03 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          />
        ) : (
          <motion.div
            key={`blur-${slideId || safeIndex}`}
            className="hero-backdrop-blurred"
            style={slide.poster ? { backgroundImage: `url(${slide.poster})` } : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          />
        )}
      </AnimatePresence>

      <div className="hero-scrim-left" />
      <div className="hero-scrim-bottom" />

      <div className="hero-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={`txt-${slideId || safeIndex}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.35 }}
            className="hero-text-block"
          >
            <div className="hero-meta-badges">
              <span className="hero-badge-featured">Spotlight Pick</span>
              {slide.imdbRating && (
                <span className="hero-rating">
                  <Star size={14} className="icon-star-gold" aria-hidden="true" />
                  {slide.imdbRating}
                </span>
              )}
              {slide.year && slide.year !== "N/A" && <span className="hero-meta-item">{slide.year}</span>}
              {slide.runtime && <span className="hero-meta-item">{slide.runtime}</span>}
            </div>

            <h1 className="hero-title">{slide.title}</h1>
            {slide.genre && <p className="hero-genre">{slide.genre}</p>}
            {slide.plot && <p className="hero-plot">{slide.plot}</p>}

            <div className="hero-actions">
              {(onAddToWatchlist || onAddWatched) && (
                <button
                  className={`btn-hero-primary ${primaryAdded ? "added" : ""}`}
                  onClick={handlePrimaryAction}
                  aria-label={`${primaryLabel}: ${slide.title}`}
                >
                  {primaryAdded ? (
                    <>
                      <Check size={18} aria-hidden="true" /> {primaryLabel}
                    </>
                  ) : (
                    <>
                      <Plus size={18} aria-hidden="true" /> {primaryLabel}
                    </>
                  )}
                </button>
              )}

              {slideId && (
                <button
                  className="btn-hero-secondary"
                  onClick={() => navigate(`/movie/${slideId}`)}
                  aria-label={`View details for ${slide.title}`}
                >
                  <Info size={18} aria-hidden="true" /> Details
                </button>
              )}

              <button
                className="btn-hero-secondary"
                onClick={() => navigate("/ai")}
                aria-label="Open AI Oracle recommendations"
              >
                <Sparkles size={17} className="text-accent" aria-hidden="true" /> AI Oracle
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {activeSlides.length > 1 && (
        <div className="hero-controls">
          <button
            className="btn-hero-arrow"
            onClick={() => setCurrentIndex((prev) => (prev === 0 ? activeSlides.length - 1 : prev - 1))}
            aria-label="Previous featured movie"
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>

          <div className="hero-indicators">
            {activeSlides.map((s, idx) => (
              <button
                key={s.imdbID || s.id || idx}
                className={`hero-dot ${idx === safeIndex ? "active" : ""}`}
                onClick={() => setCurrentIndex(idx)}
                aria-label={`Go to slide ${idx + 1}: ${s.title}`}
              />
            ))}
          </div>

          <button
            className="btn-hero-arrow"
            onClick={() => setCurrentIndex((prev) => (prev + 1) % activeSlides.length)}
            aria-label="Next featured movie"
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
