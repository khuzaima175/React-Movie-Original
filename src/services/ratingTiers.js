import { buildQuickAddWatchedMovie } from "./csvImport.js";

export const RATING_TIERS = {
  10: {
    label: "Masterpiece (Anchor Film)",
    icon: "🏆",
    desc: "Cinematic zenith • Sets top AI taste anchor",
    color: "#e2b13c",
    bg: "rgba(226, 177, 60, 0.16)",
    border: "rgba(226, 177, 60, 0.45)",
    glow: "0 0 24px rgba(226, 177, 60, 0.45)"
  },
  9: {
    label: "Exceptional Cinema",
    icon: "✨",
    desc: "Essential viewing • Strong positive affinity",
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.15)",
    border: "rgba(245, 158, 11, 0.4)",
    glow: "0 0 18px rgba(245, 158, 11, 0.35)"
  },
  8: {
    label: "Great Film",
    icon: "🍿",
    desc: "Highly recommended & deeply engaging",
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.14)",
    border: "rgba(16, 185, 129, 0.35)",
    glow: "0 0 16px rgba(16, 185, 129, 0.25)"
  },
  7: {
    label: "Good Watch",
    icon: "👍",
    desc: "Solid craft, enjoyable & well-made",
    color: "#06b6d4",
    bg: "rgba(6, 182, 212, 0.14)",
    border: "rgba(6, 182, 212, 0.35)",
    glow: "0 0 14px rgba(6, 182, 212, 0.2)"
  },
  6: {
    label: "Decent Baseline",
    icon: "😐",
    desc: "Watchable with balanced qualities",
    color: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.14)",
    border: "rgba(139, 92, 246, 0.35)",
    glow: "0 0 12px rgba(139, 92, 246, 0.2)"
  },
  5: {
    label: "Mediocre",
    icon: "📉",
    desc: "Forgettable with noticeable flaws",
    color: "#94a3b8",
    bg: "rgba(148, 163, 184, 0.12)",
    border: "rgba(148, 163, 184, 0.25)",
    glow: "none"
  },
  4: {
    label: "Flawed",
    icon: "⚠️",
    desc: "Weak storytelling or execution",
    color: "#f97316",
    bg: "rgba(249, 115, 22, 0.14)",
    border: "rgba(249, 115, 22, 0.3)",
    glow: "none"
  },
  3: {
    label: "Disliked",
    icon: "🚫",
    desc: "Trope penalty applied to AI engine",
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.15)",
    border: "rgba(239, 68, 68, 0.3)",
    glow: "0 0 14px rgba(239, 68, 68, 0.2)"
  },
  2: {
    label: "Poor Experience",
    icon: "⛔",
    desc: "AI engine suppresses matching motifs",
    color: "#dc2626",
    bg: "rgba(220, 38, 38, 0.16)",
    border: "rgba(220, 38, 38, 0.35)",
    glow: "0 0 16px rgba(220, 38, 38, 0.25)"
  },
  1: {
    label: "Severe Dislike",
    icon: "💀",
    desc: "Strict negative weight applied",
    color: "#b91c1c",
    bg: "rgba(185, 28, 28, 0.18)",
    border: "rgba(185, 28, 28, 0.4)",
    glow: "0 0 18px rgba(185, 28, 28, 0.3)"
  }
};

export const UNRATED_TIER = {
  label: "Select Your Score",
  icon: "⭐",
  desc: "Choose a rating from 1 to 10 before saving",
  color: "#b6b6b2",
  bg: "rgba(255, 255, 255, 0.05)",
  border: "rgba(255, 255, 255, 0.14)",
  glow: "none"
};

export function getRatingTier(rating) {
  const numeric = Number(rating);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return UNRATED_TIER;
  }
  const rounded = Math.min(10, Math.max(1, Math.round(numeric)));
  return RATING_TIERS[rounded] || UNRATED_TIER;
}

export function prepareQuickRatePayload(movie, selectedRating, now = Date.now()) {
  if (!movie || typeof movie !== "object") return null;
  const raw = Number(selectedRating);
  if (selectedRating === null || selectedRating === undefined || !Number.isFinite(raw) || raw < 1) {
    return null;
  }

  const normalizedRating = Math.min(10, Math.max(1, Math.round(raw)));
  const resolvedId =
    movie.imdbID || movie.id || (movie.tmdbId ? `tmdb_${movie.tmdbId}` : undefined);
  const rawImdb = Number(movie.imdbRating ?? movie.rating);
  const trimmedNote = typeof movie.userNote === "string" ? movie.userNote.trim() : "";

  const record = buildQuickAddWatchedMovie(
    {
      ...movie,
      ...(resolvedId ? { imdbID: resolvedId } : {}),
      userRating: normalizedRating
    },
    now
  );

  if (!record) return null;
  record.userRating = normalizedRating;
  record.imdbRating = Number.isFinite(rawImdb) && rawImdb > 0 ? rawImdb : null;
  if (trimmedNote) {
    record.userNote = trimmedNote;
  } else {
    delete record.userNote;
  }

  return record;
}

export function prepareWatchlistPayload(movie) {
  if (!movie || typeof movie !== "object") return null;
  const resolvedId =
    movie.imdbID || movie.id || (movie.tmdbId ? `tmdb_${movie.tmdbId}` : undefined);
  const rawImdb = Number(movie.imdbRating ?? movie.rating);

  const record = buildQuickAddWatchedMovie({
    ...movie,
    ...(resolvedId ? { imdbID: resolvedId } : {}),
    userRating: 0
  });
  if (!record) return null;

  record.userRating = 0;
  record.imdbRating = Number.isFinite(rawImdb) && rawImdb > 0 ? rawImdb : null;
  delete record.dateWatched;
  return record;
}
