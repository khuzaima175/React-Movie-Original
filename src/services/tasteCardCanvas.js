import { computeYearlyDiaryStats } from "./diaryService.js";
import { buildRatingHistogramBins } from "./vaultStats.js";

export const TASTE_CARD_ASPECTS = Object.freeze({
  story: { width: 1080, height: 1920 },
  wide: { width: 1200, height: 630 }
});

/**
 * Pure geometry calculator for Canvas rendering so Story (9:16) poster rows never collide
 * with footer metadata.
 */
export function computeTasteCardLayout(aspect = "story") {
  const isStory = aspect !== "wide";
  const dims = isStory ? TASTE_CARD_ASPECTS.story : TASTE_CARD_ASPECTS.wide;
  const { width, height } = dims;
  const pad = isStory ? 68 : 44;
  const statsY = isStory ? pad + 178 : pad + 106;
  const statsH = isStory ? 116 : 82;
  const posterY = isStory ? statsY + 150 : statsY + 114;
  const posterGap = isStory ? 28 : 18;
  const posterW = isStory ? 420 : 160;
  const posterH = Math.round(posterW * 1.44);
  const rowGap = isStory ? 56 : 0;
  const footerY = height - pad;
  const footerTop = footerY - (isStory ? 68 : 42);

  return {
    isStory,
    width,
    height,
    pad,
    statsY,
    statsH,
    posterY,
    posterGap,
    posterW,
    posterH,
    rowGap,
    footerY,
    footerTop
  };
}

