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

function parseUtcDateStart(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number.parseInt(m[1], 10);
  const mo = Number.parseInt(m[2], 10);
  const d = Number.parseInt(m[3], 10);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return dt.getTime();
}

function isReleasedOnOrAfter(candidate, minReleaseDate) {
  const minTs = parseUtcDateStart(minReleaseDate);
  if (minTs === null) return true;
  const candTs = parseUtcDateStart(candidate?.release_date);
  if (candTs !== null) return candTs >= minTs;
  const yearNum = Number(candidate?.year);
  if (Number.isFinite(yearNum) && yearNum > 1800) {
    const minYear = new Date(minTs).getUTCFullYear();
    if (yearNum > minYear) return true;
    if (yearNum < minYear) return false;
  }
  return false;
}

function computeProbabilityPercentile(sortedDesc, percentile) {
  const n = sortedDesc.length;
  if (n === 0) return 0;
  const p = Math.min(1, Math.max(0, Number(percentile ?? 0)));
  const descPos = (1 - p) * (n - 1);
  const lo = Math.floor(descPos);
  const hi = Math.ceil(descPos);
  const probLo = sortedDesc[lo].rankerProbability;
  const probHi = sortedDesc[hi].rankerProbability;
  return probLo + (descPos - lo) * (probHi - probLo);
}

function computeReserveComponents(candidate, weights) {
  const f = candidate?.features || {};
  const w = weights;
  const bayWeight = 2.5 * Number(w.bayesianRatingNorm ?? 1.2);
  const genreWeight = 0.35 * Number(w.genreOverlap ?? 1.1);

  const terms = {
    collabTerm: Number(w.collabSim ?? 4.8) * Number(f.collabSim || 0),
    contentTerm: Number(w.contentSim ?? 1.4) * Number(f.contentSim || 0),
    crewTerm: Number(w.crewMatch ?? 0.7) * Number(f.crewMatch || 0),
    castTerm: Number(w.castMatch ?? 0.5) * Number(f.castMatch || 0),
    keywordTerm: Number(w.keywordOverlap ?? 0.8) * Number(f.keywordOverlap || 0),
    negKeywordTerm: Number(w.negativeKeywordPenalty ?? -0.5) * Number(f.negativeKeywordPenalty || 0),
    repulsionTerm: Number(w.repulsion ?? -1.5) * Number(f.repulsion || 0),
    providerTerm: Number(w.providerMatch ?? 0.25) * Number(f.providerMatch || 0),
    bayesianTerm: bayWeight * Number(f.bayesianRatingNorm || 0),
    genreTerm: genreWeight * Number(f.genreOverlap || 0)
  };

  const coldStartScore = Object.values(terms).reduce((a, b) => a + b, 0);
  return {
    weightsUsed: {
      bayWeight,
      genreWeight
    },
    rawFeatures: {
      collabSim: Number(f.collabSim || 0),
      rawCollabSim: Number(f.rawCollabSim || 0),
      contentSim: Number(f.contentSim || 0),
      crewMatch: Number(f.crewMatch || 0),
      castMatch: Number(f.castMatch || 0),
      keywordOverlap: Number(f.keywordOverlap || 0),
      negativeKeywordPenalty: Number(f.negativeKeywordPenalty || 0),
      repulsion: Number(f.repulsion || 0),
      providerMatch: Number(f.providerMatch || 0),
      bayesianRatingNorm: Number(f.bayesianRatingNorm || 0),
      genreOverlap: Number(f.genreOverlap || 0),
      noveltyBonus: Number(f.noveltyBonus || 0)
    },
    terms,
    coldStartScore
  };
}

