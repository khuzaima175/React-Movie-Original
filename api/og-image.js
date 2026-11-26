import { renderOgSvgCard } from "./_ogHelpers.js";

export default function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader?.("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }

  const kicker = String(req.query?.kicker || "CinemaVault");
  const title = String(req.query?.title || "CinemaVault");
  const subtitle = String(req.query?.subtitle || "Personal Film Log & Taste Engine");

  const svg = renderOgSvgCard({ kicker, title, subtitle });
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400");
  return res.status(200).send(svg);
}
