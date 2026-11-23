import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const { parseJsonBackupContent } = await imp("src/services/vaultPortability.js");
const { parseEmbeddingBinary, buildCollabSimMapFromIndex } = await imp("src/services/embeddingService.js");
const { extractTasteProfile } = await imp("src/services/tmdbService.js");
const {
  getMoodPreset,
  isExplicitMoodActive,
  normalizeMoodFilters
} = await imp("src/services/moodPolicy.js");
const {
  getMovieRecommendations,
  resetSessionWorkingModels,
  buildGeminiReRankPrompt,
  mergeGeminiExplanationsWithRanker,
  getModelThinkingConfig,
  sanitizeAndParseJSON,
  cleanStr
} = await imp("src/services/geminiService.js");
const {
  formatTieredVault,
  buildFullVaultPrompt,
  buildFullVaultResponseSchema,
  buildDossierCurationPrompt,
  verifyGenerativePicks,
  computeArmMetrics,
  buildCombinedTwoPassBallot,
  scoreBlindBallot
} = await imp("scripts/experiments/dual_track_utils.mjs");

const DEFAULT_VAULT_PATH = ".data/cinemavault-backup-2026-11-20.json";
const DEFAULT_OUT_DIR = "scripts/experiments/results/dual_track";
const HYDROGEN_MODEL = "gemini-4-hydrogen";
const FLASH_LITE_MODEL = "gemini-3.5-flash-lite";
const MIN_HYDROGEN_GAP_MS = 16_000;
const MIN_FLASH_GAP_MS = 2_000;

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCliArgs(argv = []) {
  const opts = {
    vaultPath: DEFAULT_VAULT_PATH,
    outDir: DEFAULT_OUT_DIR,
    round: 1,
    scenario: null,
    resume: false,
    dryRun: false,
    scorePath: null,
    keyPath: null
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault" && argv[i + 1]) opts.vaultPath = argv[++i];
    else if (a === "--out" && argv[i + 1]) opts.outDir = argv[++i];
    else if (a === "--round" && argv[i + 1]) opts.round = Number(argv[++i]) || 1;
    else if (a === "--scenario" && argv[i + 1]) opts.scenario = argv[++i];
    else if (a === "--resume") opts.resume = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--score" && argv[i + 1]) opts.scorePath = argv[++i];
    else if (a === "--key" && argv[i + 1]) opts.keyPath = argv[++i];
  }
  return opts;
}

function buildTrack1ReRankConfig() {
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
              anchorTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
              reason: { type: Type.STRING }
            },
            required: ["tmdbId", "title", "year", "reason"]
          }
        },
        wildcardPicks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              year: { type: Type.STRING },
              anchorTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
              reason: { type: Type.STRING }
            },
            required: ["title", "year", "reason"]
          }
        }
      },
      required: ["tasteProfile", "recommendations"]
    }
  };
}

function getMoodSummaryForPrompt(mood = "any", rawFilters = null) {
  const moodFilters = normalizeMoodFilters(rawFilters);
  const effectiveMood =
    moodFilters?.moodId && moodFilters.moodId !== "any" && (!mood || mood === "any")
      ? moodFilters.moodId
      : (mood || "any");
  const preset = getMoodPreset(effectiveMood);
  const explicitMood = isExplicitMoodActive(effectiveMood, moodFilters);
  const vibeConstraints = [];
  if (moodFilters?.query) vibeConstraints.push(`Vibe request: "${cleanStr(moodFilters.query)}"`);
  if (moodFilters?.withGenres?.length > 0) vibeConstraints.push(`Requested genres: ${moodFilters.withGenres.join(", ")}`);
  if (moodFilters?.withoutKeywords?.length > 0) vibeConstraints.push(`Avoid elements: ${moodFilters.withoutKeywords.join(", ")}`);
  if (moodFilters?.minYear || moodFilters?.maxYear) {
    vibeConstraints.push(`Release years: ${moodFilters.minYear || "any"}-${moodFilters.maxYear || "any"}`);
  }
  return { effectiveMood, preset, explicitMood, vibeConstraints, moodFilters };
}

