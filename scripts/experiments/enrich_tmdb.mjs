import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "g:/Important Projects/movie-ratings";

// Load .env before importing src/services/tmdbService.js
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
  const envRaw = fs.readFileSync(envPath, "utf8");
  for (const line of envRaw.split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (m) {
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[m[1].trim()] = val;
    }
  }
}

if (!process.env.VITE_TMDB_KEY) {
  console.error("ERROR: VITE_TMDB_KEY missing in .env or process.env");
  process.exit(1);
}

// Wrap global fetch ONLY to add rate-limit retry (429 / 5xx / timeout) without altering src/
const nativeFetch = globalThis.fetch.bind(globalThis);
const lastHttpStatus = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

globalThis.fetch = async (url, init = {}) => {
  const urlStr = String(url);
  const tidMatch = urlStr.match(/\/movie\/(\d+)/);
  const tidKey = tidMatch ? tidMatch[1] : null;

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await nativeFetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (tidKey) lastHttpStatus.set(tidKey, res.status);

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") || "2");
        const waitMs = Math.max(1000, retryAfter * 1000) + attempt * 500;
        await sleep(waitMs);
        continue;
      }

      if (res.status >= 500 && attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }

      // 404 or 200 -> return directly to fetchTmdbMovieDetails
      return res;
    } catch (err) {
      if (tidKey) lastHttpStatus.set(tidKey, `ERR:${err?.name || err?.message}`);
      if (attempt < maxAttempts) {
        await sleep(750 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max fetch attempts exceeded");
};

const { fetchTmdbMovieDetails } = await import(
  pathToFileURL(path.join(root, "src/services/tmdbService.js")).href
);

// Parse links.csv & ratings.csv
const linksLines = fs
  .readFileSync(path.join(root, ".data/ml-latest-small/links.csv"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1);

const allUniqueTmdbIds = [];
const seenTmdbSet = new Set();
for (const line of linksLines) {
  const [, , tmdb] = line.trim().split(",");
  if (!tmdb) continue;
  const tid = Number(tmdb);
  if (!Number.isFinite(tid) || tid <= 0 || seenTmdbSet.has(tid)) continue;
  seenTmdbSet.add(tid);
  allUniqueTmdbIds.push(tid);
}

// Pre-compute restricted pool (rated by 328 users OR >= 5 ratings) in case ETA > ~2 hours
const m2t = new Map();
for (const line of linksLines) {
  const [mid, , tmdb] = line.trim().split(",");
  if (tmdb) m2t.set(mid.trim(), Number(tmdb));
}

const ratingsLines = fs
  .readFileSync(path.join(root, ".data/ml-latest-small/ratings.csv"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1);

const byUser = new Map();
const movieCounts = new Map();
for (const line of ratingsLines) {
  const [uid, mid, rStr] = line.trim().split(",");
  const tid = m2t.get(mid);
  if (!tid) continue;
  const r = Number(rStr) * 2;
  if (!byUser.has(uid)) byUser.set(uid, []);
  byUser.get(uid).push({ tid, r });
  movieCounts.set(tid, (movieCounts.get(tid) || 0) + 1);
}

const benchIds = new Set(["89", "263", "409", "561"]);
const eligibleUids = new Set();
for (const [uid, rs] of byUser.entries()) {
  if (benchIds.has(uid) || rs.length < 60) continue;
  if (rs.filter(x => x.r >= 8).length >= 15) eligibleUids.add(uid);
}

const restrictedSet = new Set();
for (const [uid, rs] of byUser.entries()) {
  if (eligibleUids.has(uid)) {
    for (const x of rs) restrictedSet.add(x.tid);
  }
}
for (const tid of allUniqueTmdbIds) {
  if ((movieCounts.get(tid) || 0) >= 5) restrictedSet.add(tid);
}

const outPath = path.join(root, ".data/tmdb_enriched.json");
const tmpPath = path.join(root, ".data/tmdb_enriched.json.tmp");

let store = {
  meta: {
    mode: "full",
    totalTargetIds: allUniqueTmdbIds.length,
    startedAt: new Date().toISOString(),
    updatedAt: null
  },
  items: {},
  failed: {}
};

if (fs.existsSync(outPath)) {
  try {
    const existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (existing && typeof existing.items === "object") {
      store.items = existing.items || {};
      store.failed = existing.failed || {};
      if (existing.meta?.startedAt) store.meta.startedAt = existing.meta.startedAt;
    }
  } catch (err) {
    console.warn("Could not parse existing tmdb_enriched.json, starting fresh:", err.message);
  }
}

function saveCheckpoint() {
  store.meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmpPath, JSON.stringify(store));
  fs.renameSync(tmpPath, outPath);
}

// Keep priority order: restrictedSet items first, then remaining catalog items
const targetList = [
  ...allUniqueTmdbIds.filter(tid => restrictedSet.has(tid)),
  ...allUniqueTmdbIds.filter(tid => !restrictedSet.has(tid))
];

const pending = targetList.filter(
  tid => !store.items[tid] && !store.failed[tid]
);

console.log(
  `TMDB Enrichment Startup: total unique tmdbIds=${allUniqueTmdbIds.length}, ` +
  `already fetched=${Object.keys(store.items).length}, already failed=${Object.keys(store.failed).length}, ` +
  `pending=${pending.length}`
);

// Rate-limiter: max ~22 req/sec (minimum 45ms between request dispatches, concurrency=12)
const CONCURRENCY = 12;
const MIN_DISPATCH_INTERVAL_MS = 45;
let nextDispatchTime = Date.now();
let dispatchLock = Promise.resolve();

async function acquireRateToken() {
  let release;
  const prev = dispatchLock;
  dispatchLock = new Promise(r => (release = r));
  await prev;
  const now = Date.now();
  const wait = Math.max(0, nextDispatchTime - now);
  nextDispatchTime = Math.max(now, nextDispatchTime) + MIN_DISPATCH_INTERVAL_MS;
  release();
  if (wait > 0) await sleep(wait);
}

let sessionFetched = 0;
let sessionFailed = 0;
let cursor = 0;
let abortRestForTimeBudget = false;
const sessionStart = Date.now();

function logProgress(prefix = "Progress") {
  const totalFetched = Object.keys(store.items).length;
  const totalFailed = Object.keys(store.failed).length;
  const processed = sessionFetched + sessionFailed;
  const elapsedSec = Math.max(1, (Date.now() - sessionStart) / 1000);
  const rate = processed / elapsedSec;
  const remaining = Math.max(0, pending.length - cursor);
  const etaMin = rate > 0 ? remaining / rate / 60 : Infinity;
  console.log(
    `[${prefix} @ ${(elapsedSec / 60).toFixed(1)}m] ` +
    `fetched=${totalFetched} (+${sessionFetched}), failed=${totalFailed} (+${sessionFailed}), ` +
    `remaining=${remaining}, rate=${rate.toFixed(1)} req/s, ETA=${Number.isFinite(etaMin) ? etaMin.toFixed(1) + "m" : "N/A"}`
  );
}

// Progress logger every 120 seconds (2 minutes)
const progressTimer = setInterval(() => {
  logProgress("2m Progress");
}, 120000);

async function worker() {
  while (true) {
    if (abortRestForTimeBudget) return;
    const idx = cursor++;
    if (idx >= pending.length) return;
    const tid = pending[idx];

    // Time budget check after 200 items: if projected > 110 minutes (~2h), restrict to restrictedSet
    if (idx === 200) {
      const elapsedSec = (Date.now() - sessionStart) / 1000;
      const projSec = (elapsedSec / 200) * pending.length;
      if (projSec > 6600) {
        console.warn(`Projected time ${(projSec / 60).toFixed(1)}m exceeds ~2h; restricting pool!`);
        store.meta.mode = "restricted";
        abortRestForTimeBudget = true;
      }
    }

    await acquireRateToken();
    try {
      const d = await fetchTmdbMovieDetails(tid, "US");
      if (d && d.tmdbId) {
        store.items[tid] = {
          tmdbId: d.tmdbId,
          imdbID: d.imdbID || null,
          title: d.title || null,
          year: d.year || "N/A",
          release_date: d.release_date || null,
          vote_average: d.vote_average ?? null,
          vote_count: d.vote_count ?? 0,
          popularity: d.popularity ?? 0,
          genre: d.genre || "Cinema",
          tmdbGenreIds: Array.isArray(d.tmdbGenreIds) ? d.tmdbGenreIds : [],
          tmdbKeywords: Array.isArray(d.tmdbKeywords) ? d.tmdbKeywords : [],
          castIds: Array.isArray(d.castIds) ? d.castIds : [],
          crewPersonId: d.crewPersonId || null,
          director: d.director || "Unknown",
          streamProviders: Array.isArray(d.streamProviders) ? d.streamProviders.map(p => ({ id: p.id, name: p.name })) : []
        };
        sessionFetched++;
      } else {
        const status = lastHttpStatus.get(String(tid)) ?? "null_response";
        store.failed[tid] = { status, recordedAt: new Date().toISOString() };
        sessionFailed++;
      }
    } catch (err) {
      store.failed[tid] = { status: String(err?.message || err), recordedAt: new Date().toISOString() };
      sessionFailed++;
    }

    const doneCount = sessionFetched + sessionFailed;
    if (doneCount % 500 === 0) {
      saveCheckpoint();
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
clearInterval(progressTimer);

saveCheckpoint();
logProgress("DONE");
console.log(`Saved enriched TMDB catalog to ${outPath}`);
