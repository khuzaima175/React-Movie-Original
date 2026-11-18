import { useEffect, useRef } from "react";
import { attachHorizontalWheelScroll } from "../services/scrollHelpers.js";

/**
 * Attaches passive:false wheel-to-horizontal scrolling on any horizontal film strip.
 * Optionally accepts an existing ref; re-binds when deps change (e.g. skeleton -> list).
 */
export function useHorizontalWheelScroll(deps = [], existingRef = null) {
  const internalRef = useRef(null);
  const targetRef = existingRef || internalRef;

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return undefined;
    return attachHorizontalWheelScroll(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRef, ...deps]);

  return targetRef;
}
