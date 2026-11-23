#!/usr/bin/env node
/**
 * Task 5: 20-User Leakage-Clean LLM Holdout A/B/C for Math-Anchored Curation (`100 -> 20`)
 *
 * Compares on 20 completely unseen MovieLens 32M users using the v6 EASE^R + SVD shortlist (100 -> 20):
 *   - Pure Math Top-20 (ceiling reference)
 *   - Control A: Current production prompt ("Curate openly" over 100 candidates)
 *   - Treatment B: Math-Anchored Prompt ("any" vibe only; tags top 8 core candidates with [Strong Vault Signal])
 *   - Treatment C: Soft Hybrid Merge (Treatment B prompt + top 4 math picks protected unless avoided/capped)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GoogleGenAI, Type } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const {
  loadCleanCohort,
  loadEaseIndexFromPath,
  pairedBootstrap
} = await imp("scripts/experiments/v6_gate_eval.mjs");
const {
  buildEaseSimMapFromIndex,
  blendEaseAndCollabSimMaps
} = await imp("src/services/easeService.js");
const {
  buildDiversifiedGeminiShortlist,
  DEFAULT_RANKER_WEIGHTS
} = await imp("src/services/rankerService.js");
const {
  buildGeminiReRankPrompt,
  mergeGeminiExplanationsWithRanker,
  getModelThinkingConfig,
  sanitizeAndParseJSON
} = await imp("src/services/geminiService.js");
const { computeNDCGAtK } = await imp("src/services/evalHarness.js");

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildSchema() {
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
              anchorTitles: { type: Type.ARRAY, items: { type: Type.STRING } },
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

function addMathAnchorCues(promptText, topCoreIds) {
  const coreSet = new Set(topCoreIds.map(String));
  const tagged = promptText.replace(/^(ID:\s*(\d+)\s*\|.*)$/gm, (line, _full, idStr) => {
    return coreSet.has(idStr) ? `${line} | [Strong Vault Signal]` : line;
  });
  return tagged.replace(
    "- Curate openly: Every listed candidate already cleared availability and safety filters. Judge picks across the full list equally on tone, pacing, directorial voice, plots, user notes, and diversity.",
    "- Math-Anchored Curation (Any Vibe): Candidates marked [Strong Vault Signal] are the viewer's highest-confidence collaborative & taste matches. Keep most of these strong core matches in your final 20 unless a specific film clashes with their dislikes, near-misses, or taste rules — do NOT replace strong franchise/cluster matches with generic IMDb classics. Spend your creative discretion on the remaining discovery slots and wildcards."
  );
}

async function callGeminiWithRetry(ai, model, contents, maxRetries = 4) {
  const thinkingConfig = getModelThinkingConfig(model);
  const config = { ...buildSchema(), ...(thinkingConfig ? { thinkingConfig } : {}) };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await ai.models.generateContent({ model, contents, config });
      return sanitizeAndParseJSON(res.text);
    } catch (err) {
      const msg = String(err?.message || err);
      if (attempt < maxRetries && /503|504|429|UNAVAILABLE|overloaded|timeout/i.test(msg)) {
        await sleep(2500 * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
}

function scoreRecs(recs, u, top200PopSet) {
  const ids = recs.slice(0, 20).map((r) => String(r.tmdbId ?? r.id));
  const ndcg10 = computeNDCGAtK(ids, u.holdoutRelevance, 10);
  const ndcg20 = computeNDCGAtK(ids, u.holdoutRelevance, 20);
  let hits10 = 0, hits20 = 0, tail20 = 0;
  for (let k = 0; k < ids.length; k++) {
    if (u.holdoutPositives.has(ids[k])) {
      if (k < 10) hits10++;
      if (k < 20) { hits20++; if (!top200PopSet.has(ids[k])) tail20++; }
    }
  }
  return { ndcg10, ndcg20, hits10, hits20, tail20, hr20: hits20 > 0 ? 1 : 0, ids };
}

function softProtectTopK(geminiRecs, rankedCandidates, protectK = 4, targetCount = 20) {
  const protectedPicks = rankedCandidates.slice(0, protectK);
  const out = [...protectedPicks];
  const seen = new Set(out.map((m) => Number(m.tmdbId ?? m.id)));
  for (const r of geminiRecs) {
    const id = Number(r.tmdbId ?? r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
    if (out.length >= targetCount) break;
  }
  out.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));
  return out.slice(0, targetCount);
}

async function main() {
  loadDotEnv(path.join(ROOT, ".env"));
  loadDotEnv(path.join(ROOT, ".env.local"));
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY / VITE_GEMINI_KEY");

  const args = process.argv.slice(2);
  let userCount = 20;
  let easePath = ".data/v6_lab/ease_v6_baseline_clean.cvea";
  let model = "gemini-3.5-flash-lite";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--users" && args[i + 1]) userCount = Number(args[++i]);
    else if (args[i] === "--ease" && args[i + 1]) easePath = args[++i];
    else if (args[i] === "--model" && args[i + 1]) model = args[++i];
  }

  const ai = new GoogleGenAI({ apiKey });
  const cohort = await loadCleanCohort(".data/item_embeddings_clean2_f16.bin", 300);
  const easeLoaded = loadEaseIndexFromPath(easePath);
  // Pick 20 diverse users from Holdout-150 (150..299) spaced evenly so zero overlap with Dev-150!
  const selected = [];
  for (let i = 0; i < userCount; i++) {
    selected.push(cohort.users[150 + Math.floor((i * 150) / userCount)]);
  }

  const ckptPath = path.join(ROOT, ".data/v6_lab/math_anchor_llm_ckpt.json");
  const ckpt = fs.existsSync(ckptPath) ? JSON.parse(fs.readFileSync(ckptPath, "utf8")) : { users: {} };

  for (let i = 0; i < selected.length; i++) {
    const u = selected[i];
    const key = String(u.uid);
    if (ckpt.users[key]?.controlA && ckpt.users[key]?.treatmentB) continue;

    const easeMap = buildEaseSimMapFromIndex(u.profile.weightedRatings, easeLoaded.idx);
    const collabSimMap = blendEaseAndCollabSimMaps(easeMap, u.svdMap, easeLoaded.idx);
    const shortlist = buildDiversifiedGeminiShortlist(
      u.pool,
      { profile: u.profile, collabSimMap, repulsionMap: u.repulsionMap },
      DEFAULT_RANKER_WEIGHTS,
      { shortlistLimit: 100 },
      null
    );
    const mathTop20 = scoreRecs(shortlist.slice(0, 20), u, cohort.top200PopSet);
    const basePrompt = buildGeminiReRankPrompt(u.profile, "any", shortlist, {
      watched: u.profile.weightedRatings.map((w) => w.movie),
      watchlist: [],
      targetCount: 20
    });
    const anchoredPrompt = addMathAnchorCues(basePrompt, shortlist.slice(0, 8).map((c) => c.tmdbId));

    process.stdout.write(`[${i + 1}/${selected.length}] User ${key} ... `);
    const rawA = await callGeminiWithRetry(ai, model, basePrompt);
    const mergedA = mergeGeminiExplanationsWithRanker(rawA, shortlist, u.profile, { watched: [] }, 20).recommendations;
    await sleep(1200);
    const rawB = await callGeminiWithRetry(ai, model, anchoredPrompt);
    const mergedB = mergeGeminiExplanationsWithRanker(rawB, shortlist, u.profile, { watched: [] }, 20).recommendations;
    const mergedC = softProtectTopK(mergedB, shortlist, 4, 20);
    await sleep(1200);

    const scA = scoreRecs(mergedA, u, cohort.top200PopSet);
    const scB = scoreRecs(mergedB, u, cohort.top200PopSet);
    const scC = scoreRecs(mergedC, u, cohort.top200PopSet);
    ckpt.users[key] = { mathTop20, controlA: scA, treatmentB: scB, treatmentC: scC };
    fs.mkdirSync(path.dirname(ckptPath), { recursive: true });
    fs.writeFileSync(ckptPath, JSON.stringify(ckpt, null, 2));
    console.log(`Math=${mathTop20.hits20}(${mathTop20.ndcg20.toFixed(3)}) | A=${scA.hits20}(${scA.ndcg20.toFixed(3)}) | B=${scB.hits20}(${scB.ndcg20.toFixed(3)}) | C=${scC.hits20}(${scC.ndcg20.toFixed(3)})`);
  }

  const rows = selected.map((u) => ckpt.users[String(u.uid)]).filter(Boolean);
  const summarize = (k) => {
    const denom = Math.max(1, rows.length);
    const m = (f) => rows.reduce((a, r) => a + r[k][f], 0) / denom;
    return {
      ndcg10: Number(m("ndcg10").toFixed(4)),
      ndcg20: Number(m("ndcg20").toFixed(4)),
      hits10: Number(m("hits10").toFixed(3)),
      hits20: Number(m("hits20").toFixed(3)),
      tail20: Number(m("tail20").toFixed(3)),
      hr20: Number((m("hr20") * 100).toFixed(1))
    };
  };
  const sM = summarize("mathTop20"), sA = summarize("controlA"), sB = summarize("treatmentB"), sC = summarize("treatmentC");
  const bB = pairedBootstrap(rows.map((r) => r.treatmentB.ndcg20), rows.map((r) => r.controlA.ndcg20));
  const bC = pairedBootstrap(rows.map((r) => r.treatmentC.ndcg20), rows.map((r) => r.controlA.ndcg20));

  console.log(`\n=== 20-USER LLM CURATION A/B/C (${model}) ===`);
  console.log("Pure Math Top-20:     ", sM);
  console.log("Control A (Open 100): ", sA);
  console.log("Treatment B (Anchor): ", sB, `boot20=[${bB.ciLower.toFixed(4)}, ${bB.ciUpper.toFixed(4)}] sig=${bB.positiveSig}`);
  console.log("Treatment C (Protect):", sC, `boot20=[${bC.ciLower.toFixed(4)}, ${bC.ciUpper.toFixed(4)}] sig=${bC.positiveSig}`);
}

main();
