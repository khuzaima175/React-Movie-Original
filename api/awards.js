import { enforceApiSecurity } from "./_security.js";
import { fetchWikidataAwardsDirect } from "../src/services/awardsService.js";

export default async function handler(req, res) {
  if (!(await enforceApiSecurity(req, res, { bucket: "awards", maxRequests: 60, windowMs: 60_000 }))) {
    return;
  }

  if (req.method !== "GET") {
    res.setHeader?.("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const query = req.query || {};
  const imdb = String(Array.isArray(query.imdb) ? query.imdb[0] : query.imdb || "").trim();
  const tmdb = String(Array.isArray(query.tmdb) ? query.tmdb[0] : query.tmdb || "").trim();

  const validImdb = /^tt\d{5,10}$/i.test(imdb) ? imdb : "";
  const validTmdb = /^\d{1,10}$/.test(tmdb) ? tmdb : "";

  if (!validImdb && !validTmdb) {
    return res.status(400).json({ error: "Provide a valid imdb (tt...) or numeric tmdb parameter" });
  }

  const fetchFn = typeof req.fetchFn === "function" ? req.fetchFn : fetch;

  try {
    const data = await fetchWikidataAwardsDirect({
      imdbID: validImdb,
      tmdbId: validTmdb,
      fetchFn,
      corsOrigin: false
    });
    res.setHeader?.("Cache-Control", "public, s-maxage=604800, stale-while-revalidate=2592000");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: err?.message || "Failed to fetch awards breakdown" });
  }
}
