import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const imp = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const { parseEmbeddingBinary } = await imp("src/services/embeddingService.js");
const { evaluateRanker, temporalHoldoutSplit, computeRecallAtK, computeNDCGAtK } = await imp("src/services/evalHarness.js");
const { mapOmdbToTmdbGenreIds } = await imp("src/services/tmdbService.js");
const {
  selectMaskedTmdbIds,
  buildMaskedCandidateMapsForEval,
  buildRollingFoldInputs,
  computeWarmColdBreakdown,
  aggregateWarmColdBreakdowns,
  verifyColdFallbackPath
} = await imp("scripts/experiments/mask_eval_utils.mjs");
export { loadDatasets, loadEmb, pairedBootstrapCI, formatCI, evalCohort, evalBenchmarks, printCohortComparison };

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) args[k] = true;
    else { args[k] = next; i++; }
  }
  return args;
}

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

function precAt10(top30Ids, posSet) {
  let hits = 0;
  const n = Math.min(10, top30Ids?.length || 0);
  for (let i = 0; i < n; i++) {
    if (posSet.has(String(top30Ids[i]))) hits++;
  }
  return hits / 10;
}

function computeWithinUserAuc(rankedIds = [], rankedScores = null, holdoutRelevance = new Map(), minPos = 9, maxNeg = 7) {
  if (!rankedIds?.length || !holdoutRelevance || holdoutRelevance.size === 0) return null;
  const scoreById = new Map();
  for (let i = 0; i < rankedIds.length; i++) {
    const id = String(rankedIds[i]);
    const rawScore = rankedScores ? Number(rankedScores[i]) : NaN;
    scoreById.set(id, Number.isFinite(rawScore) ? rawScore : -i);
  }
  const posScores = [];
  const negScores = [];
  for (const [id, rating] of holdoutRelevance.entries()) {
    const score = scoreById.get(String(id));
    if (score === undefined) continue;
    const r = Number(rating);
    if (r >= minPos) posScores.push(score);
    else if (r <= maxNeg) negScores.push(score);
  }
  if (posScores.length === 0 || negScores.length === 0) return null;
  let wins = 0;
  for (const p of posScores) {
    for (const n of negScores) {
      if (p > n) wins += 1;
      else if (p === n) wins += 0.5;
    }
  }
  return wins / (posScores.length * negScores.length);
}

function loadDatasets() {
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
  const catalog = [];
  const catalogByTmdb = new Map();
  for (const [tid, mids] of tmdbIdToMovieIds.entries()) {
    const meta = movieMeta.get(mids[0]) || { title: "Unknown", genres: "", mlYear: "N/A" };
    const e = tmdbItems[tid] || null;
    const gIds = e ? (e.tmdbGenreIds || []) : mapMovieLensGenresToTmdb(meta.genres);
    const obj = {
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
    };
    catalog.push(obj);
    catalogByTmdb.set(tid, obj);
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

  const bench = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/benchmark_vaults.json"), "utf8"));
  return { catalog, users328, users300, bench };
}

function makeRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pairedBootstrapCI(candMap, baseMap, numResamples = 2000, seed = 42) {
  const commonKeys = Object.keys(candMap).filter(k => Object.prototype.hasOwnProperty.call(baseMap, k));
  const n = commonKeys.length;
  if (n === 0) return { n: 0, meanDelta: 0, ciLo: 0, ciHi: 0, sig: false };
  const diffs = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const k = commonKeys[i];
    const d = candMap[k] - baseMap[k];
    diffs[i] = d;
    sum += d;
  }
  const meanDelta = sum / n;
  const rnd = makeRng(seed);
  const boot = new Float64Array(numResamples);
  for (let b = 0; b < numResamples; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diffs[Math.floor(rnd() * n)];
    boot[b] = s / n;
  }
  boot.sort();
  const ciLo = boot[Math.floor(0.025 * numResamples)];
  const ciHi = boot[Math.floor(0.975 * numResamples)];
  const sig = (ciLo > 0 && ciHi > 0) || (ciLo < 0 && ciHi < 0);
  return { n, meanDelta, ciLo, ciHi, sig };
}

