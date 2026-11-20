import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useScrollReveal } from "../hooks/useScrollReveal";

const MOTION_TAGS = {
  section: motion.section,
  div: motion.div,
  article: motion.article,
  aside: motion.aside
};

/**
 * Reusable GPU-only scroll reveal container (opacity + translateY).
 * Instantly visible when prefers-reduced-motion is enabled.
 */
export default function ScrollRevealSection({
  as = "section",
  delay = 0,
  offsetY = 18,
  className = "",
  children,
  ...rest
}) {
  const prefersReducedMotion = useReducedMotion();
  const [revealRef, isVisible] = useScrollReveal({
    rootMargin: "120px 0px 40px 0px",
    threshold: 0,
    disabled: Boolean(prefersReducedMotion)
  });

  const Component = MOTION_TAGS[as] || motion.section;
  const shown = Boolean(prefersReducedMotion) || isVisible;

  return (
    <Component
      ref={revealRef}
      initial={prefersReducedMotion ? false : { opacity: 0, y: offsetY }}
      animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : offsetY }}
      transition={{
        duration: prefersReducedMotion ? 0 : 0.44,
        delay: prefersReducedMotion ? 0 : delay,
        ease: [0.22, 1, 0.36, 1]
      }}
      className={className}
      {...rest}
    >
      {children}
    </Component>
  );
}
