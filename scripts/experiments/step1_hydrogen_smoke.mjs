import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

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

async function buildRealistic15Prompt() {
  const [
    { extractTasteProfile, fetchCandidatePool, fetchEmbeddingCandidates },
    { rankCandidatePool },
    { buildGeminiReRankPrompt },
    {
      parseEmbeddingBinary,
      buildRepulsionMapFromIndex,
      computeUserPersonas,
      retrieveByEmbedding
    }
  ] = await Promise.all([
    import("../../src/services/tmdbService.js"),
    import("../../src/services/rankerService.js"),
    import("../../src/services/geminiService.js"),
    import("../../src/services/embeddingService.js")
  ]);

  const embBuf = fs.readFileSync(path.join(ROOT, "public/models/item_embeddings_f16.bin"));
  const embeddingIndex = parseEmbeddingBinary(
    embBuf.buffer.slice(embBuf.byteOffset, embBuf.byteOffset + embBuf.byteLength)
  );
  const { vaults } = JSON.parse(fs.readFileSync(path.join(ROOT, ".data/benchmark_vaults.json"), "utf8"));
  const vault89 = vaults.find(v => v.name === "ml-user-89") || vaults[0];
  if (!vault89) throw new Error("No vault found in .data/benchmark_vaults.json");

  const watchedCopy = (vault89.watched || []).map(x => ({ ...x }));
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
  const collabSimMap = new Map(neighbors.map(n => [n.tmdbId, n.sim]));
  const injected = await fetchEmbeddingCandidates(neighbors, watchedCopy, [], candidates, {
    userRegion: "US",
    maxNeighbors: 30
  });
  const mergedPool = [...candidates, ...injected];
  const repulsionMap = buildRepulsionMapFromIndex(profile.weightedRatings, embeddingIndex);

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

  return { vaultName: vault89.name, top15Count: top15.length, prompt };
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  const apiKey = process.env.VITE_GEMINI_KEY?.trim();
  const hasTmdb = Boolean(process.env.VITE_TMDB_KEY?.trim());
  if (!apiKey || !hasTmdb) {
    console.error(`Missing required keys: VITE_GEMINI_KEY=${Boolean(apiKey)} VITE_TMDB_KEY=${hasTmdb}`);
    process.exit(1);
  }

  const { vaultName, top15Count, prompt } = await buildRealistic15Prompt();
  console.log(`Built realistic ${top15Count}-movie prompt from ${vaultName} (chars=${prompt.length}).`);
  if (top15Count !== 15) {
    throw new Error(`Expected 15 candidates in prompt, got ${top15Count}`);
  }

  let latestFetchTelemetry = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async function wrappedFetch(input, init) {
    const rawUrl = typeof input === "string" ? input : input?.url || "";
    let isGemini = false;
    let host = "";
    let safePath = "";
    try {
      const u = new URL(rawUrl);
      host = u.host;
      safePath = u.pathname;
      isGemini = u.host.includes("generativelanguage.googleapis.com");
    } catch (_) {}

    if (!isGemini) return origFetch.call(this, input, init);

    const t0 = performance.now();
    const telemetry = {
      host,
      path: safePath,
      httpStatus: null,
      fetchLatencyMs: null,
      errorBodySnippet: null,
      fetchError: null
    };
    latestFetchTelemetry = telemetry;
    try {
      const res = await origFetch.call(this, input, init);
      telemetry.httpStatus = res.status;
      telemetry.fetchLatencyMs = Math.round(performance.now() - t0);
      if (!res.ok) {
        try {
          telemetry.errorBodySnippet = (await res.clone().text()).slice(0, 500);
        } catch (_) {}
      }
      return res;
    } catch (err) {
      telemetry.fetchLatencyMs = Math.round(performance.now() - t0);
      telemetry.fetchError = err?.message || String(err);
      throw err;
    }
  };

  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60000 } });
  const responseSchema = {
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
  };

  const levels = ["MEDIUM", "HIGH"];
  const results = [];

  for (const level of levels) {
    latestFetchTelemetry = null;
    const t0 = performance.now();
    let httpStatus = null;
    let modelVersion = null;
    let usage = null;
    let error = null;
    let parsedOk = false;
    let recCount = 0;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema,
          thinkingConfig: { thinkingLevel: level }
        }
      });
      const latencyMs = Math.round(performance.now() - t0);
      httpStatus = latestFetchTelemetry?.httpStatus ?? null;
      modelVersion = response?.modelVersion ?? null;
      usage = response?.usageMetadata ?? null;
      try {
        const parsed = JSON.parse(response?.text || "{}");
        recCount = Array.isArray(parsed?.recommendations) ? parsed.recommendations.length : 0;
        parsedOk = recCount > 0 && Boolean(parsed?.tasteProfile);
      } catch (parseErr) {
        parsedOk = false;
        error = `JSON parse error: ${parseErr.message}`;
      }

      const rec = {
        thinkingLevel: level,
        httpStatus,
        latencyMs,
        fetchLatencyMs: latestFetchTelemetry?.fetchLatencyMs ?? null,
        modelVersion,
        promptTokenCount: usage?.promptTokenCount ?? null,
        candidatesTokenCount: usage?.candidatesTokenCount ?? null,
        thoughtsTokenCount: usage?.thoughtsTokenCount ?? null,
        totalTokenCount: usage?.totalTokenCount ?? null,
        parsedOk,
        recCount,
        error
      };
      results.push(rec);
      console.log(
        `[${level}] status=${rec.httpStatus} latency=${rec.latencyMs}ms prompt=${rec.promptTokenCount} output=${rec.candidatesTokenCount} thinking=${rec.thoughtsTokenCount} total=${rec.totalTokenCount} parsedOk=${rec.parsedOk} (recs=${rec.recCount})`
      );
    } catch (err) {
      const latencyMs = Math.round(performance.now() - t0);
      const rec = {
        thinkingLevel: level,
        httpStatus: latestFetchTelemetry?.httpStatus ?? err?.status ?? null,
        latencyMs,
        fetchLatencyMs: latestFetchTelemetry?.fetchLatencyMs ?? null,
        modelVersion: null,
        promptTokenCount: null,
        candidatesTokenCount: null,
        thoughtsTokenCount: null,
        totalTokenCount: null,
        parsedOk: false,
        recCount: 0,
        error: err?.message || String(err),
        errorBodySnippet: latestFetchTelemetry?.errorBodySnippet ?? null
      };
      results.push(rec);
      console.log(
        `[${level}] FAILED status=${rec.httpStatus} latency=${rec.latencyMs}ms err=${rec.error}`
      );
    }

    if (level === "MEDIUM") {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const outPath = path.join(ROOT, ".data/step1_hydrogen_smoke.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: "gemini-4-hydrogen",
        vaultName,
        top15Count,
        promptLengthChars: prompt.length,
        results
      },
      null,
      2
    )
  );
  console.log(`Saved Step 1 smoke report to ${outPath}`);
}

main().catch(err => {
  console.error("Step 1 smoke test failed:", err);
  process.exit(1);
});
