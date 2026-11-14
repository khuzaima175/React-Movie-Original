import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

function getReleaseYear(cand) {
  const rd = typeof cand?.release_date === "string" ? cand.release_date.slice(0, 4) : "";
  if (/^\d{4}$/.test(rd)) return Number(rd);
  const y = Number(cand?.year);
  return Number.isFinite(y) && y > 1800 ? y : null;
}

function normalizeBucketTag(sourceBucket = "") {
  if (sourceBucket.includes("Bucket A")) return "Bucket A";
  if (sourceBucket.includes("Bucket B")) return "Bucket B";
  if (sourceBucket.includes("Bucket C")) return "Bucket C";
  if (sourceBucket.includes("Bucket E")) return "Bucket E";
  return sourceBucket || "Unknown";
}

function countByBucket(list) {
  const grouped = { "Bucket A": 0, "Bucket B": 0, "Bucket C": 0, "Bucket E": 0 };
  const exact = {};
  for (const item of list) {
    const tag = normalizeBucketTag(item?.sourceBucket);
    grouped[tag] = (grouped[tag] || 0) + 1;
    const raw = item?.sourceBucket || "Unknown";
    exact[raw] = (exact[raw] || 0) + 1;
  }
  return { grouped, exact };
}

function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeEraPopProfile(movies = []) {
  const years = movies.map(getReleaseYear).filter(y => y !== null);
  const logVcs = movies
    .map(m => Number(m?.vote_count))
    .filter(vc => Number.isFinite(vc) && vc > 0)
    .map(vc => Math.log10(vc));
  const pre1980Count = years.filter(y => y < 1980).length;
  return {
    count: movies.length,
    validYearCount: years.length,
    medianYear: median(years),
    validVoteCount: logVcs.length,
    medianLog10VoteCount: median(logVcs),
    pre1980Count,
    pre1980Share: movies.length > 0 ? pre1980Count / movies.length : null
  };
}