function getRoundScenarios(round, prefs = {}) {
  const tasteRules = Array.isArray(prefs?.tasteRules) ? prefs.tasteRules : [];
  if (round === 2) {
    return [
      {
        id: "pk_streaming",
        label: "Test B2: Dark Thriller (PK Netflix + Prime)",
        mood: "dark-thriller",
        moodFilters: null,
        userRegion: "PK",
        userProviders: [8, 9],
        tasteRules,
        rawRequestCount: 25,
        blindspotCount: 3,
        batches: 1
      },
      {
        id: "refresh_3x",
        label: "Test C: 3-Turn Refresh Stress Test (Any Vibe)",
        mood: "any",
        moodFilters: null,
        userRegion: "GLOBAL",
        userProviders: [],
        tasteRules,
        rawRequestCount: 15,
        blindspotCount: 3,
        batches: 3
      }
    ];
  }

  return [
    {
      id: "any_vibe",
      label: "Test A: Any Vibe (Open Discovery)",
      mood: "any",
      moodFilters: null,
      userRegion: "GLOBAL",
      userProviders: [],
      tasteRules,
      rawRequestCount: 15,
      blindspotCount: 3,
      batches: 1
    },
    {
      id: "poetic_vibe",
      label: "Test B1: Poetic Custom Vibe (Pre-2010 Melancholic Detective Mystery, No Horror)",
      mood: "any",
      moodFilters: {
        query: "quiet, melancholic late-night detective mystery, pre-2010, no horror",
        maxYear: 2009,
        withoutKeywords: ["horror"]
      },
      userRegion: "GLOBAL",
      userProviders: [],
      tasteRules,
      rawRequestCount: 15,
      blindspotCount: 3,
      batches: 1
    }
  ];
}

function createStrictSingleModelClient(realAi, expectedModel) {
  let lastUsage = null;
  let lastLatencyMs = 0;
  return {
    getLastStats: () => ({ usageMetadata: lastUsage, latencyMs: lastLatencyMs }),
    models: {
      generateContent: async (req) => {
        if (req.model !== expectedModel) {
          throw new Error(`Strict model lock blocked fallback to "${req.model}" (expected "${expectedModel}")`);
        }
        const t0 = Date.now();
        const res = await realAi.models.generateContent(req);
        lastLatencyMs = Date.now() - t0;
        lastUsage = res?.usageMetadata ?? null;
        return res;
      }
    }
  };
}

let lastHydrogenCallMs = 0;
let lastFlashCallMs = 0;

async function paceModelCall(model) {
  const now = Date.now();
  if (model === HYDROGEN_MODEL) {
    const wait = MIN_HYDROGEN_GAP_MS - (now - lastHydrogenCallMs);
    if (wait > 0) {
      console.log(`  [Pace] Waiting ${(wait / 1000).toFixed(1)}s before Hydrogen call (5 RPM limit)...`);
      await sleep(wait);
    }
    lastHydrogenCallMs = Date.now();
  } else {
    const wait = MIN_FLASH_GAP_MS - (now - lastFlashCallMs);
    if (wait > 0) await sleep(wait);
    lastFlashCallMs = Date.now();
  }
}

function isTransientOverloadError(err) {
  const msg = String(err?.message || err || "");
  const code = Number(err?.status ?? err?.statusCode ?? err?.error?.code ?? 0);
  return code === 503 || code === 500 || /503|UNAVAILABLE|high demand|overloaded/i.test(msg);
}

async function generateStrictJson(realAi, model, contents, responseSchema, cascadeType = "curation") {
  const thinkingConfig = getModelThinkingConfig(model, cascadeType);
  const config = {
    responseMimeType: "application/json",
    responseSchema,
    ...(thinkingConfig ? { thinkingConfig } : {})
  };
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await paceModelCall(model);
    const t0 = Date.now();
    try {
      const res = await realAi.models.generateContent({ model, contents, config });
      const latencyMs = Date.now() - t0;
      const parsed = sanitizeAndParseJSON(res.text);
      return { parsed, latencyMs, usageMetadata: res?.usageMetadata ?? null };
    } catch (err) {
      if (attempt < maxAttempts && isTransientOverloadError(err)) {
        const backoffMs = attempt * 15_000;
        console.log(`  [Retry ${attempt}/${maxAttempts - 1}] ${model} transient 503/overload; waiting ${backoffMs / 1000}s...`);
        await sleep(backoffMs);
        continue;
      }
      throw err;
    }
  }
}

