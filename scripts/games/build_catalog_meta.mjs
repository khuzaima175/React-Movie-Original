/**
 * Builds `public/models/games/game_catalog_meta.bin` (CVGM v3 binary sidecar, 18 bytes/game)
 * for all 24,439 games indexed in `game_content_f16.bin`.
 *
 * Pulls via IGDB `/v4/multiquery` (3 queries bundled into 1 HTTP call per 500 IDs):
 *   - Core metadata + game_modes (Solo / Co-op / Multiplayer)
 *   - `/v4/game_time_to_beats` (typical playthrough hours)
 *   - `/v4/popularity_primitives` (type 5 = Steam 24hr Peak Players, type 6/7 = live Steam Positive/Negative share)
 *
 * Binary layout (little-endian):
 *   Header (16 bytes):
 *     0..3  : ASCII "CVGM"
 *     4..7  : uint32 version = 3
 *     8..11 : uint32 count
 *     12..15: uint32 recordBytes = 18
 *   Record (18 bytes * count):
 *     0..3  : uint32 igdbId
 *     4..5  : int16  releaseDay (days since 2000-01-01 UTC; -32768 = TBA; evaluated dynamically at runtime)
 *     6     : uint8  ratingByte (0..100, Math.round(total_rating))
 *     7     : uint8  voteTier   (0..255, Math.min(255, Math.round(Math.log2(1 + total_rating_count) * 18)))
 *     8     : uint8  platformMask (b0=Win, b1=Mac, b2=Linux, b3=PS, b4=Xbox, b5=Nintendo, b6=ModernConsole, b7=LastGenConsole)
 *     9     : uint8  specAndFlags (b0..1 = specTier 0=entry/1=mid/2=high, b2 = isIndie)
 *     10..11: uint16 genreMask (b0..14 mapped to GAME_GENRES IDs)
 *     12    : uint8  typicalHoursByte (0..255, Math.min(255, Math.round(Math.log2(1 + hours) * 30)))
 *     13    : uint8  ttbFlags (b0 = 1 if verified from IGDB game_time_to_beats, 0 if genre-estimated)
 *     14    : uint8  modeMask (b0=Solo[1], b1=Multiplayer/PvP[2,5,6], b2=Co-op/Split[3,4], b3=OnlineOnly[!b0 && (b1||b2)])
 *     15    : uint8  steamCcuTier (0=unknown, 1..255 log10-scaled 24h peak player share)
 *     16    : uint8  steamSentimentByte (0=unknown, 1..100 live Steam positive review %)
 *     17    : uint8  liveFlags (b0=deadOnlineOnlyMP, b1=steamRedeemed)
 */
import fs from "node:fs";
import path from "node:path";
import { parseEmbeddingBinary } from "../../src/services/embeddingService.js";
import { estimateGameSpecTier } from "../../src/games/services/gameRigService.js";

const EPOCH_2000_SEC = Math.floor(Date.UTC(2000, 0, 1) / 1000);
const TBA_RELEASE_DAY = -32768;

const GENRE_BIT_IDS = [12, 31, 5, 32, 15, 8, 25, 9, 13, 4, 10, 16, 24, 34, 35];
const GENRE_ID_TO_BIT = new Map(GENRE_BIT_IDS.map((id, bit) => [id, bit]));

const PS_IDS = new Set([167, 48, 9, 8, 7, 46, 38]);
const XBOX_IDS = new Set([169, 49, 12, 11]);
const NINTENDO_IDS = new Set([130, 508, 41, 5, 21, 37, 20, 4, 19]);
const MODERN_CONSOLE_IDS = new Set([167, 169, 508]);
const LAST_GEN_CONSOLE_IDS = new Set([48, 49, 130]);

const SPEC_TIER_CODE = { entry: 0, mid: 1, high: 2 };

function loadEnvSecrets() {
  const envPath = path.join(process.cwd(), ".env");
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const cid = process.env.IGDB_CLIENT_ID || raw.match(/^IGDB_CLIENT_ID=(.+)$/m)?.[1]?.trim() || "";
  const csec = process.env.IGDB_CLIENT_SECRET || raw.match(/^IGDB_CLIENT_SECRET=(.+)$/m)?.[1]?.trim() || "";
  if (!cid || !csec) {
    throw new Error("Missing IGDB_CLIENT_ID / IGDB_CLIENT_SECRET in environment or .env");
  }
  return { cid, csec };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function queryIgdbEndpoint(cid, token, endpoint, body, attempt = 0) {
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": cid,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain"
    },
    body
  });
  if (res.status === 429 && attempt < 4) {
    await sleep(1200 * (attempt + 1));
    return queryIgdbEndpoint(cid, token, endpoint, body, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`IGDB /${endpoint} HTTP ${res.status}`);
  }
  return res.json();
}