function meanObj(rows, key) {
  const vals = Object.values(rows[key] || {});
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

async function evalCohort(users, catalog, emb, minPos = 8, options = {}) {
  const ndcg = {}, rec = {}, prec = {}, neg = {}, auc8v7 = {}, auc9v7 = {};
  const warmColdByUser = {};
  const warmColdEntries = [];
  const indexIdSet = options.indexIdSet instanceof Set
    ? options.indexIdSet
    : new Set(emb?.ids ? Array.from(emb.ids) : []);
  const maskedIds = options.maskedIds instanceof Set ? options.maskedIds : new Set();

  for (const u of users) {
    let collabOverride;
    let repOverride;
    let prep;
    if (emb && maskedIds.size > 0) {
      prep = await buildMaskedCandidateMapsForEval({
        watched: u.ratings,
        catalog,
        holdoutSize: 10,
        minPositiveRating: minPos,
        embeddingIndex: emb,
        embeddingOptions: options.embeddingOptions || {},
        maskedIds
      });
      collabOverride = prep.maskedCollabSimMap;
      repOverride = prep.maskedRepulsionMap;
    } else {
      const spl = temporalHoldoutSplit(u.ratings, 10, minPos);
      const holdoutKeys = new Set(spl.holdoutRelevance.keys());
      const excluded = new Set();
      for (const m of u.ratings) {
        const key = String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
        if (key && !holdoutKeys.has(key)) excluded.add(key);
      }
      const candidateIds = [];
      for (const c of catalog) {
        const key = String(c?.id ?? c?.tmdbId ?? c?.imdbID ?? "");
        if (key && !excluded.has(key)) candidateIds.push(key);
      }
      prep = { split: spl, candidateIds };
    }

    const res = await evaluateRanker({
      watched: u.ratings,
      catalog,
      embeddingIndex: emb,
      collabSimMap: collabOverride,
      repulsionMap: repOverride,
      strategy: "ranker",
      minPositiveRating: minPos,
      includeRankedDetails: true,
      embeddingOptions: options.embeddingOptions || {},
      contentOptions: options.contentOptions || {},
      rankerOptions: options.rankerOptions || {},
      profileOptions: options.profileOptions || {}
    });
    if (res.status === "ok") {
      ndcg[u.uid] = res.metrics.ndcgAt10;
      rec[u.uid] = res.metrics.recallAt20;
      prec[u.uid] = precAt10(res.top30Ids, prep.split.holdoutPositives);
      neg[u.uid] = res.metrics.negHitAt20;
      const a8 = computeWithinUserAuc(res.rankedIds, res.rankedScores, prep.split.holdoutRelevance, 8, 7);
      const a9 = computeWithinUserAuc(res.rankedIds, res.rankedScores, prep.split.holdoutRelevance, 9, 7);
      if (a8 !== null) auc8v7[u.uid] = a8;
      if (a9 !== null) auc9v7[u.uid] = a9;

      if (emb) {
        const wc = computeWarmColdBreakdown({
          rankedIds: res.rankedIds,
          candidateIds: prep.candidateIds,
          holdoutPositives: prep.split.holdoutPositives,
          indexIdSet,
          maskedIds
        });
        warmColdByUser[u.uid] = wc;
        warmColdEntries.push(wc);
      }
    }
  }
  return {
    n: Object.keys(ndcg).length,
    nAuc8v7: Object.keys(auc8v7).length,
    nAuc9v7: Object.keys(auc9v7).length,
    totalUsers: users.length,
    means: {
      ndcg10: meanObj({ ndcg }, "ndcg"),
      rec20: meanObj({ rec }, "rec"),
      prec10: meanObj({ prec }, "prec"),
      neg20: meanObj({ neg }, "neg"),
      auc8v7: meanObj({ auc8v7 }, "auc8v7"),
      auc9v7: meanObj({ auc9v7 }, "auc9v7")
    },
    warmCold: emb ? aggregateWarmColdBreakdowns(warmColdEntries) : null,
    perUser: { ndcg, rec, prec, neg, auc8v7, auc9v7 },
    warmColdByUser: emb ? warmColdByUser : null
  };
}

function splitHoldoutForFold(watched, foldIdx, holdoutSize = 10, minPos = 8) {
  const sorted = [...watched].sort((a, b) => new Date(a.dateWatched).getTime() - new Date(b.dateWatched).getTime());
  let trimmed = sorted;
  if (foldIdx > 0) {
    let posSeen = 0;
    let cutoff = sorted.length;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (Number(sorted[i].userRating) >= minPos) {
        posSeen++;
        if (posSeen === foldIdx * holdoutSize) { cutoff = i; break; }
      }
    }
    trimmed = sorted.slice(0, cutoff);
  }
  return temporalHoldoutSplit(trimmed, holdoutSize, minPos);
}

