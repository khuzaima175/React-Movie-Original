import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Check, Info, SlidersHorizontal, ChevronLeft, ChevronRight } from "lucide-react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useReducedMotion
} from "framer-motion";
import { MetaLine } from "./ui";
import { buildSeenCollisionSet } from "../services/dashboardService";
import { buildQuickAddWatchedMovie } from "../services/csvImport";
import { prepareWatchlistPayload } from "../services/ratingTiers";
import { flyToVault } from "../services/flyToVault";
import { EASE, riseIn, staggerContainer, wordReveal } from "../motion";

const SLIDE_MS = 8000;
const SWIPE_THRESHOLD = 70;

const titleVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055 } }
};

function HeroTitle({ text }) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  return (
    <motion.h1 className="hero-title" variants={titleVariants}>
      {words.map((word, i) => (
        <React.Fragment key={`${word}-${i}`}>
          <span className="hero-word-mask">
            <motion.span className="hero-word" variants={wordReveal}>
              {word}
            </motion.span>
          </span>
          {i < words.length - 1 ? " " : null}
        </React.Fragment>
      ))}
    </motion.h1>
  );
}

function HeroCarousel({
  slides = [],
  watched = [],
  watchlist = [],
  onAddWatched,
  onAddToWatchlist,
  onOpenTasteDeck
}) {
  const navigate = useNavigate();
  const activeSlides = Array.isArray(slides) ? slides : [];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const heroRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();

  // Scroll-linked parallax: backdrop drifts slower than the page, copy fades up.
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"]
  });
  const bgY = useTransform(scrollYProgress, [0, 1], ["0%", "10%"]);
  const contentY = useTransform(scrollYProgress, [0, 1], ["0px", "-48px"]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);

  const slideCount = activeSlides.length;
  const autoplayEnabled = slideCount > 1 && !prefersReducedMotion;
  const progressRunning = autoplayEnabled && !isPaused;

  useEffect(() => {
    setCurrentIndex((prev) => (slideCount === 0 ? 0 : prev % slideCount));
  }, [slideCount]);

  // One timeout per slide. Restarts after any manual change or un-pause, which
  // keeps the CSS progress bar and the actual advance in lockstep.
  useEffect(() => {
    if (!progressRunning) return undefined;
    const timer = setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % slideCount);
    }, SLIDE_MS);
    return () => clearTimeout(timer);
  }, [progressRunning, currentIndex, slideCount]);

  const goPrev = () => setCurrentIndex((prev) => (prev === 0 ? slideCount - 1 : prev - 1));
  const goNext = () => setCurrentIndex((prev) => (prev + 1) % slideCount);

  const safeIndex = currentIndex % slideCount;
  const slide = activeSlides[safeIndex];
  const slideId = slide.imdbID || slide.id || (slide.tmdbId ? `tmdb_${slide.tmdbId}` : "");

  const watchedSet = buildSeenCollisionSet(watched, []);
  const watchlistSet = buildSeenCollisionSet([], watchlist);
  const slideKeys = buildSeenCollisionSet([slide], []);

  const isWatched = [...slideKeys].some((k) => watchedSet.has(k));
  const isWatchlisted = [...slideKeys].some((k) => watchlistSet.has(k));

  function handlePrimaryAction(e) {
    if (!slide) return;
    if (!isWatched && onAddToWatchlist) {
      if (!isWatchlisted) {
        onAddToWatchlist(prepareWatchlistPayload(slide));
        flyToVault(e?.currentTarget, slide.poster);
      }
      return;
    }
    if (!isWatched && onAddWatched) {
      onAddWatched(buildQuickAddWatchedMovie(slide));
      flyToVault(e?.currentTarget, slide.poster);
    }
  }

  const primaryAdded = isWatched || (onAddToWatchlist ? isWatchlisted : false);
  const primaryLabel = isWatched
    ? "In Vault"
    : onAddToWatchlist
      ? (isWatchlisted ? "In Watchlist" : "Add to Watchlist")
      : "Add to Vault";

  const hasBackdrop = Boolean(slide.backdrop && !/unsplash\.com/i.test(slide.backdrop));

  function handlePanEnd(_event, info) {
    const { x, y } = info.offset;
    if (Math.abs(x) < SWIPE_THRESHOLD || Math.abs(x) < Math.abs(y) * 1.2) return;
    if (x < 0) goNext();
    else goPrev();
  }

  function handleKeyDown(e) {
    if (slideCount <= 1) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    }
  }

  const parallaxStyle = prefersReducedMotion ? undefined : { y: bgY };
  const contentStyle = prefersReducedMotion ? undefined : { y: contentY, opacity: contentOpacity };

  return (
    <section className="hero-billboard-wrap page-rail" aria-label="Featured Film Billboard">
      <motion.div
        ref={heroRef}
        className="hero-billboard"
        style={{ touchAction: "pan-y" }}
        onPanEnd={handlePanEnd}
        onKeyDown={handleKeyDown}
        onPointerEnter={(e) => e.pointerType === "mouse" && setIsPaused(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setIsPaused(false)}
        onFocus={(e) => e.target.matches?.(":focus-visible") && setIsPaused(true)}
        onBlur={() => setIsPaused(false)}
      >
        <motion.div className="hero-parallax" style={parallaxStyle}>
          <AnimatePresence>
            {hasBackdrop ? (
              <motion.div
                key={`bd-${slideId || safeIndex}`}
                className="hero-backdrop"
                style={{ backgroundImage: `url(${slide.backdrop})` }}
                initial={{ opacity: 0, scale: 1 }}
                animate={{ opacity: 1, scale: 1.08 }}
                exit={{ opacity: 0, transition: { duration: 0.5, delay: 0.3 } }}
                transition={{
                  opacity: { duration: 0.7, ease: EASE },
                  scale: { duration: SLIDE_MS / 1000 + 2, ease: "linear" }
                }}
              />
            ) : (
              <motion.div
                key={`blur-${slideId || safeIndex}`}
                className="hero-backdrop-blurred"
                style={slide.poster ? { backgroundImage: `url(${slide.poster})` } : undefined}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.5, delay: 0.3 } }}
                transition={{ duration: 0.7 }}
              />
            )}
          </AnimatePresence>
        </motion.div>

        <div className="hero-scrim-left" />
        <div className="hero-scrim-bottom" />

        <motion.div className="hero-content" style={contentStyle}>
          <AnimatePresence mode="wait">
            <motion.div
              key={`txt-${slideId || safeIndex}`}
              className="hero-text-block"
              variants={staggerContainer(0.08, 0.12)}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, y: -8, transition: { duration: 0.18 } }}
            >
              <motion.span className="hero-kicker" variants={riseIn}>
                Spotlight
              </motion.span>
              <HeroTitle text={slide.title} />
              <motion.div variants={riseIn}>
                <MetaLine
                  items={[slide.year, slide.genre, slide.runtime]}
                  rating={slide.imdbRating}
                  ratingTone="neutral"
                />
              </motion.div>
              {slide.plot && (
                <motion.p className="hero-plot" variants={riseIn}>
                  {slide.plot}
                </motion.p>
              )}

              <motion.div className="hero-actions" variants={riseIn}>
                {(onAddToWatchlist || onAddWatched) && (
                  <button
                    type="button"
                    className={`btn-hero-primary ${primaryAdded ? "added" : ""}`}
                    onClick={handlePrimaryAction}
                    aria-label={`${primaryLabel}: ${slide.title}`}
                  >
                    {primaryAdded ? (
                      <>
                        <Check size={17} aria-hidden="true" /> {primaryLabel}
                      </>
                    ) : (
                      <>
                        <Plus size={17} aria-hidden="true" /> {primaryLabel}
                      </>
                    )}
                  </button>
                )}

                {slideId && (
                  <button
                    type="button"
                    className="btn-hero-secondary"
                    onClick={() => navigate(`/movie/${slideId}`)}
                    aria-label={`View details for ${slide.title}`}
                  >
                    <Info size={17} aria-hidden="true" /> Details
                  </button>
                )}
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {slideCount > 1 && (
          <div className="hero-controls">
            <button
              type="button"
              className="btn-hero-arrow"
              onClick={goPrev}
              aria-label="Previous featured movie"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>

            <div className="hero-indicators" style={{ "--hero-slide-ms": `${SLIDE_MS}ms` }}>
              {activeSlides.map((s, idx) => {
                const isActive = idx === safeIndex;
                return (
                  <button
                    type="button"
                    key={s.imdbID || s.id || idx}
                    className={`hero-bar ${isActive ? "active" : ""} ${
                      isActive && !progressRunning ? "is-static" : ""
                    }`}
                    onClick={() => setCurrentIndex(idx)}
                    aria-label={`Go to slide ${idx + 1}: ${s.title}`}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <span className="hero-bar-track">
                      {isActive && (
                        <span
                          key={`${safeIndex}-${progressRunning ? "run" : "static"}`}
                          className="hero-bar-fill"
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="btn-hero-arrow"
              onClick={goNext}
              aria-label="Next featured movie"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        )}
      </motion.div>
    </section>
  );
}

function HeroEmpty({ onOpenTasteDeck }) {
  const navigate = useNavigate();
  return (
    <section className="hero-billboard-wrap page-rail" aria-label="Featured Film Billboard">
      <div className="hero-billboard">
        <div className="hero-scrim-left" />
        <div className="hero-scrim-bottom" />
        <div className="hero-content">
          <motion.div
            className="hero-text-block"
            variants={staggerContainer(0.09, 0.05)}
            initial="hidden"
            animate="show"
          >
            <motion.span className="hero-kicker" variants={riseIn}>
              Spotlight
            </motion.span>
            <HeroTitle text="Discover Your Next Film" />
            <motion.p className="hero-plot" variants={riseIn}>
              Curated unwatched spotlights and recommendations calibrated to your vault ratings.
            </motion.p>
            <motion.div className="hero-actions" variants={riseIn}>
              <button
                type="button"
                className="btn-hero-primary"
                onClick={() => (onOpenTasteDeck ? onOpenTasteDeck() : navigate("/ai"))}
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                Taste Calibration (30)
              </button>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function HeroSkeleton() {
  return (
    <section
      className="hero-billboard-wrap page-rail hero-skeleton"
      aria-label="Loading featured films"
      aria-busy="true"
    >
      <div className="hero-billboard">
        <div className="hero-scrim-bottom" />
        <div className="hero-content">
          <div className="hero-text-block" style={{ width: "100%" }}>
            <div className="cv-skel hero-skel-line" style={{ width: "9rem" }} />
            <div className="cv-skel hero-skel-title" />
            <div className="cv-skel hero-skel-line" style={{ width: "min(30rem, 70%)" }} />
            <div className="cv-skel hero-skel-line" style={{ width: "min(52rem, 90%)" }} />
            <div className="hero-actions">
              <div className="cv-skel hero-skel-btn" />
              <div className="cv-skel hero-skel-btn" style={{ width: "11rem" }} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HeroBillboard(props) {
  const slides = Array.isArray(props.slides) ? props.slides : [];
  if (slides.length === 0) {
    return props.loading ? <HeroSkeleton /> : <HeroEmpty onOpenTasteDeck={props.onOpenTasteDeck} />;
  }
  return <HeroCarousel {...props} slides={slides} />;
}