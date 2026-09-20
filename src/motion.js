/**
 * CinemaVault Motion System
 * Standardized easing curves and Framer Motion animation presets
 */

export const EASE = [0.22, 1, 0.36, 1];

export const springHover = {
  type: "spring",
  stiffness: 320,
  damping: 28,
  mass: 0.8,
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