function loadPosterImage(url) {
  return new Promise((resolve) => {
    if (!url || url === "N/A" || typeof Image === "undefined") {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve(null), 3500);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Computes normalized Taste Passport metrics for Canvas rendering from watched films.
 */
export function buildTasteCardData({ watched = [], profile = null, year = null } = {}) {
  const realWatched = (Array.isArray(watched) ? watched : []).filter((m) => m && !m.isSample);
  const source = year
    ? realWatched.filter((m) => String(m.dateWatched || "").startsWith(`${year}-`))
    : realWatched;

  let totalMinutes = 0;
  let ratingSum = 0;
  let ratingCount = 0;
  const genreCounts = new Map();
  const directorCounts = new Map();

  for (const m of source) {
    const mins = parseInt(m.runtime, 10);
    totalMinutes += Number.isFinite(mins) && mins > 0 ? mins : 120;
    const score = Number(m.userRating);
    if (Number.isFinite(score) && score > 0) {
      ratingSum += score;
      ratingCount += 1;
    }
    if (m.genre) {
      for (const g of String(m.genre).split(",").map((s) => s.trim()).filter(Boolean)) {
        genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
      }
    }
    if (m.director && m.director !== "N/A" && m.director !== "Unknown") {
      for (const d of String(m.director).split(",").map((s) => s.trim()).filter(Boolean)) {
        directorCounts.set(d, (directorCounts.get(d) || 0) + 1);
      }
    }
  }

  const yearStats = year ? computeYearlyDiaryStats(realWatched, year) : null;
  const { bins } = buildRatingHistogramBins(source);
  const topFilms = [...source]
    .sort((a, b) => (Number(b.userRating) || 0) - (Number(a.userRating) || 0))
    .slice(0, 4)
    .map((m) => ({
      title: m.title || m.Title || "Film",
      year: m.year || m.Year || "",
      poster: m.poster || m.Poster || null,
      rating: Number(m.userRating) || null
    }));

  const rawHandle = String(profile?.username || "").replace(/^@+/, "").trim();
  const topGenre = [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || (year && yearStats?.topGenre && yearStats.topGenre !== "—" ? yearStats.topGenre : "Cinema");
  const topDirector = [...directorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Diverse Auteurs";

  return {
    title: year ? `${year} Film Passport` : "CinemaVault Taste Passport",
    handle: rawHandle ? `@${rawHandle}` : (profile?.displayName || profile?.display_name || "Film Explorer"),
    filmCount: year ? yearStats.count : source.length,
    hoursWatched: year ? Math.round(yearStats.totalMinutes / 60) : Math.round(totalMinutes / 60),
    avgRating: year
      ? yearStats.avgRating
      : (ratingCount > 0 ? Number((ratingSum / ratingCount).toFixed(1)) : null),
    topGenre,
    topDirector,
    topFilms,
    histogramBins: bins
  };
}

/**
 * Renders the Taste Passport model directly onto an HTML5 Canvas 2D surface.
 */
export async function renderTasteCardToCanvas(canvas, model, { aspect = "story" } = {}) {
  if (!canvas || !model) return;
  const layout = computeTasteCardLayout(aspect);
  const { isStory, width, height, pad, statsY, statsH, posterY, posterGap, posterW, posterH, rowGap, footerY } = layout;

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, "#0d0e11");
  bgGrad.addColorStop(0.6, "#14161c");
  bgGrad.addColorStop(1, "#191713");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width * 0.85, height * 0.15, 20, width * 0.85, height * 0.15, width * 0.7);
  glow.addColorStop(0, "rgba(226, 177, 60, 0.16)");
  glow.addColorStop(1, "rgba(226, 177, 60, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, pad * 0.45, pad * 0.45, width - pad * 0.9, height - pad * 0.9, 28);
  ctx.stroke();

  ctx.fillStyle = "#e2b13c";
  ctx.font = `700 ${isStory ? 24 : 18}px "Hanken Grotesk", system-ui, sans-serif`;
  ctx.fillText(String(model.handle || "CinemaVault").toUpperCase(), pad, pad + (isStory ? 44 : 26));

  ctx.fillStyle = "#f3f1eb";
  ctx.font = `700 ${isStory ? 62 : 40}px "Fraunces", Georgia, serif`;
  ctx.fillText(model.title || "CinemaVault Taste Passport", pad, pad + (isStory ? 116 : 74));

  const stats = [
    { label: "FILMS", value: String(model.filmCount || 0) },
    { label: "HOURS", value: `${model.hoursWatched || 0}h` },
    { label: "AVG", value: model.avgRating != null ? `${model.avgRating}/10` : "—" },
    { label: "GENRE", value: model.topGenre || "Cinema" }
  ];

  const statsW = (width - pad * 2 - 42) / 4;
  stats.forEach((st, idx) => {
    const sx = pad + idx * (statsW + 14);
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    drawRoundedRect(ctx, sx, statsY, statsW, statsH, 16);
    ctx.fill();
    ctx.fillStyle = "#8f929b";
    ctx.font = `700 ${isStory ? 17 : 13}px system-ui, sans-serif`;
    ctx.fillText(st.label, sx + 16, statsY + (isStory ? 34 : 24));
    ctx.fillStyle = idx === 2 ? "#e2b13c" : "#f3f1eb";
    ctx.font = `700 ${isStory ? 34 : 24}px system-ui, sans-serif`;
    ctx.fillText(st.value.slice(0, 12), sx + 16, statsY + (isStory ? 84 : 60));
  });

  const loadedPosters = await Promise.all((model.topFilms || []).map((f) => loadPosterImage(f.poster)));
  const gridStartX = isStory ? (width - (posterW * 2 + posterGap)) / 2 : pad;

  (model.topFilms || []).slice(0, 4).forEach((film, idx) => {
    const col = isStory ? idx % 2 : idx;
    const row = isStory ? Math.floor(idx / 2) : 0;
    const px = gridStartX + col * (posterW + posterGap);
    const py = posterY + row * (posterH + rowGap);

    ctx.save();
    drawRoundedRect(ctx, px, py, posterW, posterH, 16);
    ctx.clip();

    const img = loadedPosters[idx];
    if (img) {
      ctx.drawImage(img, px, py, posterW, posterH);
    } else {
      ctx.fillStyle = "#1f222a";
      ctx.fillRect(px, py, posterW, posterH);
      ctx.fillStyle = "#e2b13c";
      ctx.font = `700 ${isStory ? 54 : 36}px Georgia, serif`;
      ctx.fillText((film.title || "F").slice(0, 2).toUpperCase(), px + 24, py + posterH * 0.54);
    }
    ctx.restore();

    ctx.fillStyle = "#f3f1eb";
    ctx.font = `600 ${isStory ? 22 : 16}px system-ui, sans-serif`;
    ctx.fillText((film.title || "").slice(0, 22), px, py + posterH + (isStory ? 28 : 22));
  });

  ctx.fillStyle = "#8f929b";
  ctx.font = `500 ${isStory ? 22 : 16}px system-ui, sans-serif`;
  ctx.fillText(`Top Auteur: ${model.topDirector}`, pad, footerY - (isStory ? 40 : 26));
  ctx.fillStyle = "#f3f1eb";
  ctx.font = `700 ${isStory ? 26 : 18}px system-ui, sans-serif`;
  ctx.fillText("CinemaVault · Personal Film Log & Taste Engine", pad, footerY);
}
