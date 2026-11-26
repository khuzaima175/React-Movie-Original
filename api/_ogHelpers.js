export const CRAWLER_UA_PATTERN =
  /(Twitterbot|facebookexternalhit|WhatsApp|Discordbot|Slackbot|LinkedInBot|TelegramBot|Applebot)/i;

/**
 * Escapes &, <, >, ", and ' for safe HTML attribute and SVG text interpolation.
 */
export function escapeHtmlAttr(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDefaultDescriptor(siteUrl = "") {
  const base = String(siteUrl || "").replace(/\/+$/, "");
  return {
    title: "CinemaVault — Personal Film Log & Curated Discovery",
    description: "Track films, build a taste model on your device, and get verified AI-curated picks.",
    imageUrl: base ? `${base}/og-image.png` : "/og-image.png",
    canonicalUrl: base ? `${base}/` : "/",
    type: "website",
    kicker: "CinemaVault",
    subtitle: "Personal Film Log & Taste Engine"
  };
}

function buildOgImageUrl(siteUrl, { kicker, title, subtitle }) {
  const base = String(siteUrl || "").replace(/\/+$/, "");
  const params = new URLSearchParams({
    kicker: String(kicker || "CinemaVault").slice(0, 60),
    title: String(title || "CinemaVault").slice(0, 120),
    subtitle: String(subtitle || "").slice(0, 180)
  });
  return `${base}/api/og-image?${params.toString()}`;
}

/**
 * Builds Open Graph metadata for public CinemaVault routes (`/u/:username`, `/list/:slug`,
 * `/together/:code`, `/movie/:id`). Falls back safely to generic metadata when `record`
 * is null or private.
 */
export function buildOgDescriptor({ routeType = "", param = "", record = null, siteUrl = "" } = {}) {
  const base = String(siteUrl || "").replace(/\/+$/, "");
  const cleanParam = String(param || "").trim();

  if (!record || typeof record !== "object") {
    return buildDefaultDescriptor(base);
  }

  if (routeType === "profile") {
    const handle = String(record.username || cleanParam).replace(/^@+/, "");
    const displayName = String(record.display_name || `@${handle}`).trim();
    const count = Number(record.watched_count || 0);
    const bio = String(record.bio || "").trim();
    const title = `${displayName} (@${handle}) on CinemaVault`;
    const subtitle = count > 0 ? `${count} films logged · Taste Twin compatible` : "Public Film Profile";
    const description = bio || `Explore ${displayName}'s rated films, Top 4 showcase, and check your 64-D Taste Match %.`;
    return {
      title,
      description,
      imageUrl: buildOgImageUrl(base, { kicker: "Public Profile", title: displayName, subtitle }),
      canonicalUrl: `${base}/u/${encodeURIComponent(handle)}`,
      type: "profile",
      kicker: "Public Profile",
      subtitle
    };
  }

  if (routeType === "list") {
    const listName = String(record.name || "Curated List").trim();
    const count = Array.isArray(record.items) ? record.items.length : Number(record.itemCount || 0);
    const desc = String(record.description || "").trim();
    const subtitle = `${count} ${count === 1 ? "film" : "films"} · Live Taste Match %`;
    return {
      title: `${listName} — CinemaVault List`,
      description: desc || `Browse "${listName}" (${count} films) and see your personal Taste Match % on every title.`,
      imageUrl: buildOgImageUrl(base, { kicker: "Curated List", title: listName, subtitle }),
      canonicalUrl: `${base}/list/${encodeURIComponent(cleanParam)}`,
      type: "article",
      kicker: "Curated List",
      subtitle
    };
  }

  if (routeType === "together") {
    const hostName = String(record.host_name || "A friend").trim();
    const title = `Swipe movies with ${hostName} — Watch Together`;
    const subtitle = `Room ${cleanParam.toUpperCase()} · Blend your tastes to find tonight's pick`;
    return {
      title,
      description: `Join ${hostName}'s CinemaVault Movie Night room (${cleanParam.toUpperCase()}) and swipe until you hit a mutual match.`,
      imageUrl: buildOgImageUrl(base, { kicker: "Watch Together", title: `${hostName}'s Movie Night`, subtitle }),
      canonicalUrl: `${base}/together/${encodeURIComponent(cleanParam)}`,
      type: "website",
      kicker: "Watch Together",
      subtitle
    };
  }

  if (routeType === "movie") {
    const movieTitle = String(record.title || record.Title || "Film").trim();
    const year = String(record.year || (record.release_date || "").slice(0, 4)).trim();
    const title = year ? `${movieTitle} (${year}) — CinemaVault` : `${movieTitle} — CinemaVault`;
    const overview = String(record.overview || record.plot || "").trim();
    const subtitle = year ? `${year} · Personal Match % & Where to Stream` : "Personal Match % & Where to Stream";
    return {
      title,
      description: overview || `See your personal Taste Match %, community reviews, and streaming options for ${movieTitle}.`,
      imageUrl: buildOgImageUrl(base, { kicker: "CinemaVault Film", title: year ? `${movieTitle} (${year})` : movieTitle, subtitle }),
      canonicalUrl: `${base}/movie/${encodeURIComponent(cleanParam)}`,
      type: "video.movie",
      kicker: "CinemaVault Film",
      subtitle
    };
  }

  return buildDefaultDescriptor(base);
}

/**
 * Renders minimal crawler-safe HTML containing dynamic Open Graph and Twitter card metadata.
 */
export function renderOgHtml(descriptor = {}) {
  const title = escapeHtmlAttr(descriptor.title || "CinemaVault");
  const description = escapeHtmlAttr(descriptor.description || "");
  const imageUrl = escapeHtmlAttr(descriptor.imageUrl || "/og-image.png");
  const canonicalUrl = escapeHtmlAttr(descriptor.canonicalUrl || "/");
  const ogType = escapeHtmlAttr(descriptor.type || "website");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="CinemaVault" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${imageUrl}" />
</head>
<body>
  <main><h1>${title}</h1><p>${description}</p></main>
</body>
</html>`;
}

/**
 * Renders a 1200x630 editorial dark SVG social card with CinemaVault brass accents.
 */
export function renderOgSvgCard({ title = "CinemaVault", subtitle = "", kicker = "CinemaVault" } = {}) {
  const safeKicker = escapeHtmlAttr(String(kicker || "CinemaVault").slice(0, 60));
  const safeTitle = escapeHtmlAttr(String(title || "CinemaVault").slice(0, 64));
  const safeSub = escapeHtmlAttr(String(subtitle || "").slice(0, 110));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d0e11" />
      <stop offset="60%" stop-color="#14161c" />
      <stop offset="100%" stop-color="#1a1814" />
    </linearGradient>
    <radialGradient id="glow" cx="85%" cy="20%" r="60%">
      <stop offset="0%" stop-color="#e2b13c" stop-opacity="0.18" />
      <stop offset="100%" stop-color="#e2b13c" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect width="1200" height="630" fill="url(#glow)" />
  <rect x="44" y="44" width="1112" height="542" rx="24" fill="none" stroke="#2c2f38" stroke-width="2" />
  <text x="96" y="148" fill="#e2b13c" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700" letter-spacing="4">${safeKicker.toUpperCase()}</text>
  <text x="96" y="290" fill="#f3f1eb" font-family="Georgia, serif" font-size="60" font-weight="700">${safeTitle}</text>
  <text x="96" y="370" fill="#a8a9b0" font-family="system-ui, -apple-system, sans-serif" font-size="30">${safeSub}</text>
  <line x1="96" y1="478" x2="1104" y2="478" stroke="#2a2c34" stroke-width="1.5" />
  <text x="96" y="534" fill="#f3f1eb" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="700">CinemaVault</text>
  <text x="275" y="534" fill="#7d808a" font-family="system-ui, -apple-system, sans-serif" font-size="22">Personal Film Log · On-Device Taste Engine</text>
</svg>`;
}

const VALID_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d{1,5})?$/i;

