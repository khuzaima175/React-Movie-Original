import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  parseEmbeddingBinary,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex
} = await imp("src/services/embeddingService.js");
const { computeRecallAtK, computeNDCGAtK } = await imp("src/services/evalHarness.js");
const {
  rankCandidatePool,
  buildDiversifiedGeminiShortlist,
  DEFAULT_RANKER_WEIGHTS
} = await imp("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await imp("src/services/tmdbService.js");
const { normalizeTitleKey } = await imp("src/services/movieIdentity.js");
const {
  buildGeminiReRankPrompt,
  mergeGeminiExplanationsWithRanker,
  getModelThinkingConfig,
  sanitizeAndParseJSON,
  cleanStr
} = await imp("src/services/geminiService.js");
const {
  formatTieredVault,
  buildFullVaultPrompt,
  buildFullVaultResponseSchema,
  buildDossierCurationPrompt
} = await imp("scripts/experiments/dual_track_utils.mjs");

const HYDROGEN_MODEL = "gemini-4-hydrogen";
const FLASH_LITE_MODEL = "gemini-3.5-flash-lite";
const FLASH_38_MODEL = "gemini-3.8-flash";
const MIN_HYDROGEN_GAP_MS = 16_000;
const MIN_FLASH_GAP_MS = 1_500;
const MIN_FLASH_38_GAP_MS = 4_500;
const OUT_DIR = "scripts/experiments/results/ml32m_holdout";

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCliArgs(argv = []) {
  const opts = {
    users: 20,
    hydrogenUsers: 5,
    include38Flash: false,
    compareModel: null,
    minTrain: 60,
    maxTrain: 180,
    minMaxYear: 2008,
    resume: true,
    dryRun: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--users" && argv[i + 1]) opts.users = Number(argv[++i]) || 20;
    else if (a === "--hydrogen-users" && argv[i + 1]) opts.hydrogenUsers = Number(argv[++i]) || 0;
    else if (a === "--include-38-flash") opts.include38Flash = true;
    else if (a === "--compare-model" && argv[i + 1]) opts.compareModel = argv[++i];
    else if (a === "--min-train" && argv[i + 1]) opts.minTrain = Number(argv[++i]) || 60;
    else if (a === "--max-train" && argv[i + 1]) opts.maxTrain = Number(argv[++i]) || 180;
    else if (a === "--no-resume") opts.resume = false;
    else if (a === "--dry-run") opts.dryRun = true;
  }
  return opts;
}

function mapMovieLensGenresToTmdb(genresStr = "") {
  if (!genresStr || genresStr === "(no genres listed)") return [];
  const normalized = genresStr
    .replace(/\|/g, ",")
    .replace(/\bchildren\b/gi, "Family")
    .replace(/\bsci-fi\b/gi, "Sci-Fi");
  return mapOmdbToTmdbGenreIds(normalized);
}

function stripLeadingArticle(str = "") {
  return String(str || "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/,\s*(the|a|an)$/i, "")
    .trim();
}

function buildCatalog() {
  const tmdbEnriched = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/tmdb_enriched.json"), "utf8"));
  const tmdbItems = tmdbEnriched.items || {};
  const linksLines = fs
    .readFileSync(path.join(ROOT, ".data/ml-latest-small/links.csv"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1);

  const tmdbIdToMovieIds = new Map();
  for (const l of linksLines) {
    const [mid, , tmdb] = l.trim().split(",");
    if (tmdb) {
      const tid = Number(tmdb);
      if (Number.isFinite(tid) && tid > 0) {
        if (!tmdbIdToMovieIds.has(tid)) tmdbIdToMovieIds.set(tid, []);
        tmdbIdToMovieIds.get(tid).push(mid.trim());
      }
    }
  }

  const moviesLines = fs
    .readFileSync(path.join(ROOT, ".data/ml-latest-small/movies.csv"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1);

  const movieMeta = new Map();
  for (const l of moviesLines) {
    const commaIdx = l.indexOf(",");
    const lastComma = l.lastIndexOf(",");
    if (commaIdx === -1) continue;
    const mid = l.slice(0, commaIdx).trim();
    const genres = l.slice(lastComma + 1).trim();
    const rawTitle = l.slice(commaIdx + 1, lastComma).trim().replace(/^"|"$/g, "");
    const yearMatch = rawTitle.match(/\((\d{4})\)\s*$/);
    const cleanTitle = rawTitle.replace(/\s*\(\d{4}\)\s*$/, "").trim();
    movieMeta.set(mid, { title: cleanTitle, genres, mlYear: yearMatch ? yearMatch[1] : "N/A" });
  }

  const catalog = [];
  const catalogByTmdb = new Map();
  const titleYearIndex = new Map();
  const titleOnlyIndex = new Map();

  for (const [tid, mids] of tmdbIdToMovieIds.entries()) {
    const meta = movieMeta.get(mids[0]) || { title: "Unknown", genres: "", mlYear: "N/A" };
    const e = tmdbItems[tid] || null;
    const fallbackGenres = mapMovieLensGenresToTmdb(meta.genres);
    const genreIds = e ? (e.tmdbGenreIds || []) : fallbackGenres;
    const title = e?.title || meta.title;
    const year = String(e?.year || meta.mlYear || "N/A");
    const obj = {
      id: tid,
      tmdbId: tid,
      imdbID: e?.imdbID || null,
      title,
      year,
      release_date: e?.release_date || null,
      genre: e?.genre || meta.genres || "Cinema",
      tmdbGenreIds: genreIds,
      genre_ids: genreIds,
      tmdbKeywords: e?.tmdbKeywords || [],
      castIds: e?.castIds || [],
      crewPersonId: e?.crewPersonId ?? null,
      director: e?.director || "Unknown",
      vote_average: e?.vote_average ?? null,
      vote_count: e?.vote_count ?? 0,
      popularity: e?.popularity ?? 0,
      streamProviders: e?.streamProviders || [],
      hydrated: Boolean(e)
    };
    catalog.push(obj);
    catalogByTmdb.set(tid, obj);

    const keys = new Set([
      normalizeTitleKey(title),
      normalizeTitleKey(stripLeadingArticle(title)),
      normalizeTitleKey(meta.title),
      normalizeTitleKey(stripLeadingArticle(meta.title))
    ]);
    for (const k of keys) {
      if (!k) continue;
      if (!titleOnlyIndex.has(k)) titleOnlyIndex.set(k, []);
      titleOnlyIndex.get(k).push(obj);
      if (/^\d{4}$/.test(year)) {
        const ty = `${k}::${year}`;
        if (!titleYearIndex.has(ty)) titleYearIndex.set(ty, obj);
      }
    }
  }

  const sortedByVotes = [...catalog].sort((a, b) => {
    if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count;
    return (b.vote_average ?? 0) - (a.vote_average ?? 0) || a.tmdbId - b.tmdbId;
  });
  const top20Cut = Math.floor(0.20 * sortedByVotes.length);
  const popularTmdbIds = new Set(sortedByVotes.slice(0, top20Cut).map((c) => c.tmdbId));

  return { catalog, catalogByTmdb, popularTmdbIds, titleYearIndex, titleOnlyIndex };
}

function matchCatalogMovie(title, year, { titleYearIndex, titleOnlyIndex }) {
  const yrNum = Number(String(year || "").replace(/\D/g, "").slice(0, 4));
  const candidateKeys = [
    normalizeTitleKey(title),
    normalizeTitleKey(stripLeadingArticle(title))
  ].filter(Boolean);

  for (const k of candidateKeys) {
    if (Number.isInteger(yrNum) && yrNum > 1880) {
      for (const y of [yrNum, yrNum - 1, yrNum + 1]) {
        const hit = titleYearIndex.get(`${k}::${y}`);
        if (hit) return hit;
      }
    }
    const list = titleOnlyIndex.get(k);
    if (list && list.length === 1) return list[0];
    if (list && list.length > 1 && Number.isInteger(yrNum)) {
      const close = list.find((item) => Math.abs(Number(item.year) - yrNum) <= 2);
      if (close) return close;
    }
  }
  return null;
}

function buildCatalogSubsetIndex(fullIndex, catalog) {
  const keepIds = [];
  for (const c of catalog) {
    if (fullIndex.idToIndex.has(c.tmdbId)) keepIds.push(c.tmdbId);
  }
  const dim = fullIndex.dim;
  const subCount = keepIds.length;
  const subIds = new Int32Array(subCount);
  const subVecs = new Float32Array(subCount * dim);
  const subIdToIndex = new Map();
  for (let i = 0; i < subCount; i++) {
    const tid = keepIds[i];
    const srcIdx = fullIndex.idToIndex.get(tid);
    subIds[i] = tid;
    subVecs.set(fullIndex.vectors.subarray(srcIdx * dim, (srcIdx + 1) * dim), i * dim);
    subIdToIndex.set(tid, i);
  }
  return { version: fullIndex.version, count: subCount, dim, ids: subIds, vectors: subVecs, idToIndex: subIdToIndex };
}

function getUserSplit(ratings) {
  const sorted = [...ratings].sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.tmdbId - b.tmdbId));
  let pCount = 0;
  let splitIdx = sorted.length;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].userRating >= 8) {
      pCount++;
      if (pCount === 10) {
        splitIdx = i;
        break;
      }
    }
  }
  const trainWatched = sorted.slice(0, splitIdx);
  const holdoutSlice = sorted.slice(splitIdx);
  const holdoutStartTs = sorted[splitIdx]?.ts;

  const holdoutPositives = new Set();
  const holdoutRelevance = new Map();
  for (const m of holdoutSlice) {
    const key = String(m.tmdbId);
    holdoutRelevance.set(key, m.userRating);
    if (m.userRating >= 8) holdoutPositives.add(key);
  }
  const maxYear = Math.max(
    ...sorted.map((r) => {
      const y = Number(String(r.year || "").slice(0, 4));
      return Number.isFinite(y) ? y : 0;
    }),
    new Date(sorted[sorted.length - 1]?.ts || Date.now()).getUTCFullYear()
  );
  return { trainWatched, holdoutPositives, holdoutRelevance, holdoutStartTs, maxYear };
}

