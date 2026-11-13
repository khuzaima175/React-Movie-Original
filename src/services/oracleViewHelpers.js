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
