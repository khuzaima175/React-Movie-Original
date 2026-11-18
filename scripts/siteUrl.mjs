/**
 * Resolves the canonical public origin for Open Graph tags at build time.
 */
export function resolveSiteUrl(env = {}) {
  const vercelHost = String(env?.VERCEL_PROJECT_PRODUCTION_URL || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (vercelHost) {
    return `https://${vercelHost}`;
  }

  const configured = String(env?.VITE_SITE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  return configured;
}