function encodePlatformMask(platforms = []) {
  let mask = 0;
  for (const p of Array.isArray(platforms) ? platforms : []) {
    const pid = Number(typeof p === "object" ? p?.id : p);
    if (!Number.isInteger(pid)) continue;
    if (pid === 6) mask |= 1 << 0;
    if (pid === 14) mask |= 1 << 1;
    if (pid === 3) mask |= 1 << 2;
    if (PS_IDS.has(pid)) mask |= 1 << 3;
    if (XBOX_IDS.has(pid)) mask |= 1 << 4;
    if (NINTENDO_IDS.has(pid)) mask |= 1 << 5;
    if (MODERN_CONSOLE_IDS.has(pid)) mask |= 1 << 6;
    if (LAST_GEN_CONSOLE_IDS.has(pid)) mask |= 1 << 7;
  }
  return mask;
}

function encodeGenreMask(genres = []) {
  let mask = 0;
  for (const g of Array.isArray(genres) ? genres : []) {
    const gid = Number(typeof g === "object" ? g?.id : g);
    const bit = GENRE_ID_TO_BIT.get(gid);
    if (bit !== undefined) mask |= 1 << bit;
  }
  return mask;
}

function encodeModeMask(modes = []) {
  let mask = 0;
  for (const m of Array.isArray(modes) ? modes : []) {
    const mid = Number(typeof m === "object" ? m?.id : m);
    if (mid === 1) mask |= 1 << 0; // Single player
    if (mid === 2 || mid === 5 || mid === 6) mask |= 1 << 1; // Multiplayer / MMO / Battle Royale
    if (mid === 3 || mid === 4) mask |= 1 << 2; // Co-op / Split screen
  }
  if ((mask & 1) === 0 && (mask & 6) !== 0) {
    mask |= 1 << 3; // Online / Multiplayer-only (no single-player mode)
  }
  return mask;
}

function estimateFallbackTypicalHours(genreMask) {
  if ((genreMask & (1 << 0)) !== 0) return 36; // RPG
  if ((genreMask & (1 << 4)) !== 0 || (genreMask & (1 << 11)) !== 0) return 28; // Strategy / TBS
  if ((genreMask & (1 << 8)) !== 0) return 26; // Simulator
  if ((genreMask & (1 << 12)) !== 0) return 24; // Tactical
  if ((genreMask & (1 << 14)) !== 0) return 18; // Card & Board
  if ((genreMask & (1 << 1)) !== 0 || (genreMask & (1 << 6)) !== 0) return 16; // Adventure / Hack&Slash
  if ((genreMask & (1 << 2)) !== 0 || (genreMask & (1 << 10)) !== 0) return 12; // Shooter / Racing
  if ((genreMask & (1 << 9)) !== 0) return 12; // Fighting
  if ((genreMask & (1 << 5)) !== 0 || (genreMask & (1 << 7)) !== 0 || (genreMask & (1 << 13)) !== 0) return 9; // Platform / Puzzle / VN
  if ((genreMask & (1 << 3)) !== 0) return 10; // Indie
  return 15;
}

function extractVerifiedHours(ttbRow) {
  if (!ttbRow || typeof ttbRow !== "object") return 0;
  const norm = Number(ttbRow.normally || 0);
  if (Number.isFinite(norm) && norm >= 1800) return Math.max(1.5, Math.min(250, norm / 3600));
  const hasty = Number(ttbRow.hastily || 0);
  if (Number.isFinite(hasty) && hasty >= 1800) return Math.max(1.5, Math.min(250, (hasty / 3600) * 1.35));
  const comp = Number(ttbRow.completely || 0);
  if (Number.isFinite(comp) && comp >= 1800) return Math.max(1.5, Math.min(250, (comp / 3600) * 0.55));
  return 0;
}

async function resolvePopTypeIds(cid, token) {
  const rows = await queryIgdbEndpoint(cid, token, "popularity_types", "fields id,name,external_popularity_source; limit 50;");
  let ccuId = 5;
  let posId = 6;
  let negId = 7;
  for (const r of Array.isArray(rows) ? rows : []) {
    const nm = String(r?.name || "").toLowerCase();
    const id = Number(r?.id);
    if (!Number.isInteger(id)) continue;
    if (nm.includes("24hr peak")) ccuId = id;
    else if (nm.includes("positive") || nm.includes("postitive")) posId = id;
    else if (nm.includes("negative")) negId = id;
  }
  return { ccuId, posId, negId };
}

