import { formatModelDisplayName } from "./geminiService.js";

/**
 * Formatting helpers that keep the AI Oracle UI compact without changing
 * underlying recommendation payloads or filtering logic.
 */

export function formatStreamingSummary(
  userRegion = "GLOBAL",
  userWatchProviders = [],
  availableRegions = [],
  providers = []
) {
  const normalizedRegion =
    typeof userRegion === "string" && userRegion.trim() ? userRegion.trim() : "GLOBAL";
  const selectedIds = Array.isArray(userWatchProviders) ? userWatchProviders : [];

  let regionLabel = "All Regions";
  if (normalizedRegion !== "GLOBAL") {
    const matchedRegion = availableRegions.find((region) => region?.code === normalizedRegion);
    regionLabel = matchedRegion?.name || normalizedRegion;
  }

  let platformLabel = "Any Platform";
  if (selectedIds.length > 0) {
    const matchedNames = selectedIds
      .map((id) => providers.find((provider) => provider?.id === id)?.name)
      .filter(Boolean);

    if (selectedIds.length <= 2 && matchedNames.length === selectedIds.length) {
      platformLabel = matchedNames.join(", ");
    } else {
      const noun = selectedIds.length === 1 ? "streaming service" : "streaming services";
      platformLabel = `${selectedIds.length} ${noun}`;
    }
  }

  return {
    summaryText: `${regionLabel} • ${platformLabel}`,
    hasCustomFilter: normalizedRegion !== "GLOBAL" || selectedIds.length > 0
  };
}

/**
 * Build concise user-facing freshness/model labels while preserving technical
 * pipeline, slug, cache, cooldown, and token details in the hover tooltip.
 */
export function formatRecBadgeSummary(modelInfo, isCacheValid = false, queuedModel = null) {
  const cached = Boolean(isCacheValid);
  const freshnessLabel = cached ? "Saved Picks" : "Fresh Picks";
  const freshnessTone = cached ? "cached" : "stale";

  if (!modelInfo || !modelInfo.model) {
    const tooltipParts = modelInfo
      ? [
          "Model: Local Ranker (Offline Fallback)",
          `Pipeline: ${modelInfo.pipeline || "local-ranker"}`
        ]
      : [
          queuedModel
            ? `Next cascade model queued: ${formatModelDisplayName(queuedModel)} (${queuedModel})`
            : "Local Ranker offline fallback active."
        ];
    if (modelInfo?.fromCache || cached) {
      tooltipParts.push("Origin: 500KB LRU Cache");
    }
    if (modelInfo?.usageMetadata?.totalTokenCount) {
      tooltipParts.push(`Tokens: ${modelInfo.usageMetadata.totalTokenCount}`);
    }
    return {
      freshnessLabel,
      freshnessTone,
      modelLabel: "Local Ranker",
      tooltip: tooltipParts.join(" | ")
    };
  }

  const displayName = formatModelDisplayName(modelInfo.model);
  const modelLabel = modelInfo.isFallback ? `Fallback: ${displayName}` : displayName;
  const parts = [
    `Model: ${displayName} (${modelInfo.model})`,
    `Pipeline: ${modelInfo.pipeline || "gemini-curation"}`
  ];
  if (modelInfo.fromCache || cached) {
    parts.push("Origin: 500KB LRU Cache");
  }
  if (modelInfo.cooldownModels?.length > 0) {
    const skipped = modelInfo.cooldownModels.map((c) => `${c.model} (${c.reason})`).join(", ");
    parts.push(`Skipped/Fallback from: ${skipped}`);
  }
  if (modelInfo.usageMetadata?.totalTokenCount) {
    parts.push(`Tokens: ${modelInfo.usageMetadata.totalTokenCount}`);
  }

  return {
    freshnessLabel,
    freshnessTone,
    modelLabel,
    tooltip: parts.join(" | ")
  };
}

/**
 * Resolves 2-3 anchor films from the user's watched vault to show as
 * "Because you rated ..." evidence beside a recommendation.
 */
export function resolveRecommendationAnchors(rec, watched = [], maxCount = 3) {
  if (!rec || !Array.isArray(watched) || watched.length === 0) {
    return [];
  }

  const normalizeTitle = (str) =>
    String(str || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim();

  const candidateScoreMap = new Map();
  const ratedWatched = watched
    .filter((m) => m && (m.title || m.Title))
    .map((m) => ({
      id: m.imdbID || m.id || (m.tmdbId ? `tmdb_${m.tmdbId}` : ""),
      tmdbId: m.tmdbId ?? null,
      title: m.title || m.Title,
      year: m.year || m.Year || "",
      poster: m.poster || m.Poster || null,
      genre: m.genre || "",
      userRating: Number(m.userRating) || 0
    }))
    .filter((m) => m.id);

  // 1. Explicit anchorTitles / anchorIds returned by Gemini
  const explicitTitles = Array.isArray(rec.anchorTitles) ? rec.anchorTitles : [];
  const explicitIds = Array.isArray(rec.anchorIds) ? rec.anchorIds.map(String) : [];

  for (const m of ratedWatched) {
    let score = 0;
    const norm = normalizeTitle(m.title);

    if (explicitIds.includes(String(m.id)) || (m.tmdbId && explicitIds.includes(String(m.tmdbId)))) {
      score += 100;
    }
    if (explicitTitles.some((t) => normalizeTitle(t) === norm)) {
      score += 90;
    }

    // 2. Direct title mention inside the recommendation's reason prose
    const reasonText = normalizeTitle(rec.reason);
    if (norm.length >= 4 && reasonText.includes(norm)) {
      score += 75;
    }

    if (score > 0) {
      candidateScoreMap.set(m.id, { film: m, matchStrength: score + m.userRating });
    }
  }

  const matched = Array.from(candidateScoreMap.values())
    .sort((a, b) => b.matchStrength - a.matchStrength)
    .map((entry) => entry.film);

  if (matched.length >= maxCount) {
    return matched.slice(0, maxCount);
  }

  // 3. Deterministic fallback to high-rated genre-aligned vault films
  const recGenres = new Set(
    String(rec.genre || "")
      .toLowerCase()
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean)
  );

  const usedIds = new Set(matched.map((m) => m.id));
  const fallbackPool = ratedWatched
    .filter((m) => !usedIds.has(m.id) && m.userRating >= 7)
    .map((m) => {
      const filmGenres = String(m.genre || "")
        .toLowerCase()
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);
      const shared = filmGenres.filter((g) => recGenres.has(g)).length;
      return { film: m, rankScore: shared * 20 + m.userRating };
    })
    .sort((a, b) => b.rankScore - a.rankScore)
    .map((entry) => entry.film);

  return [...matched, ...fallbackPool].slice(0, maxCount);
}

