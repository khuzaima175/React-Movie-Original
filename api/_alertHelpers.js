import crypto from "node:crypto";
import { expandProviderIds } from "../src/services/tmdbService.js";

function escapeHtml(raw = "") {
  return String(raw ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeHttpUrl(rawUrl, fallback) {
  if (typeof rawUrl !== "string") return fallback;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function verifyCronAuthorization(req) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  const auth = String(req?.headers?.authorization || req?.headers?.Authorization || "");
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) return false;
  const provided = auth.slice(prefix.length);
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Diffs a movie's previous provider snapshot against current providers.
 * When `previousProviderIds === null` (first-ever check), records a baseline without alerting.
 */
export function diffWatchlistProviders({
  previousProviderIds = null,
  currentProviderIds = [],
  userPreferredProviderIds = []
} = {}) {
  const cleanCurrent = (Array.isArray(currentProviderIds) ? currentProviderIds : [])
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0);

  if (previousProviderIds === null || previousProviderIds === undefined) {
    return { isBaseline: true, newlyAvailableIds: [] };
  }

  const prevExpanded = new Set(expandProviderIds(previousProviderIds));
  const preferredExpanded = new Set(expandProviderIds(userPreferredProviderIds));

  if (preferredExpanded.size === 0) {
    return { isBaseline: false, newlyAvailableIds: [] };
  }

  const newlyAvailableIds = [];
  const seen = new Set();
  for (const id of cleanCurrent) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!prevExpanded.has(id) && preferredExpanded.has(id)) {
      newlyAvailableIds.push(id);
    }
  }

  return { isBaseline: false, newlyAvailableIds };
}

export function signUnsubscribeToken(userId, secret = process.env.CRON_SECRET || "") {
  const cleanUser = String(userId || "").trim();
  const cleanSecret = String(secret || "").trim();
  if (!cleanUser || !cleanSecret) return "";
  const payload = Buffer.from(cleanUser, "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", cleanSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(token, secret = process.env.CRON_SECRET || "") {
  const cleanSecret = String(secret || "").trim();
  if (typeof token !== "string" || !cleanSecret) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", cleanSecret)
    .update(payload)
    .digest("base64url");

  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    return Buffer.from(payload, "base64url").toString("utf8") || null;
  } catch {
    return null;
  }
}

export function buildWeeklyDigestEmail({
  displayName = "Film Lover",
  notifications = [],
  siteUrl = "https://cinemavault.app",
  unsubscribeUrl = ""
} = {}) {
  const items = Array.isArray(notifications) ? notifications.filter(Boolean) : [];
  if (items.length === 0) return null;

  const safeName = escapeHtml(displayName || "Film Lover");
  const safeSite = sanitizeHttpUrl(siteUrl, "https://cinemavault.app");
  const safeUnsub = sanitizeHttpUrl(unsubscribeUrl, `${safeSite}/account`);

  const rowsHtml = items
    .map((n) => {
      const title = escapeHtml(n.title || "Watchlisted Film");
      const provider = escapeHtml(n.provider_name || "Streaming");
      const link = sanitizeHttpUrl(n.watch_link, `${safeSite}/movie/tmdb_${n.tmdb_id || ""}`);
      return `<li style="margin:0 0 12px 0;padding:12px 14px;background:#18191e;border-radius:8px;border:1px solid #2a2c34;">
        <strong style="color:#f4f4f2;font-size:15px;">${title}</strong>
        <div style="color:#b6b6b2;font-size:13px;margin-top:4px;">Now streaming on <strong style="color:#ff6b73;">${provider}</strong> · <a href="${escapeHtml(link)}" style="color:#f4f4f2;">Watch now →</a></div>
      </li>`;
    })
    .join("");

  const textLines = items.map(
    (n) => `- ${n.title || "Film"} is now on ${n.provider_name || "streaming"} (${n.watch_link || safeSite})`
  );

  const countLabel = `${items.length} Watchlist Film${items.length === 1 ? "" : "s"}`;
  const subject = `CinemaVault Weekly: ${countLabel} Now Streaming`;

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#0b0b0c;color:#f4f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#121317;border:1px solid #262830;border-radius:12px;padding:24px;">
      <p style="margin:0 0 6px;color:#ff6b73;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">CinemaVault Weekly Digest</p>
      <h1 style="margin:0 0 12px;font-size:22px;color:#f4f4f2;">Hi ${safeName},</h1>
      <p style="margin:0 0 18px;color:#b6b6b2;font-size:14px;line-height:1.5;">
        ${countLabel} from your watchlist just arrived on your streaming services:
      </p>
      <ul style="list-style:none;padding:0;margin:0 0 20px;">${rowsHtml}</ul>
      <p style="margin:0 0 16px;">
        <a href="${escapeHtml(safeSite)}/vault?tab=watchlist" style="display:inline-block;padding:10px 18px;background:#e50914;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">Open My Watchlist</a>
      </p>
      <hr style="border:none;border-top:1px solid #262830;margin:20px 0;" />
      <p style="margin:0;color:#8e8e8a;font-size:12px;">
        You opted in to CinemaVault weekly watchlist digests.
        <a href="${escapeHtml(safeUnsub)}" style="color:#b6b6b2;">Unsubscribe in 1 click</a>.
      </p>
    </div>
  </body>
</html>`;

  const text = `Hi ${displayName || "Film Lover"},\n\n${countLabel} from your CinemaVault watchlist just arrived on streaming:\n${textLines.join("\n")}\n\nOpen Watchlist: ${safeSite}/vault?tab=watchlist\nUnsubscribe: ${safeUnsub}`;

  return { subject, html, text };
}
