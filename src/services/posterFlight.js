/**
 * Poster "hero flight": clicking a poster leaves a ghost copy in a body-level
 * overlay (it survives the route change), and once the detail page has rendered
 * its poster the ghost glides onto it. Pure DOM + Web Animations.
 *
 * - startPosterFlight(el, src)  call from the click handler
 * - landPosterFlight(targetEl)  call from the detail page once its poster exists
 * Safe to call when nothing is pending; no-ops under reduced motion.
 */

const MAX_WAIT_MS = 4500;
let current = null; // { ghost, killTimer }

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function dispose(entry, fade = true) {
  if (!entry) return;
  clearTimeout(entry.killTimer);
  if (entry.target) entry.target.style.opacity = entry.prevOpacity ?? "";
  if (current === entry) current = null;
  const { ghost } = entry;
  if (!ghost.isConnected) return;
  if (!fade) {
    ghost.remove();
    return;
  }
  const out = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
  out.onfinish = () => ghost.remove();
  out.oncancel = () => ghost.remove();
}

export function startPosterFlight(sourceEl, imageUrl) {
  if (typeof document === "undefined" || reducedMotion()) return;
  if (!sourceEl?.getBoundingClientRect || !imageUrl || imageUrl === "N/A") return;
  dispose(current, false);

  const r = sourceEl.getBoundingClientRect();
  if (!r.width || !r.height) return;

  const ghost = document.createElement("div");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    zIndex: "99990",
    pointerEvents: "none",
    borderRadius: "6px",
    transformOrigin: "top left",
    background: `center / cover no-repeat url("${String(imageUrl).replace(/"/g, "%22")}")`,
    boxShadow: "0 18px 48px rgba(0,0,0,0.6)",
    willChange: "transform, opacity"
  });
  document.body.appendChild(ghost);

  const entry = { ghost, killTimer: 0, target: null, prevOpacity: "" };
  entry.killTimer = window.setTimeout(() => dispose(entry), MAX_WAIT_MS);
  current = entry;
}

export function landPosterFlight(targetEl) {
  const entry = current;
  if (!entry || !targetEl) return;

  entry.target = targetEl;
  entry.prevOpacity = targetEl.style.opacity;
  targetEl.style.opacity = "0";

  // Let the page-enter transition settle so the measured rect is final.
  window.setTimeout(() => {
    if (current !== entry || !entry.ghost.isConnected) return;
    const from = entry.ghost.getBoundingClientRect();
    const to = targetEl.getBoundingClientRect();
    if (!to.width || !to.height || !from.width) {
      dispose(entry);
      return;
    }
    clearTimeout(entry.killTimer);
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    const sx = to.width / from.width;
    const sy = to.height / from.height;

    const flight = entry.ghost.animate(
      [
        { transform: "translate(0, 0) scale(1, 1)" },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }
      ],
      { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
    );
    flight.onfinish = () => {
      targetEl.style.opacity = entry.prevOpacity ?? "";
      entry.target = null;
      dispose(entry);
    };
    flight.oncancel = () => dispose(entry, false);
  }, 380);
}

/** Drop any pending ghost, e.g. when navigation goes somewhere other than a detail page. */
export function cancelPosterFlight() {
  dispose(current, false);
}