function buildReRankConfig() {
  return {
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        tasteProfile: {
          type: Type.OBJECT,
          properties: {
            favoriteGenres: { type: Type.ARRAY, items: { type: Type.STRING } },
            preferredEra: { type: Type.STRING },
            ratingStyle: { type: Type.STRING }
          },
          required: ["favoriteGenres", "preferredEra", "ratingStyle"]
        },
        recommendations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              tmdbId: { type: Type.NUMBER },
              title: { type: Type.STRING },
              year: { type: Type.STRING },
              matchScore: { type: Type.NUMBER },
              anchorTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
              reason: { type: Type.STRING }
            },
            required: ["tmdbId", "title", "year", "reason"]
          }
        }
      },
      required: ["tasteProfile", "recommendations"]
    }
  };
}

let lastHydrogenMs = 0;
let lastFlashMs = 0;
let lastFlash38Ms = 0;

async function pace(model) {
  const now = Date.now();
  if (model === HYDROGEN_MODEL) {
    const wait = MIN_HYDROGEN_GAP_MS - (now - lastHydrogenMs);
    if (wait > 0) await sleep(wait);
    lastHydrogenMs = Date.now();
  } else if (model === FLASH_38_MODEL) {
    const wait = MIN_FLASH_38_GAP_MS - (now - lastFlash38Ms);
    if (wait > 0) await sleep(wait);
    lastFlash38Ms = Date.now();
  } else {
    const wait = MIN_FLASH_GAP_MS - (now - lastFlashMs);
    if (wait > 0) await sleep(wait);
    lastFlashMs = Date.now();
  }
}

