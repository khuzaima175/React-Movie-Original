import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  useReducedMotion
} from "framer-motion";
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Dices,
  Gamepad2,
  Star
} from "lucide-react";
import { EASE, riseIn, staggerContainer, wordReveal } from "../../motion";
import { flyToVault } from "../../services/flyToVault";

const SLIDE_MS = 8500;

const titleVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } }
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
  const heroRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"]
  });
  const bgY = useTransform(scrollYProgress, [0, 1], ["0%", "12%"]);
  const copyY = useTransform(scrollYProgress, [0, 1], ["0px", "-36px"]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.85], [1, 0.15]);

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

  return (
    <section
      ref={heroRef}
      className="gv-billboard"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Featured Games"
    >
      {/* Parallax + Ambient Ken Burns Backdrop */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`bg-${slide.igdbId}`}
          className="gv-billboard-bg-wrap"
          style={prefersReducedMotion ? undefined : { y: bgY }}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
        >
          {(slide.backdropUrl || slide.coverUrl) && (
            <img
              src={slide.backdropUrl || slide.coverUrl}
              alt=""
              className={`gv-billboard-bg ${paused ? "is-paused" : ""}`}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <div className="gv-billboard-scrim" />

      {/* Editorial Copy Stage */}
      <motion.div
        className="gv-billboard-content"
        style={prefersReducedMotion ? undefined : { y: copyY, opacity: copyOpacity }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={`copy-${slide.igdbId}`}
            className="gv-billboard-copy"
            variants={staggerContainer(0.06, 0.04)}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -10, transition: { duration: 0.18 } }}
          >
            <motion.span className="gv-kicker" variants={riseIn}>
              <Gamepad2 size={14} aria-hidden="true" />
              {isPersonalized ? `Top Local ML Pick #${(index % count) + 1}` : "Featured 2024–2026 Standout"}
            </motion.span>

            <HeroAnimatedTitle text={slide.title} />

            <motion.div className="gv-hero-meta" variants={riseIn}>
              {Number.isFinite(Number(slide.matchScore)) && (
                <span className="gv-pill gv-pill-match tabular-num">
                  {slide.matchScore}% Match
                  {slide.estRating ? ` · Est. ${slide.estRating.toFixed(1)}` : ""}
                </span>
              )}
              {slide.rating10 && (
                <span className="gv-pill gv-pill-accent tabular-num">IGDB {slide.rating10.toFixed(1)}/10</span>
              )}
              {slide.year && <span className="gv-pill tabular-num">{slide.year}</span>}
              {(slide.genres || []).slice(0, 2).map((g) => (
                <span key={g} className="gv-pill">{g}</span>
              ))}
            </motion.div>

            {slide.summary && (
              <motion.p className="gv-hero-summary" variants={riseIn}>
                {slide.summary}
              </motion.p>
            )}

            <motion.div className="gv-actions-row" variants={riseIn}>
              <Link to={`/game/${slide.igdbId}`} className="gv-btn gv-btn-primary">
                Inspect Dossier
              </Link>
              <button
                type="button"
                className="gv-btn"
                onClick={() => onRate?.({ ...slide, ...(logged || {}) })}
              >
                <Star size={15} /> {logged ? `Rated ${logged.userRating}/10` : "Rate Game"}
              </button>
              {!logged && (
                <button
                  type="button"
                  className={`gv-btn ${inBacklog ? "gv-btn-saved" : ""}`}
                  onClick={(e) => {
                    if (!inBacklog && slide.coverUrl) flyToVault(e.currentTarget, slide.coverUrl);
                    onToggleBacklog?.(slide);
                  }}
                >
                  {inBacklog ? <Check size={15} /> : <Bookmark size={15} />}
                  {inBacklog ? "In Backlog" : "Add to Backlog"}
                </button>
              )}
              <Link to="/games/oracle" className="gv-btn">
                <Compass size={15} /> Game Oracle
              </Link>
              {onOpenRoulette && (
                <button type="button" className="gv-btn" onClick={onOpenRoulette} title="Spin Game Roulette">
                  <Dices size={15} /> Play Next?
                </button>
              )}
            </motion.div>
          </motion.div>
        </AnimatePresence>

        {/* Right Side Controls & Progress Dots */}
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
      </motion.div>
    </section>
  );
}

export default function GameHeroBillboard({ slides = [], ...rest }) {
  const activeSlides = Array.isArray(slides) ? slides.filter(Boolean).slice(0, 6) : [];
  if (activeSlides.length === 0) {
    return <div className="gv-skeleton" style={{ height: "44rem", marginBottom: "3.6rem" }} />;
  }
  return <GameHeroBillboardStage activeSlides={activeSlides} {...rest} />;
}
