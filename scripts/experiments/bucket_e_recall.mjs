import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  parseEmbeddingBinary,
  buildCollabSimMapFromIndex,
  buildRepulsionMapFromIndex,
  getCollabCatalogMax,
  retrieveAlignedEmbeddingNeighbors
} = await imp("src/services/embeddingService.js");
const { DEFAULT_RANKER_WEIGHTS } = await imp("src/services/rankerService.js");
const { extractTasteProfile, mapOmdbToTmdbGenreIds } = await imp("src/services/tmdbService.js");
const { temporalHoldoutSplit } = await imp("src/services/evalHarness.js");

export const TOP_K_GRID = [15, 30, 45, 60, 80, 100, 150];

export const ISOLATION_CAVEAT =
  "SCOPE CAVEAT: This standalone script measures Bucket E (retrieveAlignedEmbeddingNeighbors) in isolation against the 25k embedding index. Because the offline harness does not execute live TMDB Buckets A-D, these numbers CANNOT measure how much additional value larger Bucket E injection sizes (e.g., 30->60) add beyond candidates that Buckets A-D already retrieve. Production defaults (maxNeighbors=30 under 'any', 15 under explicit mood in src/services/geminiService.js) remain unchanged.";

function mapMovieLensGenresToTmdb(g = "") {
  if (!g || g === "(no genres listed)") return [];
  return mapOmdbToTmdbGenreIds(
    g.replace(/\|/g, ",").replace(/\bchildren\b/gi, "Family").replace(/\bsci-fi\b/gi, "Sci-Fi")
  );
}

