import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT_PATH = path.join(ROOT, ".data/phaseI3_model_eval.json");
const MIN_GAP_MS = 16_000; // >= 15s required spacing between live calls

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function buildReRankSchemaConfig() {
  return {
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        tasteProfile: {
          type: Type.OBJECT,
          properties: {
            favoriteGenres: { type: Type.ARRAY, items: { type: Type.STRING } },
            preferredEra: { type: Type.STRING },
            ratingStyle: { type: Type.STRING }
          },
          required: ["favoriteGenres", "preferredEra", "ratingStyle"]
        },
        recommendations: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              tmdbId: { type: Type.NUMBER },
              title: { type: Type.STRING },
              year: { type: Type.STRING },
              matchScore: { type: Type.NUMBER },
              reason: { type: Type.STRING }
            },
            required: ["tmdbId", "title", "year", "reason"]
          }
        }
      },
      required: ["tasteProfile", "recommendations"]
    }
  };
}

function parseRetrySecondsMs(msg = "") {
  const m1 = String(msg).match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i);
  if (m1) return Math.ceil(Number(m1[1]) * 1000);
  const m2 = String(msg).match(/Please retry in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (m2) return Math.ceil(Number(m2[1]) * 1000);
  return null;
}

function isDailyQuotaExhausted(msg = "") {
  return /\blimit\s*:\s*0\b|GenerateRequestsPerDay|PerDay|requests per day/i.test(String(msg));
}

function extractErrorDetails(err) {
  return {
    name: err?.name || null,
    status: err?.status ?? err?.statusCode ?? err?.error?.code ?? null,
    message: err?.message ? String(err.message) : String(err)
  };
}