async function main() {
  loadEnvFile(path.join(ROOT, ".env"));
  if (!process.env.VITE_TMDB_KEY) {
    throw new Error("VITE_TMDB_KEY missing");
  }

  const { extractTasteProfile, fetchCandidatePool, fetchEmbeddingCandidates } = await import(
    "../../src/services/tmdbService.js"
  );
  const {
    parseEmbeddingBinary,
    computeUserPersonas,
    retrieveByEmbedding,
    buildCollabSimMapFromIndex,
    buildRepulsionMapFromIndex
  } = await import("../../src/services/embeddingService.js");
  const { rankCandidatePool, DEFAULT_RANKER_WEIGHTS } = await import("../../src/services/rankerService.js");

  const binPath = path.join(ROOT, "public", "models", "item_embeddings_f16.bin");
  const binBuf = fs.readFileSync(binPath);
  const ab = binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength);
  const embeddingIndex = parseEmbeddingBinary(ab);

  const benchmarkData = JSON.parse(fs.readFileSync(path.join(ROOT, ".data", "benchmark_vaults.json"), "utf8"));
  const vaults = benchmarkData.vaults || [];

  const results = [];

  for (const vault of vaults) {
    const watched = vault.watched || [];
    const watchlist = vault.watchlist || [];

    const profile = await extractTasteProfile(watched, watchlist);
    const candidates = await fetchCandidatePool(profile, "any", watched, watchlist, {
      userRegion: "US",
      userProviders: []
    });

    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex);

    const personas = computeUserPersonas(profile.weightedRatings, embeddingIndex);
    const excludeIds = new Set([
      ...watched.map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
      ...watchlist.map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
      ...candidates.map(c => Number(c?.tmdbId ?? c?.id ?? 0))
    ]);
    const neighbors = retrieveByEmbedding(personas, embeddingIndex, excludeIds, 30);
    const injected = await fetchEmbeddingCandidates(neighbors, watched, watchlist, candidates, {
      userRegion: "US",
      maxNeighbors: 30
    });
    const mergedCandidates = injected.length > 0 ? [...candidates, ...injected] : [...candidates];

    const poolBuckets = countByBucket(mergedCandidates);
    const rankedAll = rankCandidatePool(
      mergedCandidates,
      {
        profile,
        collabSimMap,
        contentSimMap: undefined,
        repulsionMap,
        anchorKeywords: profile?.lovedKeywordIds,
        userProviders: []
      },
      DEFAULT_RANKER_WEIGHTS,
      mergedCandidates.length
    );

    const rank15 = rankedAll[14] || null;
    const prob15 = rank15 ? rank15.rankerProbability : null;

    const candidates2024Plus = [];
    for (let i = 0; i < rankedAll.length; i++) {
      const c = rankedAll[i];
      const y = getReleaseYear(c);
      if (y !== null && y >= 2024) {
        const prob = c.rankerProbability;
        candidates2024Plus.push({
          rank: i + 1,
          totalRanked: rankedAll.length,
          tmdbId: Number(c.tmdbId ?? c.id ?? 0),
          title: c.title,
          year: y,
          release_date: c.release_date || null,
          bucket: normalizeBucketTag(c.sourceBucket),
          sourceBucket: c.sourceBucket || "Unknown",
          rankerProbability: prob,
          matchScore: c.matchScore,
          gapTo15thProb: prob15 !== null ? prob - prob15 : null,
          collabSim: Number((c.features?.collabSim ?? 0).toFixed(4)),
          rawCollabSim: Number((c.features?.rawCollabSim ?? 0).toFixed(4)),
          inEmbeddingIndex: embeddingIndex.idToIndex.has(Number(c.tmdbId ?? c.id ?? 0)),
          vote_average: c.vote_average,
          vote_count: c.vote_count
        });
      }
    }

    const likedMovies = watched.filter(m => Number(m?.userRating ?? m?.UserRating ?? 0) >= 8);
    const top15 = rankedAll.slice(0, 15);
    const top15Buckets = countByBucket(top15);
    const top15CollabZero = top15.filter(c => (c.features?.collabSim ?? 0) === 0).length;

    const likedProfile = computeEraPopProfile(likedMovies);
    const top15Profile = computeEraPopProfile(top15);

    results.push({
      vault: vault.name,
      watchedCount: watched.length,
      likedCount: likedMovies.length,
      personas: personas.length,
      collabMapSize: collabSimMap.size,
      mergedPoolSize: mergedCandidates.length,
      poolBuckets,
      rank15Title: rank15?.title || null,
      rank15Prob: prob15,
      rank15MatchScore: rank15?.matchScore ?? null,
      candidates2024Plus,
      top15Buckets,
      top15CollabZero,
      eraPopularity: {
        liked: likedProfile,
        top15: top15Profile
      },
      top15Titles: top15.map((c, idx) => ({
        rank: idx + 1,
        title: c.title,
        year: getReleaseYear(c),
        vote_count: c.vote_count,
        bucket: normalizeBucketTag(c.sourceBucket),
        collabSim: Number((c.features?.collabSim ?? 0).toFixed(4)),
        prob: Number(c.rankerProbability.toFixed(6)),
        matchScore: c.matchScore
      }))
    });

    console.log(`\n=== ${vault.name} (personas=${personas.length}, merged=${mergedCandidates.length}) ===`);
    console.log(`  Pool buckets: ${JSON.stringify(poolBuckets.grouped)} | exact: ${JSON.stringify(poolBuckets.exact)}`);
    console.log(`  Top-15 buckets: ${JSON.stringify(top15Buckets.grouped)} | collabSim=0 in top-15: ${top15CollabZero}`);
    console.log(`  15th place: #15 "${rank15?.title}" prob=${prob15?.toFixed(6)} (matchScore=${rank15?.matchScore})`);
    if (candidates2024Plus.length === 0) {
      console.log(`  2024+ candidates: NONE`);
    } else {
      console.log(`  2024+ candidates (${candidates2024Plus.length}):`);
      for (const c24 of candidates2024Plus) {
        const gapStr =
          c24.gapTo15thProb >= 0 ? `+${c24.gapTo15thProb.toFixed(6)}` : c24.gapTo15thProb.toFixed(6);
        console.log(
          `    rank ${c24.rank}/${c24.totalRanked} | ${c24.title} (${c24.year}) | ${c24.bucket} | ` +
            `prob=${c24.rankerProbability.toFixed(6)} | gapTo15th=${gapStr} | collab=${c24.collabSim}`
        );
      }
    }
    console.log(
      `  Era/Pop liked (>=8, n=${likedProfile.count}): medYear=${likedProfile.medianYear}, ` +
        `medLog10VC=${likedProfile.medianLog10VoteCount?.toFixed(4)}`
    );
    console.log(
      `  Era/Pop top-15: medYear=${top15Profile.medianYear}, ` +
        `medLog10VC=${top15Profile.medianLog10VoteCount?.toFixed(4)}, ` +
        `pre1980=${top15Profile.pre1980Count}/15 (${(top15Profile.pre1980Share * 100).toFixed(1)}%)`
    );
  }

  const outPath = path.join(ROOT, ".data", "phaseE_e2_report.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        defaultNegativeKeywordPenalty: DEFAULT_RANKER_WEIGHTS.negativeKeywordPenalty,
        vaults: results
      },
      null,
      2
    )
  );
  console.log(`\nSaved Phase E2 report to ${outPath}`);
}

main().catch(err => {
  console.error("Phase E2 failed:", err);
  process.exit(1);
});
