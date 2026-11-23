import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { parseEmbeddingBinary, buildCollabSimMapFromIndex, buildRepulsionMapFromIndex } = await imp("src/services/embeddingService.js");
const { computeRecallAtK, computeNDCGAtK } = await imp("src/services/evalHarness.js");
const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await imp("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await imp("src/services/tmdbService.js");
const { getModelThinkingConfig, sanitizeAndParseJSON, cleanStr } = await imp("src/services/geminiService.js");
const { formatTieredVault } = await imp("scripts/experiments/dual_track_utils.mjs");

// Load .env
for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq <= 0) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const tmdbItems = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/tmdb_enriched.json"), "utf8")).items || {};
const linksLines = fs.readFileSync(path.join(ROOT, ".data/ml-latest-small/links.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1);
const tmdbToMids = new Map();
for (const l of linksLines) {
  const [mid,,tmdb] = l.trim().split(",");
  if (tmdb && Number(tmdb) > 0) {
    const tid = Number(tmdb);
    if (!tmdbToMids.has(tid)) tmdbToMids.set(tid, []);
    tmdbToMids.get(tid).push(mid.trim());
  }
}
const moviesLines = fs.readFileSync(path.join(ROOT, ".data/ml-latest-small/movies.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1);
const metaByMid = new Map();
for (const l of moviesLines) {
  const c1 = l.indexOf(","), c2 = l.lastIndexOf(",");
  if (c1 === -1) continue;
  const mid = l.slice(0, c1).trim();
  const genres = l.slice(c2 + 1).trim();
  const raw = l.slice(c1 + 1, c2).trim().replace(/^"|"$/g, "");
  const ym = raw.match(/\((\d{4})\)\s*$/);
  metaByMid.set(mid, { title: raw.replace(/\s*\(\d{4}\)\s*$/, "").trim(), genres, mlYear: ym ? ym[1] : "N/A" });
}
const catalog = [];
const catalogByTmdb = new Map();
for (const [tid, mids] of tmdbToMids.entries()) {
  const m = metaByMid.get(mids[0]) || { title: "Unknown", genres: "", mlYear: "N/A" };
  const e = tmdbItems[tid] || null;
  const genreIds = e ? (e.tmdbGenreIds || []) : mapOmdbToTmdbGenreIds((m.genres || "").replace(/\|/g, ",").replace(/\bchildren\b/gi, "Family"));
  const obj = {
    id: tid, tmdbId: tid, title: e?.title || m.title, year: String(e?.year || m.mlYear || "N/A"),
    release_date: e?.release_date || null, genre: e?.genre || m.genres || "Cinema",
    tmdbGenreIds: genreIds, genre_ids: genreIds, tmdbKeywords: e?.tmdbKeywords || [],
    castIds: e?.castIds || [], crewPersonId: e?.crewPersonId ?? null, director: e?.director || "Unknown",
    vote_average: e?.vote_average ?? null, vote_count: e?.vote_count ?? 0, popularity: e?.popularity ?? 0,
    streamProviders: e?.streamProviders || [], hydrated: Boolean(e)
  };
  catalog.push(obj);
  catalogByTmdb.set(tid, obj);
}

const sortedByVotes = [...catalog].sort((a, b) => b.vote_count - a.vote_count || (b.vote_average ?? 0) - (a.vote_average ?? 0));
const popularTmdbIds = new Set(sortedByVotes.slice(0, Math.floor(0.20 * sortedByVotes.length)).map((c) => c.tmdbId));

const embBuf = fs.readFileSync(path.join(ROOT, ".data/item_embeddings_clean2_f16.bin"));
const fullClean = parseEmbeddingBinary(embBuf.buffer.slice(embBuf.byteOffset, embBuf.byteOffset + embBuf.byteLength));
const keepIds = catalog.filter((c) => fullClean.idToIndex.has(c.tmdbId)).map((c) => c.tmdbId);
const dim = fullClean.dim;
const subIds = new Int32Array(keepIds.length);
const subVecs = new Float32Array(keepIds.length * dim);
const subIdToIndex = new Map();
keepIds.forEach((tid, i) => {
  const src = fullClean.idToIndex.get(tid);
  subIds[i] = tid;
  subVecs.set(fullClean.vectors.subarray(src * dim, (src + 1) * dim), i * dim);
  subIdToIndex.set(tid, i);
});
const cleanSub = { version: fullClean.version, count: keepIds.length, dim, ids: subIds, vectors: subVecs, idToIndex: subIdToIndex };

const fresh = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/fresh_300_users.json"), "utf8")).users;
const ckPath = path.join(ROOT, "scripts/experiments/results/ml32m_holdout/checkpoint.json");
const ck = JSON.parse(fs.readFileSync(ckPath, "utf8"));
const uids20 = Object.keys(ck.users);

const ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_KEY.trim(), httpOptions: { timeout: 60_000 } });
const MODEL = "gemini-3.5-flash-lite";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const schema = {
  type: Type.OBJECT,
  properties: {
    recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tmdbId: { type: Type.NUMBER },
          title: { type: Type.STRING },
          reason: { type: Type.STRING }
        },
        required: ["tmdbId", "title", "reason"]
      }
    }
  },
  required: ["recommendations"]
};