function isQuotaError(err) {
  const msg = String(err?.message || err || "");
  return /429|RESOURCE_EXHAUSTED|quota|PerDay/i.test(msg);
}

function isTransientError(err) {
  const msg = String(err?.message || err || "");
  return /503|500|UNAVAILABLE|high demand|overloaded|timeout|DEADLINE_EXCEEDED/i.test(msg);
}

async function callGeminiStrict(ai, model, contents, responseSchema) {
  const thinkingConfig = getModelThinkingConfig(model, "curation");
  const config = {
    responseMimeType: "application/json",
    responseSchema,
    ...(thinkingConfig ? { thinkingConfig } : {})
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    await pace(model);
    const t0 = Date.now();
    try {
      const res = await ai.models.generateContent({ model, contents, config });
      return {
        parsed: sanitizeAndParseJSON(res.text),
        latencyMs: Date.now() - t0,
        usageMetadata: res?.usageMetadata ?? null
      };
    } catch (err) {
      if (isQuotaError(err)) throw err;
      if (attempt < 3 && isTransientError(err)) {
        await sleep(attempt * 15_000);
        continue;
      }
      throw err;
    }
  }
}

function scoreTop10(top10Items, holdoutPositives, holdoutRelevance, popularTmdbIds) {
  const ids = top10Items.slice(0, 10).map((m) => String(m.tmdbId ?? m.id));
  const hitCount = ids.filter((id) => holdoutPositives.has(id)).length;
  const recall10 = computeRecallAtK(ids, holdoutPositives, 10);
  const ndcg10 = computeNDCGAtK(ids, holdoutRelevance, 10);

  const ltPos = new Set();
  const ltRel = new Map();
  for (const [tid, rel] of holdoutRelevance.entries()) {
    if (!popularTmdbIds.has(Number(tid))) {
      ltRel.set(tid, rel);
      if (holdoutPositives.has(tid)) ltPos.add(tid);
    }
  }
  const ltRecall10 = ltPos.size > 0 ? computeRecallAtK(ids, ltPos, 10) : null;
  const ltNdcg10 = ltRel.size > 0 ? computeNDCGAtK(ids, ltRel, 10) : null;
  const meanLogVc = top10Items.length > 0
    ? top10Items.slice(0, 10).reduce((s, m) => s + Math.log(Math.max(1, Number(m.vote_count || 1))), 0) / Math.min(10, top10Items.length)
    : 0;

  return {
    hitsAt10: hitCount,
    hitAny: hitCount > 0 ? 1 : 0,
    recall10,
    ndcg10,
    ltRecall10,
    ltNdcg10,
    meanLogVc
  };
}