function summarizeOverlapPairs(runs) {
  const valid = runs.filter(r => r.ok && Array.isArray(r.final6) && r.final6.length > 0);
  const pairs = [];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i];
      const b = valid[j];
      const idsA = a.final6.map(x => Number(x.tmdbId));
      const idsB = b.final6.map(x => Number(x.tmdbId));
      const setB = new Set(idsB);
      const overlap = idsA.filter(id => setB.has(id)).length;
      const identicalOrder =
        idsA.length === idsB.length && idsA.every((id, k) => id === idsB[k]);
      const differsOnlyInOrdering = overlap === 6 && idsA.length === 6 && idsB.length === 6 && !identicalOrder;

      const rawIdsA = (a.raw6 || []).map(x => Number(x.tmdbId));
      const rawIdsB = (b.raw6 || []).map(x => Number(x.tmdbId));
      const rawOverlap = rawIdsA.filter(id => new Set(rawIdsB).has(id)).length;
      const rawIdenticalOrder =
        rawIdsA.length === rawIdsB.length && rawIdsA.every((id, k) => id === rawIdsB[k]);

      pairs.push({
        runA: a.runKey,
        runB: b.runKey,
        configA: a.configLabel,
        configB: b.configLabel,
        overlapAt6: overlap,
        identicalOrder,
        differsOnlyInOrdering,
        rawOverlapAt6: rawOverlap,
        rawIdenticalOrder,
        rawDiffersOnlyInOrdering: rawOverlap === 6 && !rawIdenticalOrder
      });
    }
  }
  return pairs;
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  const geminiKey = process.env.VITE_GEMINI_KEY?.trim();
  const tmdbKey = process.env.VITE_TMDB_KEY?.trim();
  if (!geminiKey || !tmdbKey) {
    console.error(`Missing keys: VITE_TMDB_KEY=${Boolean(tmdbKey)} VITE_GEMINI_KEY=${Boolean(geminiKey)}`);
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
    },
    {
      executeCascade,
      resetSessionWorkingModels,
      buildGeminiReRankPrompt,
      sanitizeAndParseJSON,
      mergeGeminiExplanationsWithRanker,
      classifyGeminiError
    }
  ] = await Promise.all([
    import("../../src/services/tmdbService.js"),
    import("../../src/services/rankerService.js"),
    import("../../src/services/embeddingService.js"),
    import("../../src/services/geminiService.js")
  ]);

  const embBuf = fs.readFileSync(path.join(ROOT, "public/models/item_embeddings_f16.bin"));
  const embeddingIndex = parseEmbeddingBinary(
    embBuf.buffer.slice(embBuf.byteOffset, embBuf.byteOffset + embBuf.byteLength)
  );
  const { vaults } = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/benchmark_vaults.json"), "utf8"));
  const byName = new Map(vaults.map(v => [v.name, v]));

  const targetVaultNames = ["ml-user-89", "ml-user-561"];
  const preparedVaults = {};

  for (const vaultName of targetVaultNames) {
    const vault = byName.get(vaultName);
    if (!vault) throw new Error(`Missing vault ${vaultName}`);
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

    // reserve: null / OFF (on feat/gemini-4-hydrogen-cascade rankCandidatePool takes topK=15 without reserve)
    const top15 = rankCandidatePool(
      mergedPool,
      {
        profile,
        collabSimMap,
        repulsionMap,
        anchorKeywords: profile.lovedKeywordIds,
        userProviders: []
      },
      undefined,
      15
    );
    const prompt = buildGeminiReRankPrompt(profile, "any", top15, {
      watched: watchedCopy,
      watchlist: []
    });

    preparedVaults[vaultName] = {
      profile,
      mergedPoolCount: mergedPool.length,
      top15Summary: top15.map((c, idx) => ({
        rank: idx + 1,
        tmdbId: c.id || c.tmdbId,
        title: c.title,
        year: c.year,
        bucket: c.sourceBucket,
        matchScore: c.matchScore,
        rankerProbability: Number((c.rankerProbability ?? 0).toFixed(6))
      })),
      top15,
      prompt
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    minGapMs: MIN_GAP_MS,
    stoppedEarlyReason: null,
    fixedInputs: Object.fromEntries(
      targetVaultNames.map(v => [
        v,
        {
          mergedPoolCount: preparedVaults[v].mergedPoolCount,
          promptLengthChars: preparedVaults[v].prompt.length,
          top15: preparedVaults[v].top15Summary
        }
      ])
    ),
    runs: [],
    overlapByVault: {}
  };

  const flushReport = () => {
    for (const v of targetVaultNames) {
      report.overlapByVault[v] = summarizeOverlapPairs(report.runs.filter(r => r.vault === v));
    }
    fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), "utf8");
  };

  flushReport();

  const rawAi = new GoogleGenAI({ apiKey: geminiKey, httpOptions: { timeout: 25000 } });
  const generationConfig = buildReRankSchemaConfig();

  // Build ordered run schedule (core configs for both vaults, then LOW probe on ml-user-89)
  const schedule = [];
  for (const vaultName of targetVaultNames) {
    schedule.push(
      { vault: vaultName, runKey: "hydrogen_MEDIUM_1", configLabel: "gemini-4-hydrogen (MEDIUM)", model: "gemini-4-hydrogen", thinkingLevel: "MEDIUM", cascadeType: "fast", direct: false },
      { vault: vaultName, runKey: "hydrogen_MEDIUM_2", configLabel: "gemini-4-hydrogen (MEDIUM)", model: "gemini-4-hydrogen", thinkingLevel: "MEDIUM", cascadeType: "fast", direct: false },
      { vault: vaultName, runKey: "hydrogen_HIGH_1", configLabel: "gemini-4-hydrogen (HIGH)", model: "gemini-4-hydrogen", thinkingLevel: "HIGH", cascadeType: "curation", direct: false },
      { vault: vaultName, runKey: "hydrogen_HIGH_2", configLabel: "gemini-4-hydrogen (HIGH)", model: "gemini-4-hydrogen", thinkingLevel: "HIGH", cascadeType: "curation", direct: false },
      { vault: vaultName, runKey: "flash_lite_1", configLabel: "gemini-3.5-flash-lite (LOW)", model: "gemini-3.5-flash-lite", thinkingLevel: "LOW", cascadeType: "fast", direct: false },
      { vault: vaultName, runKey: "flash_lite_2", configLabel: "gemini-3.5-flash-lite (LOW)", model: "gemini-3.5-flash-lite", thinkingLevel: "LOW", cascadeType: "fast", direct: false }
    );
  }
  schedule.push({
    vault: "ml-user-89",
    runKey: "hydrogen_LOW_probe",
    configLabel: "gemini-4-hydrogen (LOW probe)",
    model: "gemini-4-hydrogen",
    thinkingLevel: "LOW",
    cascadeType: "probe",
    direct: true
  });

  let lastCallCompletedAt = 0;

  async function waitSpacing() {
    if (lastCallCompletedAt > 0) {
      const elapsed = Date.now() - lastCallCompletedAt;
      const waitMs = Math.max(0, MIN_GAP_MS - elapsed);
      if (waitMs > 0) {
        console.log(`  [spacing] waiting ${(waitMs / 1000).toFixed(1)}s before next Gemini call...`);
        await sleep(waitMs);
      }
    }
  }

  for (const item of schedule) {
    await waitSpacing();

    const { prompt, top15, profile } = preparedVaults[item.vault];
    const topById = new Map(top15.map(c => [Number(c.tmdbId ?? c.id), c]));

    let capturedError = null;
    let attemptLatencyMs = 0;
    let rawResponse = null;

    const spyAi = {
      models: {
        generateContent: async (req) => {
          const t0 = Date.now();
          try {
            const res = await rawAi.models.generateContent(req);
            attemptLatencyMs = Date.now() - t0;
            lastCallCompletedAt = Date.now();
            return res;
          } catch (err) {
            attemptLatencyMs = Date.now() - t0;
            lastCallCompletedAt = Date.now();
            capturedError = err;
            throw err;
          }
        }
      }
    };

    const runOnce = async () => {
      capturedError = null;
      attemptLatencyMs = 0;
      resetSessionWorkingModels();
      if (item.direct) {
        try {
          return await spyAi.models.generateContent({
            model: item.model,
            contents: prompt,
            config: {
              ...generationConfig,
              thinkingConfig: { thinkingLevel: item.thinkingLevel }
            }
          });
        } catch (_) {
          return null;
        }
      }
      return await executeCascade(
        spyAi,
        [item.model],
        { contents: prompt, config: generationConfig },
        { cascadeType: item.cascadeType }
      );
    };

    console.log(`[RUN] ${item.vault} :: ${item.runKey} (${item.model}, ${item.thinkingLevel})`);
    rawResponse = await runOnce();

    let quotaRetried = false;
    if (!rawResponse && capturedError && classifyGeminiError(capturedError) === "quota") {
      const errInfo = extractErrorDetails(capturedError);
      if (isDailyQuotaExhausted(errInfo.message)) {
        report.stoppedEarlyReason = `Daily RPD quota exhausted on ${item.vault} ${item.runKey}: ${errInfo.message}`;
        report.runs.push({
          vault: item.vault,
          runKey: item.runKey,
          configLabel: item.configLabel,
          model: item.model,
          thinkingLevel: item.thinkingLevel,
          ok: false,
          latencyMs: attemptLatencyMs,
          error: errInfo
        });
        flushReport();
        console.error(`[QUOTA STOP] ${report.stoppedEarlyReason}`);
        break;
      }
      const retryDelayMs = parseRetrySecondsMs(errInfo.message) ?? 20_000;
      const backoffMs = Math.max(20_000, retryDelayMs + 2_000);
      console.warn(`  [429 backoff] waiting ${(backoffMs / 1000).toFixed(1)}s before single retry...`);
      await sleep(backoffMs);
      quotaRetried = true;
      rawResponse = await runOnce();
      if (!rawResponse && capturedError && classifyGeminiError(capturedError) === "quota") {
        const errInfo2 = extractErrorDetails(capturedError);
        report.stoppedEarlyReason = `Quota error persisted after backoff on ${item.vault} ${item.runKey}: ${errInfo2.message}`;
        report.runs.push({
          vault: item.vault,
          runKey: item.runKey,
          configLabel: item.configLabel,
          model: item.model,
          thinkingLevel: item.thinkingLevel,
          ok: false,
          retriedAfter429: true,
          latencyMs: attemptLatencyMs,
          error: errInfo2
        });
        flushReport();
        console.error(`[QUOTA STOP] ${report.stoppedEarlyReason}`);
        break;
      }
    }

    if (!rawResponse) {
      const errInfo = extractErrorDetails(capturedError || new Error("No response returned"));
      console.warn(`  [FAIL] ${item.vault} ${item.runKey}:`, JSON.stringify(errInfo));
      report.runs.push({
        vault: item.vault,
        runKey: item.runKey,
        configLabel: item.configLabel,
        model: item.model,
        thinkingLevel: item.thinkingLevel,
        ok: false,
        retriedAfter429: quotaRetried,
        latencyMs: attemptLatencyMs,
        error: errInfo
      });
      flushReport();
      continue;
    }

    const usage = rawResponse.usageMetadata || {};
    const parsed = sanitizeAndParseJSON(rawResponse.text);
    const merged = mergeGeminiExplanationsWithRanker(parsed, top15, profile);

    const mapPick = (r, idx) => {
      const cand = topById.get(Number(r.tmdbId)) ||
        top15.find(c => String(c.title).toLowerCase() === String(r.title).toLowerCase());
      return {
        rank: idx + 1,
        tmdbId: Number(r.tmdbId ?? cand?.tmdbId ?? cand?.id ?? 0),
        title: cand?.title || r.title,
        year: cand?.year || r.year,
        bucket: r.sourceBucket || cand?.sourceBucket || "UNKNOWN",
        matchScore: r.matchScore ?? cand?.matchScore ?? null
      };
    };

    const raw6 = (parsed?.recommendations || []).slice(0, 6).map(mapPick);
    const final6 = (merged?.recommendations || []).slice(0, 6).map(mapPick);

    const record = {
      vault: item.vault,
      runKey: item.runKey,
      configLabel: item.configLabel,
      model: item.model,
      thinkingLevel: item.thinkingLevel,
      ok: true,
      retriedAfter429: quotaRetried,
      latencyMs: attemptLatencyMs,
      tokens: {
        prompt: usage.promptTokenCount ?? null,
        output: usage.candidatesTokenCount ?? null,
        thinking: usage.thoughtsTokenCount ?? null,
        total: usage.totalTokenCount ?? null
      },
      rawRecsCount: (parsed?.recommendations || []).length,
      raw6,
      final6
    };

    report.runs.push(record);
    flushReport();

    console.log(
      `  [OK] latency=${record.latencyMs}ms | tok=${record.tokens.prompt}/${record.tokens.output}/${record.tokens.thinking} | final6=${final6.map(x => `${x.title}(${x.year})[${x.bucket}]`).join(" ; ")}`
    );
  }

  flushReport();
  console.log(`\nSaved ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
