import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import PosterImage from "./PosterImage";

/**
 * Renders nothing. While mounted inside `.movie-backdrop-hero` it writes a
 * 0..1 scroll progress to `--hero-progress` on that element (rAF-throttled);
 * CSS turns it into backdrop parallax + a deepening scrim.
 */
export function HeroParallaxController() {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return undefined;
    const hero = document.querySelector(".movie-backdrop-hero");
    if (!hero) return undefined;
    let frame = 0;

    const update = () => {
      frame = 0;
      const h = hero.offsetHeight || 1;
      const p = Math.min(1, Math.max(0, window.scrollY / h));
      hero.style.setProperty("--hero-progress", p.toFixed(3));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      hero.style.removeProperty("--hero-progress");
    };
  }, [reduced]);

  return null;
}

/** Compact title bar that docks under the navbar after the hero scrolls away. */
export function StickyTitleBar({ title, poster, year, onBack }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 420);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="movie-sticky-bar"
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="movie-sticky-inner page-rail">
            <button type="button" className="movie-sticky-back" onClick={onBack} aria-label="Go back">
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
            <div className="movie-sticky-thumb">
              <PosterImage src={poster} title={title} alt="" />
            </div>
            <div className="movie-sticky-text">
              <span className="movie-sticky-title">{title}</span>
              {year ? <span className="movie-sticky-year tabular-num">{year}</span> : null}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
