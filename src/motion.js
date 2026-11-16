/**
 * CinemaVault Motion System
 * Standardized easing curves and Framer Motion animation presets.
 * Rule: animate transform + opacity only.
 */

export const EASE = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT = [0.65, 0, 0.35, 1];

export const springHover = {
  type: "spring",
  stiffness: 320,
  damping: 28,
  mass: 0.8,
};

export const springSnappy = {
  type: "spring",
  stiffness: 520,
  damping: 32,
  mass: 0.7,
};

export const springSoft = {
  type: "spring",
  stiffness: 180,
  damping: 24,
  mass: 1,
};

export const reveal = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: EASE },
};

export const stagger = (staggerChildren = 0.04, delayChildren = 0) => ({
  initial: {},
  animate: {
    transition: {
      staggerChildren,
      delayChildren,
    },
  },
});

export const cardIn = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96 },
  transition: { duration: 0.2, ease: EASE },
};

/** Route-level page transition (used by App's AnimatePresence). */
export const pageTransition = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.34, ease: EASE } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.16, ease: EASE_IN_OUT } },
};

/** Staggered child reveal: parent uses `staggerContainer`, children use `riseIn`. */
export const staggerContainer = (stagger = 0.08, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

export const riseIn = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

/** Masked word reveal for large display titles. */
export const wordReveal = {
  hidden: { y: "110%" },
  show: { y: "0%", transition: { duration: 0.7, ease: EASE } },
};