function buildTop80CompactPrompt(tieredVaultText, top80) {
  const candLines = top80.map((c, idx) => {
    const dir = c.director && c.director !== "Unknown" ? ` | Dir: ${cleanStr(c.director)}` : "";
    const score = c.vote_average ? ` | ${c.vote_average}/10 (${c.vote_count}v)` : "";
    return `${idx + 1}. ID:${c.tmdbId} | "${cleanStr(c.title)}" (${c.year})${dir} | ${cleanStr(c.genre)}${score}`;
  }).join("\n");

  return `You are an expert film curator selecting the TOP 10 movies this viewer is most likely to rate 8–10/10 next from the 80 pre-scored candidates below.

VIEWER'S COMPLETE TIERED WATCH HISTORY:
${tieredVaultText}

TOP 80 PRE-SCORED CANDIDATE POOL (ordered by collaborative math rank #1..#80):
${candLines}

INSTRUCTIONS:
1. Study ALL taste clusters in the viewer's 9–10/10 tiers — including smaller high-intensity clusters (e.g., 4–6 films all rated 10/10) that may sit at ranks #26–#80 below a larger genre cluster.
2. Avoid tones/directors/franchises similar to their <=5/10 dislikes and 6–7/10 near-misses.
3. Select the 10 strongest, most accurate matches STRICTLY from the 80 candidates above (return exact tmdbId and title), ordered from #1 (strongest fit) to #10.
4. Keep variety reasonable (don't pick 6 films from the same franchise unless strongly warranted), and output strict JSON.`;
}

const outPath = path.join(ROOT, "scripts/experiments/results/ml32m_holdout/top80_compact_eval.json");
const ckTop80Path = path.join(ROOT, "scripts/experiments/results/ml32m_holdout/top80_compact_checkpoint.json");
const savedTop80 = fs.existsSync(ckTop80Path) ? JSON.parse(fs.readFileSync(ckTop80Path, "utf8")) : {};

