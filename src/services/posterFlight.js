/**
 * Poster transition helpers.
 * Imperative body-level DOM ghosts are intentionally disabled because React 18
 * StrictMode + async TMDB detail loads caused ghost overlays to stall over
 * loading skeletons and lock real posters at opacity: 0. MovieDetails now uses
 * a GPU-accelerated Framer Motion entrance directly on the poster container.
 */

export function startPosterFlight() {
  // No-op: handled cleanly by Framer Motion route & poster entrance transitions.
}

export function landPosterFlight(targetEl) {
  if (targetEl?.style && targetEl.style.opacity === "0") {
    targetEl.style.opacity = "";
  }
}

export function cancelPosterFlight() {
  // No-op.
}
