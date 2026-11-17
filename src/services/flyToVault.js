/**
 * Fly a ghost of a poster from a source element to the nav's Vault/Watchlist
 * target, then bump that target. Pure DOM + Web Animations (no React state),
 * so it can be fired from any handler. No-ops under reduced motion or when
 * either element is missing.
 */
export function flyToVault(sourceEl, imageUrl) {
  if (typeof document === "undefined" || !sourceEl?.getBoundingClientRect) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const isMobile = window.matchMedia?.("(max-width: 900px)").matches;
  const target = document.querySelector(
    isMobile ? '.mobile-tab[href="/vault"]' : ".stream-watchlist-btn"
  );
  if (!target) return;

  const from = sourceEl.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (!from.width || !to.width) return;

  const w = Math.min(from.width, 120);
  const h = w * 1.5;
  const startX = from.left + from.width / 2 - w / 2;
  const startY = from.top + from.height / 2 - h / 2;
  const dx = to.left + to.width / 2 - (startX + w / 2);
  const dy = to.top + to.height / 2 - (startY + h / 2);

  const ghost = document.createElement("div");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${startX}px`,
    top: `${startY}px`,
    width: `${w}px`,
    height: `${h}px`,
    zIndex: "100000",
    pointerEvents: "none",
    borderRadius: "6px",
    background: imageUrl && imageUrl !== "N/A"
      ? `center / cover no-repeat url("${String(imageUrl).replace(/"/g, "%22")}")`
      : "#252831",
    boxShadow: "0 12px 32px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.18)",
    willChange: "transform, opacity"
  });
  document.body.appendChild(ghost);

  const anim = ghost.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 40}px) scale(0.7)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0.2, offset: 1 }
    ],
    { duration: 650, easing: "cubic-bezier(0.5, 0, 0.75, 0.3)", fill: "forwards" }
  );

  const finish = () => {
    ghost.remove();
    target.classList.remove("cv-bump");
    // restart the animation if it is already running
    void target.offsetWidth;
    target.classList.add("cv-bump");
    window.setTimeout(() => target.classList.remove("cv-bump"), 500);
  };
  anim.onfinish = finish;
  anim.oncancel = () => ghost.remove();
}
