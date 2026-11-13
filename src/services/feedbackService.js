/**
 * Feedback Signal Normalization & Conversion Tracking Service
 */
import { sanitizeFeatureSnapshot } from "./onlineLearningService.js";

function matchesFeedbackEntry(existing, incoming) {
  if (!existing || !incoming) return false;
  if (existing.tmdbId && incoming.tmdbId && Number(existing.tmdbId) === Number(incoming.tmdbId)) {
    return true;
  }
  if (existing.imdbID && incoming.imdbID && String(existing.imdbID).toLowerCase() === String(incoming.imdbID).toLowerCase()) {
    return true;
  }
  if (existing.title && incoming.title) {
    return String(existing.title).toLowerCase().trim() === String(incoming.title).toLowerCase().trim();
  }
  return false;
}

/**
 * Normalizes and merges a feedback event into the log (capped at maxEvents = 500).
 */
export function normalizeFeedbackEvent(feedbackItem, prevLog = [], maxEvents = 500) {
  if (!feedbackItem || (!feedbackItem.title && !feedbackItem.tmdbId && !feedbackItem.imdbID)) {
    return Array.isArray(prevLog) ? prevLog : [];
  }

  const list = Array.isArray(prevLog) ? prevLog : [];
  const existing = list.find(f => matchesFeedbackEntry(f, feedbackItem));
  const filtered = list.filter(f => !matchesFeedbackEntry(f, feedbackItem));

  const cleanFeatures =
    sanitizeFeatureSnapshot(feedbackItem.features) ||
    sanitizeFeatureSnapshot(existing?.features) ||
    null;

  const merged = {
    ...(existing || {}),
    ...feedbackItem,
    tmdbId: feedbackItem.tmdbId ?? existing?.tmdbId ?? null,
    imdbID: feedbackItem.imdbID ?? existing?.imdbID ?? null,
    matchScoreAtTime: feedbackItem.matchScoreAtTime ?? existing?.matchScoreAtTime ?? null,
    sourceBucket: feedbackItem.sourceBucket ?? existing?.sourceBucket ?? null,
    features: cleanFeatures,
    previousAction: existing && existing.action !== feedbackItem.action ? existing.action : (existing?.previousAction ?? null),
    ts: feedbackItem.ts || new Date().toISOString()
  };

  return [...filtered, merged].slice(-maxEvents);
}

/**
 * Records a "rated" conversion if the rated movie matches an entry in feedbackLog or aiRecommendations.
 */
export function recordRatedMovieConversion(movie, prevLog = [], aiRecommendations = [], maxEvents = 500) {
  const list = Array.isArray(prevLog) ? prevLog : [];
  if (!movie || !(Number(movie.userRating) > 0)) return list;

  const matchedLog = list.find(f => matchesFeedbackEntry(f, movie));
  const matchedRec = (Array.isArray(aiRecommendations) ? aiRecommendations : []).find(
    r => matchesFeedbackEntry(r, movie)
  );

  if (!matchedLog && !matchedRec) return list;

  return normalizeFeedbackEvent(
    {
      title: movie.title,
      year: movie.year,
      tmdbId: movie.tmdbId ?? matchedRec?.tmdbId ?? matchedLog?.tmdbId ?? null,
      imdbID: movie.imdbID ?? matchedRec?.imdbID ?? matchedLog?.imdbID ?? null,
      matchScoreAtTime: matchedLog?.matchScoreAtTime ?? matchedRec?.matchScore ?? null,
      sourceBucket: matchedLog?.sourceBucket ?? matchedRec?.sourceBucket ?? null,
      features: matchedLog?.features ?? matchedRec?.features ?? null,
      action: "rated",
      userRating: Number(movie.userRating)
    },
    list,
    maxEvents
  );
}
