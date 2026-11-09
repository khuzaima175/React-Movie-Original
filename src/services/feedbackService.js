/**
 * Feedback Signal Normalization & Conversion Tracking Service
 */

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

  const merged = {
    ...(existing || {}),
    ...feedbackItem,
    tmdbId: feedbackItem.tmdbId ?? existing?.tmdbId ?? null,
    imdbID: feedbackItem.imdbID ?? existing?.imdbID ?? null,
    matchScoreAtTime: feedbackItem.matchScoreAtTime ?? existing?.matchScoreAtTime ?? null,
    sourceBucket: feedbackItem.sourceBucket ?? existing?.sourceBucket ?? null,
    previousAction: existing && existing.action !== feedbackItem.action ? existing.action : (existing?.previousAction ?? null),
    ts: feedbackItem.ts || new Date().toISOString()
  };

  return [...filtered, merged].slice(-maxEvents);
}
