import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = "g:/Important Projects/movie-ratings";
const importSrc = rel => import(pathToFileURL(path.join(root, rel)).href);

const modeArg = process.argv.find(a => a.startsWith("--mode="))?.split("=")[1] || "before";

const {
  parseEmbeddingBinary,
  computeUserPersonas,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex
} = await importSrc("src/services/embeddingService.js");
const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await importSrc("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await importSrc("src/services/tmdbService.js");

function mapMovieLensGenresToTmdb(genresStr = "") {
  if (!genresStr || genresStr === "(no genres listed)") return [];
  const normalized = genresStr
    .replace(/\|/g, ",")
    .replace(/\bchildren\b/gi, "Family")
    .replace(/\bsci-fi\b/gi, "Sci-Fi");
  return mapOmdbToTmdbGenreIds(normalized);
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
  const holdoutStartTs = sorted[splitIdx]?.ts;
  return { trainWatched, holdoutStartTs };
}

function loadEmbeddingBin(relPath) {
  const buf = fs.readFileSync(path.join(root, relPath));
  return parseEmbeddingBinary(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
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

function buildCatalog() {
  const tmdbEnriched = JSON.parse(fs.readFileSync(path.join(root, ".data/tmdb_enriched.json"), "utf8"));
  const tmdbItems = tmdbEnriched.items || {};
  const linksLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/links.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1);
  const movieIdToTmdbId = new Map();
  const tmdbIdToMovieIds = new Map();
  for (const l of linksLines) {
    const [mid, , tmdb] = l.trim().split(",");
    if (tmdb) {
      const tid = Number(tmdb);
      if (Number.isFinite(tid) && tid > 0) {
        movieIdToTmdbId.set(mid.trim(), tid);
        if (!tmdbIdToMovieIds.has(tid)) tmdbIdToMovieIds.set(tid, []);
        tmdbIdToMovieIds.get(tid).push(mid.trim());
      }
    }
  }
  const moviesLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/movies.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1);
  const movieMeta = new Map();
  for (const l of moviesLines) {
    const commaIdx = l.indexOf(",");
    const lastComma = l.lastIndexOf(",");
    if (commaIdx === -1) continue;
    const mid = l.slice(0, commaIdx).trim();
    const genres = l.slice(lastComma + 1).trim();
    const title = l.slice(commaIdx + 1, lastComma).trim().replace(/^"|"$/g, "");
    const yearMatch = title.match(/\((\d{4})\)\s*$/);
    movieMeta.set(mid, { title, genres, mlYear: yearMatch ? yearMatch[1] : "N/A" });
  }
  const catalog = [];
  const catalogByTmdb = new Map();
  for (const [tid, mids] of tmdbIdToMovieIds.entries()) {
    const meta = movieMeta.get(mids[0]) || { title: "Unknown", genres: "", mlYear: "N/A" };
    const e = tmdbItems[tid] || null;
    const fallbackGenres = mapMovieLensGenresToTmdb(meta.genres);
    const genreIds = e ? (e.tmdbGenreIds || []) : fallbackGenres;
    const obj = {
      id: tid,
      tmdbId: tid,
      title: e?.title || meta.title,
      year: e?.year || meta.mlYear || "N/A",
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
      streamProviders: e?.streamProviders || []
    };
    catalog.push(obj);
    catalogByTmdb.set(tid, obj);
  }
  return { catalog, catalogByTmdb, movieIdToTmdbId };
}

function loadOrig328Users(catalogByTmdb, movieIdToTmdbId) {
  const ratingsLines = fs.readFileSync(path.join(root, ".data/ml-latest-small/ratings.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1);
  const ratingsByUser = new Map();
  for (const l of ratingsLines) {
    const [uid, mid, rStr, tsStr] = l.trim().split(",");
    const tid = movieIdToTmdbId.get(mid);
    if (!tid) continue;
    const cat = catalogByTmdb.get(tid);
    if (!cat) continue;
    if (!ratingsByUser.has(uid)) ratingsByUser.set(uid, []);
    ratingsByUser.get(uid).push({
      ...cat,
      movieId: mid,
      userRating: Number(rStr) * 2,
      dateWatched: new Date(Number(tsStr) * 1000).toISOString(),
      ts: Number(tsStr) * 1000
    });
  }
  const benchmarkUserIds = new Set(["89", "263", "409", "561"]);
  const users = [];
  for (const [uid, ratings] of ratingsByUser.entries()) {
    if (benchmarkUserIds.has(uid)) continue;
    if (ratings.length < 60) continue;
    ratings.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.tmdbId - b.tmdbId));
    const pos = ratings.filter(r => r.userRating >= 8);
    if (pos.length >= 15) users.push({ uid, ratings });
  }
  users.sort((a, b) => Number(a.uid) - Number(b.uid));
  return users;
}

async function computeState() {
  const { catalog, catalogByTmdb, movieIdToTmdbId } = buildCatalog();
  const origUsers = loadOrig328Users(catalogByTmdb, movieIdToTmdbId);
  const clean1Sub = buildCatalogSubsetIndex(loadEmbeddingBin(".data/item_embeddings_clean_f16.bin"), catalog);

  const userTop20 = {};
  for (let u = 0; u < origUsers.length; u++) {
    const user = origUsers[u];
    const { trainWatched, holdoutStartTs } = getUserSplit(user.ratings);
    const trainIdSet = new Set(trainWatched.map(m => Number(m.tmdbId)));
    const profile = await extractTasteProfile(trainWatched, [], {
      now: holdoutStartTs,
      anchorCutoff: Infinity
    });
    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, clean1Sub);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, clean1Sub);
    const candidates = catalog.filter(c => !trainIdSet.has(c.tmdbId));
    const ranked = rankCandidatePool(
      candidates,
      {
        profile,
        collabSimMap,
        contentSimMap: new Map(),
        repulsionMap,
        anchorKeywords: profile.lovedKeywordIds || [],
        userProviders: []
      },
      DEFAULT_RANKER_WEIGHTS,
      20
    );
    userTop20[user.uid] = ranked.map(m => Number(m.tmdbId));
    if ((u + 1) % 100 === 0) {
      console.log(`[${modeArg}] parity pass ${u + 1}/${origUsers.length}`);
    }
  }

  // Real-clock check on the 4 benchmark vaults using Date.now()
  const prodEmb = loadEmbeddingBin("public/models/item_embeddings_f16.bin");
  const benchmarkData = JSON.parse(fs.readFileSync(path.join(root, ".data/benchmark_vaults.json"), "utf8"));
  const benchmarkVaults = [];
  for (const v of benchmarkData.vaults) {
    const profile = await extractTasteProfile(v.watched || [], v.watchlist || []);
    const personas = computeUserPersonas(profile.weightedRatings, prodEmb);
    const simMap = buildCollabSimMapFromIndex(profile.weightedRatings, prodEmb);
    const repMap = buildRepulsionMapFromIndex(profile.weightedRatings, prodEmb);
    const maxAbsW = Math.max(0, ...profile.weightedRatings.map(e => Math.abs(Number(e?.weight ?? 0))));
    benchmarkVaults.push({
      name: v.name,
      nowIso: new Date().toISOString(),
      maxAbsWeight: maxAbsW,
      personaCount: personas.length,
      collabMapSize: simMap.size,
      repulsionNonZero: Array.from(repMap.values()).filter(x => x > 0).length
    });
  }

  return {
    mode: modeArg,
    generatedAt: new Date().toISOString(),
    userCount: origUsers.length,
    userTop20,
    benchmarkVaults
  };
}