async function main() {
  const { cid, csec } = loadEnvSecrets();
  const tokRes = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(cid)}&client_secret=${encodeURIComponent(csec)}&grant_type=client_credentials`,
    { method: "POST" }
  );
  if (!tokRes.ok) throw new Error(`Twitch OAuth HTTP ${tokRes.status}`);
  const { access_token: token } = await tokRes.json();

  const { ccuId, posId, negId } = await resolvePopTypeIds(cid, token);
  console.log(`Resolved IGDB popularity_types: CCU=${ccuId}, Positive=${posId}, Negative=${negId}`);

  const contentPath = path.join(process.cwd(), "public/models/games/game_content_f16.bin");
  const contentBuf = fs.readFileSync(contentPath);
  const contentIdx = parseEmbeddingBinary(
    contentBuf.buffer.slice(contentBuf.byteOffset, contentBuf.byteOffset + contentBuf.byteLength)
  );
  const allIds = Array.from(contentIdx.ids);
  console.log(`Querying IGDB metadata + Time-to-Beat + Popularity Primitives for ${allIds.length} indexed games...`);

  const metaById = new Map();
  const ttbById = new Map();
  const popById = new Map(); // id -> { ccu, pos, neg }

  let batches = 0;
  for (let i = 0; i < allIds.length; i += 250) {
    // 250 IDs/batch keeps popularity_primitives (up to 3 rows/game = 750 max, capped at 500 per sub-query -> split by type!)
    const chunk = allIds.slice(i, i + 250);
    const idCsv = chunk.join(",");
    const multiBody = [
      `query games "g" { fields id,first_release_date,total_rating,total_rating_count,platforms.id,genres.id,genres.name,game_modes.id; where id = (${idCsv}); limit 250; };`,
      `query game_time_to_beats "t" { fields game_id,hastily,normally,completely,count; where game_id = (${idCsv}); limit 250; };`,
      `query popularity_primitives "ccu" { fields game_id,value; where game_id = (${idCsv}) & popularity_type = ${ccuId}; limit 250; };`,
      `query popularity_primitives "pos" { fields game_id,value; where game_id = (${idCsv}) & popularity_type = ${posId}; limit 250; };`,
      `query popularity_primitives "neg" { fields game_id,value; where game_id = (${idCsv}) & popularity_type = ${negId}; limit 250; };`
    ].join("\n");

    const sections = await queryIgdbEndpoint(cid, token, "multiquery", multiBody);
    for (const sec of Array.isArray(sections) ? sections : []) {
      const list = Array.isArray(sec?.result) ? sec.result : [];
      if (sec.name === "g") {
        for (const r of list) {
          const id = Number(r?.id);
          if (Number.isInteger(id) && id > 0) metaById.set(id, r);
        }
      } else if (sec.name === "t") {
        for (const r of list) {
          const gid = Number(r?.game_id);
          if (Number.isInteger(gid) && gid > 0) ttbById.set(gid, r);
        }
      } else if (sec.name === "ccu" || sec.name === "pos" || sec.name === "neg") {
        for (const r of list) {
          const gid = Number(r?.game_id);
          const val = Number(r?.value || 0);
          if (!Number.isInteger(gid) || gid <= 0 || !Number.isFinite(val)) continue;
          const rec = popById.get(gid) || { ccu: 0, pos: 0, neg: 0 };
          rec[sec.name] = Math.max(rec[sec.name], val);
          popById.set(gid, rec);
        }
      }
    }
    batches++;
    if (batches % 20 === 0 || i + 250 >= allIds.length) {
      console.log(`  Fetched ${Math.min(i + 250, allIds.length)}/${allIds.length} (games=${metaById.size}, TTB=${ttbById.size}, pop=${popById.size})`);
    }
    if (i + 250 < allIds.length) await sleep(270);
  }

  const count = allIds.length;
  const recordBytes = 18;
  const outBuf = Buffer.alloc(16 + count * recordBytes);
  outBuf.write("CVGM", 0, 4, "ascii");
  outBuf.writeUInt32LE(3, 4);
  outBuf.writeUInt32LE(count, 8);
  outBuf.writeUInt32LE(recordBytes, 12);

  let verifiedTtbCount = 0;
  let ccuCovered = 0;
  let sentimentCovered = 0;
  let deadMpCount = 0;
  let redeemedCount = 0;
  let onlineOnlyCount = 0;

  for (let i = 0; i < count; i++) {
    const igdbId = allIds[i];
    const row = metaById.get(igdbId);
    const ttbRow = ttbById.get(igdbId);
    const pop = popById.get(igdbId) || null;
    const off = 16 + i * recordBytes;

    let releaseDay = TBA_RELEASE_DAY;
    let year = 0;
    if (row && Number.isFinite(Number(row.first_release_date)) && Number(row.first_release_date) > 0) {
      const sec = Number(row.first_release_date);
      const rawDay = Math.floor((sec - EPOCH_2000_SEC) / 86400);
      releaseDay = Math.max(-32767, Math.min(32767, rawDay));
      year = new Date(sec * 1000).getUTCFullYear();
    }

    const totalRating = row && Number.isFinite(Number(row.total_rating)) ? Number(row.total_rating) : 0;
    const ratingByte = Math.max(0, Math.min(100, Math.round(totalRating)));
    const votes = row && Number.isFinite(Number(row.total_rating_count)) ? Math.max(0, Number(row.total_rating_count)) : 0;
    const voteTier = Math.max(0, Math.min(255, Math.round(Math.log2(1 + votes) * 18)));

    const platformMask = row ? encodePlatformMask(row.platforms) : 0;
    const genreMask = row ? encodeGenreMask(row.genres) : 0;
    const genreNames = row && Array.isArray(row.genres) ? row.genres.map((g) => g?.name).filter(Boolean) : [];
    const tierStr = estimateGameSpecTier({ year, genres: genreNames });
    const isIndie = (genreMask & (1 << 3)) !== 0 ? 1 : 0;
    const specAndFlags = ((SPEC_TIER_CODE[tierStr] ?? 1) & 0x03) | (isIndie << 2);

    const verifiedHrs = extractVerifiedHours(ttbRow);
    const typicalHours = verifiedHrs > 0 ? verifiedHrs : estimateFallbackTypicalHours(genreMask);
    const typicalHoursByte = Math.max(1, Math.min(255, Math.round(Math.log2(1 + typicalHours) * 30)));
    const ttbFlags = verifiedHrs > 0 ? 1 : 0;
    if (verifiedHrs > 0) verifiedTtbCount++;

    const modeMask = row ? encodeModeMask(row.game_modes) : 0;
    const isOnlineOnly = (modeMask & (1 << 3)) !== 0;
    if (isOnlineOnly) onlineOnlyCount++;

    const ccuVal = pop?.ccu > 0 ? pop.ccu : 0;
    const steamCcuTier = ccuVal > 0
      ? Math.max(1, Math.min(255, Math.round(Math.log10(1 + ccuVal * 1_000_000) * 42)))
      : 0;
    if (steamCcuTier > 0) ccuCovered++;

    // Bayes-calibrated live Steam positive % (global Steam positive prior ~85% / 15%)
    let steamSentimentByte = 0;
    if (pop && (pop.pos > 0 || pop.neg > 0)) {
      const pWeight = pop.pos * 0.85;
      const nWeight = pop.neg * 0.15;
      const pct = (pWeight + nWeight) > 1e-12 ? (100 * pWeight) / (pWeight + nWeight) : 0;
      steamSentimentByte = Math.max(1, Math.min(100, Math.round(pct)));
      sentimentCovered++;
    }

    // Dead online-only MP: online-only PC game that has Steam reviews/presence (or is >=2 yrs old) with negligible CCU
    const isPc = (platformMask & 0x07) !== 0;
    const isDeadMp = isOnlineOnly && isPc && (
      (steamCcuTier > 0 && steamCcuTier < 32) ||
      (steamCcuTier === 0 && steamSentimentByte > 0 && year > 0 && year <= 2024)
    );
    const isRedeemed = steamSentimentByte >= 80 && ratingByte > 0 && ratingByte < 76;
    const liveFlags = (isDeadMp ? 1 : 0) | (isRedeemed ? 2 : 0);
    if (isDeadMp) deadMpCount++;
    if (isRedeemed) redeemedCount++;

    outBuf.writeUInt32LE(igdbId, off);
    outBuf.writeInt16LE(releaseDay, off + 4);
    outBuf.writeUInt8(ratingByte, off + 6);
    outBuf.writeUInt8(voteTier, off + 7);
    outBuf.writeUInt8(platformMask, off + 8);
    outBuf.writeUInt8(specAndFlags, off + 9);
    outBuf.writeUInt16LE(genreMask, off + 10);
    outBuf.writeUInt8(typicalHoursByte, off + 12);
    outBuf.writeUInt8(ttbFlags, off + 13);
    outBuf.writeUInt8(modeMask, off + 14);
    outBuf.writeUInt8(steamCcuTier, off + 15);
    outBuf.writeUInt8(steamSentimentByte, off + 16);
    outBuf.writeUInt8(liveFlags, off + 17);
  }

  const outPath = path.join(process.cwd(), "public/models/games/game_catalog_meta.bin");
  fs.writeFileSync(outPath, outBuf);
  console.log(
    `Wrote CVGM v3 ${outPath} (${outBuf.length.toLocaleString()} bytes) | records=${count} | TTB=${verifiedTtbCount} | CCU=${ccuCovered} | SteamSentiment=${sentimentCovered} | OnlineOnly=${onlineOnlyCount} | DeadMP=${deadMpCount} | Redeemed=${redeemedCount}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
