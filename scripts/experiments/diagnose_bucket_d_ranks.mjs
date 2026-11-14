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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
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

  for (const vault of vaults) {
    const profile = await extractTasteProfile(vault.watched, []);
    const candidates = await fetchCandidatePool(profile, "any", vault.watched, [], { userRegion: "US", userProviders: [] });
    const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex);
    const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex);
    const personas = computeUserPersonas(profile.weightedRatings, embeddingIndex);
    const excludeIds = new Set([
      ...vault.watched.map(m => Number(m?.tmdbId ?? m?.id ?? 0)),
      ...candidates.map(c => Number(c?.tmdbId ?? c?.id ?? 0))
    ]);
    const neighbors = retrieveByEmbedding(personas, embeddingIndex, excludeIds, 30);
    const injected = await fetchEmbeddingCandidates(neighbors, vault.watched, [], candidates, {
      userRegion: "US",
      maxNeighbors: 30
    });
    const merged = [...candidates, ...injected];
    const rankedAll = rankCandidatePool(
      merged,
      {
        profile,
        collabSimMap,
        repulsionMap,
        anchorKeywords: profile.lovedKeywordIds,
        userProviders: []
      },
      undefined,
      merged.length
    );

    const probsAsc = rankedAll.map(c => c.rankerProbability).sort((a, b) => a - b);
    const mid = Math.floor(probsAsc.length / 2);
    const medianP = probsAsc.length % 2 === 1 ? probsAsc[mid] : 0.5 * (probsAsc[mid - 1] + probsAsc[mid]);
    const recentItems = rankedAll
      .map((c, idx) => ({ rank: idx + 1, c }))
      .filter(({ c }) => String(c.release_date || "") >= "2025-05-13" || c.sourceBucket === "D");

    const maxRecentP = recentItems.reduce((m, x) => Math.max(m, x.c.rankerProbability), 0);
    const aboveP50 = recentItems.filter(x => x.c.rankerProbability >= medianP).length;

    console.log(
      `${vault.name}: pool=${rankedAll.length}, p50=${medianP.toFixed(4)} (rank ${rankedAll.filter(c => c.rankerProbability >= medianP).length}/${rankedAll.length}), recentCount=${recentItems.length}, maxRecentP=${maxRecentP.toFixed(4)}, bestRecentRank=${recentItems[0]?.rank ?? "none"}, recent>=p50=${aboveP50}`
    );
    for (const { rank, c } of recentItems.slice(0, 5)) {
      console.log(
        `  rank ${rank}/${rankedAll.length} | bucket=${c.sourceBucket} | date=${c.release_date} | p=${c.rankerProbability.toFixed(4)} | hasCollab=${collabSimMap.has(Number(c.tmdbId ?? c.id))} | ${c.title}`
      );
    }
  }
}

main();