async function main() {
  const beforePath = path.join(root, ".data/phaseE_e1_before.json");
  if (modeArg === "before") {
    const state = await computeState();
    fs.writeFileSync(beforePath, JSON.stringify(state, null, 2));
    console.log(`Saved BEFORE baseline (${state.userCount} users) to ${beforePath}`);
    console.log("Benchmark vaults BEFORE (real Date.now()):", state.benchmarkVaults);
    return;
  }

  if (modeArg === "after") {
    if (!fs.existsSync(beforePath)) {
      throw new Error(`Missing BEFORE snapshot at ${beforePath}`);
    }
    const before = JSON.parse(fs.readFileSync(beforePath, "utf8"));
    const after = await computeState();

    const mismatches = [];
    const uids = Object.keys(before.userTop20);
    for (const uid of uids) {
      const aList = before.userTop20[uid];
      const bList = after.userTop20[uid];
      let firstDiffIdx = -1;
      for (let i = 0; i < 20; i++) {
        if (aList[i] !== bList[i]) {
          firstDiffIdx = i;
          break;
        }
      }
      if (firstDiffIdx !== -1 || aList.length !== bList.length) {
        mismatches.push({ uid, firstDiffIdx, before: aList, after: bList });
      }
    }

    console.log(`\nParity check (328 users): total=${uids.length}, mismatches=${mismatches.length}`);
    if (mismatches.length > 0) {
      for (const m of mismatches.slice(0, 10)) {
        console.log(`  Mismatch uid=${m.uid} firstDiffIdx=${m.firstDiffIdx}`);
      }
    }

    console.log("\nReal-clock check (4 benchmark vaults, Date.now()):");
    const vaultComparison = [];
    for (let i = 0; i < after.benchmarkVaults.length; i++) {
      const bv = before.benchmarkVaults[i];
      const av = after.benchmarkVaults[i];
      vaultComparison.push({
        name: av.name,
        maxAbsWeightBefore: bv.maxAbsWeight,
        maxAbsWeightAfter: av.maxAbsWeight,
        personasBefore: bv.personaCount,
        personasAfter: av.personaCount,
        collabMapBefore: bv.collabMapSize,
        collabMapAfter: av.collabMapSize
      });
      console.log(
        `  ${av.name}: personas ${bv.personaCount} -> ${av.personaCount}, ` +
          `collabMapSize ${bv.collabMapSize} -> ${av.collabMapSize}, maxAbsW=${av.maxAbsWeight.toExponential(3)}`
      );
    }

    const reportPath = path.join(root, ".data/phaseE_e1_report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          userCount: uids.length,
          mismatchCount: mismatches.length,
          mismatches,
          vaultComparison
        },
        null,
        2
      )
    );
    console.log(`Saved AFTER report to ${reportPath}`);
    return;
  }

  throw new Error(`Unknown --mode=${modeArg}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
