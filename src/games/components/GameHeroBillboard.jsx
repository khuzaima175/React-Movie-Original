import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Dices,
  Info,
  Star
} from "lucide-react";
import { EASE, riseIn, staggerContainer, wordReveal } from "../../motion";
import { flyToVault } from "../../services/flyToVault";

const SLIDE_MS = 8500;

const titleVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } }
};

function HeroAnimatedTitle({ text }) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  return (
    <motion.h1 className="gv-billboard-title" variants={titleVariants}>
      {words.map((word, i) => (
        <React.Fragment key={`${word}-${i}`}>
          <span className="gv-word-mask">
            <motion.span className="gv-word" variants={wordReveal}>
              {word}
            </motion.span>
          </span>
          {i < words.length - 1 ? " " : null}
        </React.Fragment>
      ))}
    </motion.h1>
  );
}

function GameHeroBillboardStage({
  activeSlides,
  isPersonalized,
  playedById,
  backlogIds,
  onRate,
  onToggleBacklog,
  onOpenRoulette
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const count = activeSlides.length;

  useEffect(() => {
    setIndex((prev) => (count === 0 ? 0 : prev % count));
  }, [count]);

  useEffect(() => {
    if (count <= 1 || paused || prefersReducedMotion) return undefined;
    const t = window.setTimeout(() => setIndex((prev) => (prev + 1) % count), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [count, index, paused, prefersReducedMotion]);

  const slide = activeSlides[index % count];
  const logged = playedById?.get(slide.igdbId) || null;
  const inBacklog = backlogIds?.has(slide.igdbId) || false;

  const goPrev = () => setIndex((prev) => (prev === 0 ? count - 1 : prev - 1));
  const goNext = () => setIndex((prev) => (prev + 1) % count);

  const genreText = (slide.genres || []).slice(0, 2).join(" · ");

  return (
    <div className="gv-billboard-wrap">
      <section
        className="gv-billboard"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        aria-label="Featured Games"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={`bg-${slide.igdbId}`}
            className="gv-billboard-bg-wrap"
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 1.03 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: EASE }}
          >
            {(slide.backdropUrl || slide.coverUrl) && (
              <img
                src={slide.backdropUrl || slide.coverUrl}
                alt=""
                decoding="async"
                className="gv-billboard-bg"
              />
            )}
          </motion.div>
        </AnimatePresence>

        <div className="gv-billboard-scrim" />

        <div className="gv-billboard-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={`copy-${slide.igdbId}`}
              className="gv-billboard-copy"
              variants={staggerContainer(0.05, 0.03)}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0, y: -8, transition: { duration: 0.16 } }}
            >
              <motion.span className="gv-billboard-kicker" variants={riseIn}>
                {isPersonalized ? `Top Pick For You · #${(index % count) + 1}` : "Spotlight"}
              </motion.span>

              <HeroAnimatedTitle text={slide.title} />

              <motion.div className="gv-billboard-meta-line" variants={riseIn}>
                {Number.isFinite(Number(slide.matchScore)) && (
                  <span className="gv-billboard-match-badge tabular-num">
                    {slide.matchScore}% Match
                  </span>
                )}
                {slide.year && <span className="tabular-num">{slide.year}</span>}
                {slide.year && genreText && <span aria-hidden="true">·</span>}
                {genreText && <span>{genreText}</span>}
                {slide.rating10 && (
                  <>
                    {(slide.year || genreText) && <span aria-hidden="true">·</span>}
                    <span className="gv-billboard-score tabular-num">
                      <Star size={12} fill="currentColor" aria-hidden="true" />
                      {slide.rating10.toFixed(1)}
                    </span>
                  </>
                )}
              </motion.div>

              {slide.summary && (
                <motion.p className="gv-hero-summary" variants={riseIn}>
                  {slide.summary}
                </motion.p>
              )}

              <motion.div className="gv-actions-row w-full" variants={riseIn}>
                <div className="gv-billboard-actions-pair flex items-center gap-3">
                  {!logged ? (
                    <button
                      type="button"
                      className="gv-btn gv-hero-btn-primary"
                      onClick={(e) => {
                        if (!inBacklog && slide.coverUrl) flyToVault(e.currentTarget, slide.coverUrl);
                        onToggleBacklog?.(slide);
                      }}
                    >
                      {inBacklog ? <Check size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
                      {inBacklog ? "In Backlog" : "Backlog"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="gv-btn gv-hero-btn-primary"
                      onClick={() => onRate?.({ ...slide, ...logged })}
                    >
                      <Star size={15} aria-hidden="true" />
                      {logged.userRating ? `Rated ${logged.userRating}/10` : "Update Log"}
                    </button>
                  )}

                  <Link to={`/game/${slide.igdbId}`} className="gv-btn gv-hero-btn-secondary">
                    <Info size={15} aria-hidden="true" />
                    Details
                  </Link>
                </div>

                {!logged && (
                  <button
                    type="button"
                    className="gv-btn gv-hero-btn-secondary gv-billboard-desktop-only"
                    onClick={() => onRate?.({ ...slide })}
                  >
                    <Star size={14} aria-hidden="true" />
                    Rate Game
                  </button>
                )}

                <Link to="/games/oracle" className="gv-btn gv-hero-btn-secondary gv-billboard-desktop-only">
                  <Compass size={14} aria-hidden="true" />
                  Oracle
                </Link>

                {onOpenRoulette && (
                  <button
                    type="button"
                    className="gv-btn gv-hero-btn-secondary gv-billboard-desktop-only"
                    onClick={onOpenRoulette}
                    title="Spin Game Roulette"
                  >
                    <Dices size={14} aria-hidden="true" />
                    Play Next?
                  </button>
                )}
              </motion.div>
            </motion.div>
          </AnimatePresence>

          {count > 1 && (
            <div className="gv-billboard-controls">
              <div className="gv-billboard-dots" role="tablist" aria-label="Featured slides">
                {activeSlides.map((s, i) => {
                  const isActive = i === index % count;
                  return (
                    <button
                      key={s.igdbId}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-label={`Show ${s.title}`}
                      className={`gv-billboard-dot ${isActive ? "is-active" : ""}`}
                      onClick={() => setIndex(i)}
                    >
                      {isActive && !paused && !prefersReducedMotion && (
                        <span
                          key={`prog-${index}`}
                          className="gv-billboard-dot-fill"
                          style={{ animationDuration: `${SLIDE_MS}ms` }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="gv-billboard-arrows">
                <button type="button" className="gv-carousel-arrow" onClick={goPrev} aria-label="Previous featured game">
                  <ChevronLeft size={16} />
                </button>
                <button type="button" className="gv-carousel-arrow" onClick={goNext} aria-label="Next featured game">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default function GameHeroBillboard({ slides = [], ...rest }) {
  const activeSlides = Array.isArray(slides) ? slides.filter(Boolean).slice(0, 6) : [];
  if (activeSlides.length === 0) {
    return (
      <div className="gv-billboard-wrap">
        <div className="gv-skeleton" style={{ height: "42rem" }} />
      </div>
    );
  }
  return <GameHeroBillboardStage activeSlides={activeSlides} {...rest} />;
}