async function evalBenchmarks(bench, emb, options = {}) {
  const indexIdSet = options.indexIdSet instanceof Set
    ? options.indexIdSet
    : new Set(emb?.ids ? Array.from(emb.ids) : []);
  const maskedIds = options.maskedIds instanceof Set ? options.maskedIds : new Set();

  const perVault = {};
  for (const minPos of [8, 9]) {
    const label = minPos === 8 ? "ge8" : "ge9";
    perVault[label] = {};
    const validMeans = [];
    const fold0Means = [];
    const rollingWarmColdAll = [];
    const fold0WarmColdAll = [];

    for (const v of bench.vaults) {
      const foldInputs = buildRollingFoldInputs(v.watched, 3, 10, minPos);
      const foldResults = [];
      const foldPreps = [];
      for (const input of foldInputs) {
        let collabOverride;
        let repOverride;
        let prep;
        if (emb && maskedIds.size > 0) {
          prep = await buildMaskedCandidateMapsForEval({
            watched: input.watched,
            catalog: bench.catalog,
            excludeIds: input.excludeIds,
            holdoutSize: 10,
            minPositiveRating: minPos,
            embeddingIndex: emb,
            embeddingOptions: options.embeddingOptions || {},
            maskedIds
          });
          collabOverride = prep.maskedCollabSimMap;
          repOverride = prep.maskedRepulsionMap;
        } else {
          const spl = temporalHoldoutSplit(input.watched, 10, minPos);
          const holdoutKeys = new Set(spl.holdoutRelevance.keys());
          const excluded = new Set((input.excludeIds || []).map(String));
          for (const m of input.watched || []) {
            const k = String(m?.id ?? m?.tmdbId ?? m?.imdbID ?? "");
            if (k && !holdoutKeys.has(k)) excluded.add(k);
          }
          const candidateIds = [];
          for (const c of bench.catalog || []) {
            const k = String(c?.id ?? c?.tmdbId ?? c?.imdbID ?? "");
            if (k && !excluded.has(k)) candidateIds.push(k);
          }
          prep = { split: spl, candidateIds };
        }
        const fRes = await evaluateRanker({
          watched: input.watched,
          excludeIds: input.excludeIds,
          catalog: bench.catalog,
          embeddingIndex: emb,
          collabSimMap: collabOverride,
          repulsionMap: repOverride,
          strategy: "ranker",
          holdoutSize: 10,
          minPositiveRating: minPos,
          includeRankedDetails: true,
          embeddingOptions: options.embeddingOptions || {},
          contentOptions: options.contentOptions || {},
          rankerOptions: options.rankerOptions || {},
          profileOptions: options.profileOptions || {}
        });
        foldResults.push(fRes);
        foldPreps.push(prep);
      }

      const okPairs = foldResults
        .map((f, idx) => ({ f, idx, prep: foldPreps[idx] }))
        .filter(x => x.f.status === "ok");
      if (okPairs.length === 0) {
        perVault[label][v.name] = {
          status: "insufficient_data",
          reason: foldResults[0]?.reason || "no usable folds"
        };
        continue;
      }

      const meanKey = k => okPairs.reduce((s, x) => s + x.f.metrics[k], 0) / okPairs.length;
      const p10Folds = okPairs.map(x => precAt10(x.f.top30Ids, x.prep.split.holdoutPositives));
      const auc8Folds = okPairs
        .map(x => computeWithinUserAuc(x.f.rankedIds, x.f.rankedScores, x.prep.split.holdoutRelevance, 8, 7))
        .filter(x => x !== null);
      const auc9Folds = okPairs
        .map(x => computeWithinUserAuc(x.f.rankedIds, x.f.rankedScores, x.prep.split.holdoutRelevance, 9, 7))
        .filter(x => x !== null);
      const rollP10 = p10Folds.reduce((a, b) => a + b, 0) / p10Folds.length;
      const rollAuc8 = auc8Folds.length ? auc8Folds.reduce((a, b) => a + b, 0) / auc8Folds.length : null;
      const rollAuc9 = auc9Folds.length ? auc9Folds.reduce((a, b) => a + b, 0) / auc9Folds.length : null;
      const fold0Auc8 = computeWithinUserAuc(okPairs[0].f.rankedIds, okPairs[0].f.rankedScores, okPairs[0].prep.split.holdoutRelevance, 8, 7);
      const fold0Auc9 = computeWithinUserAuc(okPairs[0].f.rankedIds, okPairs[0].f.rankedScores, okPairs[0].prep.split.holdoutRelevance, 9, 7);

      const foldWarmCold = emb
        ? okPairs.map(x =>
            computeWarmColdBreakdown({
              rankedIds: x.f.rankedIds,
              candidateIds: x.prep.candidateIds,
              holdoutPositives: x.prep.split.holdoutPositives,
              indexIdSet,
              maskedIds
            })
          )
        : [];
      if (emb) {
        rollingWarmColdAll.push(...foldWarmCold);
        fold0WarmColdAll.push(foldWarmCold[0]);
      }

      const entry = {
        status: "ok",
        foldsUsed: okPairs.length,
        rolling: {
          ndcg10: meanKey("ndcgAt10"),
          rec20: meanKey("recallAt20"),
          prec10: rollP10,
          neg20: meanKey("negHitAt20"),
          auc8v7: rollAuc8,
          auc9v7: rollAuc9,
          warmCold: emb ? aggregateWarmColdBreakdowns(foldWarmCold) : null
        },
        fold0: {
          ndcg10: okPairs[0].f.metrics.ndcgAt10,
          rec20: okPairs[0].f.metrics.recallAt20,
          prec10: p10Folds[0],
          neg20: okPairs[0].f.metrics.negHitAt20,
          auc8v7: fold0Auc8,
          auc9v7: fold0Auc9,
          warmCold: emb ? foldWarmCold[0] : null
        }
      };
      perVault[label][v.name] = entry;
      validMeans.push(entry.rolling);
      fold0Means.push(entry.fold0);
    }
    const meanOpt = (arr, k) => {
      const vals = arr.map(x => x[k]).filter(v => v !== null && v !== undefined && Number.isFinite(v));
      return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
    };
    const avg = (arr, pooledWc) => arr.length ? ({
      vaultsUsed: arr.length,
      ndcg10: arr.reduce((s, x) => s + x.ndcg10, 0) / arr.length,
      rec20: arr.reduce((s, x) => s + x.rec20, 0) / arr.length,
      prec10: arr.reduce((s, x) => s + x.prec10, 0) / arr.length,
      neg20: arr.reduce((s, x) => s + x.neg20, 0) / arr.length,
      auc8v7: meanOpt(arr, "auc8v7"),
      auc9v7: meanOpt(arr, "auc9v7"),
      warmCold: emb ? aggregateWarmColdBreakdowns(pooledWc) : null
    }) : null;
    perVault[label].MEAN_ROLLING = avg(validMeans, rollingWarmColdAll);
    perVault[label].MEAN_FOLD0 = avg(fold0Means, fold0WarmColdAll);
  }
  return perVault;
}

