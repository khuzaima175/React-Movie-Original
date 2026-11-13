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
