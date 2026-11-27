/**
 * Game Oracle Service: Local ML Shortlist + Optional Gemini Editorial Curation (reusing `/api/gemini`).
 * Always locks mathematical `matchScore` and `matchReasons` — Gemini never hallucinates match percentages.
 */

import { hasGeminiBackend, resolveGeminiKey } from "../../services/apiTransport.js";

/**
 * 32 diverse, iconic multi-platform starter games with live IGDB-verified IDs, covers, genres & spec tiers.
 * Covers Open-World, FPS/CoD/Battlefield, RPG/CRPG, Sims/Cozy/Strategy, PlayStation/Nintendo Icons & Indies.
 */
export const STARTER_CALIBRATION_GAMES = Object.freeze([
  { igdbId: 1020, title: "Grand Theft Auto V", year: 2013, primaryGenre: "Open-World Action", genres: ["Shooter", "Adventure"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co2lbd.jpg" },
  { igdbId: 1942, title: "The Witcher 3: Wild Hunt", year: 2015, primaryGenre: "Open-World RPG", genres: ["Role-playing (RPG)", "Adventure"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/coaarl.jpg" },
  { igdbId: 25076, title: "Red Dead Redemption 2", year: 2018, primaryGenre: "Narrative Open-World", genres: ["Shooter", "Adventure"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "mid", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1q1f.jpg" },
  { igdbId: 1877, title: "Cyberpunk 2077", year: 2020, primaryGenre: "Sci-Fi RPG", genres: ["Role-playing (RPG)", "Shooter"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "high", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/coaih8.jpg" },
  { igdbId: 119171, title: "Baldur's Gate III", year: 2023, primaryGenre: "CRPG", genres: ["Role-playing (RPG)", "Strategy"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "mid", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co670h.jpg" },
  { igdbId: 119133, title: "Elden Ring", year: 2022, primaryGenre: "Action RPG", genres: ["Role-playing (RPG)", "Adventure"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "mid", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co4jni.jpg" },
  { igdbId: 545, title: "Call of Duty: Black Ops", year: 2010, primaryGenre: "FPS Shooter", genres: ["Shooter"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1wkl.jpg" },
  { igdbId: 18320, title: "Battlefield 1", year: 2016, primaryGenre: "Warfare FPS", genres: ["Shooter"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co2n9d.jpg" },
  { igdbId: 472, title: "The Elder Scrolls V: Skyrim", year: 2011, primaryGenre: "Fantasy RPG", genres: ["Role-playing (RPG)", "Adventure"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/cocs1l.jpg" },
  { igdbId: 3212, title: "The Sims 4", year: 2014, primaryGenre: "Life Sim", genres: ["Simulator"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co3h3l.jpg" },
  { igdbId: 19560, title: "God of War", year: 2018, primaryGenre: "Action Adventure", genres: ["Role-playing (RPG)", "Hack and slash/Beat 'em up"], platformFamilies: ["pc", "playstation"], specTier: "mid", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/cobkt6.jpg" },
  { igdbId: 1009, title: "The Last of Us", year: 2013, primaryGenre: "Story Survival", genres: ["Shooter", "Adventure"], platformFamilies: ["pc", "playstation"], specTier: "mid", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1r7f.jpg" },
  { igdbId: 19565, title: "Marvel's Spider-Man", year: 2018, primaryGenre: "Superhero Action", genres: ["Hack and slash/Beat 'em up", "Adventure"], platformFamilies: ["pc", "playstation"], specTier: "mid", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1r77.jpg" },
  { igdbId: 7331, title: "Uncharted 4: A Thief's End", year: 2016, primaryGenre: "Cinematic Action", genres: ["Shooter", "Adventure"], platformFamilies: ["pc", "playstation"], specTier: "mid", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1r7h.jpg" },
  { igdbId: 76882, title: "Sekiro: Shadows Die Twice", year: 2019, primaryGenre: "Precision Action", genres: ["Adventure", "Hack and slash/Beat 'em up"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "mid", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co2a23.jpg" },
  { igdbId: 14593, title: "Hollow Knight", year: 2017, primaryGenre: "Metroidvania", genres: ["Adventure", "Indie"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/cobfzp.jpg" },
  { igdbId: 113112, title: "Hades", year: 2020, primaryGenre: "Roguelike", genres: ["Hack and slash/Beat 'em up", "Indie"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/cob9kr.jpg" },
  { igdbId: 251833, title: "Balatro", year: 2024, primaryGenre: "Deckbuilder", genres: ["Card & Board Game", "Indie"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co9f4g.jpg" },
  { igdbId: 17000, title: "Stardew Valley", year: 2016, primaryGenre: "Cozy Sim", genres: ["Simulator", "Indie"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/coa93h.jpg" },
  { igdbId: 242408, title: "Counter-Strike 2", year: 2023, primaryGenre: "Tactical FPS", genres: ["Shooter", "Tactical"], platformFamilies: ["pc"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/coaczd.jpg" },
  { igdbId: 19130, title: "Sid Meier's Civilization VI", year: 2016, primaryGenre: "4X Strategy", genres: ["Strategy", "Simulator"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/coaaqr.jpg" },
  { igdbId: 9254, title: "Subnautica", year: 2018, primaryGenre: "Survival", genres: ["Adventure", "Indie"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/coa938.jpg" },
  { igdbId: 72, title: "Portal 2", year: 2011, primaryGenre: "Puzzle Classic", genres: ["Puzzle", "Shooter"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1rs4.jpg" },
  { igdbId: 103298, title: "DOOM Eternal", year: 2020, primaryGenre: "Arena FPS", genres: ["Shooter"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "mid", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co3p5n.jpg" },
  { igdbId: 14362, title: "Detroit: Become Human", year: 2018, primaryGenre: "Interactive Story", genres: ["Adventure"], platformFamilies: ["pc", "playstation"], specTier: "mid", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/cocot9.jpg" },
  { igdbId: 37001, title: "Ori and the Will of the Wisps", year: 2020, primaryGenre: "Platformer", genres: ["Platform", "Adventure"], platformFamilies: ["pc", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/cocjl7.jpg" },
  { igdbId: 305152, title: "Clair Obscur: Expedition 33", year: 2025, primaryGenre: "Turn-Based RPG", genres: ["Role-playing (RPG)", "Turn-based strategy (TBS)"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "high", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co9gam.jpg" },
  { igdbId: 298526, title: "Kingdom Come: Deliverance II", year: 2025, primaryGenre: "Medieval RPG", genres: ["Role-playing (RPG)", "Simulator"], platformFamilies: ["pc", "playstation", "xbox"], specTier: "high", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co8qmv.jpg" },
  { igdbId: 119388, title: "The Legend of Zelda: Tears of the Kingdom", year: 2023, primaryGenre: "Nintendo Icon", genres: ["Adventure"], platformFamilies: ["nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co5vmg.jpg" },
  { igdbId: 7334, title: "Bloodborne", year: 2015, primaryGenre: "PS Exclusive", genres: ["Role-playing (RPG)", "Adventure"], platformFamilies: ["playstation"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/cob99l.jpg" },
  { igdbId: 114283, title: "Persona 5 Royal", year: 2019, primaryGenre: "JRPG", genres: ["Role-playing (RPG)", "Turn-based strategy (TBS)"], platformFamilies: ["pc", "playstation", "xbox", "nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/coclf1.jpg" },
  { igdbId: 26758, title: "Super Mario Odyssey", year: 2017, primaryGenre: "3D Platformer", genres: ["Platform", "Adventure"], platformFamilies: ["nintendo"], specTier: "entry", coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co1mxf.jpg" }
]);

export const GAME_ORACLE_MOODS = Object.freeze([
  { id: "any", label: "Best Overall Match", prompt: "" },
  { id: "atmospheric", label: "Dark & Atmospheric", prompt: "moody, dark, atmospheric world-building" },
  { id: "cozy", label: "Cozy & Relaxing", prompt: "cozy, low-stress, heartwarming, relaxing pacing" },
  { id: "challenge", label: "High-Skill Challenge", prompt: "tight combat, high mechanical skill ceiling, rewarding mastery" },
  { id: "story", label: "Deep Story & Choices", prompt: "narrative masterpiece, unforgettable characters, meaningful choices" },
  { id: "short", label: "Tight 5–15h Gem", prompt: "focused, unforgettable shorter experience without open-world bloat" },
  { id: "replayable", label: "Endless Replayability", prompt: "roguelike, deckbuilder, strategy, or deep build-crafting loop" }
]);

function extractJsonBlock(rawText = "") {
  const s = String(rawText || "").trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : s;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildOfflinePitch(game, anchorTitles = []) {
  const pieces = [];
  if (game?.summary) {
    const clean = game.summary.replace(/\s+/g, " ").trim();
    pieces.push(clean.length > 155 ? `${clean.slice(0, 152).trimEnd()}...` : clean);
  }
  if (anchorTitles.length > 0) {
    pieces.push(`Strongly aligned with your love for ${anchorTitles.slice(0, 2).join(" & ")}.`);
  }
  return pieces.join(" ") || "High-affinity match from your local collaborative & semantic game taste model.";
}

async function defaultCallGeminiProxy(prompt) {
  const userKey = resolveGeminiKey();
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(userKey ? { "x-user-gemini-key": userKey } : {})
    },
    body: JSON.stringify({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    })
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data?.text || data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/**
 * Curates up to `count` game picks from pre-ranked local ML candidates, optionally using Gemini
 * for editorial reasoning + anchor title pairing while strictly locking mathematical `matchScore`.
 */
export async function curateGamesWithOracle({
  played = [],
  candidates = [],
  vibe = "",
  platformFamily = "all",
  count = 12,
  excludeIds = [],
  useGemini = true,
  geminiCaller = null
} = {}) {
  const excluded = new Set((Array.isArray(excludeIds) ? excludeIds : []).map(Number));
  const filtered = (Array.isArray(candidates) ? candidates : []).filter((g) => {
    if (excluded.has(Number(g?.igdbId))) return false;
    if (platformFamily && platformFamily !== "all") {
      return Array.isArray(g.platformFamilies) && g.platformFamilies.includes(platformFamily);
    }
    return true;
  });

  const pool = filtered.slice(0, 45);
  const topLoved = (Array.isArray(played) ? played : [])
    .filter((g) => Number(g?.userRating ?? 0) >= 8 || String(g?.status || "") === "completed")
    .sort((a, b) => (Number(b.userRating || 0) - Number(a.userRating || 0)) || (Number(b.hoursPlayed || 0) - Number(a.hoursPlayed || 0)))
    .slice(0, 10);

  const fallbackAnchors = topLoved.slice(0, 2).map((g) => g.title).filter(Boolean);
  const buildFallback = () => ({
    source: "local-ml",
    picks: pool.slice(0, count).map((g) => ({
      ...g,
      anchorTitles: fallbackAnchors,
      pitch: buildOfflinePitch(g, fallbackAnchors)
    }))
  });

  if (pool.length === 0) {
    return { source: "local-ml", picks: [] };
  }

  const canCallAi = useGemini && (typeof geminiCaller === "function" || hasGeminiBackend());
  if (!canCallAi) {
    return buildFallback();
  }

  const promptLines = [
    "You are GameVault Oracle, an expert video game curator.",
    `Player's top loved games: ${topLoved.map((g) => `${g.title}${g.userRating ? ` (${g.userRating}/10)` : ""}${g.hoursPlayed ? ` [${g.hoursPlayed}h]` : ""}`).join(", ") || "New player"}.`,
    vibe ? `Requested vibe/mood: "${vibe}".` : "Requested vibe: Best overall personal taste match.",
    platformFamily !== "all" ? `Preferred platform: ${platformFamily.toUpperCase()}.` : "",
    `Select the best ${Math.min(count, pool.length)} diverse games ONLY from the candidate list below. Return strict JSON: {"picks":[{"igdbId":123,"anchorTitles":["Game A"],"pitch":"2 concise editorial sentences explaining why this player will love it without mentioning scores or algorithms."}]}.`,
    "Candidates:",
    ...pool.map((c) => `- id=${c.igdbId} | ${c.title} (${c.year || "?"}) | ${(c.genres || []).slice(0, 3).join(", ")} | ${(c.platforms || []).slice(0, 4).join(", ")} | ${(c.summary || "").slice(0, 180)}`)
  ].filter(Boolean);

  try {
    const caller = typeof geminiCaller === "function" ? geminiCaller : defaultCallGeminiProxy;
    const rawResp = await caller(promptLines.join("\n"));
    const parsed = extractJsonBlock(rawResp);
    const aiPicks = Array.isArray(parsed?.picks) ? parsed.picks : [];
    if (aiPicks.length === 0) return buildFallback();

    const byId = new Map(pool.map((g) => [Number(g.igdbId), g]));
    const lovedTitleSet = new Set(topLoved.map((g) => String(g.title || "").toLowerCase()));
    const merged = [];
    const usedIds = new Set();

    for (const p of aiPicks) {
      const id = Number(p?.igdbId);
      const base = byId.get(id);
      if (!base || usedIds.has(id)) continue;
      usedIds.add(id);
      const anchors = (Array.isArray(p?.anchorTitles) ? p.anchorTitles : [])
        .map((t) => String(t || "").trim())
        .filter((t) => t && (lovedTitleSet.size === 0 || lovedTitleSet.has(t.toLowerCase())))
        .slice(0, 2);
      merged.push({
        ...base,
        // Strictly lock mathematical matchScore & matchReasons!
        matchScore: base.matchScore,
        matchReasons: base.matchReasons,
        anchorTitles: anchors.length > 0 ? anchors : fallbackAnchors,
        pitch: String(p?.pitch || "").trim() || buildOfflinePitch(base, anchors.length ? anchors : fallbackAnchors)
      });
    }

    // Backfill to `count` from top local ML candidates if Gemini returned fewer
    for (const base of pool) {
      if (merged.length >= count) break;
      if (usedIds.has(base.igdbId)) continue;
      usedIds.add(base.igdbId);
      merged.push({
        ...base,
        anchorTitles: fallbackAnchors,
        pitch: buildOfflinePitch(base, fallbackAnchors)
      });
    }

    const finalPicks = merged
      .slice(0, count)
      .sort((a, b) => (Number(b.matchScore) || 0) - (Number(a.matchScore) || 0));

    return { source: "gemini", picks: finalPicks };
  } catch {
    return buildFallback();
  }
}

/**
 * Interactive Game Companion Chat powered by `/api/gemini` with optional pinned game dossier & spoiler safety.
 */
export async function askGameCompanionChat({
  message = "",
  history = [],
  played = [],
  backlog = [],
  pinnedGame = null,
  allowSpoilers = false,
  geminiCaller = null
} = {}) {
  const cleanMsg = String(message || "").trim();
  if (!cleanMsg) return "";

  const topLoved = (Array.isArray(played) ? played : [])
    .filter((g) => Number(g?.userRating ?? 0) >= 8)
    .sort((a, b) => (Number(b.userRating || 0) - Number(a.userRating || 0)) || (Number(b.hoursPlayed || 0) - Number(a.hoursPlayed || 0)))
    .slice(0, 12);

  const systemLines = [
    "You are GameVault Companion, an expert, concise video-game critic and recommender.",
    allowSpoilers
      ? "Spoilers are explicitly allowed for this conversation."
      : "STRICT SPOILER-SAFE MODE: Never spoil story twists, late-game bosses, or endings.",
    `Player's top rated games: ${topLoved.map((g) => `${g.title} (${g.userRating}/10${g.hoursPlayed ? `, ${g.hoursPlayed}h` : ""})`).join(", ") || "None yet"}.`,
    backlog.length > 0 ? `Player's backlog: ${backlog.slice(0, 8).map((g) => g.title).join(", ")}.` : "",
    pinnedGame
      ? `Currently discussing pinned game: "${pinnedGame.title}" (${pinnedGame.year || "?"}) · Genres: ${(pinnedGame.genres || []).join(", ")} · Developers: ${(pinnedGame.developers || []).join(", ")} · Summary: ${(pinnedGame.summary || "").slice(0, 260)}`
      : "",
    "Keep replies sharp, structured, and grounded in real games (2-4 tight paragraphs or bullet points). Stay focused on video games."
  ].filter(Boolean);

  const recentTurns = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((m) => `${m.role === "assistant" ? "Companion" : "Player"}: ${String(m.text || "").slice(0, 450)}`);

  const fullPrompt = [
    ...systemLines,
    "",
    ...recentTurns,
    `Player: ${cleanMsg}`,
    "Companion:"
  ].join("\n");

  const caller = typeof geminiCaller === "function"
    ? geminiCaller
    : async (prompt) => {
        const userKey = resolveGeminiKey();
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(userKey ? { "x-user-gemini-key": userKey } : {})
          },
          body: JSON.stringify({
            model: "gemini-3.5-flash-lite",
            contents: prompt
          })
        });
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
        const data = await res.json();
        return data?.text || data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      };

  const reply = await caller(fullPrompt);
  return String(reply || "").trim();
}