function formatCI(ci) {
  const sign = ci.meanDelta >= 0 ? "+" : "";
  return `${sign}${ci.meanDelta.toFixed(4)} [${ci.ciLo >= 0 ? "+" : ""}${ci.ciLo.toFixed(4)}, ${ci.ciHi >= 0 ? "+" : ""}${ci.ciHi.toFixed(4)}]${ci.sig ? " *" : ""}`;
}

function printCohortComparison(name, cur, refs) {
  console.log(`\n--- ${name} (valid=${cur.n}/${cur.totalUsers}) ---`);
  const auc8 = cur.means.auc8v7 !== undefined ? ` | AUC(>=8v<=7)=${cur.means.auc8v7.toFixed(4)}(n=${cur.nAuc8v7})` : "";
  const auc9 = cur.means.auc9v7 !== undefined ? ` | AUC(>=9v<=7)=${cur.means.auc9v7.toFixed(4)}(n=${cur.nAuc9v7})` : "";
  console.log(`  NDCG@10=${cur.means.ndcg10.toFixed(4)} | Recall@20=${cur.means.rec20.toFixed(4)} | Precision@10=${cur.means.prec10.toFixed(4)} | NegHit@20=${cur.means.neg20.toFixed(4)}${auc9}${auc8}`);
  for (const [refLabel, ref] of refs) {
    if (!ref) continue;
    const cN = pairedBootstrapCI(cur.perUser.ndcg, ref.perUser.ndcg);
    const cR = pairedBootstrapCI(cur.perUser.rec, ref.perUser.rec);
    const cP = pairedBootstrapCI(cur.perUser.prec, ref.perUser.prec);
    const cNeg = pairedBootstrapCI(cur.perUser.neg, ref.perUser.neg);
    let aucCi = "";
    if (cur.perUser?.auc9v7 && ref.perUser?.auc9v7) {
      const cA9 = pairedBootstrapCI(cur.perUser.auc9v7, ref.perUser.auc9v7);
      aucCi += ` | dAUC9v7=${formatCI(cA9)}`;
    }
    if (cur.perUser?.auc8v7 && ref.perUser?.auc8v7) {
      const cA8 = pairedBootstrapCI(cur.perUser.auc8v7, ref.perUser.auc8v7);
      aucCi += ` | dAUC8v7=${formatCI(cA8)}`;
    }
    console.log(`  vs ${refLabel}: dNDCG@10=${formatCI(cN)} | dRec@20=${formatCI(cR)} | dPrec@10=${formatCI(cP)} | dNeg@20=${formatCI(cNeg)}${aucCi}`);
  }
}