const results = [];
for (let i = 0; i < uids20.length; i++) {
  const uid = uids20[i];
  if (savedTop80[uid]) {
    results.push(savedTop80[uid]);
    console.log(`[${i + 1}/20] uid=${uid} [cached] | in80=${savedTop80[uid].hitsIn80} | Local=${savedTop80[uid].localHits} | Old39=${savedTop80[uid].prev39Hits} | NewTop80=${savedTop80[uid].hits10} (ndcg=${savedTop80[uid].ndcg10.toFixed(3)})`);
    continue;
  }
  const rawUser = fresh.find((u) => String(u.uid) === String(uid));
  const ratings = rawUser.ratings.map((r) => ({
    ...catalogByTmdb.get(r.tmdbId), movieId: r.movieId, userRating: r.userRating,
    dateWatched: new Date(r.ts).toISOString(), ts: r.ts
  })).sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.tmdbId - b.tmdbId));
  let p = 0, splitIdx = ratings.length;
  for (let k = ratings.length - 1; k >= 0; k--) { if (ratings[k].userRating >= 8 && ++p === 10) { splitIdx = k; break; } }
  const train = ratings.slice(0, splitIdx);
  const hold = ratings.slice(splitIdx);
  const holdPos = new Set(hold.filter((m) => m.userRating >= 8).map((m) => String(m.tmdbId)));
  const holdRel = new Map(hold.map((m) => [String(m.tmdbId), m.userRating]));
  const trainIds = new Set(train.map((m) => m.tmdbId));
  const maxYear = Math.max(...ratings.map((r) => Number(String(r.year || "").slice(0, 4)) || 0), new Date(ratings[ratings.length - 1].ts).getUTCFullYear());

  const profile = await extractTasteProfile(train, [], { now: ratings[splitIdx].ts, anchorCutoff: Infinity });
  const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, cleanSub);
  const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, cleanSub);
  const cands = catalog.filter((c) => !trainIds.has(c.tmdbId) && !(Number(String(c.year || "").slice(0, 4)) > maxYear));
  const ctx = { profile, collabSimMap, contentSimMap: new Map(), repulsionMap, anchorKeywords: profile.lovedKeywordIds || [], userProviders: [] };

  const top80 = rankCandidatePool(cands, ctx, DEFAULT_RANKER_WEIGHTS, 80, { metadataDampingFactor: 0.20 });
  const top80ById = new Map(top80.map((c) => [c.tmdbId, c]));
  const hitsIn80 = top80.filter((c) => holdPos.has(String(c.tmdbId))).length;

  const tiered = formatTieredVault(train, [], { userRegion: "US" });
  const prompt = buildTop80CompactPrompt(tiered.text, top80);
  const thinkingConfig = getModelThinkingConfig(MODEL, "curation");

  const t0 = Date.now();
  let res = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      res = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: schema, ...(thinkingConfig ? { thinkingConfig } : {}) }
      });
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 6 && /503|500|504|UNAVAILABLE|high demand|overloaded|fetch failed|DEADLINE/i.test(String(err?.message || err))) {
        const waitMs = Math.min(25_000, attempt * 5000);
        console.log(`  [Retry ${attempt}/5] uid=${uid} transient 503; waiting ${waitMs / 1000}s...`);
        await sleep(waitMs);
        continue;
      }
      break;
    }
  }
  if (!res) {
    console.warn(`  [Skip] uid=${uid} failed after retries: ${lastErr?.message || lastErr}`);
    continue;
  }
  const latencyMs = Date.now() - t0;
  const parsed = sanitizeAndParseJSON(res.text);

  const chosenIds = [];
  const seen = new Set();
  for (const r of parsed?.recommendations || []) {
    const id = Number(r?.tmdbId);
    if (top80ById.has(id) && !seen.has(id)) {
      seen.add(id);
      chosenIds.push(String(id));
    }
    if (chosenIds.length >= 10) break;
  }
  for (const c of top80) {
    if (chosenIds.length >= 10) break;
    if (!seen.has(c.tmdbId)) {
      seen.add(c.tmdbId);
      chosenIds.push(String(c.tmdbId));
    }
  }

  const hits10 = chosenIds.filter((id) => holdPos.has(id)).length;
  const ndcg10 = computeNDCGAtK(chosenIds, holdRel, 10);
  const recall10 = computeRecallAtK(chosenIds, holdPos, 10);
  const ltPos = new Set([...holdPos].filter((id) => !popularTmdbIds.has(Number(id))));
  const ltRel = new Map([...holdRel.entries()].filter(([id]) => !popularTmdbIds.has(Number(id))));
  const ltRecall10 = ltPos.size > 0 ? computeRecallAtK(chosenIds, ltPos, 10) : null;
  const ltNdcg10 = ltRel.size > 0 ? computeNDCGAtK(chosenIds, ltRel, 10) : null;

  const row = {
    uid,
    hitsIn80,
    hits10,
    hitAny: hits10 > 0 ? 1 : 0,
    ndcg10,
    recall10,
    ltRecall10,
    ltNdcg10,
    latencyMs,
    promptTokens: res?.usageMetadata?.promptTokenCount ?? 0,
    prev39Hits: ck.users[uid].track1_math_flashlite.hitsAt10,
    prev39Ndcg: ck.users[uid].track1_math_flashlite.ndcg10,
    localHits: ck.users[uid].local_ranker.hitsAt10,
    localNdcg: ck.users[uid].local_ranker.ndcg10
  };
  savedTop80[uid] = row;
  fs.writeFileSync(ckTop80Path, JSON.stringify(savedTop80, null, 2), "utf8");
  results.push(row);
  console.log(`[${i + 1}/20] uid=${uid} | in80=${hitsIn80} | Local=${ck.users[uid].local_ranker.hitsAt10} | Old39=${ck.users[uid].track1_math_flashlite.hitsAt10} | NewTop80=${hits10} (ndcg=${ndcg10.toFixed(3)}, ${latencyMs}ms, ${res?.usageMetadata?.promptTokenCount ?? 0} tok)`);
  await sleep(1500);
}

const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const ltRec = results.map((r) => r.ltRecall10).filter((v) => v !== null);
const ltNdcg = results.map((r) => r.ltNdcg10).filter((v) => v !== null);

const summary = {
  nUsers: results.length,
  meanHitsInTop80: Number(avg(results.map((r) => r.hitsIn80)).toFixed(2)),
  old_local_ranker: {
    hitRate: Number(avg(results.map((r) => (r.localHits > 0 ? 1 : 0))).toFixed(4)),
    meanHits10: Number(avg(results.map((r) => r.localHits)).toFixed(4)),
    ndcg10: Number(avg(results.map((r) => r.localNdcg)).toFixed(4))
  },
  old_39shortlist_flashlite: {
    hitRate: Number(avg(results.map((r) => (r.prev39Hits > 0 ? 1 : 0))).toFixed(4)),
    meanHits10: Number(avg(results.map((r) => r.prev39Hits)).toFixed(4)),
    ndcg10: Number(avg(results.map((r) => r.prev39Ndcg)).toFixed(4))
  },
  new_top80_compact_flashlite: {
    hitRate: Number(avg(results.map((r) => r.hitAny)).toFixed(4)),
    meanHits10: Number(avg(results.map((r) => r.hits10)).toFixed(4)),
    recall10: Number(avg(results.map((r) => r.recall10)).toFixed(4)),
    ndcg10: Number(avg(results.map((r) => r.ndcg10)).toFixed(4)),
    ltRecall10: ltRec.length > 0 ? Number(avg(ltRec).toFixed(4)) : null,
    ltNdcg10: ltNdcg.length > 0 ? Number(avg(ltNdcg).toFixed(4)) : null,
    avgLatencyMs: Math.round(avg(results.map((r) => r.latencyMs))),
    avgPromptTokens: Math.round(avg(results.map((r) => r.promptTokens)))
  }
};

fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log("\n=== TOP-80 COMPACT VS OLD 39-SHORTLIST SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
