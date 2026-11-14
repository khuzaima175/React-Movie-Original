import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const root = "g:/Important Projects/movie-ratings";
const SEED = 42;
const TARGET_SAMPLE = 300;
const EXTRA_CANDIDATE_BUFFER = 500; // Draw prefix >= TARGET_SAMPLE to allow exact post-dedup verification

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function summarize(arr) {
  if (!arr.length) return { n: 0, mean: 0, std: 0, min: 0, p10: 0, median: 0, p90: 0, max: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const pct = p => {
    const idx = (p / 100) * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
  };
  return {
    n,
    mean,
    std: Math.sqrt(variance),
    min: sorted[0],
    p10: pct(10),
    median: pct(50),
    p90: pct(90),
    max: sorted[n - 1]
  };
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
  const holdoutStartTs = sorted[splitIdx]?.ts ?? null;
  const holdoutPositives = holdoutSlice.filter(m => m.userRating >= 8);
  return { trainWatched, holdoutSlice, holdoutPositives, holdoutStartTs };
}

async function main() {
  const tStart = Date.now();
  console.log("==========================================================================");
  console.log("TASK 1: SAMPLE FRESH 300-USER CONFIRMATION SET FROM ML-32M (SEED=42)");
  console.log("==========================================================================");

  // 1. Load 9,733 unique tmdbId catalog from ml-latest-small/links.csv & tmdb_enriched.json
  const enrichedJson = JSON.parse(fs.readFileSync(path.join(root, ".data/tmdb_enriched.json"), "utf8"));
  const tmdbItems = enrichedJson.items || {};

  const smallLinksLines = fs
    .readFileSync(path.join(root, ".data/ml-latest-small/links.csv"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1);

  const smallMidToTmdb = new Map();
  const catalogTmdbSet = new Set();
  for (const l of smallLinksLines) {
    const [mid, , tmdb] = l.trim().split(",");
    if (tmdb) {
      const tid = Number(tmdb);
      if (Number.isFinite(tid) && tid > 0) {
        smallMidToTmdb.set(mid.trim(), tid);
        catalogTmdbSet.add(tid);
      }
    }
  }
  console.log(`Catalog unique tmdbIds (from ml-latest-small/links.csv): ${catalogTmdbSet.size}`);
  console.log(`TMDB enriched entries present: ${Object.keys(tmdbItems).length}`);

  // Compute exact Long-Tail popular threshold (top 20% by TMDB vote_count across the 9,733 catalog)
  const sortedByVotes = Array.from(catalogTmdbSet)
    .map(tid => ({
      tmdbId: tid,
      vote_count: tmdbItems[tid]?.vote_count ?? 0,
      vote_average: tmdbItems[tid]?.vote_average ?? 0
    }))
    .sort((a, b) => {
      if (b.vote_count !== a.vote_count) return b.vote_count - a.vote_count;
      return b.vote_average - a.vote_average || a.tmdbId - b.tmdbId;
    });
  const top20Cut = Math.floor(0.20 * sortedByVotes.length);
  const popularTmdbIds = new Set(sortedByVotes.slice(0, top20Cut).map(x => x.tmdbId));
  const popVoteThreshold = sortedByVotes[top20Cut - 1]?.vote_count ?? 0;
  console.log(`Popularity top-20% threshold: vote_count > ${popVoteThreshold} (${popularTmdbIds.size} popular, ${catalogTmdbSet.size - popularTmdbIds.size} long-tail)`);

  // 2. Load 328 ml-latest-small users & 4 benchmark users + unmatched tuples
  const userMapJson = JSON.parse(fs.readFileSync(path.join(root, ".data/user_id_map.json"), "utf8"));
  const excludedMl32mIds = new Set();
  const unmatchedSmallIds = new Set();
  for (const [smallUid, info] of Object.entries(userMapJson.mapping || {})) {
    if (info.ml32m_userId != null) excludedMl32mIds.add(Number(info.ml32m_userId));
    if (info.status === "unmatched" || info.status === "ambiguous") unmatchedSmallIds.add(smallUid);
  }
  console.log(`Known excluded ml-32m userIds from user_id_map.json: ${excludedMl32mIds.size}`);
  console.log(`Unmatched/ambiguous among 328 small users to tuple-check: ${unmatchedSmallIds.size}`);

  const benchmarkIds = new Set(["89", "263", "409", "561"]);
  const smallRatingsLines = fs
    .readFileSync(path.join(root, ".data/ml-latest-small/ratings.csv"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1);

  const smallUsersRaw = new Map();
  const specialTupleLookup = new Map(); // "mid:r:ts" -> Set of label strings ("bench_89", "unmatched_X")
  for (const l of smallRatingsLines) {
    const [uid, mid, rStr, tsStr] = l.trim().split(",");
    if (benchmarkIds.has(uid) || unmatchedSmallIds.has(uid)) {
      const label = benchmarkIds.has(uid) ? `bench_${uid}` : `unmatched_${uid}`;
      const key = `${mid}:${rStr}:${tsStr}`;
      if (!specialTupleLookup.has(key)) specialTupleLookup.set(key, []);
      specialTupleLookup.get(key).push(label);
    }
    const tid = smallMidToTmdb.get(mid);
    if (!tid) continue;
    if (!smallUsersRaw.has(uid)) smallUsersRaw.set(uid, []);
    smallUsersRaw.get(uid).push({
      tmdbId: tid,
      movieId: mid,
      userRating: Number(rStr) * 2,
      ts: Number(tsStr) * 1000
    });
  }

  const small328 = [];
  for (const [uid, list] of smallUsersRaw.entries()) {
    if (benchmarkIds.has(uid)) continue;
    if (list.length < 60) continue;
    list.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.tmdbId - b.tmdbId));
    const pos = list.filter(x => x.userRating >= 8);
    if (pos.length >= 15) small328.push({ uid, ratings: list, posCount: pos.length });
  }
  small328.sort((a, b) => Number(a.uid) - Number(b.uid));
  console.log(`Verified original ml-latest-small eligible users: ${small328.length}`);

  // 3. Load ml-32m/links.csv mapping ONLY to the 9,733-film catalog
  const links32mLines = fs
    .readFileSync(path.join(root, ".data/ml-32m/links.csv"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1);

  const ml32mMidToTmdb = new Map();
  let tmdbWithMultiMid = 0;
  const tmdbSeenIn32m = new Map();
  for (const l of links32mLines) {
    const parts = l.trim().split(",");
    const midStr = parts[0];
    const tmdbStr = parts[2];
    if (!tmdbStr) continue;
    const tid = Number(tmdbStr);
    if (!catalogTmdbSet.has(tid)) continue;
    ml32mMidToTmdb.set(midStr, tid);
    tmdbSeenIn32m.set(tid, (tmdbSeenIn32m.get(tid) || 0) + 1);
  }
  for (const c of tmdbSeenIn32m.values()) {
    if (c > 1) tmdbWithMultiMid++;
  }
  console.log(`ml-32m movieIds mapped into 9,733-film catalog: ${ml32mMidToTmdb.size} (${tmdbWithMultiMid} tmdbIds have >1 ml32m movieId)`);

  // 4. Pass 1 over ml-32m/ratings.csv:
  //    - count per-user restricted ratings & positives
  //    - match special tuples (4 benchmark users + 7 unmatched users)
  console.log("Pass 1: Streaming .data/ml-32m/ratings.csv (counting restricted ratings + checking benchmark/unmatched tuples)...");
  const tP1 = Date.now();
  const MAX_UID_ALLOC = 220000;
  let totalCnt = new Int32Array(MAX_UID_ALLOC);
  let posCnt = new Int32Array(MAX_UID_ALLOC);
  let maxSeenUid = 0;
  let totalLines32m = 0;
  let restrictedRatings32m = 0;
  const specialMatches = new Map(); // label -> Map(uid32m -> count)

  {
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(root, ".data/ml-32m/ratings.csv")),
      crlfDelay: Infinity
    });
    let headerSkipped = false;
    for await (const line of rl) {
      if (!headerSkipped) {
        headerSkipped = true;
        continue;
      }
      if (!line) continue;
      totalLines32m++;
      const c1 = line.indexOf(",");
      const c2 = line.indexOf(",", c1 + 1);
      const c3 = line.indexOf(",", c2 + 1);
      const uid = Number(line.slice(0, c1));
      const midStr = line.slice(c1 + 1, c2);
      const rStr = line.slice(c2 + 1, c3);
      const tsStr = line.slice(c3 + 1);

      if (uid > maxSeenUid) maxSeenUid = uid;
      if (uid >= totalCnt.length) {
        const nextSize = Math.max(uid + 10000, totalCnt.length * 2);
        const nt = new Int32Array(nextSize);
        const np = new Int32Array(nextSize);
        nt.set(totalCnt);
        np.set(posCnt);
        totalCnt = nt;
        posCnt = np;
      }

      const spLabels = specialTupleLookup.get(`${midStr}:${rStr}:${tsStr}`);
      if (spLabels) {
        for (const lbl of spLabels) {
          if (!specialMatches.has(lbl)) specialMatches.set(lbl, new Map());
          const m = specialMatches.get(lbl);
          m.set(uid, (m.get(uid) || 0) + 1);
        }
      }

      if (ml32mMidToTmdb.has(midStr)) {
        restrictedRatings32m++;
        totalCnt[uid]++;
        if (Number(rStr) * 2 >= 8) posCnt[uid]++;
      }
    }
  }
  console.log(`Pass 1 complete in ${((Date.now() - tP1) / 1000).toFixed(1)}s: ${totalLines32m.toLocaleString()} total rows, maxUid=${maxSeenUid}, ${restrictedRatings32m.toLocaleString()} restricted-catalog ratings.`);

  // Exclude any dominant ml-32m match for benchmark users or unmatched users (>= 10 exact tuple hits)
  const benchmarkMappingSummary = {};
  for (const [lbl, m] of specialMatches.entries()) {
    const sortedCands = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    benchmarkMappingSummary[lbl] = sortedCands.slice(0, 3);
    for (const [u32m, hits] of sortedCands) {
      if (hits >= 10) excludedMl32mIds.add(u32m);
    }
  }
  console.log("Benchmark & unmatched tuple scan summary:", JSON.stringify(benchmarkMappingSummary));
  console.log(`Total excluded ml-32m userIds (328 mapped + benchmark/unmatched hits): ${excludedMl32mIds.size}`);

  // Gather all Pass-1 pre-qualified candidate userIds (strict superset of post-dedup qualified)
  const preQualified = [];
  for (let u = 1; u <= maxSeenUid; u++) {
    if (excludedMl32mIds.has(u)) continue;
    if (totalCnt[u] >= 60 && posCnt[u] >= 15) {
      preQualified.push(u);
    }
  }
  console.log(`Pass-1 pre-qualified ml-32m users (>=60 ratings, >=15 positives in 9,733 catalog): ${preQualified.length}`);

  // Deterministic Fisher-Yates shuffle with seed=42
  const rng = makeRng(SEED);
  const shuffled = [...preQualified];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  const bufferList = shuffled.slice(0, Math.min(EXTRA_CANDIDATE_BUFFER, shuffled.length));
  const bufferSet = new Set(bufferList);
  const bufferRank = new Map(bufferList.map((uid, idx) => [uid, idx]));

  // 5. Pass 2: Extract full restricted ratings ONLY for the 500-user shuffled prefix & enforce post-dedup qualification
  console.log(`Pass 2: Extracting restricted ratings for first ${bufferList.length} shuffled candidates to deduplicate by (uid, tmdbId)...`);
  const tP2 = Date.now();
  const collectedByUid = new Map();
  {
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(root, ".data/ml-32m/ratings.csv")),
      crlfDelay: Infinity
    });
    let headerSkipped = false;
    for await (const line of rl) {
      if (!headerSkipped) {
        headerSkipped = true;
        continue;
      }
      if (!line) continue;
      const c1 = line.indexOf(",");
      const uid = Number(line.slice(0, c1));
      if (!bufferSet.has(uid)) continue;

      const c2 = line.indexOf(",", c1 + 1);
      const midStr = line.slice(c1 + 1, c2);
      const tid = ml32mMidToTmdb.get(midStr);
      if (tid === undefined) continue;

      const c3 = line.indexOf(",", c2 + 1);
      const rStr = line.slice(c2 + 1, c3);
      const tsStr = line.slice(c3 + 1);

      if (!collectedByUid.has(uid)) collectedByUid.set(uid, []);
      collectedByUid.get(uid).push({
        tmdbId: tid,
        movieId: midStr,
        userRating: Number(rStr) * 2,
        ts: Number(tsStr) * 1000
      });
    }
  }
  console.log(`Pass 2 complete in ${((Date.now() - tP2) / 1000).toFixed(1)}s.`);

  let droppedOnDedup = 0;
  let dupRatingsRemoved = 0;
  const freshQualifiedBuffer = [];
  for (const uid of bufferList) {
    const raw = collectedByUid.get(uid) || [];
    // Deduplicate by tmdbId keeping latest timestamp (tie-break larger movieId)
    const byTmdb = new Map();
    for (const item of raw) {
      const prev = byTmdb.get(item.tmdbId);
      if (!prev || item.ts > prev.ts || (item.ts === prev.ts && Number(item.movieId) > Number(prev.movieId))) {
        byTmdb.set(item.tmdbId, item);
      }
    }
    const deduped = Array.from(byTmdb.values());
    dupRatingsRemoved += raw.length - deduped.length;
    deduped.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.tmdbId - b.tmdbId));
    const pos = deduped.filter(m => m.userRating >= 8);
    if (deduped.length >= 60 && pos.length >= 15) {
      freshQualifiedBuffer.push({ uid: String(uid), ml32m_userId: uid, ratings: deduped, posCount: pos.length });
    } else {
      droppedOnDedup++;
    }
  }

  if (freshQualifiedBuffer.length < TARGET_SAMPLE) {
    throw new Error(`Only ${freshQualifiedBuffer.length} qualified users in buffer (< ${TARGET_SAMPLE})!`);
  }
  const fresh300 = freshQualifiedBuffer.slice(0, TARGET_SAMPLE);
  // Keep deterministic ascending numeric user order when storing (preserving which 300 were sampled)
  fresh300.sort((a, b) => a.ml32m_userId - b.ml32m_userId);

  const survivalRate = freshQualifiedBuffer.length / bufferList.length;
  const estimatedTotalQualified = Math.round(preQualified.length * survivalRate);
  console.log(
    `Selected ${fresh300.length} fresh ml-32m users (${droppedOnDedup}/${bufferList.length} dropped after (uid,tmdbId) dedup; ` +
    `${dupRatingsRemoved} duplicate movieId->tmdbId ratings resolved; est. total qualified in ml-32m ~ ${estimatedTotalQualified.toLocaleString()}).`
  );

  // 6. Compare distributions: Original 328 vs Fresh 300
  function computeGroupStats(users) {
    const ratingsPerUser = [];
    const positivesPerUser = [];
    const trainPerUser = [];
    const allLtPosShare = [];
    const holdoutLtPosShare = [];
    let totalHoldoutPos = 0;
    let totalHoldoutLtPos = 0;
    let totalAllPos = 0;
    let totalAllLtPos = 0;

    for (const u of users) {
      ratingsPerUser.push(u.ratings.length);
      const pos = u.ratings.filter(r => r.userRating >= 8);
      positivesPerUser.push(pos.length);

      let uAllLt = 0;
      for (const r of pos) {
        if (!popularTmdbIds.has(r.tmdbId)) uAllLt++;
      }
      totalAllPos += pos.length;
      totalAllLtPos += uAllLt;
      allLtPosShare.push(pos.length > 0 ? uAllLt / pos.length : 0);

      const { trainWatched, holdoutPositives } = getUserSplit(u.ratings);
      trainPerUser.push(trainWatched.length);
      let uHoldLt = 0;
      for (const h of holdoutPositives) {
        if (!popularTmdbIds.has(h.tmdbId)) uHoldLt++;
      }
      totalHoldoutPos += holdoutPositives.length;
      totalHoldoutLtPos += uHoldLt;
      holdoutLtPosShare.push(holdoutPositives.length > 0 ? uHoldLt / holdoutPositives.length : 0);
    }

    return {
      nUsers: users.length,
      ratingsPerUser: summarize(ratingsPerUser),
      positivesPerUser: summarize(positivesPerUser),
      trainRatingsPerUser: summarize(trainPerUser),
      allPosLongTailSharePerUser: summarize(allLtPosShare),
      holdoutPosLongTailSharePerUser: summarize(holdoutLtPosShare),
      pooledAllPosLongTailShare: totalAllPos > 0 ? totalAllLtPos / totalAllPos : 0,
      pooledHoldoutPosLongTailShare: totalHoldoutPos > 0 ? totalHoldoutLtPos / totalHoldoutPos : 0,
      usersWithAnyHoldoutLtPos: holdoutLtPosShare.filter(x => x > 0).length
    };
  }

  const stats328 = computeGroupStats(small328);
  const statsFresh300 = computeGroupStats(fresh300);

  console.log("\nDISTRIBUTION COMPARISON (ml-latest-small 328 vs Fresh ml-32m 300, both restricted to 9,733-film catalog):");
  console.log("Metric                             | Orig 328 (Mean / Med [p10..p90])      | Fresh 300 (Mean / Med [p10..p90])");
  console.log("-------------------------------------------------------------------------------------------------------------------");
  const fmtD = d => `${d.mean.toFixed(1)} / ${d.median.toFixed(1)} [${d.p10.toFixed(1)}..${d.p90.toFixed(1)}]`;
  const fmtP = d => `${(d.mean * 100).toFixed(2)}% / ${(d.median * 100).toFixed(1)}% [${(d.p10 * 100).toFixed(0)}%..${(d.p90 * 100).toFixed(0)}%]`;
  console.log(`Ratings per user                   | ${fmtD(stats328.ratingsPerUser).padEnd(38)} | ${fmtD(statsFresh300.ratingsPerUser)}`);
  console.log(`Positives (>=8) per user           | ${fmtD(stats328.positivesPerUser).padEnd(38)} | ${fmtD(statsFresh300.positivesPerUser)}`);
  console.log(`Train ratings per user             | ${fmtD(stats328.trainRatingsPerUser).padEnd(38)} | ${fmtD(statsFresh300.trainRatingsPerUser)}`);
  console.log(`All-positive long-tail share/user  | ${fmtP(stats328.allPosLongTailSharePerUser).padEnd(38)} | ${fmtP(statsFresh300.allPosLongTailSharePerUser)}`);
  console.log(`Holdout-pos long-tail share/user   | ${fmtP(stats328.holdoutPosLongTailSharePerUser).padEnd(38)} | ${fmtP(statsFresh300.holdoutPosLongTailSharePerUser)}`);
  console.log(`Pooled holdout LT positive share   | ${(stats328.pooledHoldoutPosLongTailShare * 100).toFixed(2)}% (users>=1: ${stats328.usersWithAnyHoldoutLtPos}/328)         | ${(statsFresh300.pooledHoldoutPosLongTailShare * 100).toFixed(2)}% (users>=1: ${statsFresh300.usersWithAnyHoldoutLtPos}/300)`);
  console.log("-------------------------------------------------------------------------------------------------------------------");

  // 7. Save .data/fresh_300_exclude_ids.json and .data/fresh_300_users.json
  const allExcludeIds = Array.from(new Set([
    ...excludedMl32mIds,
    ...fresh300.map(u => u.ml32m_userId)
  ])).sort((a, b) => a - b);

  const excludePayload = {
    meta: {
      seed: SEED,
      knownExcludedFromMapAndTuples: excludedMl32mIds.size,
      freshSampledCount: fresh300.length,
      totalExcludedCount: allExcludeIds.length,
      benchmarkMappingSummary
    },
    freshUserIds: fresh300.map(u => u.ml32m_userId),
    excludeAllMl32mUserIds: allExcludeIds
  };
  fs.writeFileSync(path.join(root, ".data/fresh_300_exclude_ids.json"), JSON.stringify(excludePayload, null, 2));

  const freshPayload = {
    meta: {
      seed: SEED,
      catalogSize: catalogTmdbSet.size,
      popularVoteThreshold: popVoteThreshold,
      preQualifiedPass1Count: preQualified.length,
      dedupBufferSize: bufferList.length,
      droppedAfterDedup: droppedOnDedup,
      estimatedTotalQualified,
      sampledCount: fresh300.length,
      benchmarkMappingSummary,
      stats328,
      statsFresh300,
      elapsedSec: (Date.now() - tStart) / 1000
    },
    users: fresh300
  };
  fs.writeFileSync(path.join(root, ".data/fresh_300_users.json"), JSON.stringify(freshPayload));
  console.log(`Saved .data/fresh_300_users.json and .data/fresh_300_exclude_ids.json in ${((Date.now() - tStart) / 1000).toFixed(1)}s.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