const args = parseArgs(process.argv);
const isDirectMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectMain) {
  const tag = args.tag || "baseline";
  const outDir = args["out-dir"] || path.join(ROOT, ".data/ablation_results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `eval_${tag}.json`);

  const maskFrac = args["mask-frac"] !== undefined ? Number(args["mask-frac"]) : 0;
  const maskSeed = args["mask-seed"] !== undefined ? Number(args["mask-seed"]) : 1;

  const { catalog, users328, users300, bench } = loadDatasets();
  const embClean2 = args.embeddings === "null" ? null : loadEmb(".data/item_embeddings_clean2_f16.bin");
  const indexIdSet = new Set(embClean2?.ids ? Array.from(embClean2.ids) : []);
  const maskedIds = embClean2 && maskFrac > 0 ? selectMaskedTmdbIds(embClean2.ids, maskFrac, maskSeed) : new Set();

  const embeddingOptions = {};
  if (args["persona-agg"]) embeddingOptions.personaAggregation = String(args["persona-agg"]);
  if (args.beta !== undefined) embeddingOptions.personaBeta = Number(args.beta);
  if (args["ridge-blend"] !== undefined) embeddingOptions.ridgeBlend = Number(args["ridge-blend"]);
  if (args["ridge-lambda"] !== undefined) embeddingOptions.ridgeLambda = Number(args["ridge-lambda"]);
  const rankerOptions = {};
  if (args["collab-norm"]) rankerOptions.collabNormalization = String(args["collab-norm"]);
  if (args["smooth-damping"] === "false") rankerOptions.smoothDamping = false;
  else if (args["smooth-damping"] === "true") rankerOptions.smoothDamping = true;
  if (args.gamma !== undefined) rankerOptions.percentileGamma = Number(args.gamma);
  if (args["ramp-max"] !== undefined) rankerOptions.dampingRampMax = Number(args["ramp-max"]);
  const evalOpts = { embeddingOptions, rankerOptions, indexIdSet, maskedIds };

  let coldPathCheck = null;
  if (embClean2 && maskedIds.size > 0 && users300.length > 0) {
    coldPathCheck = await verifyColdFallbackPath({
      watched: users300[0].ratings,
      catalog,
      embeddingIndex: embClean2,
      embeddingOptions,
      maskedIds
    });
    if (!coldPathCheck.verified) {
      throw new Error(`Cold-path verification failed: ${JSON.stringify(coldPathCheck)}`);
    }
  }

  const t0 = Date.now();
  const result = {
    tag,
    generatedAt: new Date().toISOString(),
    maskFrac,
    maskSeed,
    maskedCount: maskedIds.size,
    coldPathCheck,
    evalOpts: { embeddingOptions, rankerOptions },
    datasets: {}
  };

  if (args.embeddings !== "null") {
    result.datasets.c328_clean2_ge8 = await evalCohort(users328, catalog, embClean2, 8, evalOpts);
    result.datasets.c328_clean2_ge9 = await evalCohort(users328, catalog, embClean2, 9, evalOpts);
    result.datasets.bench_clean2 = await evalBenchmarks(bench, embClean2, evalOpts);
  }

  if (args["include-null"]) {
    result.datasets.c328_null_ge8 = await evalCohort(users328, catalog, null, 8, evalOpts);
    result.datasets.c328_null_ge9 = await evalCohort(users328, catalog, null, 9, evalOpts);
    result.datasets.bench_null = await evalBenchmarks(bench, null, evalOpts);
  }

  if (args["include-300"]) {
    result.datasets.c300_clean2_ge8 = await evalCohort(users300, catalog, embClean2, 8, evalOpts);
    result.datasets.c300_clean2_ge9 = await evalCohort(users300, catalog, embClean2, 9, evalOpts);
  }

  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`Saved ${outFile} in ${((Date.now() - t0) / 1000).toFixed(1)}s (maskFrac=${maskFrac}, maskSeed=${maskSeed}, masked=${maskedIds.size})`);
  if (coldPathCheck) {
    console.log(
      `  Cold-path check: candidates=${coldPathCheck.candidatesCount}, masked=${coldPathCheck.maskedCandCount}, maskedCollab0=${coldPathCheck.maskedCollabZeroCount}, maskedStructured>0=${coldPathCheck.maskedContentNonZeroCount}, warmColdLeak=${coldPathCheck.warmColdLeakCount}`
    );
  }

  const compareTags = (args.compare || "").split(",").filter(Boolean);
  const refObjs = compareTags.map(t => {
    const p = path.join(outDir, `eval_${t}.json`);
    return [t, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null];
  });

  if (result.datasets.c328_clean2_ge8) {
    printCohortComparison("328-Cohort clean2 (>=8★)", result.datasets.c328_clean2_ge8, refObjs.map(([l, o]) => [l, o?.datasets?.c328_clean2_ge8]));
    printCohortComparison("328-Cohort clean2 (>=9★)", result.datasets.c328_clean2_ge9, refObjs.map(([l, o]) => [l, o?.datasets?.c328_clean2_ge9]));
    const b8 = result.datasets.bench_clean2.ge8;
    const b9 = result.datasets.bench_clean2.ge9;
    console.log(`\n--- 4 Benchmark Vaults clean2 ---`);
    const fmtOpt = (v) => (v !== null && v !== undefined && Number.isFinite(v)) ? v.toFixed(4) : "n/a";
    for (const [vName, d] of Object.entries(b8)) {
      if (d.status !== "ok") continue;
      console.log(`  >=8★ ${vName}: roll(${d.foldsUsed}/3) NDCG=${d.rolling.ndcg10.toFixed(4)} Rec20=${d.rolling.rec20.toFixed(4)} P10=${d.rolling.prec10.toFixed(4)} Neg20=${d.rolling.neg20.toFixed(4)} AUC9v7=${fmtOpt(d.rolling.auc9v7)} AUC8v7=${fmtOpt(d.rolling.auc8v7)} | fold0 NDCG=${d.fold0.ndcg10.toFixed(4)} Rec20=${d.fold0.rec20.toFixed(4)} P10=${d.fold0.prec10.toFixed(4)}`);
    }
    console.log(`  >=8★ MEAN ROLLING (4 vaults): NDCG=${b8.MEAN_ROLLING.ndcg10.toFixed(4)} Rec20=${b8.MEAN_ROLLING.rec20.toFixed(4)} P10=${b8.MEAN_ROLLING.prec10.toFixed(4)} Neg20=${b8.MEAN_ROLLING.neg20.toFixed(4)} AUC9v7=${fmtOpt(b8.MEAN_ROLLING.auc9v7)} AUC8v7=${fmtOpt(b8.MEAN_ROLLING.auc8v7)}`);
    console.log(`  >=9★ MEAN ROLLING (${b9.MEAN_ROLLING.vaultsUsed} vaults): NDCG=${b9.MEAN_ROLLING.ndcg10.toFixed(4)} Rec20=${b9.MEAN_ROLLING.rec20.toFixed(4)} P10=${b9.MEAN_ROLLING.prec10.toFixed(4)} Neg20=${b9.MEAN_ROLLING.neg20.toFixed(4)} AUC9v7=${fmtOpt(b9.MEAN_ROLLING.auc9v7)} AUC8v7=${fmtOpt(b9.MEAN_ROLLING.auc8v7)}`);
    for (const [l, o] of refObjs) {
      const rb8 = o?.datasets?.bench_clean2?.ge8?.MEAN_ROLLING;
      const rb9 = o?.datasets?.bench_clean2?.ge9?.MEAN_ROLLING;
      if (rb8) {
        const dA9 = (b8.MEAN_ROLLING.auc9v7 != null && rb8.auc9v7 != null) ? ` dAUC9v7=${(b8.MEAN_ROLLING.auc9v7 - rb8.auc9v7).toFixed(4)}` : "";
        const dA8 = (b8.MEAN_ROLLING.auc8v7 != null && rb8.auc8v7 != null) ? ` dAUC8v7=${(b8.MEAN_ROLLING.auc8v7 - rb8.auc8v7).toFixed(4)}` : "";
        const d9A9 = (b9.MEAN_ROLLING.auc9v7 != null && rb9.auc9v7 != null) ? ` dAUC9v7=${(b9.MEAN_ROLLING.auc9v7 - rb9.auc9v7).toFixed(4)}` : "";
        console.log(`  Bench vs ${l}: >=8★ dNDCG=${(b8.MEAN_ROLLING.ndcg10 - rb8.ndcg10).toFixed(4)} dRec=${(b8.MEAN_ROLLING.rec20 - rb8.rec20).toFixed(4)} dP10=${(b8.MEAN_ROLLING.prec10 - rb8.prec10).toFixed(4)}${dA9}${dA8} | >=9★ dNDCG=${(b9.MEAN_ROLLING.ndcg10 - rb9.ndcg10).toFixed(4)} dRec=${(b9.MEAN_ROLLING.rec20 - rb9.rec20).toFixed(4)}${d9A9}`);
      }
    }
  }

  if (result.datasets.c328_null_ge8) {
    printCohortComparison("328-Cohort metadata-only null (>=8★)", result.datasets.c328_null_ge8, refObjs.map(([l, o]) => [l, o?.datasets?.c328_null_ge8]));
    printCohortComparison("328-Cohort metadata-only null (>=9★)", result.datasets.c328_null_ge9, refObjs.map(([l, o]) => [l, o?.datasets?.c328_null_ge9]));
  }

  if (result.datasets.c300_clean2_ge8) {
    printCohortComparison("fresh_300 clean2 (>=8★)", result.datasets.c300_clean2_ge8, refObjs.map(([l, o]) => [l, o?.datasets?.c300_clean2_ge8]));
    printCohortComparison("fresh_300 clean2 (>=9★)", result.datasets.c300_clean2_ge9, refObjs.map(([l, o]) => [l, o?.datasets?.c300_clean2_ge9]));
  }
}
