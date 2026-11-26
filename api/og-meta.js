import { createClient } from "@supabase/supabase-js";
import {
  buildOgDescriptor,
  fetchTogetherRoomForOg,
  renderOgHtml,
  resolveSafeSiteUrl
} from "./_ogHelpers.js";

function getPublicSupabase() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ""
  ).trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function fetchMovieSummaryForOg(rawId) {
  const tmdbKey = String(process.env.TMDB_API_KEY || process.env.VITE_TMDB_KEY || "").trim();
  if (!tmdbKey) return null;

  const clean = String(rawId || "").trim();
  let tmdbId = null;
  if (/^tmdb_\d+$/i.test(clean)) {
    tmdbId = clean.slice(5);
  } else if (/^\d+$/.test(clean)) {
    tmdbId = clean;
  } else if (/^tt\d+$/i.test(clean)) {
    const findRes = await fetch(
      `https://api.themoviedb.org/3/find/${encodeURIComponent(clean)}?external_source=imdb_id&api_key=${encodeURIComponent(tmdbKey)}`
    ).catch(() => null);
    if (findRes?.ok) {
      const findJson = await findRes.json().catch(() => null);
      const hit = Array.isArray(findJson?.movie_results) ? findJson.movie_results[0] : null;
      if (hit?.id) tmdbId = String(hit.id);
    }
  }

  if (!tmdbId) return null;
  const movieRes = await fetch(
    `https://api.themoviedb.org/3/movie/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(tmdbKey)}`
  ).catch(() => null);
  if (!movieRes?.ok) return null;
  return movieRes.json().catch(() => null);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader?.("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }

  const routeType = String(req.query?.type || "").trim().toLowerCase();
  const param = String(req.query?.id || "").trim();
  const siteUrl = resolveSafeSiteUrl(req?.headers || {}, process.env);
  let record = null;

  try {
    if (routeType === "profile" && /^[a-z0-9_]{3,24}$/i.test(param.replace(/^@+/, ""))) {
      const supabase = getPublicSupabase();
      if (supabase) {
        const handle = param.replace(/^@+/, "").toLowerCase();
        const { data } = await supabase
          .from("public_profiles")
          .select("username, display_name, bio, watched_count")
          .eq("username", handle)
          .maybeSingle();
        record = data || null;
      }
    } else if (routeType === "list" && /^[a-z0-9-]{4,96}$/i.test(param)) {
      const supabase = getPublicSupabase();
      if (supabase) {
        const { data } = await supabase
          .from("user_lists")
          .select("name, description, items, slug")
          .eq("slug", param.toLowerCase())
          .eq("is_public", true)
          .is("deleted_at", null)
          .maybeSingle();
        record = data || null;
      }
    } else if (routeType === "together" && /^[A-Z0-9]{6,12}$/i.test(param)) {
      const supabase = getPublicSupabase();
      if (supabase) {
        record = await fetchTogetherRoomForOg(supabase, param);
      }
    } else if (routeType === "movie" && param) {
      record = await fetchMovieSummaryForOg(param);
    }
  } catch {
    record = null;
  }

  const descriptor = buildOgDescriptor({ routeType, param, record, siteUrl });
  const html = renderOgHtml(descriptor);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
  return res.status(200).send(html);
}
