/**
 * Pure wheel-to-horizontal-scroll helpers for cinema poster carousels & film strips.
 * Yields vertical scroll back to the page when non-overflowing, during native
 * trackpad horizontal gestures, or at the start/end bounds of the strip.
 */

export function computeHorizontalWheelDelta({
  deltaX = 0,
  deltaY = 0,
  deltaMode = 0,
  scrollLeft = 0,
  scrollWidth = 0,
  clientWidth = 0,
  clientHeight = 0
} = {}) {
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

export function attachHorizontalWheelScroll(el) {
  if (!el || typeof el.addEventListener !== "function") {
    return () => {};
  }

  const handleWheel = (e) => {
    const horizontalDelta = computeHorizontalWheelDelta({
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      scrollLeft: el.scrollLeft,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight
    });

    if (horizontalDelta === null) return;

    e.preventDefault();
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollLeft = Math.max(0, Math.min(maxScrollLeft, el.scrollLeft + horizontalDelta));
  };

  el.addEventListener("wheel", handleWheel, { passive: false });
  return () => {
    el.removeEventListener("wheel", handleWheel);
  };
}
