import { useCallback, useEffect, useState } from "react";

const sharedObserverPool = new Map();

function getSharedRevealObserver(rootMargin, threshold) {
  const key = `${rootMargin}|${threshold}`;
  let entry = sharedObserverPool.get(key);
  if (entry) return entry;

  const callbacks = new WeakMap();
  const observer = new window.IntersectionObserver(
    (entries) => {
      for (const item of entries) {
        if (
          item.isIntersecting ||
          item.boundingClientRect.top <= (window.innerHeight || 900) + 120
        ) {
          const cb = callbacks.get(item.target);
          callbacks.delete(item.target);
          observer.unobserve(item.target);
          cb?.();
        }
      }
    },
    { rootMargin, threshold }
  );

  entry = { observer, callbacks };
  sharedObserverPool.set(key, entry);
  return entry;
}

/**
 * Shared-IntersectionObserver scroll-reveal hook.
 * Reuses one observer per (rootMargin, threshold) across all mounted cards so
 * grids with 100+ posters never allocate per-card observers or scroll listeners.
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
    const next = el || null;
    setNode((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    if (disabled || isVisible || !node) return undefined;

    if (typeof window === "undefined") {
      setIsVisible(true);
      return undefined;
    }

    const rect = node.getBoundingClientRect();
    if (rect.top <= (window.innerHeight || 900) + 120) {
      setIsVisible(true);
      return undefined;
    }

    if (typeof window.IntersectionObserver !== "function") {
      setIsVisible(true);
      return undefined;
    }

    const { observer, callbacks } = getSharedRevealObserver(rootMargin, threshold);
    callbacks.set(node, () => setIsVisible(true));
    observer.observe(node);

    return () => {
      callbacks.delete(node);
      observer.unobserve(node);
    };
  }, [disabled, isVisible, node, rootMargin, threshold]);

  return [ref, isVisible];
}

export default useScrollReveal;
