import { useCallback, useEffect, useState } from "react";

/**
 * Callback-ref IntersectionObserver scroll-reveal hook.
 * Attaches dynamically even when elements mount asynchronously after data loads,
 * and includes a passive scroll-position fallback so tall or zoomed-out blocks
 * never remain hidden at opacity 0.
 */
export function useScrollReveal({
  rootMargin = "160px 0px 80px 0px",
  threshold = 0,
  disabled = false
} = {}) {
  const [node, setNode] = useState(null);
  const [isVisible, setIsVisible] = useState(() => {
    if (disabled) return true;
    if (typeof window === "undefined") return true;
    if (typeof window.IntersectionObserver !== "function") return true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      return true;
    }
    return false;
  });

  const ref = useCallback((el) => {
    setNode(el || null);
  }, []);

  useEffect(() => {
    if (disabled || isVisible || !node) return;

    if (typeof window === "undefined") {
      setIsVisible(true);
      return;
    }

    const isNearViewport = () => {
      const rect = node.getBoundingClientRect();
      return rect.top <= (window.innerHeight || 900) + 120;
    };

    if (isNearViewport()) {
      setIsVisible(true);
      return;
    }

    if (typeof window.IntersectionObserver !== "function") {
      setIsVisible(true);
      return;
    }

    const observer = new window.IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.boundingClientRect.top <= (window.innerHeight || 900) + 120) {
            setIsVisible(true);
            observer.disconnect();
            window.removeEventListener("scroll", onScrollFallback);
            break;
          }
        }
      },
      { rootMargin, threshold }
    );

    const onScrollFallback = () => {
      if (isNearViewport()) {
        setIsVisible(true);
        observer.disconnect();
        window.removeEventListener("scroll", onScrollFallback);
      }
    };

    observer.observe(node);
    window.addEventListener("scroll", onScrollFallback, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScrollFallback);
    };
  }, [disabled, isVisible, node, rootMargin, threshold]);

  return [ref, isVisible];
}

export default useScrollReveal;