function summarizeArm(records = []) {
  const n = records.length;
  if (n === 0) return null;
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const ltRec = records.map((r) => r.ltRecall10).filter((v) => v !== null);
  const ltNdcg = records.map((r) => r.ltNdcg10).filter((v) => v !== null);
  const matchRates = records.map((r) => r.catalogMatchRate).filter((v) => v !== null && v !== undefined);
  return {
    nUsers: n,
    hitRateAny: Number(avg(records.map((r) => r.hitAny)).toFixed(4)),
    meanHitsAt10: Number(avg(records.map((r) => r.hitsAt10)).toFixed(4)),
    recall10: Number(avg(records.map((r) => r.recall10)).toFixed(4)),
    ndcg10: Number(avg(records.map((r) => r.ndcg10)).toFixed(4)),
    ltRecall10: ltRec.length > 0 ? Number(avg(ltRec).toFixed(4)) : null,
    ltNdcg10: ltNdcg.length > 0 ? Number(avg(ltNdcg).toFixed(4)) : null,
    meanLogVc: Number(avg(records.map((r) => r.meanLogVc)).toFixed(3)),
    avgCatalogMatchRate: matchRates.length > 0 ? Number(avg(matchRates).toFixed(3)) : null
  };
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  const opts = parseCliArgs(process.argv.slice(2));
  const { catalog, catalogByTmdb, popularTmdbIds, titleYearIndex, titleOnlyIndex } = buildCatalog();

  const rawFresh = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/fresh_300_users.json"), "utf8"));
  const eligible = rawFresh.users
    .map((u) => {
      const ratings = u.ratings.map((r) => ({
        ...catalogByTmdb.get(r.tmdbId),
        movieId: r.movieId,
        userRating: r.userRating,
        dateWatched: new Date(r.ts).toISOString(),
        ts: r.ts
      }));
      const split = getUserSplit(ratings);
      return { uid: u.uid, ratings, ...split };
    })
    .filter((u) => {
      const latestTrainYear = u.trainWatched.length > 0
        ? new Date(u.trainWatched[u.trainWatched.length - 1].ts).getUTCFullYear()
        : 0;
      return (
        u.trainWatched.length >= opts.minTrain &&
        u.trainWatched.length <= opts.maxTrain &&
        u.holdoutPositives.size === 10 &&
        latestTrainYear >= opts.minMaxYear
      );
    });

  // Deterministic spread sample across eligible users
  const step = Math.max(1, Math.floor(eligible.length / opts.users));
  const selected = [];
  for (let i = 0; i < eligible.length && selected.length < opts.users; i += step) {
    selected.push(eligible[i]);
  }

  console.log("=== MovieLens 32M Holdout Benchmark (Leakage-Clean) ===");
  console.log(`Eligible pool: ${eligible.length} users | Selected: ${selected.length} users (${opts.hydrogenUsers} with Hydrogen)`);
  console.log(`Selected UIDs: ${selected.map((u) => `${u.uid}(${u.trainWatched.length})`).join(", ")}`);

  if (opts.dryRun) return;

  const geminiKey = process.env.VITE_GEMINI_KEY?.trim();
  if (!geminiKey) {
    console.error("Missing VITE_GEMINI_KEY in .env");
    process.exit(1);
  }

  const embBuf = fs.readFileSync(path.join(ROOT, ".data/item_embeddings_clean2_f16.bin"));
  const fullCleanIndex = parseEmbeddingBinary(
    embBuf.buffer.slice(embBuf.byteOffset, embBuf.byteOffset + embBuf.byteLength)
  );
  const cleanSubIndex = buildCatalogSubsetIndex(fullCleanIndex, catalog);
  const ai = new GoogleGenAI({ apiKey: geminiKey, httpOptions: { timeout: 65_000 } });

  fs.mkdirSync(path.resolve(ROOT, OUT_DIR), { recursive: true });
  const ckPath = path.resolve(ROOT, OUT_DIR, "checkpoint.json");
  const checkpoint = opts.resume && fs.existsSync(ckPath)
    ? JSON.parse(fs.readFileSync(ckPath, "utf8"))
    : { users: {} };

  let hydrogenExhausted = false;
  let flash38Exhausted = false;
  let compareExhausted = false;
  const compareTag = opts.compareModel
    ? opts.compareModel.replace(/[^a-z0-9]/gi, "").toLowerCase()
    : null;
  const compareMathKey = compareTag ? `track1_math_${compareTag}` : null;
  const compareFullKey = compareTag ? `fullvault_${compareTag}` : null;

  for (let i = 0; i < selected.length; i++) {
    const u = selected[i];
    const useHydrogen = i < opts.hydrogenUsers && !hydrogenExhausted;
    const saved = checkpoint.users[u.uid] || {};
    console.log(`\n[${i + 1}/${selected.length}] User ${u.uid} (train=${u.trainWatched.length}, maxYear=${u.maxYear}, hydrogen=${useHydrogen})`);

    const trainIdSet = new Set(u.trainWatched.map((m) => Number(m.tmdbId)));
    const profile = await extractTasteProfile(u.trainWatched, [], {
      now: u.holdoutStartTs,
      anchorCutoff: Infinity
    });
    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, cleanSubIndex);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, cleanSubIndex);
    const candidates = catalog.filter((c) => {
      if (trainIdSet.has(c.tmdbId)) return false;
      const y = Number(String(c.year || "").slice(0, 4));
      return !Number.isFinite(y) || y <= u.maxYear;
    });
    const rankerCtx = {
      profile,
      collabSimMap,
      contentSimMap: new Map(),
      repulsionMap,
      anchorKeywords: profile.lovedKeywordIds || [],
      userProviders: []
    };

    // 1. Pure Local Ranker (Top 10)
    if (!saved.local_ranker) {
      const top10Math = rankCandidatePool(candidates, rankerCtx, DEFAULT_RANKER_WEIGHTS, 10, { metadataDampingFactor: 0.20 });
      saved.local_ranker = scoreTop10(top10Math, u.holdoutPositives, u.holdoutRelevance, popularTmdbIds);
      saved.local_ranker.topIds = top10Math.map((m) => m.tmdbId);
    }

    const shortlist39 = buildDiversifiedGeminiShortlist(
      candidates,
      rankerCtx,
      DEFAULT_RANKER_WEIGHTS,
      { shortlistLimit: 39, metadataDampingFactor: 0.20 },
      null
    );
    const reRankPrompt = buildGeminiReRankPrompt(profile, "any", shortlist39, {
      watched: u.trainWatched,
      watchlist: [],
      embeddingIndex: cleanSubIndex,
      targetCount: 10
    });
    const reRankSchema = buildReRankConfig().responseSchema;

    // 2. Track 1 Math + Flash-Lite
    if (!saved.track1_math_flashlite) {
      const res = await callGeminiStrict(ai, FLASH_LITE_MODEL, reRankPrompt, reRankSchema);
      const merged = mergeGeminiExplanationsWithRanker(res.parsed, shortlist39, profile, {
        watched: u.trainWatched,
        targetCount: 10
      });
      saved.track1_math_flashlite = scoreTop10(merged.recommendations, u.holdoutPositives, u.holdoutRelevance, popularTmdbIds);
      saved.track1_math_flashlite.topIds = merged.recommendations.map((m) => m.tmdbId);
    }

    // 3. Full-Vault Flash-Lite
    const tiered = formatTieredVault(u.trainWatched, [], { userRegion: "US" });
    const fullPrompt = buildFullVaultPrompt({
      vaultText: tiered.text,
      moodLabel: "Any Vibe",
      moodDirective: `Recommend films that genuinely match this viewer's taste, released on or before ${u.maxYear}.`,
      vibeConstraints: [`Release year <= ${u.maxYear}`, "Avoid obscure direct-to-video titles; focus on notable theatrical releases"],
      region: "US",
      requestedCount: 20,
      blindspotCount: 3
    });
    const fullSchema = buildFullVaultResponseSchema({ includeThesis: true });

    const resolveFullVaultPicks = (rawRecs = []) => {
      const matched = [];
      const seen = new Set();
      let catalogHits = 0;
      for (const r of rawRecs) {
        const hit = matchCatalogMovie(r?.title || "", r?.year, { titleYearIndex, titleOnlyIndex });
        if (!hit) continue;
        catalogHits += 1;
        if (trainIdSet.has(hit.tmdbId) || seen.has(hit.tmdbId)) continue;
        seen.add(hit.tmdbId);
        matched.push(hit);
      }
      return {
        matched,
        catalogMatchRate: rawRecs.length > 0 ? catalogHits / rawRecs.length : 0
      };
    };

    if (!saved.fullvault_flashlite) {
      const res = await callGeminiStrict(ai, FLASH_LITE_MODEL, fullPrompt, fullSchema);
      const raw = res.parsed?.recommendations || [];
      const { matched, catalogMatchRate } = resolveFullVaultPicks(raw);
      saved.fullvault_flashlite = {
        ...scoreTop10(matched.slice(0, 10), u.holdoutPositives, u.holdoutRelevance, popularTmdbIds),
        catalogMatchRate,
        survivedCount: matched.length,
        topIds: matched.slice(0, 10).map((m) => m.tmdbId)
      };
    }

    // 4 & 5 & 6. Hydrogen arms (for first opts.hydrogenUsers)
    if (useHydrogen) {
      if (!saved.track1_math_hydrogen) {
        try {
          const res = await callGeminiStrict(ai, HYDROGEN_MODEL, reRankPrompt, reRankSchema);
          const merged = mergeGeminiExplanationsWithRanker(res.parsed, shortlist39, profile, {
            watched: u.trainWatched,
            targetCount: 10
          });
          saved.track1_math_hydrogen = scoreTop10(merged.recommendations, u.holdoutPositives, u.holdoutRelevance, popularTmdbIds);
          saved.track1_math_hydrogen.topIds = merged.recommendations.map((m) => m.tmdbId);
        } catch (err) {
          if (isQuotaError(err)) {
            console.warn("  [Quota] Hydrogen daily quota reached; continuing remaining users on Flash-Lite only.");
            hydrogenExhausted = true;
          } else {
            console.warn(`  [Warn] track1_math_hydrogen failed: ${err.message}`);
          }
        }
      }

      if (!hydrogenExhausted && !saved.fullvault_hydrogen) {
        try {
          const res = await callGeminiStrict(ai, HYDROGEN_MODEL, fullPrompt, fullSchema);
          const raw = res.parsed?.recommendations || [];
          const { matched, catalogMatchRate } = resolveFullVaultPicks(raw);
          saved.fullvault_hydrogen = {
            ...scoreTop10(matched.slice(0, 10), u.holdoutPositives, u.holdoutRelevance, popularTmdbIds),
            catalogMatchRate,
            survivedCount: matched.length,
            tasteThesis: res.parsed?.tasteThesis || null,
            topIds: matched.slice(0, 10).map((m) => m.tmdbId)
          };
        } catch (err) {
          if (isQuotaError(err)) {
            console.warn("  [Quota] Hydrogen daily quota reached; continuing remaining users on Flash-Lite only.");
            hydrogenExhausted = true;
          } else {
            console.warn(`  [Warn] fullvault_hydrogen failed: ${err.message}`);
          }
        }
      }

      if (saved.fullvault_hydrogen?.tasteThesis && !saved.dossier_flashlite) {
        const dossierPrompt = buildDossierCurationPrompt(reRankPrompt, saved.fullvault_hydrogen.tasteThesis);
        const res = await callGeminiStrict(ai, FLASH_LITE_MODEL, dossierPrompt, reRankSchema);
        const merged = mergeGeminiExplanationsWithRanker(res.parsed, shortlist39, profile, {
          watched: u.trainWatched,
          targetCount: 10
        });
        saved.dossier_flashlite = scoreTop10(merged.recommendations, u.holdoutPositives, u.holdoutRelevance, popularTmdbIds);
        saved.dossier_flashlite.topIds = merged.recommendations.map((m) => m.tmdbId);
      }
    }

    // 7 & 8. Gemini 3.8 Flash arms (if --include-38-flash)
    if (opts.include38Flash && !flash38Exhausted) {
      if (!saved.track1_math_38flash) {
        try {
          const res = await callGeminiStrict(ai, FLASH_38_MODEL, reRankPrompt, reRankSchema);
          const merged = mergeGeminiExplanationsWithRanker(res.parsed, shortlist39, profile, {
            watched: u.trainWatched,
            targetCount: 10
          });
          saved.track1_math_38flash = scoreTop10(merged.recommendations, u.holdoutPositives, u.holdoutRelevance, popularTmdbIds);
          saved.track1_math_38flash.topIds = merged.recommendations.map((m) => m.tmdbId);
        } catch (err) {
          if (isQuotaError(err)) {
            console.warn("  [Quota] Gemini 3.8 Flash quota reached; stopping 3.8 Flash arms.");
            flash38Exhausted = true;
          } else {
            console.warn(`  [Warn] track1_math_38flash failed: ${err.message}`);
          }
        }
      }

      if (!flash38Exhausted && !saved.fullvault_38flash) {
        try {
          const res = await callGeminiStrict(ai, FLASH_38_MODEL, fullPrompt, fullSchema);
          const raw = res.parsed?.recommendations || [];
          const { matched, catalogMatchRate } = resolveFullVaultPicks(raw);
          saved.fullvault_38flash = {
            ...scoreTop10(matched.slice(0, 10), u.holdoutPositives, u.holdoutRelevance, popularTmdbIds),
            catalogMatchRate,
            survivedCount: matched.length,
            topIds: matched.slice(0, 10).map((m) => m.tmdbId)
          };
        } catch (err) {
          if (isQuotaError(err)) {
            console.warn("  [Quota] Gemini 3.8 Flash quota reached; stopping 3.8 Flash arms.");
            flash38Exhausted = true;
          } else {
            console.warn(`  [Warn] fullvault_38flash failed: ${err.message}`);
          }
        }
      }
    }

    // 9 & 10. Custom --compare-model arms (e.g. gemini-3.6-flash)
    if (opts.compareModel && !compareExhausted) {
      if (!saved[compareMathKey]) {
        try {
          const res = await callGeminiStrict(ai, opts.compareModel, reRankPrompt, reRankSchema);
          const merged = mergeGeminiExplanationsWithRanker(res.parsed, shortlist39, profile, {
            watched: u.trainWatched,
            targetCount: 10
          });
          saved[compareMathKey] = scoreTop10(merged.recommendations, u.holdoutPositives, u.holdoutRelevance, popularTmdbIds);
          saved[compareMathKey].topIds = merged.recommendations.map((m) => m.tmdbId);
          saved[compareMathKey].latencyMs = res.latencyMs;
        } catch (err) {
          if (isQuotaError(err)) {
            console.warn(`  [Quota] ${opts.compareModel} quota reached; stopping ${opts.compareModel} arms.`);
            compareExhausted = true;
          } else {
            console.warn(`  [Warn] ${compareMathKey} failed: ${err.message}`);
          }
        }
      }

      if (!compareExhausted && !saved[compareFullKey]) {
        try {
          const res = await callGeminiStrict(ai, opts.compareModel, fullPrompt, fullSchema);
          const raw = res.parsed?.recommendations || [];
          const { matched, catalogMatchRate } = resolveFullVaultPicks(raw);
          saved[compareFullKey] = {
            ...scoreTop10(matched.slice(0, 10), u.holdoutPositives, u.holdoutRelevance, popularTmdbIds),
            catalogMatchRate,
            survivedCount: matched.length,
            topIds: matched.slice(0, 10).map((m) => m.tmdbId),
            latencyMs: res.latencyMs
          };
        } catch (err) {
          if (isQuotaError(err)) {
            console.warn(`  [Quota] ${opts.compareModel} quota reached; stopping ${opts.compareModel} arms.`);
            compareExhausted = true;
          } else {
            console.warn(`  [Warn] ${compareFullKey} failed: ${err.message}`);
          }
        }
      }
    }

    checkpoint.users[u.uid] = saved;
    fs.writeFileSync(ckPath, JSON.stringify(checkpoint, null, 2), "utf8");
    console.log(
      `  Hits@10 -> LocalRanker=${saved.local_ranker.hitsAt10} | Math+Flash=${saved.track1_math_flashlite.hitsAt10} | FullFlash=${saved.fullvault_flashlite.hitsAt10}` +
      (compareMathKey && (saved[compareMathKey] || saved[compareFullKey]) ? ` | Math+${compareTag}=${saved[compareMathKey]?.hitsAt10 ?? "—"} | Full+${compareTag}=${saved[compareFullKey]?.hitsAt10 ?? "—"}` : "") +
      (saved.track1_math_38flash || saved.fullvault_38flash ? ` | Math+3.8=${saved.track1_math_38flash?.hitsAt10 ?? "—"} | Full3.8=${saved.fullvault_38flash?.hitsAt10 ?? "—"}` : "") +
      (saved.fullvault_hydrogen ? ` | Math+H2=${saved.track1_math_hydrogen?.hitsAt10 ?? "—"} | FullH2=${saved.fullvault_hydrogen.hitsAt10} | Dossier+Flash=${saved.dossier_flashlite?.hitsAt10 ?? "—"}` : "")
    );
  }

  // Build summaries:
  // A) Matched subset where all Hydrogen arms ran
  const allSaved = selected.map((u) => checkpoint.users[u.uid]).filter(Boolean);
  const h2Matched = allSaved.filter((s) => s.fullvault_hydrogen && s.track1_math_hydrogen && s.dossier_flashlite);

  const armNamesAll = [
    "local_ranker",
    "track1_math_flashlite",
    "fullvault_flashlite",
    ...(compareMathKey && allSaved.some((s) => s[compareMathKey]) ? [compareMathKey] : []),
    ...(compareFullKey && allSaved.some((s) => s[compareFullKey]) ? [compareFullKey] : []),
    ...(allSaved.some((s) => s.track1_math_38flash) ? ["track1_math_38flash"] : []),
    ...(allSaved.some((s) => s.fullvault_38flash) ? ["fullvault_38flash"] : [])
  ];
  const armNamesH2 = ["local_ranker", "track1_math_hydrogen", "track1_math_flashlite", "fullvault_hydrogen", "fullvault_flashlite", "dossier_flashlite"];

  const summaryAll = Object.fromEntries(armNamesAll.map((a) => [a, summarizeArm(allSaved.map((s) => s[a]).filter(Boolean))]));
  const summaryH2 = Object.fromEntries(armNamesH2.map((a) => [a, summarizeArm(h2Matched.map((s) => s[a]).filter(Boolean))]));

  const mdLines = [
    "# MovieLens 32M Holdout Evaluation (Leakage-Clean)",
    "",
    `- Dataset: \`.data/fresh_300_users.json\` + \`.data/item_embeddings_clean2_f16.bin\` (10 held-out \`>=8★\` films per user)`,
    `- Users evaluated (Fast arms): \`${allSaved.length}\``,
    `- Users evaluated (All 6 arms incl. Gemini 4 Hydrogen): \`${h2Matched.length}\``,
    "",
    "## Table A: Head-to-Head Across All 6 Arms (Matched Hydrogen Subset)",
    "",
    "| Arm | Users | Hit Rate (>=1/10) | Mean Hits@10 | Recall@10 | NDCG@10 | LT Recall@10 | LT NDCG@10 | Mean ln(Votes) | Catalog Match |",
    "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
  ];

  for (const a of armNamesH2) {
    const s = summaryH2[a];
    if (!s) continue;
    mdLines.push(
      `| ${a} | ${s.nUsers} | ${(s.hitRateAny * 100).toFixed(1)}% | ${s.meanHitsAt10} | ${s.recall10} | **${s.ndcg10}** | ${s.ltRecall10 ?? "—"} | ${s.ltNdcg10 ?? "—"} | ${s.meanLogVc} | ${s.avgCatalogMatchRate ?? "1.000"} |`
    );
  }

  mdLines.push(
    "",
    "## Table B: Broader Multi-User Benchmark (Local Ranker vs. Math+Flash-Lite vs. Full-Vault Flash-Lite)",
    "",
    "| Arm | Users | Hit Rate (>=1/10) | Mean Hits@10 | Recall@10 | NDCG@10 | LT Recall@10 | LT NDCG@10 | Mean ln(Votes) | Catalog Match |",
    "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
  );

  for (const a of armNamesAll) {
    const s = summaryAll[a];
    if (!s) continue;
    mdLines.push(
      `| ${a} | ${s.nUsers} | ${(s.hitRateAny * 100).toFixed(1)}% | ${s.meanHitsAt10} | ${s.recall10} | **${s.ndcg10}** | ${s.ltRecall10 ?? "—"} | ${s.ltNdcg10 ?? "—"} | ${s.meanLogVc} | ${s.avgCatalogMatchRate ?? "1.000"} |`
    );
  }

  const mdOut = path.resolve(ROOT, OUT_DIR, "summary.md");
  const jsonOut = path.resolve(ROOT, OUT_DIR, "summary.json");
  fs.writeFileSync(mdOut, mdLines.join("\n") + "\n", "utf8");
  fs.writeFileSync(jsonOut, JSON.stringify({ summaryH2, summaryAll }, null, 2), "utf8");
  console.log(`\nSaved MovieLens 32M Holdout Report to ${mdOut}`);
}

await main();