function summarizeScores(items) {
  const scores = items.map(x => Number(x.matchScore ?? 0)).sort((a, b) => a - b);
  const probs = items.map(x => Number(x.rankerProbability ?? 0));
  const sumScore = scores.reduce((a, b) => a + b, 0);
  const sumProb = probs.reduce((a, b) => a + b, 0);
  const mid = Math.floor(scores.length / 2);
  return {
    count: items.length,
    minMatchScore: scores[0] ?? 0,
    maxMatchScore: scores[scores.length - 1] ?? 0,
    medianMatchScore: scores[mid] ?? 0,
    meanMatchScore: Number((sumScore / Math.max(1, scores.length)).toFixed(2)),
    meanProbability: Number((sumProb / Math.max(1, probs.length)).toFixed(6))
  };
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  if (!process.env.VITE_TMDB_KEY?.trim()) {
    console.error("Missing VITE_TMDB_KEY");
    process.exit(1);
  }

  const [
    { extractTasteProfile, fetchCandidatePool, fetchEmbeddingCandidates, getRecentReleaseDateFloor },
    { rankCandidatePool, DEFAULT_RANKER_WEIGHTS },
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
  const minReleaseDate = getRecentReleaseDateFloor(18);

  const report = {
    generatedAt: new Date().toISOString(),
    minReleaseDate,
    minProbabilityPercentile: 0.5,
    absMinProbability: 0.54,
    vaults: [],
    crossVaultOverlapByCount: {}
  };

  const reservedOccurrences = { 2: [], 3: [] };

  for (const vault of vaults) {
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
    const injected = await fetchEmbeddingCandidates(neighbors, watchedCopy, [], candidates, {
      userRegion: "US",
      maxNeighbors: 30
    });

    const mergedPool = [...candidates, ...injected];
    const ctx = {
      profile,
      collabSimMap,
      repulsionMap,
      anchorKeywords: profile.lovedKeywordIds,
      userProviders: []
    };

    const fullScored = rankCandidatePool(mergedPool, ctx, undefined, mergedPool.length, {}, null);
    const unreservedRankById = new Map();
    fullScored.forEach((c, idx) => {
      const id = Number(c?.tmdbId ?? c?.id ?? 0);
      if (id > 0 && !unreservedRankById.has(id)) {
        unreservedRankById.set(id, idx + 1);
      }
    });

    // Compute exact probFloor used by selectWithReserve
    const nonCollabDesc = fullScored.filter(c => Number(c.features?.collabSim || 0) <= 0);
    const percentileBasis = nonCollabDesc.length > 0 ? nonCollabDesc : fullScored;
    const percentileFloor = computeProbabilityPercentile(percentileBasis, 0.5);
    const probFloor = Math.max(percentileFloor, 0.54);

    const byCount = {};
    for (const count of [0, 2, 3]) {
      const reserveCfg = {
        count,
        minReleaseDate,
        minProbabilityPercentile: 0.5
      };
      const top15 = rankCandidatePool(mergedPool, ctx, undefined, 15, {}, reserveCfg);

      const headCount = Math.max(0, 15 - count);
      const headIds = new Set();
      for (const c of fullScored) {
        if (headIds.size >= headCount) break;
        const id = Number(c?.tmdbId ?? c?.id ?? 0);
        if (id > 0) headIds.add(id);
      }

      // Trace qualifying reserve pool per selectWithReserve logic for transparency
      const baseQualifying = fullScored.filter(c => {
        const id = Number(c?.tmdbId ?? c?.id ?? 0);
        if (headIds.has(id)) return false;
        if (c.rankerProbability < probFloor) return false;
        return isReleasedOnOrAfter(c, minReleaseDate);
      });
      const hasLovedGenres = Array.isArray(profile?.lovedGenreIds) && profile.lovedGenreIds.length > 0;
      const genreMatched = hasLovedGenres
        ? baseQualifying.filter(c => Number(c.features?.genreOverlap || 0) > 0)
        : [];
      const activeQualifying = genreMatched.length > 0 ? genreMatched : baseQualifying;
      const reserveRankedIds = new Set(
        activeQualifying
          .map(c => ({
            id: Number(c?.tmdbId ?? c?.id ?? 0),
            score: computeReserveComponents(c, DEFAULT_RANKER_WEIGHTS).coldStartScore,
            prob: c.rankerProbability
          }))
          .sort((a, b) => b.score - a.score || b.prob - a.prob)
          .slice(0, count)
          .map(x => x.id)
      );

      const top15Rows = top15.map((c, idx) => {
        const id = Number(c?.tmdbId ?? c?.id ?? 0);
        const comp = computeReserveComponents(c, DEFAULT_RANKER_WEIGHTS);
        const isReserved = count > 0 && reserveRankedIds.has(id);
        const isRecent = isReleasedOnOrAfter(c, minReleaseDate);
        return {
          slot: idx + 1,
          tmdbId: id,
          title: c.title,
          year: c.year,
          release_date: c.release_date,
          bucket: c.sourceBucket,
          isRecent,
          isReserved,
          unreservedRank: unreservedRankById.get(id) ?? null,
          rankerProbability: c.rankerProbability,
          matchScore: c.matchScore,
          vote_average: c.vote_average ?? null,
          vote_count: c.vote_count ?? 0,
          genreOverlap: Number((c.features?.genreOverlap ?? 0).toFixed(4)),
          coldStartScore: comp.coldStartScore,
          reserveComponents: comp
        };
      });

      const reservedPicks = top15Rows.filter(r => r.isReserved);
      if (count === 2 || count === 3) {
        for (const pick of reservedPicks) {
          reservedOccurrences[count].push({
            vault: vault.name,
            tmdbId: pick.tmdbId,
            title: pick.title,
            year: pick.year,
            matchScore: pick.matchScore
          });
        }
      }

      byCount[String(count)] = {
        count,
        summary: {
          ...summarizeScores(top15),
          recentInTop15: top15Rows.filter(r => r.isRecent).length,
          reservedCountSelected: reservedPicks.length,
          qualifyingRecentPoolCount: activeQualifying.length
        },
        top15: top15Rows,
        reservedPicks
      };
    }

    const baseIds = new Set(byCount["0"].top15.map(x => x.tmdbId));
    const diffsVs0 = {};
    for (const count of ["2", "3"]) {
      const cur = byCount[count].top15;
      const curIds = new Set(cur.map(x => x.tmdbId));
      diffsVs0[count] = {
        added: cur.filter(x => !baseIds.has(x.tmdbId)).map(x => `${x.title} (${x.year}) [#${x.unreservedRank}->#${x.slot}, ${x.matchScore}%]`),
        dropped: byCount["0"].top15.filter(x => !curIds.has(x.tmdbId)).map(x => `${x.title} (${x.year}) [#${x.slot}, ${x.matchScore}%]`)
      };
    }

    report.vaults.push({
      name: vault.name,
      mergedPoolCount: mergedPool.length,
      percentileFloor,
      probFloor,
      lovedGenreIds: profile.lovedGenreIds || [],
      byCount,
      diffsVs0
    });

    console.log(`\n=== ${vault.name} (pool=${mergedPool.length}, probFloor=${probFloor.toFixed(4)}) ===`);
    for (const c of ["0", "2", "3"]) {
      console.log(`  count=${c}:`, JSON.stringify(byCount[c].summary));
    }
    console.log(`  count=3 reserved:`, byCount["3"].reservedPicks.map(p => `${p.title} (${p.year}) score=${p.coldStartScore.toFixed(4)} prob=${p.rankerProbability.toFixed(4)} ${p.matchScore}%`).join(" | "));
  }

  for (const count of [2, 3]) {
    const mapById = new Map();
    for (const occ of reservedOccurrences[count]) {
      const key = `${occ.tmdbId}`;
      if (!mapById.has(key)) {
        mapById.set(key, { tmdbId: occ.tmdbId, title: occ.title, year: occ.year, vaults: [] });
      }
      mapById.get(key).vaults.push(`${occ.vault} (${occ.matchScore}%)`);
    }
    const allDistinct = Array.from(mapById.values());
    const multiVault = allDistinct.filter(x => x.vaults.length > 1);
    report.crossVaultOverlapByCount[String(count)] = {
      totalReservedSlots: reservedOccurrences[count].length,
      distinctTitlesCount: allDistinct.length,
      repeatedAcrossVaults: multiVault,
      allDistinctTitles: allDistinct
    };
  }

  const outPath = path.join(ROOT, ".data/phaseI5_reserve_review.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n=== Cross-Vault Overlap ===`);
  console.log(JSON.stringify(report.crossVaultOverlapByCount, null, 2));
  console.log(`\nSaved ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