function formatMetricsMarkdown(rows = [], coldReportNote = "") {
  const lines = [
    "# Dual-Track Full-Vault & Hydrogen Experiment Metrics",
    "",
    coldReportNote ? `> ${coldReportNote}` : "",
    "",
    "| Scenario | Arm | Model | Raw | Survived | Final | Collisions | Halluc/TV | Rule/Stream Fails | T1 Final Overlap | T1 Shortlist Overlap | Median Votes | 2024+ | Cold (collab=0) | Mean collabSim | Latency (ms) | Prompt / Out Tokens |",
    "| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
  ].filter(Boolean);

  for (const r of rows) {
    lines.push(
      `| ${r.scenarioId} | ${r.armName} | ${r.model} | ${r.rawCount} | ${r.survivedCount} | ${r.finalCount} | ${r.collisionCount} | ${r.hallucinationOrTvCount} | ${r.constraintViolationCount} | ${r.overlapWithTrack1Final} | ${r.overlapWithTrack1Shortlist} | ${r.medianVoteCount} | ${r.recent2024PlusCount} | ${r.coldCollabCount} | ${r.meanCollabSimAll} | ${r.latencyMs} | ${r.promptTokens} / ${r.outputTokens} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

function loadCheckpoint(filePath) {
  if (!fs.existsSync(filePath)) return { completed: {} };
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { completed: {} };
  }
}

function saveCheckpoint(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function runScoreMode(opts) {
  if (!opts.scorePath || !opts.keyPath) {
    console.error("Usage: --score <ballot.md> --key <blind_key.json>");
    process.exit(1);
  }
  const md = fs.readFileSync(path.resolve(process.cwd(), opts.scorePath), "utf8");
  const key = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), opts.keyPath), "utf8"));
  const res = scoreBlindBallot(md, key);
  const outPath = path.join(path.dirname(path.resolve(process.cwd(), opts.scorePath)), "scored_summary.md");
  fs.writeFileSync(outPath, res.summaryMarkdown, "utf8");
  console.log(res.summaryMarkdown);
  console.log(`Saved unblinded summary to ${outPath}`);
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  const opts = parseCliArgs(process.argv.slice(2));

  if (opts.scorePath) {
    await runScoreMode(opts);
    return;
  }

  const vaultFile = path.resolve(process.cwd(), opts.vaultPath);
  if (!fs.existsSync(vaultFile)) {
    console.error(`Vault file not found: ${vaultFile}`);
    process.exit(1);
  }
  const rawVault = fs.readFileSync(vaultFile, "utf8");
  const parsedRaw = JSON.parse(rawVault);
  const { watched, watchlist } = parseJsonBackupContent(rawVault);
  const prefs = parsedRaw?.preferences || {};

  const tieredVault = formatTieredVault(watched, watchlist, prefs);
  const scenariosAll = getRoundScenarios(opts.round, prefs);
  const scenarios = opts.scenario
    ? scenariosAll.filter((s) => s.id === opts.scenario)
    : scenariosAll;

  if (scenarios.length === 0) {
    console.error(`No matching scenario for --round ${opts.round} --scenario ${opts.scenario}`);
    process.exit(1);
  }

  const totalBatches = scenarios.reduce((sum, s) => sum + (s.batches || 1), 0);
  const hydrogenCallsNeeded = totalBatches * 2;
  const flashCallsNeeded = opts.round === 1 ? totalBatches * 2 : totalBatches;

  console.log("=== Dual-Track Experiment Plan ===");
  console.log(`Vault: ${vaultFile}`);
  console.log(`Stats: ${tieredVault.stats.movieCount} movies (${tieredVault.stats.ratedMovieCount} rated, mean ${tieredVault.stats.meanRating}/10), ${tieredVault.stats.seriesCount} series, ${tieredVault.stats.watchlistCount} watchlist`);
  console.log(`Tiered Vault Size: ${tieredVault.stats.charLength} chars (~${tieredVault.stats.estimatedTokens} tokens)`);
  console.log(`Round ${opts.round}: ${scenarios.map((s) => s.id).join(", ")}`);
  console.log(`Estimated API Budget: ${hydrogenCallsNeeded} Hydrogen calls + ${flashCallsNeeded} Flash-Lite calls`);

  if (opts.dryRun) {
    console.log("\n--- Formatted Vault Preview (first 35 lines) ---");
    console.log(tieredVault.text.split("\n").slice(0, 35).join("\n"));
    return;
  }

  const geminiKey = process.env.VITE_GEMINI_KEY?.trim();
  const tmdbKey = process.env.VITE_TMDB_KEY?.trim();
  if (!geminiKey || !tmdbKey) {
    console.error(`Missing required .env keys: VITE_GEMINI_KEY=${Boolean(geminiKey)} VITE_TMDB_KEY=${Boolean(tmdbKey)}`);
    process.exit(1);
  }

  const binPath = path.join(ROOT, "public/models/item_embeddings_f16.bin");
  const binBuf = fs.readFileSync(binPath);
  const embeddingIndex = parseEmbeddingBinary(
    binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength)
  );
  const profile = await extractTasteProfile(watched, watchlist);
  const collabSimMap = buildCollabSimMapFromIndex(profile.weightedRatings, embeddingIndex);

  const realAi = new GoogleGenAI({ apiKey: geminiKey, httpOptions: { timeout: 65_000 } });
  const outDir = path.resolve(process.cwd(), opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const checkpointPath = path.join(outDir, `checkpoint_round${opts.round}.json`);
  const checkpoint = opts.resume ? loadCheckpoint(checkpointPath) : { completed: {} };

  const allMetricRows = [];
  const ballotScenarios = [];
  const thesesByScenario = {};

  for (const sc of scenarios) {
    const batches = sc.batches || 1;
    const batchExcludeIds = [];
    const batchExcludeMovies = [];
    const batchExcludeTitles = [];

    for (let b = 1; b <= batches; b++) {
      const batchTag = batches > 1 ? `${sc.id}_b${b}` : sc.id;
      const batchLabel = batches > 1 ? `${sc.label} — Batch ${b}/${batches}` : sc.label;
      console.log(`\n>>> Running ${batchLabel}...`);

      // --- ARM 1: Current CinemaVault (Track 1) locked to Hydrogen ---
      const arm1Key = `${batchTag}::track1_math_hydrogen`;
      let arm1Data = checkpoint.completed[arm1Key];
      if (!arm1Data) {
        let cachedCandidates = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          await paceModelCall(HYDROGEN_MODEL);
          resetSessionWorkingModels();
          let diagnostics = null;
          const strictAi = createStrictSingleModelClient(realAi, HYDROGEN_MODEL);
          const t0 = Date.now();
          const res1 = await getMovieRecommendations(watched, watchlist, null, {
            aiClient: strictAi,
            personalMode: true,
            mood: sc.mood,
            moodFilters: sc.moodFilters,
            excludeIds: [...batchExcludeIds],
            userRegion: sc.userRegion,
            userProviders: sc.userProviders,
            tasteRules: sc.tasteRules,
            embeddingIndex,
            contentIndex: null,
            dnaIndex: null,
            ...(cachedCandidates ? { candidates: cachedCandidates, injectEmbeddingNeighbors: false } : {}),
            onDiagnostics: (d) => {
              diagnostics = d;
            }
          });
          const totalLatencyMs = Date.now() - t0;
          const llmStats = strictAi.getLastStats();
          if (diagnostics?.mergedCandidates?.length >= 6) {
            cachedCandidates = diagnostics.mergedCandidates;
          }
          if (diagnostics?.model === HYDROGEN_MODEL) {
            arm1Data = {
              finalPicks: res1.recommendations || [],
              shortlist: diagnostics?.topCandidates || [],
              model: diagnostics.model,
              latencyMs: totalLatencyMs,
              llmLatencyMs: llmStats.latencyMs,
              usageMetadata: llmStats.usageMetadata || diagnostics?.usageMetadata || null
            };
            break;
          }
          if (attempt < 3) {
            const backoffMs = attempt * 15_000;
            console.log(`  [Retry ${attempt}/2] Track 1 Hydrogen did not complete (got model=${diagnostics?.model}); waiting ${backoffMs / 1000}s...`);
            await sleep(backoffMs);
          } else {
            throw new Error(`Track 1 failed strict Hydrogen lock after 3 attempts (got model=${diagnostics?.model})`);
          }
        }
        checkpoint.completed[arm1Key] = arm1Data;
        saveCheckpoint(checkpointPath, checkpoint);
        console.log(`  [Arm 1] Track 1 Hydrogen done: ${arm1Data.finalPicks.length} picks (${arm1Data.latencyMs}ms)`);
      } else {
        console.log(`  [Arm 1] Loaded from checkpoint (${arm1Data.finalPicks.length} picks)`);
      }

      const track1FinalIds = new Set(arm1Data.finalPicks.map((p) => Number(p.tmdbId ?? p.id)).filter((n) => n > 0));
      const track1ShortlistIds = new Set(arm1Data.shortlist.map((p) => Number(p.tmdbId ?? p.id)).filter((n) => n > 0));

      const arm1Metrics = computeArmMetrics({
        armName: "track1_math_hydrogen",
        model: HYDROGEN_MODEL,
        rawCount: arm1Data.shortlist.length,
        finalPicks: arm1Data.finalPicks,
        track1FinalIds,
        track1ShortlistIds,
        collabSimMap,
        latencyMs: arm1Data.latencyMs,
        usageMetadata: arm1Data.usageMetadata
      });
      allMetricRows.push({ scenarioId: batchTag, ...arm1Metrics });

      const moodInfo = getMoodSummaryForPrompt(sc.mood, sc.moodFilters);
      const fullVaultPrompt = buildFullVaultPrompt({
        vaultText: tieredVault.text,
        moodLabel: moodInfo.preset.label,
        moodDirective: moodInfo.preset.promptDirective,
        vibeConstraints: moodInfo.vibeConstraints,
        tasteRules: sc.tasteRules,
        region: sc.userRegion,
        providers: sc.userProviders,
        excludeTitles: batchExcludeTitles,
        requestedCount: sc.rawRequestCount,
        blindspotCount: sc.blindspotCount
      });
      const fullVaultSchema = buildFullVaultResponseSchema({ includeThesis: true });

      // --- ARM 2: Idea A + C (Full-Vault Hydrogen HIGH) ---
      const arm2Key = `${batchTag}::arm2_fullvault_hydrogen`;
      let arm2Data = checkpoint.completed[arm2Key];
      if (!arm2Data) {
        const t0 = Date.now();
        const { parsed, usageMetadata } = await generateStrictJson(
          realAi,
          HYDROGEN_MODEL,
          fullVaultPrompt,
          fullVaultSchema,
          "curation"
        );
        const rawPicks = Array.isArray(parsed?.recommendations) ? parsed.recommendations : [];
        const verified = await verifyGenerativePicks(rawPicks, {
          watched,
          watchlist,
          excludeIds: batchExcludeIds,
          excludeMovies: batchExcludeMovies,
          mood: sc.mood,
          moodFilters: sc.moodFilters,
          userRegion: sc.userRegion,
          userProviders: sc.userProviders,
          tasteRules: sc.tasteRules,
          collabSimMap
        });
        arm2Data = {
          tasteThesis: parsed?.tasteThesis || null,
          rawCount: rawPicks.length,
          verified,
          finalPicks: verified.survivors.slice(0, 10),
          latencyMs: Date.now() - t0,
          usageMetadata
        };
        checkpoint.completed[arm2Key] = arm2Data;
        saveCheckpoint(checkpointPath, checkpoint);
        console.log(`  [Arm 2] Full-Vault Hydrogen done: ${verified.survivors.length}/${rawPicks.length} survived (${arm2Data.latencyMs}ms)`);
      } else {
        console.log(`  [Arm 2] Loaded from checkpoint (${arm2Data.finalPicks.length} picks)`);
      }

      thesesByScenario[batchTag] = arm2Data.tasteThesis;
      allMetricRows.push({
        scenarioId: batchTag,
        ...computeArmMetrics({
          armName: "arm2_fullvault_hydrogen",
          model: HYDROGEN_MODEL,
          rawCount: arm2Data.rawCount,
          verifiedReport: arm2Data.verified,
          finalPicks: arm2Data.finalPicks,
          track1FinalIds,
          track1ShortlistIds,
          collabSimMap,
          latencyMs: arm2Data.latencyMs,
          usageMetadata: arm2Data.usageMetadata
        })
      });

      // --- ARM 3: Full-Vault Flash-Lite ---
      const arm3Key = `${batchTag}::arm3_fullvault_flashlite`;
      let arm3Data = null;
      if (opts.round === 1) {
        arm3Data = checkpoint.completed[arm3Key];
        if (!arm3Data) {
          const t0 = Date.now();
          const { parsed, usageMetadata } = await generateStrictJson(
            realAi,
            FLASH_LITE_MODEL,
            fullVaultPrompt,
            fullVaultSchema,
            "curation"
          );
          const rawPicks = Array.isArray(parsed?.recommendations) ? parsed.recommendations : [];
          const verified = await verifyGenerativePicks(rawPicks, {
            watched,
            watchlist,
            excludeIds: batchExcludeIds,
            excludeMovies: batchExcludeMovies,
            mood: sc.mood,
            moodFilters: sc.moodFilters,
            userRegion: sc.userRegion,
            userProviders: sc.userProviders,
            tasteRules: sc.tasteRules,
            collabSimMap
          });
          arm3Data = {
            tasteThesis: parsed?.tasteThesis || null,
            rawCount: rawPicks.length,
            verified,
            finalPicks: verified.survivors.slice(0, 10),
            latencyMs: Date.now() - t0,
            usageMetadata
          };
          checkpoint.completed[arm3Key] = arm3Data;
          saveCheckpoint(checkpointPath, checkpoint);
          console.log(`  [Arm 3] Full-Vault Flash-Lite done: ${verified.survivors.length}/${rawPicks.length} survived (${arm3Data.latencyMs}ms)`);
        } else {
          console.log(`  [Arm 3] Loaded from checkpoint (${arm3Data.finalPicks.length} picks)`);
        }

        allMetricRows.push({
          scenarioId: batchTag,
          ...computeArmMetrics({
            armName: "arm3_fullvault_flashlite",
            model: FLASH_LITE_MODEL,
            rawCount: arm3Data.rawCount,
            verifiedReport: arm3Data.verified,
            finalPicks: arm3Data.finalPicks,
            track1FinalIds,
            track1ShortlistIds,
            collabSimMap,
            latencyMs: arm3Data.latencyMs,
            usageMetadata: arm3Data.usageMetadata
          })
        });
      }

      // --- ARM 4: Idea B (Hydrogen Dossier + Flash-Lite on Track 1 Shortlist) ---
      const arm4Key = `${batchTag}::arm4_dossier_flashlite`;
      let arm4Data = checkpoint.completed[arm4Key];
      if (!arm4Data) {
        const basePrompt = buildGeminiReRankPrompt(profile, sc.mood, arm1Data.shortlist, {
          watched,
          watchlist,
          embeddingIndex,
          tasteRules: sc.tasteRules,
          moodFilters: sc.moodFilters,
          targetCount: 10
        });
        const dossierPrompt = buildDossierCurationPrompt(basePrompt, arm2Data.tasteThesis);
        const t0 = Date.now();
        const { parsed, usageMetadata } = await generateStrictJson(
          realAi,
          FLASH_LITE_MODEL,
          dossierPrompt,
          buildTrack1ReRankConfig().responseSchema,
          "curation"
        );
        const merged = mergeGeminiExplanationsWithRanker(parsed, arm1Data.shortlist, profile, {
          watched,
          targetCount: 10,
          verifiedWildcards: []
        });
        arm4Data = {
          finalPicks: merged.recommendations || [],
          latencyMs: Date.now() - t0,
          usageMetadata
        };
        checkpoint.completed[arm4Key] = arm4Data;
        saveCheckpoint(checkpointPath, checkpoint);
        console.log(`  [Arm 4] Hydrogen Dossier + Flash-Lite done: ${arm4Data.finalPicks.length} picks (${arm4Data.latencyMs}ms)`);
      } else {
        console.log(`  [Arm 4] Loaded from checkpoint (${arm4Data.finalPicks.length} picks)`);
      }

      allMetricRows.push({
        scenarioId: batchTag,
        ...computeArmMetrics({
          armName: "arm4_dossier_flashlite",
          model: FLASH_LITE_MODEL,
          rawCount: arm1Data.shortlist.length,
          finalPicks: arm4Data.finalPicks,
          track1FinalIds,
          track1ShortlistIds,
          collabSimMap,
          latencyMs: arm4Data.latencyMs,
          usageMetadata: arm4Data.usageMetadata
        })
      });

      const scenarioArms = {
        track1_math_hydrogen: arm1Data.finalPicks,
        arm2_fullvault_hydrogen: arm2Data.finalPicks,
        ...(arm3Data ? { arm3_fullvault_flashlite: arm3Data.finalPicks } : {}),
        arm4_dossier_flashlite: arm4Data.finalPicks
      };
      ballotScenarios.push({
        scenarioId: batchTag,
        scenarioLabel: batchLabel,
        arms: scenarioArms
      });

      if (batches > 1) {
        const allPicked = Object.values(scenarioArms).flat();
        for (const p of allPicked) {
          const tid = Number(p?.tmdbId ?? p?.id ?? 0);
          if (tid > 0 && !batchExcludeIds.includes(tid)) batchExcludeIds.push(tid);
          batchExcludeMovies.push(p);
          const label = `${cleanStr(p?.title)} (${cleanStr(p?.year)})`;
          if (p?.title && !batchExcludeTitles.includes(label)) batchExcludeTitles.push(label);
        }
      }
    }
  }

  const ballot = buildCombinedTwoPassBallot(ballotScenarios);
  const metricsJsonPath = path.join(outDir, `metrics_report_round${opts.round}.json`);
  const metricsMdPath = path.join(outDir, `metrics_summary_round${opts.round}.md`);
  const thesesPath = path.join(outDir, `hydrogen_theses_round${opts.round}.json`);
  const ballotMdPath = path.join(outDir, `blind_ballot_round${opts.round}.md`);
  const keyJsonPath = path.join(outDir, `blind_key_round${opts.round}.json`);

  fs.writeFileSync(
    metricsJsonPath,
    JSON.stringify({ vaultStats: tieredVault.stats, rows: allMetricRows }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    metricsMdPath,
    formatMetricsMarkdown(allMetricRows, `Vault: ${tieredVault.stats.movieCount} movies (~${tieredVault.stats.estimatedTokens} tokens)`),
    "utf8"
  );
  fs.writeFileSync(thesesPath, JSON.stringify(thesesByScenario, null, 2), "utf8");
  fs.writeFileSync(ballotMdPath, ballot.markdown, "utf8");
  fs.writeFileSync(keyJsonPath, JSON.stringify(ballot.key, null, 2), "utf8");

  console.log("\n=== Experiment Complete ===");
  console.log(`Metrics table: ${metricsMdPath}`);
  console.log(`Hydrogen Taste Theses: ${thesesPath}`);
  console.log(`Blind Ballot (score this!): ${ballotMdPath}`);
  console.log(`Answer Key (do NOT peek until scored!): ${keyJsonPath}`);
}

await main();
