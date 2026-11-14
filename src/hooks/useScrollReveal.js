import { useEffect, useRef, useState } from "react";

/**
 * Lightweight IntersectionObserver scroll-reveal hook.
 * Triggers once when an element approaches the viewport from below, creating
 * smooth GPU-composited upward entrance transitions without layout thrash.
 */
export function useScrollReveal({
  rootMargin = "0px 0px -36px 0px",
  threshold = 0.05,
  disabled = false
} = {}) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(() => {
    if (disabled) return true;
    if (typeof window === "undefined") return true;
    if (typeof window.IntersectionObserver !== "function") return true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (disabled || isVisible) return;
    const node = ref.current;
    if (!node) return;

    if (typeof window === "undefined" || typeof window.IntersectionObserver !== "function") {
      setIsVisible(true);
      return;
    }

    // Elements already within or near the initial fold appear without delay.
    const rect = node.getBoundingClientRect();
    if (rect.top <= window.innerHeight * 0.96) {
      setIsVisible(true);
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.boundingClientRect.top <= window.innerHeight) {
            setIsVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin, threshold }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [disabled, isVisible, rootMargin, threshold]);

  return [ref, isVisible];
}

export default useScrollReveal;
