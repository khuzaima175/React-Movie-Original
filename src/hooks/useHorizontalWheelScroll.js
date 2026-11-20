import { useCallback, useEffect, useRef, useState } from "react";
import { attachHorizontalWheelScroll } from "../services/scrollHelpers.js";

/**
 * Opt-in horizontal wheel scrolling hook for poster carousels & film strips.
 * Plain vertical scrolling over a row always scrolls the page vertically;
 * clicking the row border/toggle pill (or holding Shift+Wheel) unlocks smooth
 * horizontal wheel gliding, auto-releasing on Escape, outside click, or pointer leave.
 */
export function useHorizontalWheelScroll(deps = [], existingRef = null) {
  const internalRef = useRef(null);
  const targetRef = existingRef || internalRef;
  const containerRef = useRef(null);
  const [isEngaged, setIsEngaged] = useState(false);
  const engagedRef = useRef(false);

  const engage = useCallback(() => {
    engagedRef.current = true;
    setIsEngaged(true);
  }, []);

  const release = useCallback(() => {
    if (!engagedRef.current) return;
    engagedRef.current = false;
    setIsEngaged(false);
  }, []);

  const toggleEngaged = useCallback(() => {
    const next = !engagedRef.current;
    engagedRef.current = next;
    setIsEngaged(next);
  }, []);

  const handleTrackClick = useCallback((e) => {
    if (!e?.target || typeof e.target.closest !== "function") return;
    // Engage only when clicking the rail border/empty track space, not card links or buttons
    if (e.target.closest("a, button, input, select, textarea, .unified-movie-card, .collection-part-card")) {
      return;
    }
    engagedRef.current = true;
    setIsEngaged(true);
  }, []);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return undefined;
    return attachHorizontalWheelScroll(el, {
      requireActivation: true,
      isEngagedFn: () => engagedRef.current
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRef, ...deps]);

  useEffect(() => {
    if (!isEngaged || typeof document === "undefined") return undefined;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") release();
    };
    const handleOutsidePointerDown = (e) => {
      const host = containerRef.current || targetRef.current;
      if (host && e.target && !host.contains(e.target)) {
        release();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    };
  }, [isEngaged, release, targetRef]);

  return {
    ref: targetRef,
    containerRef,
    isEngaged,
    engage,
    release,
    toggleEngaged,
    handleTrackClick
  };
}
