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

function parseReleaseYear(item) {
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
  for (const item of items) {
    const b = item?.sourceBucket || "UNKNOWN";
    counts[b] = (counts[b] || 0) + 1;
  }
  const sorted = {};
  for (const k of Object.keys(counts).sort()) sorted[k] = counts[k];
  return sorted;
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  const hasTmdbKey = Boolean(process.env.VITE_TMDB_KEY?.trim());
  const hasGeminiKey = Boolean(process.env.VITE_GEMINI_KEY?.trim());
  if (!hasTmdbKey || !hasGeminiKey) {
    console.error(`Missing keys: VITE_TMDB_KEY=${hasTmdbKey} VITE_GEMINI_KEY=${hasGeminiKey}`);
    process.exit(1);
  }

  const [
    { getMovieRecommendations, resetSessionWorkingModels, getSessionCurationModel },
    { parseEmbeddingBinary }
  ] = await Promise.all([
    import("../../src/services/geminiService.js"),
    import("../../src/services/embeddingService.js")
  ]);

  const embBuf = fs.readFileSync(path.join(ROOT, "public/models/item_embeddings_f16.bin"));
  const embeddingIndex = parseEmbeddingBinary(
    embBuf.buffer.slice(embBuf.byteOffset, embBuf.byteOffset + embBuf.byteLength)
  );
  const { vaults } = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/benchmark_vaults.json"), "utf8"));
  const byName = new Map(vaults.map(v => [v.name, v]));

  const runPlan = [
    { vaultName: "ml-user-89", label: "Reserve ON #1 (cold session)" },
    { vaultName: "ml-user-89", label: "Reserve ON #2 (warm session check)" },
    { vaultName: "ml-user-263", label: "Reserve ON" },
    { vaultName: "ml-user-409", label: "Reserve ON" },
    { vaultName: "ml-user-561", label: "Reserve ON" }
  ];

  // Start clean so run #1 populates sessionCurationModel and run #2 tests warm reuse
  resetSessionWorkingModels();

  let currentAttempts = [];
  let lastGeminiFetchStartMs = 0;
  const origFetch = globalThis.fetch;

  globalThis.fetch = async function wrappedFetch(input, init) {
    const rawUrl = typeof input === "string" ? input : input?.url || "";
    let geminiModel = null;
    try {
      const u = new URL(rawUrl);
      if (u.host.includes("generativelanguage.googleapis.com")) {
        const m = u.pathname.match(/\/models\/([^:/?]+)/);
        if (m) geminiModel = m[1];
      }
    } catch (_) {}

    if (!geminiModel) {
      return origFetch.call(this, input, init);
    }

    const rec = {
      seq: currentAttempts.length + 1,
      model: geminiModel,
      httpStatus: null,
      fetchLatencyMs: null,
      errorBodySnippet: null,
      aborted: false,
      fetchError: null
    };
    currentAttempts.push(rec);

    lastGeminiFetchStartMs = performance.now();
    const t0 = lastGeminiFetchStartMs;
    try {
      const res = await origFetch.call(this, input, init);
      rec.httpStatus = res.status;
      rec.fetchLatencyMs = Math.round(performance.now() - t0);
      if (!res.ok) {
        try {
          rec.errorBodySnippet = (await res.clone().text()).slice(0, 300);
        } catch (_) {}
      }
      return res;
    } catch (err) {
      rec.fetchLatencyMs = Math.round(performance.now() - t0);
      rec.aborted = Boolean(init?.signal?.aborted || /abort/i.test(err?.name || err?.message || ""));
      rec.fetchError = err?.message || String(err);
      throw err;
    }
  };

  const runs = [];
  const MIN_GAP_BETWEEN_RUNS_MS = 13000;

  for (let i = 0; i < runPlan.length; i++) {
    const { vaultName, label } = runPlan[i];
    const vault = byName.get(vaultName);
    if (!vault) throw new Error(`Missing vault: ${vaultName}`);

    if (i > 0 && lastGeminiFetchStartMs > 0) {
      const elapsedSinceLastGemini = performance.now() - lastGeminiFetchStartMs;
      if (elapsedSinceLastGemini < MIN_GAP_BETWEEN_RUNS_MS) {
        const waitMs = Math.ceil(MIN_GAP_BETWEEN_RUNS_MS - elapsedSinceLastGemini);
        console.log(`  [rate-limit guard] Waiting ${waitMs}ms before run ${i + 1}...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }

    currentAttempts = [];
    let diag = null;
    const watchedCopy = (vault.watched || []).map(x => ({ ...x }));

    const t0 = performance.now();
    let result = null;
    let runError = null;
    try {
      result = await getMovieRecommendations(watchedCopy, [], undefined, {
        embeddingIndex,
        onDiagnostics: d => {
          diag = d;
        }
      });
    } catch (err) {
      runError = err?.message || String(err);
    }
    const latencyMs = Math.round(performance.now() - t0);

    const mergedCandidates = diag?.mergedCandidates || [];
    const topCandidates = diag?.topCandidates || [];
    const topById = new Map(topCandidates.map(c => [Number(c?.tmdbId ?? c?.id ?? 0), c]));

    const top15 = topCandidates.map((c, idx) => ({
      rank: idx + 1,
      tmdbId: c?.tmdbId ?? c?.id ?? null,
      title: c?.title ?? null,
      year: parseReleaseYear(c),
      release_date: c?.release_date ?? null,
      sourceBucket: c?.sourceBucket || "UNKNOWN",
      vote_average: c?.vote_average ?? null,
      vote_count: c?.vote_count ?? null,
      rankerProbability: typeof c?.rankerProbability === "number" ? Number(c.rankerProbability.toFixed(6)) : null,
      matchScore: typeof c?.matchScore === "number" ? c.matchScore : null,
      matchReasons: c?.matchReasons || []
    }));

    const final6 = (result?.recommendations || []).map((r, idx) => {
      const tid = Number(r?.tmdbId ?? r?.id ?? 0);
      const src = topById.get(tid);
      return {
        rank: idx + 1,
        tmdbId: r?.tmdbId ?? r?.id ?? null,
        title: r?.title ?? null,
        year: parseReleaseYear(r) ?? parseReleaseYear(src),
        release_date: r?.release_date ?? src?.release_date ?? null,
        sourceBucket: r?.sourceBucket || src?.sourceBucket || "UNKNOWN",
        vote_average: r?.vote_average ?? src?.vote_average ?? null,
        vote_count: r?.vote_count ?? src?.vote_count ?? null,
        matchScore: typeof r?.matchScore === "number" ? r.matchScore : (src?.matchScore ?? null),
        rankerProbability:
          typeof src?.rankerProbability === "number"
            ? Number(src.rankerProbability.toFixed(6))
            : (typeof r?.rankerProbability === "number" ? Number(r.rankerProbability.toFixed(6)) : null),
        reason: r?.reason ?? null
      };
    });

    const rawUsage = diag?.usageMetadata || null;
    const usageMetadata = rawUsage
      ? {
          promptTokenCount: rawUsage.promptTokenCount ?? null,
          candidatesTokenCount: rawUsage.candidatesTokenCount ?? null,
          thoughtsTokenCount: rawUsage.thoughtsTokenCount ?? 0,
          totalTokenCount: rawUsage.totalTokenCount ?? null
        }
      : null;

    const top15Ge2025 = top15.filter(x => x.year !== null && x.year >= 2025);
    const final6Ge2025 = final6.filter(x => x.year !== null && x.year >= 2025);

    const runRec = {
      runIndex: i + 1,
      vault: vaultName,
      label,
      model: diag?.model ?? getSessionCurationModel() ?? null,
      latencyMs,
      geminiAttempts: [...currentAttempts],
      attemptCount: currentAttempts.length,
      sessionModelAfterRun: getSessionCurationModel(),
      usageMetadata,
      poolTotal: mergedCandidates.length,
      poolByBucket: countByBucket(mergedCandidates),
      reserveResolved: diag?.reserve ?? null,
      top15Count: top15.length,
      top15Ge2025Count: top15Ge2025.length,
      top15Ge2025Titles: top15Ge2025.map(x => `${x.title} (${x.year})`),
      top15,
      final6Count: final6.length,
      final6Ge2025Count: final6Ge2025.length,
      final6Ge2025Titles: final6Ge2025.map(x => `${x.title} (${x.year})`),
      final6,
      tasteProfile: result?.tasteProfile ?? null,
      runError
    };
    runs.push(runRec);

    const tokStr = usageMetadata
      ? `in=${usageMetadata.promptTokenCount}, out=${usageMetadata.candidatesTokenCount}, think=${usageMetadata.thoughtsTokenCount}, tot=${usageMetadata.totalTokenCount}`
      : "no-usage";
    const attStr = currentAttempts.map(a => `${a.model}:${a.httpStatus ?? (a.aborted ? "ABORT" : "ERR")}(${a.fetchLatencyMs}ms)`).join(" -> ");
    console.log(
      `[Run ${i + 1}/5] ${vaultName} [${label}] model=${runRec.model} latency=${latencyMs}ms attempts=[${attStr}] | pool=${runRec.poolTotal} (${JSON.stringify(runRec.poolByBucket)}) | top15>=2025:${runRec.top15Ge2025Count} final6>=2025:${runRec.final6Ge2025Count} | tokens(${tokStr})${runError ? ` ERROR=${runError}` : ""}`
    );
  }

  const outPath = path.join(ROOT, ".data/phaseF_f3_e2e_v2_report.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        branch: "feat/recent-release-slots",
        runs
      },
      null,
      2
    )
  );
  console.log(`\nSaved Phase F3 v2 E2E report to ${outPath}`);
}

main().catch(err => {
  console.error("Phase F3 v2 failed:", err);
  process.exit(1);
});