/**
 * Resolves a verified public origin for Open Graph tags, ignoring untrusted forwarded headers
 * when a canonical Vercel host is configured and validating proto/host syntax otherwise.
 */
export function resolveSafeSiteUrl(headers = {}, env = process.env) {
  const prod = String(env?.VERCEL_PROJECT_PRODUCTION_URL || env?.VERCEL_URL || "").trim();
  if (prod) {
    const cleanProd = prod.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    if (VALID_HOST_RE.test(cleanProd)) {
      return `https://${cleanProd}`;
    }
  }

  const rawProto = String(headers?.["x-forwarded-proto"] || "https").split(",")[0].trim().toLowerCase();
  if (rawProto !== "http" && rawProto !== "https") {
    return "";
  }

  const rawHost = String(headers?.["x-forwarded-host"] || headers?.host || "").split(",")[0].trim();
  if (!rawHost || !VALID_HOST_RE.test(rawHost)) {
    return "";
  }

  return `${rawProto}://${rawHost}`;
}

/**
 * Fetches public Watch Together room summary via the `get_watch_session_by_code` RPC
 * (required because `watch_sessions` has RLS with zero direct SELECT policies).
 */
export async function fetchTogetherRoomForOg(supabase, roomCode = "") {
  const cleanCode = String(roomCode || "").trim().toUpperCase();
  if (!supabase || typeof supabase.rpc !== "function" || !/^[A-Z0-9]{6,12}$/.test(cleanCode)) {
    return null;
  }

  const { data, error } = await supabase.rpc("get_watch_session_by_code", {
    p_room_code: cleanCode
  });
  if (error || !data || typeof data !== "object") {
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.room_code) return null;
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return null;
  }

  return {
    room_code: row.room_code,
    host_name: row.host_name || "A friend",
    region: row.region || "US",
    expires_at: row.expires_at || null
  };
}
