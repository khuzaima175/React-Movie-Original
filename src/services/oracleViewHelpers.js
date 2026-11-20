import { formatModelDisplayName } from "./geminiService.js";
import { MOOD_OPTIONS } from "./moodPolicy.js";

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
function formatHydrationLabel(hydrationCoverage) {
  const total = Number(hydrationCoverage?.total);
  const hydrated = Number(hydrationCoverage?.hydrated);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(hydrated)) {
    return null;
  }
  const pct = Number.isFinite(Number(hydrationCoverage?.percent))
    ? Number(hydrationCoverage.percent)
    : Math.round((hydrated / total) * 100);
  return `${hydrated}/${total} films hydrated (${pct}%)`;
}

export function formatRecBadgeSummary(modelInfo, isCacheValid = false, queuedModel = null, { debug = false } = {}) {
  const cached = Boolean(isCacheValid);
  const freshnessLabel = cached ? "Saved Picks" : "Fresh Picks";
  const freshnessTone = cached ? "cached" : "stale";
  const hydrationLabel = formatHydrationLabel(modelInfo?.hydrationCoverage);

  if (!debug) {
    const hasAiModel = Boolean(modelInfo?.model);
    const modelLabel = hasAiModel ? "AI Curated" : "On-Device Engine";
    const tooltipParts = [
      hasAiModel
        ? "Curated by AI from a shortlist verified against TMDB"
        : "Ranked on-device from your taste profile"
    ];
    if (modelInfo?.fromCache || cached) {
      tooltipParts.push("Saved from your last session");
    }
    if (hydrationLabel) {
      tooltipParts.push(`Metadata: ${hydrationLabel}`);
    }
    return {
      freshnessLabel,
      freshnessTone,
      modelLabel,
      hydrationLabel,
      tooltip: tooltipParts.join(" | ")
    };
  }

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
    if (hydrationLabel) {
      tooltipParts.push(`Metadata: ${hydrationLabel}`);
    }
    if (modelInfo?.usageMetadata?.totalTokenCount) {
      tooltipParts.push(`Tokens: ${modelInfo.usageMetadata.totalTokenCount}`);
    }
    return {
      freshnessLabel,
      freshnessTone,
      modelLabel: "Local Ranker",
      hydrationLabel,
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
  if (hydrationLabel) {
    parts.push(`Metadata: ${hydrationLabel}`);
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
    hydrationLabel,
    tooltip: parts.join(" | ")
  };
}

/**
 * Explains calmly when shared AI curation fell back to the on-device hybrid ranker.
 */
export function describePipelineNotice(modelInfo) {
  if (modelInfo?.pipeline === "ranker-fallback") {
    return "Shared AI curation is at capacity, so these picks come from your on-device taste model.";
  }
  return null;
}

/**
 * Selects the highest-rated film poster from the user's vault as a subtle Studio Deck wash.
 */
export function selectStudioBackdropPoster(watched) {
  if (!Array.isArray(watched) || watched.length === 0) return null;
  let bestPoster = null;
  let bestRating = -Infinity;
  let bestDateMs = -Infinity;

  for (const movie of watched) {
    const poster = String(movie?.poster || movie?.Poster || "").trim();
    if (!poster || poster === "N/A") continue;
    const rating = Number(movie?.userRating ?? movie?.UserRating ?? 0);
    const parsedDate = Date.parse(String(movie?.dateWatched || ""));
    const dateMs = Number.isFinite(parsedDate) ? parsedDate : 0;

    if (rating > bestRating || (rating === bestRating && dateMs > bestDateMs)) {
      bestPoster = poster;
      bestRating = rating;
      bestDateMs = dateMs;
    }
  }

  return bestPoster;
}

/**
 * Generates the four Oracle loading progress messages, hiding raw model slugs in public mode.
 */
export function buildOracleLoadingSteps({ watchedCount = 0, queuedModel = null, debug = false } = {}) {
  const step1 =
    watchedCount >= 3
      ? `Analyzing ${watchedCount} rated films with time-weighted affinities...`
      : "Preparing initial taste calibration...";

  let step4;
  if (debug) {
    step4 = `Curating final picks via ${queuedModel ? formatModelDisplayName(queuedModel) : "Local Ranker"}...`;
  } else {
    step4 = queuedModel
      ? "Curating your final 10 picks..."
      : "Ranking your final picks on-device...";
  }

  return [
    step1,
    "Querying TMDB discovery candidates...",
    "Ranking films against your vault history...",
    step4
  ];
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

/**
 * Clean legacy AI-chrome buzzwords ("High Taste-Twin Match", "Core Theme Match",
 * "Genre Bullseye", or "A 98% High Taste-Twin Match that ...") out of cached or
 * model-generated recommendation reasons while keeping real film criticism intact.
 */
export function sanitizeOracleReason(reason) {
  if (typeof reason !== "string") return "";
  const trimmed = reason.trim();
  if (!trimmed) return "";

  let cleaned = trimmed
    // Strip phrases like "A 98% High Taste-Twin Match that channels..."
    .replace(
      /^(?:a|an)\s+\d{1,3}%\s+(?:high|elite|prime|strong)?\s*taste-twin\s+match\s+(?:that|which)\s+/i,
      ""
    )
    // Strip "... and earning a High Taste-Twin Match, Core Theme Match, and Genre Bullseye, "
    .replace(
      /,?\s*(?:and\s+)?earning\s+(?:a|an)?\s*(?:high|elite|prime|strong)?\s*taste-twin\s+match(?:,?\s*core\s+theme\s+match)?(?:,?\s*(?:and\s+)?genre\s+bullseye)?\s*,?\s*/gi,
      ", "
    )
    // Strip standalone leakage terms
    .replace(/\b(?:high|elite|prime|strong)?\s*taste-twin\s+match\b/gi, "")
    .replace(/\bcore\s+theme\s+match\b/gi, "")
    .replace(/\bgenre\s+bullseye\b/gi, "")
    // Normalize leftover punctuation / spacing
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[,;\s]+/, "")
    .replace(/,\s*,+/g, ",")
    .trim();

  if (cleaned) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Formats a concise UI summary line for active mood + free-text vibe filters.
 */
export function formatActiveVibeNote(filters, moodOptions = MOOD_OPTIONS) {
  if (!filters || typeof filters !== "object") return "";

  const parts = [];
  if (filters.moodId && filters.moodId !== "any") {
    const preset = (moodOptions || MOOD_OPTIONS).find((m) => m.id === filters.moodId);
    parts.push(preset ? preset.label : filters.moodId);
  }
  if (Array.isArray(filters.withGenres) && filters.withGenres.length > 0) {
    parts.push(filters.withGenres.join(", "));
  }
  if (filters.minYear && filters.maxYear) {
    parts.push(`${filters.minYear}–${filters.maxYear}`);
  } else if (filters.minYear) {
    parts.push(`${filters.minYear}+`);
  } else if (filters.maxYear) {
    parts.push(`Through ${filters.maxYear}`);
  }
  if (Array.isArray(filters.withoutKeywords) && filters.withoutKeywords.length > 0) {
    parts.push(`Avoiding: ${filters.withoutKeywords.join(", ")}`);
  }

  return parts.length > 0 ? `Active vibe: ${parts.join(" • ")}` : "";
}

/**
 * Tracks session seen recommendation IDs (bounded at 120) and rotates TMDB discovery
 * pages cyclically (1..5) when explicitly refreshing picks.
 */
export function nextRefreshExcludeState(prevState = { seenIds: [], page: 1 }, currentRecs = [], forceRefresh = false) {
  if (!forceRefresh) {
    return { seenIds: [], excludeIds: [], page: 1 };
  }

  const maxHistory = 120;
  const existing = Array.isArray(prevState?.seenIds) ? prevState.seenIds.map(String).filter(Boolean) : [];
  const nextSet = new Set(existing);

  for (const rec of Array.isArray(currentRecs) ? currentRecs : []) {
    const primary = rec?.tmdbId ?? rec?.id ?? rec?.imdbID;
    if (primary !== undefined && primary !== null && String(primary).trim()) {
      nextSet.add(String(primary).trim());
    }
  }

  const allSeen = Array.from(nextSet);
  const boundedSeen = allSeen.length > maxHistory ? allSeen.slice(allSeen.length - maxHistory) : allSeen;
  const currentPage = Math.max(1, Math.floor(Number(prevState?.page) || 1));
  const nextPage = currentPage >= 5 ? 1 : currentPage + 1;

  return {
    seenIds: boundedSeen,
    excludeIds: boundedSeen,
    page: nextPage
  };
}

/**
 * Returns true when closing the filter drawer leaves the active recommendation hash
 * out of sync with the currently selected mood/provider/region state.
 */
export function shouldAutoRefreshOnDrawerClose(isDrawer, currentHash, activeHash, isLoading = false) {
  if (!isDrawer || isLoading) return false;
  if (!currentHash || !activeHash) return false;
  return currentHash !== activeHash;
}


/**
 * Summarizes secondary Film Oracle preferences (Region, Streaming Platforms,
 * Active Taste Rules, Personal AI Key) for the unified "Filters & Rules" popover trigger.
 */
export function summarizeOraclePreferences({
  userRegion = "GLOBAL",
  userWatchProviders = [],
  tasteRules = [],
  usingOwnKey = false
} = {}) {
  const normalizedRegion =
    typeof userRegion === "string" && userRegion.trim() ? userRegion.trim().toUpperCase() : "GLOBAL";
  const hasRegion = normalizedRegion !== "GLOBAL";

  const uniqueProviders = Array.isArray(userWatchProviders)
    ? Array.from(new Set(userWatchProviders.filter((id) => id !== null && id !== undefined && id !== "")))
    : [];
  const providerCount = uniqueProviders.length;

  const activeRuleCount = Array.isArray(tasteRules)
    ? tasteRules.filter((rule) => rule && rule.active !== false && String(rule.text || "").trim()).length
    : 0;

  const parts = [];
  let badgeCount = 0;

  if (hasRegion) {
    parts.push(normalizedRegion);
    badgeCount += 1;
  }
  if (providerCount > 0) {
    parts.push(providerCount === 1 ? "1 platform" : `${providerCount} platforms`);
    badgeCount += 1;
  }
  if (activeRuleCount > 0) {
    parts.push(activeRuleCount === 1 ? "1 rule" : `${activeRuleCount} rules`);
    badgeCount += activeRuleCount;
  }
  if (usingOwnKey) {
    parts.push("Personal key");
    badgeCount += 1;
  }

  return {
    badgeCount,
    summaryText: parts.length > 0 ? parts.join(" · ") : "Filters & Rules"
  };
}
