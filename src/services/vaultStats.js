/**
 * Vault analytics helpers. Keeps UI components thin and allows unit testing
 * rating distributions directly without React mounts.
 */

export function buildRatingHistogramBins(watched = []) {
  const counts = new Map();
  for (let score = 10; score >= 1; score -= 1) {
    counts.set(score, 0);
  }

  for (const movie of Array.isArray(watched) ? watched : []) {
    if (!movie || typeof movie !== "object") continue;
    const rawUser = Number(movie.userRating);
    const rawImdb = Number(movie.imdbRating);
    const numericRating =
      Number.isFinite(rawUser) && rawUser > 0
        ? rawUser
        : Number.isFinite(rawImdb) && rawImdb > 0
          ? rawImdb
          : null;

    if (numericRating === null) continue;
    const rounded = Math.min(10, Math.max(1, Math.round(numericRating)));
    counts.set(rounded, (counts.get(rounded) || 0) + 1);
  }

  let maxCount = 1;
  for (const count of counts.values()) {
    if (count > maxCount) maxCount = count;
  }

  const bins = [];
  for (let score = 10; score >= 1; score -= 1) {
    const count = counts.get(score) || 0;
    bins.push({
      score,
      label: `${score}★`,
      count,
      heightPct: count > 0 ? Math.round((count / maxCount) * 100) : 0
    });
  }

  return { bins, maxCount };
}
