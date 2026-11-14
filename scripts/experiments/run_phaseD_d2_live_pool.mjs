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
  const counts = {};
  for (const item of list) {
    const tag = normalizeBucketTag(item?.sourceBucket);
    counts[tag] = (counts[tag] || 0) + 1;
  }
  return counts;
}

async function main() {
  loadEnvFile(path.join(ROOT, ".env"));
  if (!process.env.VITE_TMDB_KEY) {
    throw new Error("VITE_TMDB_KEY is missing from environment / .env");
  }

  // Dynamic import after loading .env so module-scope TMDB_KEY initializes properly
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
  const { rankCandidatePool } = await import("../../src/services/rankerService.js");

  const binPath = path.join(ROOT, "public", "models", "item_embeddings_f16.bin");
  const binBuf = fs.readFileSync(binPath);
  const ab = binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength);
  const embeddingIndex = parseEmbeddingBinary(ab);
  console.log(`Loaded embedding index: count=${embeddingIndex.count}, dim=${embeddingIndex.dim}`);

  const letterboxdDir = path.join(ROOT, ".data", "letterboxd");
  const hasLetterboxdDir = fs.existsSync(letterboxdDir);
  console.log(`.data/letterboxd exists: ${hasLetterboxdDir}`);

  const vaultsPath = path.join(ROOT, ".data", "benchmark_vaults.json");
  const benchmarkData = JSON.parse(fs.readFileSync(vaultsPath, "utf8"));
  const vaults = benchmarkData.vaults || [];

  const vaultReports = [];

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
    const injected = await fetchEmbeddingCandidates(
      neighbors,
      watched,
      watchlist,
      candidates,
      { userRegion: "US", maxNeighbors: 30 }
    );

    const mergedCandidates = injected.length > 0 ? [...candidates, ...injected] : [...candidates];

    const mergedReleased2024Plus = mergedCandidates.filter(c => {
      const y = getReleaseYear(c);
      return y !== null && y >= 2024;
    }).length;

    const mergedMissingEmbedding = mergedCandidates.filter(
      c => !embeddingIndex.idToIndex.has(Number(c?.tmdbId ?? c?.id ?? 0))
    ).length;

    const top15 = rankCandidatePool(
      mergedCandidates,
      {
        profile,
        collabSimMap,
        contentSimMap: undefined,
        repulsionMap,
        anchorKeywords: profile?.lovedKeywordIds,
        userProviders: []
      },
      undefined,
      15
    );

    const top15CollabZeroCount = top15.filter(c => (c.features?.collabSim ?? 0) === 0).length;
    const top15RawCollabZeroCount = top15.filter(c => (c.features?.rawCollabSim ?? 0) === 0).length;
    const top15MissingIndexCount = top15.filter(
      c => !embeddingIndex.idToIndex.has(Number(c?.tmdbId ?? c?.id ?? 0))
    ).length;
    const top15Released2024PlusCount = top15.filter(c => {
      const y = getReleaseYear(c);
      return y !== null && y >= 2024;
    }).length;

    const picks = top15.map((c, idx) => {
      const tmdbId = Number(c?.tmdbId ?? c?.id ?? 0);
      return {
        rank: idx + 1,
        tmdbId,
        title: c.title,
        year: getReleaseYear(c),
        release_date: c.release_date || null,
        bucket: normalizeBucketTag(c.sourceBucket),
        sourceBucket: c.sourceBucket || "Unknown",
        inEmbeddingIndex: embeddingIndex.idToIndex.has(tmdbId),
        collabSim: Number((c.features?.collabSim ?? 0).toFixed(4)),
        rawCollabSim: Number((c.features?.rawCollabSim ?? 0).toFixed(4)),
        genreOverlap: Number((c.features?.genreOverlap ?? 0).toFixed(4)),
        bayesianRatingNorm: Number((c.features?.bayesianRatingNorm ?? 0).toFixed(4)),
        matchScore: c.matchScore,
        probability: Number((c.rankerProbability ?? 0).toFixed(4))
      };
    });

    const report = {
      vault: vault.name,
      watchedCount: watched.length,
      profileSummary: {
        lovedGenres: profile.lovedGenreNames,
        lovedKeywordsCount: profile.lovedKeywordIds?.length || 0,
        hatedKeywordsCount: profile.hatedKeywordIds?.length || 0,
        topCrewCount: profile.topCrewIds?.length || 0,
        personaCount: personas.length
      },
      mergedPool: {
        totalMerged: mergedCandidates.length,
        fromFetchCandidatePool: candidates.length,
        injectedBucketE: injected.length,
        byBucket: countByBucket(mergedCandidates),
        released2024PlusCount: mergedReleased2024Plus,
        missingEmbeddingCount: mergedMissingEmbedding
      },
      top15Summary: {
        count: top15.length,
        collabZeroCount: top15CollabZeroCount,
        rawCollabZeroCount: top15RawCollabZeroCount,
        missingIndexCount: top15MissingIndexCount,
        released2024PlusCount: top15Released2024PlusCount,
        byBucket: countByBucket(top15)
      },
      top15: picks
    };
    vaultReports.push(report);

    console.log(`\n=== ${vault.name} (watched=${watched.length}, personas=${personas.length}) ===`);
    console.log(
      `Merged pool: total=${mergedCandidates.length} (3-bucket=${candidates.length}, E=${injected.length}), ` +
        `>=2024=${mergedReleased2024Plus}, missingEmb=${mergedMissingEmbedding}, buckets=${JSON.stringify(
          report.mergedPool.byBucket
        )}`
    );
    console.log(
      `Top 15: collabSim===0: ${top15CollabZeroCount}, missingIndex: ${top15MissingIndexCount}, ` +
        `>=2024: ${top15Released2024PlusCount}, buckets=${JSON.stringify(report.top15Summary.byBucket)}`
    );
    for (const p of picks) {
      console.log(
        `  #${String(p.rank).padStart(2, "0")} [${p.bucket}] ${p.title} (${p.year ?? "N/A"}) ` +
          `score=${p.matchScore} collab=${p.collabSim.toFixed(3)} rawCollab=${p.rawCollabSim.toFixed(3)} ` +
          `genre=${p.genreOverlap.toFixed(2)} inIdx=${p.inEmbeddingIndex} (${p.sourceBucket})`
      );
    }
  }

  const outPath = path.join(ROOT, ".data", "phaseD_d2_live_pool.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        embeddingIndex: { count: embeddingIndex.count, dim: embeddingIndex.dim },
        hasLetterboxdDir,
        vaults: vaultReports
      },
      null,
      2
    )
  );
  console.log(`\nSaved Phase D2 report to ${outPath}`);
}

main().catch(err => {
  console.error("Phase D2 failed:", err);
  process.exit(1);
});
