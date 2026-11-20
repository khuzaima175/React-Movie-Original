/**
 * Pure wheel-to-horizontal-scroll helpers for cinema poster carousels & film strips.
 * Requires explicit opt-in (row engagement or Shift+Wheel) so plain vertical page
 * scrolling is never hijacked merely by passing the cursor over a horizontal rail.
 */

export function computeHorizontalWheelDelta({
  deltaX = 0,
  deltaY = 0,
  deltaMode = 0,
  scrollLeft = 0,
  scrollWidth = 0,
  clientWidth = 0,
  clientHeight = 0,
  engaged = false,
  shiftKey = false,
  requireActivation = true
} = {}) {
  if (requireActivation && !engaged && !shiftKey) {
    return null;
  }

  const maxScrollLeft = scrollWidth - clientWidth;
  if (!Number.isFinite(maxScrollLeft) || maxScrollLeft <= 1) {
    return null;
  }

  // Respect native horizontal scrolling gestures (trackpads, tilt wheels)
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return null;
  }

  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return null;
  }

  // Normalize wheel delta across pixel (0), line (1), and page (2) modes
  let scaled = deltaY;
  if (deltaMode === 1) {
    scaled = deltaY * 40;
  } else if (deltaMode === 2) {
    scaled = deltaY * (clientHeight > 0 ? clientHeight : 400);
  }

  if (scaled < 0 && scrollLeft <= 4) {
    return null;
  }
  if (scaled > 0 && scrollLeft >= maxScrollLeft - 4) {
    return null;
  }

  return scaled;
}

function prefersReducedMotion(explicitFlag) {
  if (typeof explicitFlag === "boolean") return explicitFlag;
  try {
    return Boolean(
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

export function attachHorizontalWheelScroll(el, options = {}) {
  if (!el || typeof el.addEventListener !== "function") {
    return () => {};
  }

  const multiplier = Number.isFinite(options.multiplier) ? options.multiplier : 1.25;
  const speed = Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 11.5;
  const requireActivation = options.requireActivation !== false;
  const isEngagedFn = typeof options.isEngagedFn === "function"
    ? options.isEngagedFn
    : () => Boolean(options.engaged);

  const rafFn =
    typeof options.requestAnimationFrameFn === "function"
      ? options.requestAnimationFrameFn
      : typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : null;
  const cancelRafFn =
    typeof options.cancelAnimationFrameFn === "function"
      ? options.cancelAnimationFrameFn
      : typeof cancelAnimationFrame === "function"
        ? cancelAnimationFrame
        : null;

  let rafId = null;
  let currentLeft = 0;
  let targetLeft = 0;
  let lastTs = null;
  let savedSnapType = null;

  const restoreSnap = () => {
    if (savedSnapType !== null && el.style) {
      el.style.scrollSnapType = savedSnapType;
      savedSnapType = null;
    }
  };

  const stopAnimation = () => {
    if (rafId !== null && cancelRafFn) {
      cancelRafFn(rafId);
    }
    rafId = null;
    lastTs = null;
    restoreSnap();
  };

  const step = (ts) => {
    const dt = lastTs === null ? 0.016 : Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
    lastTs = ts;

    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    targetLeft = Math.max(0, Math.min(maxScrollLeft, targetLeft));

    const diff = targetLeft - currentLeft;
    if (Math.abs(diff) <= 0.6) {
      el.scrollLeft = targetLeft;
      stopAnimation();
      return;
    }

    const alpha = 1 - Math.exp(-speed * dt);
    currentLeft += diff * alpha;
    el.scrollLeft = currentLeft;
    rafId = rafFn(step);
  };

  const handleWheel = (e) => {
    const engaged = Boolean(isEngagedFn());
    const activeLeft = rafId !== null ? targetLeft : el.scrollLeft;
    const horizontalDelta = computeHorizontalWheelDelta({
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      scrollLeft: activeLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      engaged,
      shiftKey: Boolean(e.shiftKey),
      requireActivation
    });

    if (horizontalDelta === null) return;

    e.preventDefault();
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const scaledDelta = horizontalDelta * multiplier;

    if (prefersReducedMotion(options.reducedMotion) || !rafFn) {
      const next = Math.max(0, Math.min(maxScrollLeft, el.scrollLeft + scaledDelta));
      el.scrollLeft = next;
      return;
    }

    if (rafId === null) {
      currentLeft = el.scrollLeft;
      targetLeft = currentLeft;
      lastTs = null;
      if (el.style) {
        savedSnapType = el.style.scrollSnapType ?? "";
        el.style.scrollSnapType = "none";
      }
      rafId = rafFn(step);
    }

    targetLeft = Math.max(0, Math.min(maxScrollLeft, targetLeft + scaledDelta));
  };

  const handlePointerDown = () => {
    if (rafId !== null) stopAnimation();
  };

  el.addEventListener("wheel", handleWheel, { passive: false });
  el.addEventListener("pointerdown", handlePointerDown);

  return () => {
    stopAnimation();
    el.removeEventListener("wheel", handleWheel);
    el.removeEventListener("pointerdown", handlePointerDown);
  };
}
