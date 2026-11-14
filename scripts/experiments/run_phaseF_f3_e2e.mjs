import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
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

function parseReleaseYear(item) {
  const candidates = [item?.year, item?.release_date];
  for (const c of candidates) {
    if (c === null || c === undefined) continue;
    const match = String(c).match(/^(\d{4})/);
    if (match) {
      const y = Number.parseInt(match[1], 10);
      if (Number.isFinite(y) && y > 1800 && y < 2200) return y;
    }
  }
  return null;
}

function countByBucket(items = []) {
  const counts = {};
  for (const item of items) {
    const bucket = item?.sourceBucket || "UNKNOWN";
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  const sorted = {};
  for (const k of Object.keys(counts).sort()) {
    sorted[k] = counts[k];
  }
  return sorted;
}

function fmtPct(num) {
  return `${(num * 100).toFixed(1)}%`;
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));

  const hasTmdbKey = Boolean(process.env.VITE_TMDB_KEY?.trim());
  const hasGeminiKey = Boolean(process.env.VITE_GEMINI_KEY?.trim());
  const hasOmdbKey = Boolean(process.env.VITE_OMDB_KEY?.trim());

  if (!hasTmdbKey || !hasGeminiKey) {
    console.log(
      `SKIPPED Phase F3: missing required API keys (VITE_TMDB_KEY=${hasTmdbKey}, VITE_GEMINI_KEY=${hasGeminiKey}).`
    );
    return;
  }

  const [{ getMovieRecommendations, getSessionCurationModel }, { parseEmbeddingBinary }] = await Promise.all([
    import("../../src/services/geminiService.js"),
    import("../../src/services/embeddingService.js")
  ]);

  const embPath = path.join(ROOT, "public/models/item_embeddings_f16.bin");
  const embBuf = fs.readFileSync(embPath);
  const embArrayBuf = embBuf.buffer.slice(embBuf.byteOffset, embBuf.byteOffset + embBuf.byteLength);
  const embeddingIndex = parseEmbeddingBinary(embArrayBuf);

  const vaultsPath = path.join(ROOT, ".data/benchmark_vaults.json");
  const vaultsData = JSON.parse(fs.readFileSync(vaultsPath, "utf8"));
  const vaults = Array.isArray(vaultsData.vaults) ? vaultsData.vaults : [];

  console.log(
    `Loaded ${vaults.length} benchmark vaults and embeddingIndex (count=${embeddingIndex.count}, dim=${embeddingIndex.dim}).`
  );

  const settings = [
    { setting: "OFF", reserveArg: null },
    { setting: "ON", reserveArg: undefined }
  ];

  const vaultReports = [];

  for (const vault of vaults) {
    const liked = (vault.watched || []).filter(m => Number(m?.userRating) >= 8);
    const likedYears = liked.map(parseReleaseYear).filter(y => y !== null);
    const likedPre1980Count = likedYears.filter(y => y < 1980).length;
    const likedGe2024Count = likedYears.filter(y => y >= 2024).length;
    const likedPre1980Share = likedYears.length > 0 ? likedPre1980Count / likedYears.length : 0;

    const baselineLiked = {
      watchedCount: (vault.watched || []).length,
      likedCount: liked.length,
      validYearCount: likedYears.length,
      pre1980Count: likedPre1980Count,
      pre1980Share: likedPre1980Share,
      ge2024Count: likedGe2024Count
    };

    console.log(
      `\n=== Vault ${vault.name} (watched=${baselineLiked.watchedCount}, liked>=8=${baselineLiked.likedCount}, pre1980=${likedPre1980Count}/${likedYears.length} = ${fmtPct(likedPre1980Share)}) ===`
    );

    const runs = [];

    for (const { setting, reserveArg } of settings) {
      for (const repeat of [1, 2]) {
        let diag = null;
        const watchedCopy = (vault.watched || []).map(m => ({ ...m }));
        const opts = {
          embeddingIndex,
          onDiagnostics: d => {
            diag = d;
          }
        };
        if (reserveArg === null) {
          opts.reserve = null;
        }

        const t0 = performance.now();
        let result = null;
        let runError = null;
        try {
          result = await getMovieRecommendations(watchedCopy, [], undefined, opts);
        } catch (err) {
          runError = err?.message || String(err);
        }
        const latencyMs = Math.round(performance.now() - t0);

        const mergedCandidates = diag?.mergedCandidates || [];
        const topCandidates = diag?.topCandidates || [];

        const top15 = topCandidates.map((c, idx) => ({
          rank: idx + 1,
          tmdbId: c?.tmdbId ?? c?.id ?? null,
          title: c?.title ?? null,
          year: parseReleaseYear(c),
          yearRaw: c?.year ?? null,
          release_date: c?.release_date ?? null,
          sourceBucket: c?.sourceBucket || "UNKNOWN",
          rankerProbability: typeof c?.rankerProbability === "number" ? Number(c.rankerProbability.toFixed(6)) : null,
          matchScore: typeof c?.matchScore === "number" ? c.matchScore : null
        }));

        const top15Years = top15.map(x => x.year).filter(y => y !== null);
        const top15Ge2024Count = top15Years.filter(y => y >= 2024).length;
        const top15Lt1980Count = top15Years.filter(y => y < 1980).length;
        const top15Lt1980Share = top15Years.length > 0 ? top15Lt1980Count / top15Years.length : 0;

        const final6 = (result?.recommendations || []).map((r, idx) => ({
          rank: idx + 1,
          tmdbId: r?.tmdbId ?? r?.id ?? null,
          title: r?.title ?? null,
          year: parseReleaseYear(r),
          yearRaw: r?.year ?? null,
          sourceBucket: r?.sourceBucket || "UNKNOWN",
          matchScore: typeof r?.matchScore === "number" ? r.matchScore : null,
          rankerProbability: typeof r?.rankerProbability === "number" ? Number(r.rankerProbability.toFixed(6)) : null
        }));
        const final6Years = final6.map(x => x.year).filter(y => y !== null);

        const rawUsage = diag?.usageMetadata || null;
        const usageMetadata = rawUsage
          ? {
              promptTokenCount: rawUsage.promptTokenCount ?? null,
              candidatesTokenCount: rawUsage.candidatesTokenCount ?? null,
              thoughtsTokenCount: rawUsage.thoughtsTokenCount ?? 0,
              totalTokenCount: rawUsage.totalTokenCount ?? null
            }
          : null;

        const runRecord = {
          setting,
          repeat,
          reservePassed: reserveArg === null ? null : "default",
          reserveResolved: diag?.reserve ?? null,
          model: diag?.model ?? getSessionCurationModel() ?? null,
          diagnosticsCaptured: Boolean(diag),
          runError,
          latencyMs,
          usageMetadata,
          poolTotal: mergedCandidates.length,
          poolByBucket: countByBucket(mergedCandidates),
          top15Count: top15.length,
          top15ValidYearCount: top15Years.length,
          top15Ge2024Count,
          top15Lt1980Count,
          top15Lt1980Share,
          top15ByBucket: countByBucket(top15),
          top15,
          final6Count: final6.length,
          final6Ge2024Count: final6Years.filter(y => y >= 2024).length,
          final6Lt1980Count: final6Years.filter(y => y < 1980).length,
          final6,
          tasteProfile: result?.tasteProfile ?? null
        };

        runs.push(runRecord);

        const bucketStr = Object.entries(runRecord.poolByBucket)
          .map(([k, v]) => `${k}:${v}`)
          .join(" ");
        const tokStr = usageMetadata
          ? `in=${usageMetadata.promptTokenCount},out=${usageMetadata.candidatesTokenCount},think=${usageMetadata.thoughtsTokenCount},tot=${usageMetadata.totalTokenCount}`
          : "no-usage";
        console.log(
          `  [${setting} #${repeat}] model=${runRecord.model} latency=${latencyMs}ms pool=${runRecord.poolTotal} (${bucketStr}) | top15 >=2024:${top15Ge2024Count} <1980:${top15Lt1980Count}/${top15Years.length} (${fmtPct(top15Lt1980Share)}) | tokens(${tokStr})${runError ? ` ERROR=${runError}` : ""}`
        );
      }
    }

    vaultReports.push({
      name: vault.name,
      baselineLiked,
      runs
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    branch: "feat/recent-release-slots",
    keyPresence: { hasTmdbKey, hasGeminiKey, hasOmdbKey },
    embeddingIndex: {
      path: "public/models/item_embeddings_f16.bin",
      count: embeddingIndex.count,
      dim: embeddingIndex.dim
    },
    vaults: vaultReports
  };

  const outPath = path.join(ROOT, ".data/phaseF_f3_e2e_report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nSaved Phase F3 E2E report to ${outPath}`);
}

main().catch(err => {
  console.error("Phase F3 script failed:", err);
  process.exit(1);
});
