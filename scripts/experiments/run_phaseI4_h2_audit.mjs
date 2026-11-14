import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

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

function getYear(item) {
  for (const c of [item?.year, item?.release_date]) {
    if (c === null || c === undefined) continue;
    const m = String(c).match(/^(\d{4})/);
    if (m) {
      const y = Number.parseInt(m[1], 10);
      if (Number.isFinite(y) && y > 1800 && y < 2200) return y;
    }
  }
  return null;
}

function countByBucket(items = []) {
  const counts = {};
  for (const x of items) {
    const b = x?.sourceBucket || "UNKNOWN";
    counts[b] = (counts[b] || 0) + 1;
  }
  return counts;
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
      buildCollabSimMapFromIndex,
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
  const byName = new Map(vaults.map(v => [v.name, v]));

  const targetVaults = ["ml-user-561", "ml-user-409"];
  const report = {
    generatedAt: new Date().toISOString(),
    vaults: []
  };

  for (const vaultName of targetVaults) {
    const vault = byName.get(vaultName);
    if (!vault) throw new Error(`Vault ${vaultName} not found`);

    const watchedCopy = (vault.watched || []).map(x => ({ ...x }));
    const profile = await extractTasteProfile(watchedCopy, []);
    const candidates = await fetchCandidatePool(profile, "any", watchedCopy, [], {
      userRegion: "US",
      userProviders: []
    });

    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex);
    const personas = computeUserPersonas(profile.weightedRatings, embeddingIndex);

    const excludeIds = new Set([
      ...watchedCopy.map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
      ...candidates.map(c => Number(c?.tmdbId ?? c?.id ?? 0))
    ]);

    const neighbors = retrieveByEmbedding(personas, embeddingIndex, excludeIds, 30);
    const neighborById = new Map(
      neighbors.map((n, idx) => [Number(n.tmdbId), { dotRank: idx + 1, dotSim: n.collabSim }])
    );

    const injected = await fetchEmbeddingCandidates(neighbors, watchedCopy, [], candidates, {
      userRegion: "US",
      maxNeighbors: 30
    });

    const mergedPool = [...candidates, ...injected];
    const maxCollabInPool = mergedPool.reduce((mx, c) => {
      const id = Number(c?.tmdbId ?? c?.id ?? 0);
      const val = Number(collabSimMap.get(id) ?? c?.collabSim ?? 0);
      return val > mx ? val : mx;
    }, 0);

    const scoredAll = rankCandidatePool(
      mergedPool,
      {
        profile,
        collabSimMap,
        repulsionMap,
        anchorKeywords: profile.lovedKeywordIds,
        userProviders: []
      },
      undefined,
      mergedPool.length,
      {},
      null
    );

    const scoredById = new Map();
    scoredAll.forEach((c, idx) => {
      const id = Number(c?.tmdbId ?? c?.id ?? 0);
      scoredById.set(id, { finalRank: idx + 1, item: c });
    });

    // 1. All 30 Bucket E neighbors ordered by raw dot order (retrieveByEmbedding order)
    const bucketERows = injected
      .map(cand => {
        const id = Number(cand?.tmdbId ?? cand?.id ?? 0);
        const nb = neighborById.get(id);
        const scoredEntry = scoredById.get(id);
        const s = scoredEntry?.item || cand;
        const f = s.features || {};
        const yr = getYear(s);
        return {
          dotRank: nb?.dotRank ?? null,
          finalRank: scoredEntry?.finalRank ?? null,
          tmdbId: id,
          title: s.title,
          year: yr,
          pre1980: yr !== null && yr < 1980,
          dotSim: nb?.dotSim ?? cand.collabSim ?? 0,
          rawCollab: f.rawCollabSim ?? 0,
          poolNormCollab: f.collabSim ?? 0,
          bayesianRatingNorm: f.bayesianRatingNorm ?? 0,
          genreOverlap: f.genreOverlap ?? 0,
          repulsion: f.repulsion ?? 0,
          noveltyBonus: f.noveltyBonus ?? 0,
          rankerProbability: s.rankerProbability ?? 0,
          matchScore: s.matchScore ?? 0,
          vote_average: s.vote_average ?? null,
          vote_count: s.vote_count ?? 0
        };
      })
      .sort((a, b) => (a.dotRank ?? 999) - (b.dotRank ?? 999));

    const bucketETop15ByDot = bucketERows.slice(0, 15);

    // 2. Full mergedPool sorted by raw dot/rawCollabSim (using rawCollabSim desc, tie-break by finalRank)
    const poolTop15ByRawCollab = [...scoredAll]
      .sort((a, b) => (b.features?.rawCollabSim ?? 0) - (a.features?.rawCollabSim ?? 0))
      .slice(0, 15)
      .map((c, idx) => {
        const id = Number(c?.tmdbId ?? c?.id ?? 0);
        const yr = getYear(c);
        const nb = neighborById.get(id);
        const scoredEntry = scoredById.get(id);
        return {
          rawCollabRank: idx + 1,
          finalRank: scoredEntry?.finalRank ?? null,
          dotRank: nb?.dotRank ?? null,
          tmdbId: id,
          title: c.title,
          year: yr,
          pre1980: yr !== null && yr < 1980,
          bucket: c.sourceBucket,
          dotSim: nb?.dotSim ?? null,
          rawCollab: c.features?.rawCollabSim ?? 0,
          poolNormCollab: c.features?.collabSim ?? 0,
          rankerProbability: c.rankerProbability
        };
      });

    // 3. Final ranker Top-15 (reserve: null)
    const finalTop15 = scoredAll.slice(0, 15).map((c, idx) => {
      const id = Number(c?.tmdbId ?? c?.id ?? 0);
      const yr = getYear(c);
      const nb = neighborById.get(id);
      return {
        finalRank: idx + 1,
        dotRank: nb?.dotRank ?? null,
        tmdbId: id,
        title: c.title,
        year: yr,
        pre1980: yr !== null && yr < 1980,
        bucket: c.sourceBucket,
        dotSim: nb?.dotSim ?? null,
        rawCollab: c.features?.rawCollabSim ?? 0,
        poolNormCollab: c.features?.collabSim ?? 0,
        bayesianRatingNorm: c.features?.bayesianRatingNorm ?? 0,
        genreOverlap: c.features?.genreOverlap ?? 0,
        repulsion: c.features?.repulsion ?? 0,
        noveltyBonus: c.features?.noveltyBonus ?? 0,
        rankerProbability: c.rankerProbability,
        matchScore: c.matchScore
      };
    });

    const summary = {
      mergedPoolCount: mergedPool.length,
      poolBucketCounts: countByBucket(mergedPool),
      personasCount: personas.length,
      neighborsRequested: neighbors.length,
      bucketEInjectedCount: injected.length,
      maxPoolCollabSim: maxCollabInPool,
      pre1980_in_bucketE_all30: bucketERows.filter(x => x.pre1980).length,
      pre1980_in_bucketE_top15_byDot: bucketETop15ByDot.filter(x => x.pre1980).length,
      pre1980_in_pool_top15_byRawCollab: poolTop15ByRawCollab.filter(x => x.pre1980).length,
      pre1980_in_finalTop15: finalTop15.filter(x => x.pre1980).length,
      bucketE_count_in_finalTop15: finalTop15.filter(x => x.bucket === "E").length,
      finalTop15_bucketCounts: countByBucket(scoredAll.slice(0, 15))
    };

    report.vaults.push({
      name: vaultName,
      summary,
      bucketETop15ByDot,
      poolTop15ByRawCollab,
      finalTop15,
      bucketEAll30: bucketERows
    });

    console.log(`\n=== ${vaultName} ===`);
    console.log(JSON.stringify(summary, null, 2));
  }

  const outPath = path.join(ROOT, ".data/phaseI4_h2_audit.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nSaved ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
