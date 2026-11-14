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

function classifyOutcome(errText = "", httpStatus = null) {
  const s = String(errText || "");
  if (/timed out/i.test(s)) return "timeout";
  if (httpStatus === 429 || /"code"\s*:\s*429|RESOURCE_EXHAUSTED|quota/i.test(s)) return "quota";
  if (httpStatus === 503 || /"code"\s*:\s*503|UNAVAILABLE/i.test(s)) return "503";
  return "other";
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  const hasTmdb = Boolean(process.env.VITE_TMDB_KEY?.trim());
  const hasGemini = Boolean(process.env.VITE_GEMINI_KEY?.trim());
  if (!hasTmdb || !hasGemini) {
    console.error(`Missing keys: TMDB=${hasTmdb}, GEMINI=${hasGemini}`);
    process.exit(1);
  }

  const [{ getMovieRecommendations, CURATION_MODEL_CASCADE, getSessionCurationModel }, { parseEmbeddingBinary }] =
    await Promise.all([
      import("../../src/services/geminiService.js"),
      import("../../src/services/embeddingService.js")
    ]);

  const embBuf = fs.readFileSync(path.join(ROOT, "public/models/item_embeddings_f16.bin"));
  const embeddingIndex = parseEmbeddingBinary(
    embBuf.buffer.slice(embBuf.byteOffset, embBuf.byteOffset + embBuf.byteLength)
  );
  const { vaults } = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/benchmark_vaults.json"), "utf8"));
  const vault89 = vaults.find(v => v.name === "ml-user-89");
  if (!vault89) throw new Error("ml-user-89 not found");

  // Shared per-run instrumentation state
  let activeTrace = null;
  const origFetch = globalThis.fetch;
  const origWarn = console.warn;

  globalThis.fetch = async function wrappedFetch(input, init) {
    const rawUrl = typeof input === "string" ? input : input?.url || "";
    let safeHost = "";
    let geminiModel = null;
    try {
      const u = new URL(rawUrl);
      safeHost = u.host;
      if (u.host.includes("generativelanguage.googleapis.com")) {
        const m = u.pathname.match(/\/models\/([^:/?]+)/);
        if (m) geminiModel = m[1];
      }
    } catch (_) {}

    if (!geminiModel || !activeTrace) {
      return origFetch.call(this, input, init);
    }

    const startMs = performance.now();
    const fetchRec = {
      seq: activeTrace.fetchCalls.length + 1,
      host: safeHost,
      model: geminiModel,
      startMs,
      relStartMs: Math.round(startMs - activeTrace.runStartMs),
      endMs: null,
      fetchElapsedMs: null,
      httpStatus: null,
      errorBodySnippet: null,
      fetchThrown: null
    };
    activeTrace.fetchCalls.push(fetchRec);
    // Start an attempt slot keyed to this model when fetch begins
    activeTrace.pendingFetchStarts.set(geminiModel, startMs);

    try {
      const res = await origFetch.call(this, input, init);
      const endMs = performance.now();
      fetchRec.endMs = endMs;
      fetchRec.fetchElapsedMs = Math.round(endMs - startMs);
      fetchRec.httpStatus = res.status;
      if (!res.ok) {
        try {
          const clone = res.clone();
          const bodyText = await clone.text();
          fetchRec.errorBodySnippet = bodyText.slice(0, 1200);
        } catch (_) {}
      }
      return res;
    } catch (err) {
      const endMs = performance.now();
      fetchRec.endMs = endMs;
      fetchRec.fetchElapsedMs = Math.round(endMs - startMs);
      fetchRec.fetchThrown = err?.message || String(err);
      throw err;
    }
  };

  console.warn = function wrappedWarn(...args) {
    if (activeTrace) {
      const msg = args.map(a => (typeof a === "string" ? a : String(a))).join(" ");
      const m = msg.match(/^Model\s+(\S+)\s+failed in\s+(\S+)\s+cascade\s+\(([\s\S]*)\)\.\s+Trying fallback\.\.\.$/);
      if (m) {
        const warnMs = performance.now();
        const model = m[1];
        const cascadeType = m[2];
        const errDetail = m[3];
        const attemptStartMs = activeTrace.pendingFetchStarts.get(model) ?? activeTrace.lastEventMs ?? activeTrace.cascadeStartMs ?? activeTrace.runStartMs;
        const matchingFetch = [...activeTrace.fetchCalls].reverse().find(f => f.model === model);
        const outcome = classifyOutcome(errDetail, matchingFetch?.httpStatus ?? null);
        activeTrace.attempts.push({
          attemptIndex: activeTrace.attempts.length + 1,
          model,
          cascadeType,
          outcome,
          httpStatus: matchingFetch?.httpStatus ?? null,
          elapsedMs: Math.round(warnMs - attemptStartMs),
          errorMessage: errDetail.slice(0, 600)
        });
        activeTrace.lastEventMs = warnMs;
      } else {
        activeTrace.otherWarns.push(msg.slice(0, 400));
      }
    }
    return origWarn.apply(console, args);
  };

  const runs = [];

  try {
    for (let runIdx = 1; runIdx <= 6; runIdx++) {
      const runStartMs = performance.now();
      let diag = null;
      let diagTimeMs = null;

      activeTrace = {
        runIdx,
        runStartMs,
        cascadeStartMs: null,
        lastEventMs: null,
        pendingFetchStarts: new Map(),
        fetchCalls: [],
        attempts: [],
        otherWarns: []
      };

      let result = null;
      let runError = null;
      const watchedCopy = (vault89.watched || []).map(x => ({ ...x }));
      try {
        result = await getMovieRecommendations(
          watchedCopy,
          [],
          msg => {
            if (String(msg).includes("AI Oracle") && activeTrace.cascadeStartMs === null) {
              const now = performance.now();
              activeTrace.cascadeStartMs = now;
              activeTrace.lastEventMs = now;
            }
          },
          {
            embeddingIndex,
            onDiagnostics: d => {
              diagTimeMs = performance.now();
              diag = d;
            }
          }
        );
      } catch (err) {
        runError = err?.message || String(err);
      }

      const runEndMs = performance.now();

      // Close successful attempt if onDiagnostics received a non-null model
      if (diag?.model) {
        const winModel = diag.model;
        const winStart = activeTrace.pendingFetchStarts.get(winModel) ?? activeTrace.lastEventMs ?? activeTrace.cascadeStartMs ?? runStartMs;
        const matchingFetch = [...activeTrace.fetchCalls].reverse().find(f => f.model === winModel);
        activeTrace.attempts.push({
          attemptIndex: activeTrace.attempts.length + 1,
          model: winModel,
          cascadeType: "curation",
          outcome: "ok",
          httpStatus: matchingFetch?.httpStatus ?? 200,
          elapsedMs: Math.round((diagTimeMs ?? runEndMs) - winStart),
          errorMessage: null
        });
      }

      const totalWallMs = Math.round(runEndMs - runStartMs);
      const tmdbPrepMs = activeTrace.cascadeStartMs ? Math.round(activeTrace.cascadeStartMs - runStartMs) : null;
      const cascadeWallMs = activeTrace.cascadeStartMs ? Math.round((diagTimeMs ?? runEndMs) - activeTrace.cascadeStartMs) : null;
      const failedAttempts = activeTrace.attempts.filter(a => a.outcome !== "ok");
      const failedAttemptsMs = failedAttempts.reduce((sum, a) => sum + a.elapsedMs, 0);
      const okAttempt = activeTrace.attempts.find(a => a.outcome === "ok");

      const runRecord = {
        run: runIdx,
        winningModelFromOnDiagnostics: diag?.model ?? null,
        sessionCurationModelAfterRun: getSessionCurationModel(),
        diagnosticsCaptured: Boolean(diag),
        usageMetadata: diag?.usageMetadata ?? null,
        totalWallMs,
        tmdbPrepMs,
        cascadeWallMs,
        failedAttemptsMs,
        okAttemptMs: okAttempt?.elapsedMs ?? null,
        attemptCount: activeTrace.attempts.length,
        attempts: activeTrace.attempts,
        fetchCalls: activeTrace.fetchCalls.map(({ errorBodySnippet, ...rest }) => ({
          ...rest,
          hasErrorBody: Boolean(errorBodySnippet),
          errorBodySnippet: errorBodySnippet || null
        })),
        otherWarns: activeTrace.otherWarns,
        runError,
        final6Count: result?.recommendations?.length ?? 0
      };
      runs.push(runRecord);

      console.log(
        `RUN ${runIdx}/6 | totalWall=${totalWallMs}ms (tmdbPrep=${tmdbPrepMs}ms, cascade=${cascadeWallMs}ms) | winner=${runRecord.winningModelFromOnDiagnostics} | failedMs=${failedAttemptsMs}ms | attempts=${runRecord.attempts.map(a => `${a.model}:${a.outcome}(${a.elapsedMs}ms)`).join(" -> ")}`
      );
    }
  } finally {
    globalThis.fetch = origFetch;
    console.warn = origWarn;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    vault: "ml-user-89",
    cascadeOrderConfigured: CURATION_MODEL_CASCADE,
    runs
  };

  const outPath = path.join(ROOT, ".data/phaseG2_results.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nSaved G2 results to ${outPath}`);
}

main().catch(err => {
  console.error("G2 failed:", err);
  process.exit(1);
});
