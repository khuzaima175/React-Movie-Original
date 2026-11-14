import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MIN_RELEASE_DATE = "2025-05-13";
const MIN_RELEASE_UTC = Date.UTC(2025, 4, 13);

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function isRecentRelease(cand) {
  const rd = cand?.release_date ? String(cand.release_date).trim() : "";
  const m = rd.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return ts >= MIN_RELEASE_UTC;
  }
  const y = Number(cand?.year);
  return Number.isFinite(y) && y > 2025;
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  if (!process.env.VITE_TMDB_KEY?.trim()) {
    console.error("Missing VITE_TMDB_KEY");
    process.exit(1);
  }

  const [
    { extractTasteProfile, fetchCandidatePool, fetchEmbeddingCandidates },
    { rankCandidatePool },
    {
      parseEmbeddingBinary,
      buildRepulsionMapFromIndex,
      computeUserPersonas,
      retrieveByEmbedding
    }
  ] = await Promise.all([
    import("../../src/services/tmdbService.js"),
    import("../../src/services/rankerService.js"),
    import("../../src/services/embeddingService.js")
  ]);

  const embBuf = fs.readFileSync(path.join(ROOT, "public/models/item_embeddings_f16.bin"));
  const embeddingIndex = parseEmbeddingBinary(
    embBuf.buffer.slice(embBuf.byteOffset, embBuf.byteOffset + embBuf.byteLength)
  );
  const { vaults } = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/benchmark_vaults.json"), "utf8"));

  const report = {
    generatedAt: new Date().toISOString(),
    minReleaseDate: MIN_RELEASE_DATE,
    vaults: []
  };

  for (const vault of vaults) {
    const watchedCopy = (vault.watched || []).map(x => ({ ...x }));
    const profile = await extractTasteProfile(watchedCopy, []);
    const candidates = await fetchCandidatePool(profile, "any", watchedCopy, [], {
      userRegion: "US",
      userProviders: []
    });

    const personas = computeUserPersonas(profile.weightedRatings, embeddingIndex);
    const excludeIds = new Set([
      ...watchedCopy.map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
      ...candidates.map(c => Number(c?.tmdbId ?? c?.id ?? 0))
    ]);
    const neighbors = retrieveByEmbedding(personas, embeddingIndex, excludeIds, 30);
    const injected = await fetchEmbeddingCandidates(neighbors, watchedCopy, [], candidates, {
      userRegion: "US",
      maxNeighbors: 30
    });
    const mergedPool = [...candidates, ...injected];
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex);

    const recentPool = mergedPool
      .filter(isRecentRelease)
      .map(({ collabSim, ...rest }) => ({ ...rest }));

    const rankedRecent = rankCandidatePool(
      recentPool,
      {
        profile,
        collabSimMap: new Map(),
        repulsionMap,
        anchorKeywords: profile.lovedKeywordIds,
        userProviders: []
      },
      undefined,
      recentPool.length,
      {},
      null
    );

    const allEvaluated = rankedRecent.map((c, idx) => ({
      rankByProb: idx + 1,
      tmdbId: c.tmdbId ?? c.id,
      title: c.title,
      year: c.year,
      release_date: c.release_date,
      bucket: c.sourceBucket,
      rankerProbability: Number(c.rankerProbability.toFixed(6)),
      vote_average: c.vote_average ?? null,
      vote_count: c.vote_count ?? 0,
      genreOverlap: Number((c.features?.genreOverlap ?? 0).toFixed(4)),
      keywordOverlap: Number((c.features?.keywordOverlap ?? 0).toFixed(4)),
      castMatch: c.features?.castMatch ?? 0,
      crewMatch: c.features?.crewMatch ?? 0,
      noveltyBonus: Number((c.features?.noveltyBonus ?? 0).toFixed(4)),
      bayesianRatingNorm: Number((c.features?.bayesianRatingNorm ?? 0).toFixed(4)),
      collabSim: Number((c.features?.collabSim ?? 0).toFixed(4)),
      negativeKeywordPenalty: Number((c.features?.negativeKeywordPenalty ?? 0).toFixed(4)),
      repulsion: Number((c.features?.repulsion ?? 0).toFixed(4)),
      matchReasons: c.matchReasons || []
    }));

    const top8 = allEvaluated.slice(0, 8);
    const top8Qualifying = top8.filter(x => (x.vote_count || 0) >= 50 && x.vote_average !== null);
    const top8LowVotes = top8.filter(x => (x.vote_count || 0) < 50 || x.vote_average === null);
    const top8ByVoteAvg = [...top8Qualifying].sort((a, b) => {
      if ((b.vote_average ?? -1) !== (a.vote_average ?? -1)) return (b.vote_average ?? -1) - (a.vote_average ?? -1);
      if ((b.vote_count ?? 0) !== (a.vote_count ?? 0)) return (b.vote_count ?? 0) - (a.vote_count ?? 0);
      return b.rankerProbability - a.rankerProbability;
    });

    const minTop8VoteAvg = top8Qualifying.length > 0
      ? Math.min(...top8Qualifying.map(x => x.vote_average))
      : Infinity;
    const maxTop8VoteAvg = top8Qualifying.length > 0
      ? Math.max(...top8Qualifying.map(x => x.vote_average))
      : -Infinity;

    const outsideTop8HigherVote = allEvaluated
      .slice(8)
      .filter(x => (x.vote_count || 0) >= 50 && x.vote_average !== null && x.vote_average > minTop8VoteAvg)
      .sort((a, b) => b.vote_average - a.vote_average || b.vote_count - a.vote_count);

    const bucketCountsRecent = {};
    for (const x of allEvaluated) {
      bucketCountsRecent[x.bucket] = (bucketCountsRecent[x.bucket] || 0) + 1;
    }

    report.vaults.push({
      name: vault.name,
      totalPoolCount: mergedPool.length,
      recentCount: allEvaluated.length,
      recentBucketCounts: bucketCountsRecent,
      top8ByProb: top8,
      top8ByVoteAvg,
      top8ExcludedForLowVotes: top8LowVotes,
      minTop8VoteAvg,
      maxTop8VoteAvg,
      outsideTop8HigherVote,
      allRecentEvaluated: allEvaluated
    });

    console.log(`\n=== ${vault.name} | totalPool=${mergedPool.length} | recentCount(>=${MIN_RELEASE_DATE})=${allEvaluated.length} | buckets=${JSON.stringify(bucketCountsRecent)} ===`);
    console.log("Top 8 by rankerProbability:");
    for (const x of top8) {
      console.log(
        `  #${x.rankByProb} | ${x.title} (${x.year}, ${x.release_date}) | bucket=${x.bucket} | p=${x.rankerProbability} | vote=${x.vote_average} (n=${x.vote_count}) | g=${x.genreOverlap} kw=${x.keywordOverlap} cast=${x.castMatch} crew=${x.crewMatch} nov=${x.noveltyBonus} bay=${x.bayesianRatingNorm} | badges=${JSON.stringify(x.matchReasons)}`
      );
    }
    console.log("Top 8 re-ordered by vote_average (vote_count >= 50):");
    for (const x of top8ByVoteAvg) {
      console.log(
        `  vote=${x.vote_average} (n=${x.vote_count}) | probRank=#${x.rankByProb} (p=${x.rankerProbability}) | ${x.title} (${x.year}, ${x.bucket})`
      );
    }
    if (top8LowVotes.length > 0) {
      console.log("Excluded from top 8 vote_average ranking (vote_count < 50):", top8LowVotes.map(x => `${x.title} (n=${x.vote_count}, avg=${x.vote_average})`));
    }
    console.log(`Outside Top 8 with vote_count >= 50 and vote_average > minTop8 (${minTop8VoteAvg}): count=${outsideTop8HigherVote.length}`);
    for (const x of outsideTop8HigherVote) {
      console.log(
        `  probRank=#${x.rankByProb} (p=${x.rankerProbability}) | vote=${x.vote_average} (n=${x.vote_count}) | ${x.title} (${x.year}, ${x.release_date}, ${x.bucket})`
      );
    }
  }

  const outPath = path.join(ROOT, ".data/phaseG1_results.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nSaved G1 results to ${outPath}`);
}

main().catch(err => {
  console.error("G1 failed:", err);
  process.exit(1);
});