function loadEmb(relPath) {
  const b = fs.readFileSync(path.join(ROOT, relPath));
  return parseEmbeddingBinary(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

function loadCohorts() {
  const tmdbItems = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/tmdb_enriched.json"), "utf8")).items || {};
  const linksLines = fs.readFileSync(path.join(ROOT, ".data/ml-latest-small/links.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1);
  const movieIdToTmdbId = new Map();
  const tmdbIdToMovieIds = new Map();
  for (const l of linksLines) {
    const [mid, , tmdb] = l.trim().split(",");
    if (tmdb && Number(tmdb) > 0) {
      const tid = Number(tmdb);
      movieIdToTmdbId.set(mid.trim(), tid);
      if (!tmdbIdToMovieIds.has(tid)) tmdbIdToMovieIds.set(tid, []);
      tmdbIdToMovieIds.get(tid).push(mid.trim());
    }
  }
  const movieMeta = new Map();
  for (const l of fs.readFileSync(path.join(ROOT, ".data/ml-latest-small/movies.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1)) {
    const c1 = l.indexOf(",");
    const c2 = l.lastIndexOf(",");
    if (c1 === -1) continue;
    const mid = l.slice(0, c1).trim();
    const genres = l.slice(c2 + 1).trim();
    const title = l.slice(c1 + 1, c2).trim().replace(/^"|"$/g, "");
    const ym = title.match(/\((\d{4})\)\s*$/);
    movieMeta.set(mid, { title, genres, mlYear: ym ? ym[1] : "N/A" });
  }

  const catalogByTmdb = new Map();
  for (const [tid, mids] of tmdbIdToMovieIds.entries()) {
    const meta = movieMeta.get(mids[0]) || { title: "Unknown", genres: "", mlYear: "N/A" };
    const e = tmdbItems[tid] || null;
    const gIds = e ? (e.tmdbGenreIds || []) : mapMovieLensGenresToTmdb(meta.genres);
    catalogByTmdb.set(tid, {
      id: tid,
      tmdbId: tid,
      title: e?.title || meta.title,
      year: e?.year || meta.mlYear,
      release_date: e?.release_date || null,
      genre: e?.genre || meta.genres,
      tmdbGenreIds: gIds,
      genre_ids: gIds,
      tmdbKeywords: e?.tmdbKeywords || [],
      castIds: e?.castIds || [],
      crewPersonId: e?.crewPersonId ?? null,
      director: e?.director || "Unknown",
      vote_average: e?.vote_average ?? null,
      vote_count: e?.vote_count ?? 0,
      popularity: e?.popularity ?? 0,
      streamProviders: e?.streamProviders || []
    });
  }

  const ratingsByUser = new Map();
  for (const l of fs.readFileSync(path.join(ROOT, ".data/ml-latest-small/ratings.csv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1)) {
    const [uid, mid, rStr, tsStr] = l.trim().split(",");
    const tid = movieIdToTmdbId.get(mid);
    const cat = tid ? catalogByTmdb.get(tid) : null;
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
  const benchIds = new Set(["89", "263", "409", "561"]);
  const users328 = [];
  for (const [uid, ratings] of ratingsByUser.entries()) {
    if (benchIds.has(uid) || ratings.length < 60) continue;
    ratings.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.tmdbId - b.tmdbId));
    if (ratings.filter(r => r.userRating >= 8).length >= 15) users328.push({ uid, ratings });
  }
  users328.sort((a, b) => Number(a.uid) - Number(b.uid));

  const freshRaw = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/fresh_300_users.json"), "utf8"));
  const users300 = freshRaw.users.map(u => {
    const enrichedRatings = u.ratings
      .map(r => {
        const cat = catalogByTmdb.get(Number(r.tmdbId));
        if (!cat) return null;
        return {
          ...cat,
          movieId: r.movieId,
          userRating: Number(r.userRating),
          dateWatched: new Date(Number(r.ts)).toISOString(),
          ts: Number(r.ts)
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.tmdbId - b.tmdbId));
    return { uid: String(u.uid), ratings: enrichedRatings };
  });

  return { users328, users300 };
}

/**
 * Mirrors the Bucket E caller in `src/services/geminiService.js` (`getMovieRecommendations`,
 * around `getCollabCatalogMax` + `DEFAULT_RANKER_WEIGHTS` + `retrieveAlignedEmbeddingNeighbors`):
 * builds `collabSimMap` & `repulsionMap` from the train vault, computes `catalogMax` over the
 * full map BEFORE `excludeIds` filtering, sets `repulsionWeight = |repulsion| / collabSim`,
 * excludes the train vault IDs, and returns top-`maxK` neighbors.
 */
export async function retrieveBucketENeighborsForTrainVault(trainWatched, holdoutStartTs, emb, maxK = 150) {
  const profile = await extractTasteProfile(trainWatched, [], {
    now: holdoutStartTs ?? undefined,
    anchorCutoff: Infinity
  });

  // Mirrors caller: src/services/geminiService.js (`getMovieRecommendations`)
  const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, emb);
  const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, emb);
  const excludeIds = new Set(
    (trainWatched || [])
      .map(m => Number(m?.tmdbId ?? m?.id ?? 0))
      .filter(id => Number.isFinite(id) && id > 0)
  );
  const catalogMax = getCollabCatalogMax(collabSimMap);
  const repulsionWeight =
    Math.abs(DEFAULT_RANKER_WEIGHTS.repulsion) / DEFAULT_RANKER_WEIGHTS.collabSim;

  return retrieveAlignedEmbeddingNeighbors(profile.weightedRatings, emb, excludeIds, {
    collabSimMap,
    repulsionMap,
    catalogMax,
    repulsionWeight,
    topK: maxK
  });
}

export async function evaluateBucketECohort(users, emb, minPos = 8, kList = TOP_K_GRID) {
  const sortedKs = [...kList].sort((a, b) => a - b);
  const maxK = sortedKs[sortedKs.length - 1];

  let validUsers = 0;
  let totalHoldoutPos = 0;
  let indexedHoldoutPos = 0;
  let sumCeilingMacro = 0;

  const perK = Object.fromEntries(
    sortedKs.map(k => [
      k,
      {
        hitsSum: 0,
        usersWithHit: 0,
        macroRecallSum: 0,
        macroIndexedRecallSum: 0,
        usersWithIndexedPos: 0
      }
    ])
  );
  let usersZeroToHit30to60 = 0;

  for (const u of users) {
    const split = temporalHoldoutSplit(u.ratings, 10, minPos);
    if (split.trainWatched.length < 10 || split.holdoutPositives.size < 3) continue;

    validUsers++;
    const holdoutIds = new Set([...split.holdoutPositives].map(id => Number(id)));
    const indexedHoldoutIds = new Set([...holdoutIds].filter(id => emb.idToIndex.has(id)));
    const nPos = holdoutIds.size;
    const nIdxPos = indexedHoldoutIds.size;

    totalHoldoutPos += nPos;
    indexedHoldoutPos += nIdxPos;
    sumCeilingMacro += nPos > 0 ? nIdxPos / nPos : 0;

    const neighbors = await retrieveBucketENeighborsForTrainVault(split.trainWatched, split.holdoutStartTs, emb, maxK);
    const neighborIds = neighbors.map(n => Number(n.tmdbId));

    let hitsAt30 = 0;
    let hitsAt60 = 0;

    for (const k of sortedKs) {
      const topSet = new Set(neighborIds.slice(0, k));
      let hits = 0;
      for (const hid of holdoutIds) {
        if (topSet.has(hid)) hits++;
      }
      if (k === 30) hitsAt30 = hits;
      if (k === 60) hitsAt60 = hits;

      const acc = perK[k];
      acc.hitsSum += hits;
      if (hits >= 1) acc.usersWithHit++;
      acc.macroRecallSum += nPos > 0 ? hits / nPos : 0;
      if (nIdxPos > 0) {
        acc.macroIndexedRecallSum += hits / nIdxPos;
        acc.usersWithIndexedPos++;
      }
    }

    if (hitsAt30 === 0 && hitsAt60 > 0) {
      usersZeroToHit30to60++;
    }
  }

  const ceilingMicro = totalHoldoutPos > 0 ? indexedHoldoutPos / totalHoldoutPos : 0;
  const ceilingMacro = validUsers > 0 ? sumCeilingMacro / validUsers : 0;

  const byK = sortedKs.map(k => {
    const acc = perK[k];
    return {
      topK: k,
      totalHits: acc.hitsSum,
      recallMacro: validUsers > 0 ? acc.macroRecallSum / validUsers : 0,
      recallMicro: totalHoldoutPos > 0 ? acc.hitsSum / totalHoldoutPos : 0,
      indexedRecallMacro: acc.usersWithIndexedPos > 0 ? acc.macroIndexedRecallSum / acc.usersWithIndexedPos : 0,
      indexedRecallMicro: indexedHoldoutPos > 0 ? acc.hitsSum / indexedHoldoutPos : 0,
      perUserHitRate: validUsers > 0 ? acc.usersWithHit / validUsers : 0,
      usersWithHit: acc.usersWithHit
    };
  });

  const k30 = byK.find(r => r.topK === 30);
  const k60 = byK.find(r => r.topK === 60);
  const marginal30to60 = k30 && k60
    ? {
        marginalHits: k60.totalHits - k30.totalHits,
        marginalHitsPerUser: validUsers > 0 ? (k60.totalHits - k30.totalHits) / validUsers : 0,
        hitRateGain: k60.perUserHitRate - k30.perUserHitRate,
        usersUnlockedFromZero: usersZeroToHit30to60,
        recallMacroGain: k60.recallMacro - k30.recallMacro,
        recallMicroGain: k60.recallMicro - k30.recallMicro,
        indexedRecallMacroGain: k60.indexedRecallMacro - k30.indexedRecallMacro
      }
    : null;

  return {
    validUsers,
    totalUsers: users.length,
    minPos,
    totalHoldoutPos,
    indexedHoldoutPos,
    indexCeilingMicro: ceilingMicro,
    indexCeilingMacro: ceilingMacro,
    byK,
    marginal30to60
  };
}

function buildMarkdownReport(report) {
  const fmt = v => (v !== null && v !== undefined && Number.isFinite(v) ? v.toFixed(4) : "n/a");
  const pct = v => (v !== null && v !== undefined && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "n/a");

  const lines = [
    "# Standalone Bucket E Recall by Injection Size (`clean2` Index)",
    "",
    `- Generated: \`${report.generatedAt}\``,
    `- Caller parity: mirrors \`getMovieRecommendations\` in \`src/services/geminiService.js\` (\`catalogMax\` via \`getCollabCatalogMax\` on full \`collabSimMap\` before \`excludeIds\`, \`repulsionWeight = |repulsion| / collabSim = ${(Math.abs(DEFAULT_RANKER_WEIGHTS.repulsion) / DEFAULT_RANKER_WEIGHTS.collabSim).toFixed(6)}\`, train-vault \`excludeIds\`).`,
    `- **${report.caveat}**`,
    "",
    "## Index Coverage Ceiling & 30 → 60 Marginal Gains",
    "",
    "| Cohort | Valid Users | Holdout Pos (Indexed / Total) | Index Ceiling Micro | Ceiling Macro | Marginal Hits 30→60 | Marginal Hits/User | New Users Hit (0→>=1) | Hit Rate 30→60 | Recall Gain 30→60 (Macro / Indexed) |",
    "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
  ];

  for (const ds of report.datasets) {
    const m = ds.marginal30to60;
    lines.push(
      `| ${ds.label} | ${ds.validUsers} | ${ds.indexedHoldoutPos}/${ds.totalHoldoutPos} | ${pct(ds.indexCeilingMicro)} | ${pct(ds.indexCeilingMacro)} | +${m.marginalHits} | +${m.marginalHitsPerUser.toFixed(4)} | +${m.usersUnlockedFromZero} | +${pct(m.hitRateGain)} | +${fmt(m.recallMacroGain)} / +${fmt(m.indexedRecallMacroGain)} |`
    );
  }

  for (const ds of report.datasets) {
    lines.push(
      "",
      `## ${ds.label} (n=${ds.validUsers}, Index Ceiling=${pct(ds.indexCeilingMicro)} micro)`,
      "",
      "| `topK` | Total Hits | Recall@K (Macro) | Recall@K (Micro) | Indexed-Only Recall (Macro) | Indexed-Only Recall (Micro) | Per-User Hit Rate (`>=1` hit) |",
      "| :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
    );
    for (const r of ds.byK) {
      lines.push(
        `| ${r.topK} | ${r.totalHits} | ${fmt(r.recallMacro)} | ${fmt(r.recallMicro)} | ${fmt(r.indexedRecallMacro)} | ${fmt(r.indexedRecallMicro)} | ${pct(r.perUserHitRate)} (${r.usersWithHit}/${ds.validUsers}) |`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

const isDirectMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectMain) {
  const t0 = Date.now();
  const { users328, users300 } = loadCohorts();
  const embClean2 = loadEmb(".data/item_embeddings_clean2_f16.bin");

  const datasets = [
    { label: "328 >=8★", ...(await evaluateBucketECohort(users328, embClean2, 8, TOP_K_GRID)) },
    { label: "328 >=9★", ...(await evaluateBucketECohort(users328, embClean2, 9, TOP_K_GRID)) },
    { label: "fresh_300 >=8★", ...(await evaluateBucketECohort(users300, embClean2, 8, TOP_K_GRID)) },
    { label: "fresh_300 >=9★", ...(await evaluateBucketECohort(users300, embClean2, 9, TOP_K_GRID)) }
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    embeddingIndexPath: ".data/item_embeddings_clean2_f16.bin",
    topKGrid: TOP_K_GRID,
    caveat: ISOLATION_CAVEAT,
    productionDefaultsUnchanged: { anyVibeMaxNeighbors: 30, explicitMoodMaxNeighbors: 15, retrieveTopK: 80 },
    datasets
  };

  const outDir = path.join(ROOT, "scripts/experiments/results");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonOut = path.join(outDir, "bucket_e_recall.json");
  const mdOut = path.join(outDir, "bucket_e_recall.md");
  const md = buildMarkdownReport(report);
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdOut, md);

  console.log(md);
  console.log(`Completed in ${((Date.now() - t0) / 1000).toFixed(1)}s. Saved ${jsonOut} and ${mdOut}`);
}
