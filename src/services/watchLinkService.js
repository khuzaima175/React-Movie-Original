export const PROVIDER_SEARCH_TEMPLATES = Object.freeze({
  8: (q) => `https://www.netflix.com/search?q=${q}`,
  9: (q) => `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${q}`,
  119: (q) => `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${q}`,
  337: (q) => `https://www.disneyplus.com/search?q=${q}`,
  1899: (q) => `https://play.max.com/search?q=${q}`,
  384: (q) => `https://play.max.com/search?q=${q}`,
  350: (q) => `https://tv.apple.com/search?term=${q}`,
  15: (q) => `https://www.hulu.com/search?q=${q}`,
  386: (q) => `https://www.peacocktv.com/watch/search?q=${q}`,
  531: (q) => `https://www.paramountplus.com/search/?q=${q}`,
  11: (q) => `https://mubi.com/en/search?query=${q}`,
  258: (q) => `https://www.criterionchannel.com/search?q=${q}`
});

function sanitizeHttpsUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves a safe external streaming launch URL for a provider badge:
 * 1) Verified TMDB/JustWatch regional watch link when available
 * 2) Direct provider search fallback for major platforms
 * 3) JustWatch search fallback for any other provider
 */
export function resolveProviderLaunchUrl({
  providerId = null,
  providerName = "",
  title = "",
  year = "",
  watchProviderLink = null
} = {}) {
  const safeName = String(providerName || "streaming").trim();
  const safeTitle = String(title || "").trim();
  const safeYear = String(year || "").replace(/\D/g, "").slice(0, 4);

  const verifiedWatchLink = sanitizeHttpsUrl(watchProviderLink);
  if (verifiedWatchLink) {
    return {
      href: verifiedWatchLink,
      mode: "justwatch",
      label: `Watch ${safeTitle || "film"} on ${safeName} via JustWatch`
    };
  }

  const template = PROVIDER_SEARCH_TEMPLATES[Number(providerId)];
  if (template) {
    const query = encodeURIComponent(safeTitle || safeName);
    return {
      href: template(query),
      mode: "provider-search",
      label: `Search ${safeTitle || "film"} on ${safeName}`
    };
  }

  const searchTerms = [safeTitle, safeYear].filter(Boolean).join(" ").trim() || safeName;
  return {
    href: `https://www.justwatch.com/us/search?q=${encodeURIComponent(searchTerms)}`,
    mode: "web-search",
    label: `Find ${safeTitle || "film"} on ${safeName} via JustWatch`
  };
}
