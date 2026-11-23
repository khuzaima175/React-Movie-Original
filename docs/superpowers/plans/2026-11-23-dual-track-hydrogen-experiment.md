# Dual-Track Full-Vault & Gemini 4 Hydrogen Experiment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a zero-risk, blind-scored 4-arm benchmark comparing CinemaVault's current hybrid retrieval+curation pipeline against full-vault Gemini 4 Hydrogen (`HIGH` thinking + taste psychoanalysis), full-vault Gemini 3.5 Flash-Lite, and a Hydrogen-Dossier + Flash-Lite hybrid before touching any production app code.

**Architecture:** All pure formatting, prompt-building, instrumented TMDB verification, metric aggregation, and two-pass blind ballot generation/scoring live in a unit-tested helper module (`scripts/experiments/dual_track_utils.mjs`). A thin CLI runner (`scripts/experiments/ab_dual_track.mjs`) loads the exported Schema v2 vault backup and local `item_embeddings_f16.bin` from disk, executes strict single-model locked runs with 16-second RPM pacing and per-arm JSON checkpointing, and writes objective metrics plus a two-pass blind ballot to `scripts/experiments/results/dual_track/`.

**Tech Stack:** Node.js ESM (`node --test`), `@google/genai`, existing CinemaVault services (`src/services/geminiService.js`, `src/services/tmdbService.js`, `src/services/rankerService.js`, `src/services/embeddingService.js`, `src/services/moodPolicy.js`, `src/services/tasteRulesService.js`, `src/services/movieIdentity.js`, `src/services/vaultPortability.js`).

**Spec:** Conversation-agreed 4-arm Dual-Track experiment incorporating Idea A (Hydrogen `tasteThesis` psychoanalysis + blindspot picks), Idea B (Hydrogen Dossier -> Flash-Lite curation), and Idea C (upgraded tiered vault format with Directors, separate Series/Anime block, and 2024–2026 taste drift).

---

## Global Constraints

- **Zero production edits:** Do not modify any file under `src/` during the experiment phase.
- **Exact model & thinking lock:** Never allow silent cascade fallback between models during benchmark runs. Lock `gemini-4-hydrogen` to `thinkingConfig: { thinkingLevel: "HIGH" }` and `gemini-3.5-flash-lite` to `thinkingConfig: { thinkingLevel: "LOW" }` matching `getModelThinkingConfig` in `src/services/geminiService.js:134-155`.
- **Quota safety (Hydrogen = 5 RPM / 250K TPM / 20 RPD):** Round 1 MUST consume at most **4 Gemini 4 Hydrogen calls** and **4 Gemini 3.5 Flash-Lite calls**, with `MIN_HYDROGEN_GAP_MS = 16000` spacing between live Hydrogen calls and per-arm disk checkpoints (`--resume`).
- **Two-pass blinding:** Pass 1 shows only Title, Year, Director, Genres, and TMDB Overview (no track labels, no match %, no AI prose) to score Excitement & Discovery; Pass 2 reveals anonymized explanations (`Pitch A`, `Pitch B`, ...) to score Taste Understanding without prose-style leakage.
- **Default test vault:** `.data/cinemavault-backup-2026-11-20.json` (135 watched including 8 series, 9 watchlist), overridable via `--vault <path>`.
- **Output location:** `scripts/experiments/results/dual_track/` (gitignored or kept local with experiment outputs; never commit `.env` or raw API keys).

## Review Focus

- **Silent model fallback in Track 1:** `reRankCandidatesWithGemini` defaults to `PUBLIC_CURATION_CASCADE` (`gemini-3.5-flash-lite` first) in Node unless `personalMode: true` is set, and `executeCascade` silently falls back on timeout/429. Verify Track 1 inspects `diagnostics.model` and aborts/marks invalid if `model !== "gemini-4-hydrogen"`.
- **Wildcard attribution leak in Track 1:** Track 1 already injects up to `MAX_WILDCARD_PICKS = 2` Gemini wildcards (`sourceBucket === "Gemini Wildcard"`). Log every Track 1 pick's `sourceBucket` so wildcard hits aren't miscredited to TMDB/math retrieval.
- **Silent truncation & pool exclusion in `verifyAndScoreWildcardPicks`:** Do not call `verifyAndScoreWildcardPicks` with default `maxWildcards = 2` or pass Track 1's candidate pool in `existingCandidates`. Use `verifyGenerativePicks` so all 15 raw picks get explicit drop reasons (`collision_watched`, `collision_watchlist`, `hallucinated_or_unmatched`, `tv_series`, `failed_provider`, `failed_mood`, `failed_avoid`, `survived`).
- **Multi-arm duplicate movies in the blind ballot:** When two or more arms pick the exact same TMDB movie, the movie must appear **once** in Pass 1 (with every contributing arm credited in `blind_key.json`) and have separate anonymized pitches in Pass 2 so scoring never double-counts or loses credit.
- **Node disk loading of CVEM binary index:** Browser `loadDefaultEmbeddingIndex()` calls `fetch("/models/item_embeddings_f16.bin")` which fails in Node. Load `public/models/item_embeddings_f16.bin` with `fs.readFileSync` + `parseEmbeddingBinary` and pass `embeddingIndex`, `contentIndex: null`, `dnaIndex: null` explicitly.

---

## File Map

| File | Responsibility |
| :--- | :--- |
| `scripts/experiments/dual_track_utils.mjs` | Pure helpers: tiered vault formatter (Idea C), Full-Vault + `tasteThesis` prompt/schema (Idea A), Dossier prompt injector (Idea B), instrumented TMDB pick verifier, hard-metrics calculator, two-pass blind ballot builder & score parser. |
| `tests/dualTrackExperiment.test.js` | Unit tests covering all pure functions in `dual_track_utils.mjs` and every edge case in Review Focus. |
| `scripts/experiments/ab_dual_track.mjs` | CLI orchestrator for Round 1 (2 scenarios × 4 arms = 4 Hydrogen + 4 Flash-Lite calls), optional Round 2 (PK streaming filter + 3-turn refresh fatigue), `--resume` checkpointing, and `--score` unblinding report. |

---

## Experiment Design Summary

### Round 1 (Default — ~3–4 min runtime, 4 Hydrogen calls + 4 Flash-Lite calls)

Run **2 Scenarios** (no streaming filter so taste quality isn't confounded by live regional catalog licensing):
1. **Scenario A (`any_vibe`):** `"Any Vibe"` — pure open taste discovery.
2. **Scenario B1 (`poetic_vibe`):** Custom vibe query `"quiet, melancholic late-night detective mystery, pre-2010, no horror"` (`mood: "any"`, `moodFilters: { query: "...", maxYear: 2009, withoutKeywords: ["horror"] }`).

Across **4 Arms** per scenario:
1. **`track1_math_hydrogen` (Baseline):** Current CinemaVault (`getMovieRecommendations` with `personalMode: true`, disk-loaded CVEM v1 index, strict check that `diagnostics.model === "gemini-4-hydrogen"`). Captures the 39-candidate shortlist, final 10 picks, and `sourceBucket` per pick.
2. **`arm2_fullvault_hydrogen` (Idea A + C):** Compact tiered full vault (with Directors, separate Series/Anime section, `[YYYY-MM]` newest-first) → `gemini-4-hydrogen` (`thinkingLevel: "HIGH"`) generating a structured `tasteThesis` (3 hidden attractors, 3 near-miss traps, 3 dealbreakers, taste-drift note) + 15 movie picks (including 3 explicitly tagged blindspot picks) → instrumented TMDB verifier → top 10 valid survivors.
3. **`arm3_fullvault_flashlite` (Flash Full-Vault):** Exact same compact tiered full vault & prompt → `gemini-3.5-flash-lite` (`thinkingLevel: "LOW"`) → instrumented TMDB verifier → top 10 valid survivors.
4. **`arm4_dossier_flashlite` (Idea B — Production Hybrid):** Takes the ~600-token `tasteThesis` generated by Arm 2, injects it into Track 1's 39-candidate shortlist curation prompt, and runs `gemini-3.5-flash-lite` (`thinkingLevel: "LOW"`) to pick 10. Tests whether **running Hydrogen once to build a Taste Dossier + Flash-Lite for daily clicks** matches full Hydrogen quality.

### Optional Round 2 (`--round 2` — ~5 min runtime, 6 Hydrogen calls)
Only run after reviewing Round 1 scores if Full-Vault Hydrogen or Hybrid looks promising:
- **Scenario B2 (`pk_streaming`):** `dark-thriller` + `region: "PK"` + `providers: ["Netflix", "Amazon Prime Video"]` (asking Track 2 for 25 raw picks to measure real streaming survival yield vs. Track 1).
- **Scenario C (`refresh_3x`):** 3 sequential batches of 10 (`30` total movies), passing prior batches into `excludeIds` / `excludeTitles` to measure repeat fatigue and quality decay on Batches 2 & 3.

---

## Step-by-Step Implementation Tasks

### Task 1: Vault Cold-Share Baseline Check (Optional 10s Context)

**Files:**
- Read/Run existing: `scripts/experiments/vault_cold_share.mjs`

- [ ] **Step 1: Run the existing cold-share check on the exported backup**

Run:
```bash
node scripts/experiments/vault_cold_share.mjs --vault .data/cinemavault-backup-2026-11-20.json --exclude-series
```
Expected: Prints JSON/markdown summary showing what % of the 127 watched movies are inside `public/models/item_embeddings_f16.bin` vs. post-2023 cold movies. Save this number as baseline context for interpreting Track 1 vs. Arm 2.

---

### Task 2: Tiered Vault Formatter & Prompt/Schema Builders (Ideas A, B, C)

**Files:**
- Create: `scripts/experiments/dual_track_utils.mjs`
- Test: `tests/dualTrackExperiment.test.js`

**Interfaces:**
- Produces:
  - `formatTieredVault(watched, watchlist, prefs)` -> `{ text: string, stats: { movieCount, seriesCount, watchlistCount, meanRating, estimatedTokens } }`
  - `buildFullVaultPrompt(opts)` -> `string`
  - `buildFullVaultResponseSchema({ includeThesis?: boolean })` -> `object` (Gemini `responseSchema`)
  - `formatDossierBlock(tasteThesis)` -> `string`
  - `buildDossierCurationPrompt(baseReRankPrompt, tasteThesis)` -> `string`

- [ ] **Step 1: Write failing tests in `tests/dualTrackExperiment.test.js`**

Test cases to pin:
1. `formatTieredVault` groups movies into exact tiers (`10/10`, `9/10`, `8/10`, `6-7/10`, `<=5/10`), sorts newest `dateWatched` first within each tier, includes `Dir: ...` and `userNote`, separates `Type: "series"` into `=== LOVED SERIES / ANIME ===`, and lists watchlist items under `=== WATCHLIST (Already planned — DO NOT recommend) ===` without poster URLs.
2. `buildFullVaultPrompt` includes active mood/custom query, taste rules, exclude titles, 2024–2026 taste-drift instruction, blindspot instruction (`3` blindspot picks), and identical 1-sentence anti-jargon editorial prose rules as Track 1.
3. `formatDossierBlock` renders a compact `<= 2800` char (~700 token) Taste Manifesto block from `tasteThesis` (`hiddenAttractors`, `nearMissTraps`, `dealbreakers`, `tasteDrift`), and `buildDossierCurationPrompt` injects it cleanly before `PRE-RANKED CANDIDATE MOVIES`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dualTrackExperiment.test.js`
Expected: FAIL with module not found (`dual_track_utils.mjs`).

- [ ] **Step 3: Implement formatter, prompts, and schema in `scripts/experiments/dual_track_utils.mjs`**

Implement `formatTieredVault`, `buildFullVaultPrompt`, `buildFullVaultResponseSchema`, `formatDossierBlock`, and `buildDossierCurationPrompt`. Use `isSeriesVaultItem` from `src/services/tmdbService.js` for consistent series classification.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dualTrackExperiment.test.js`
Expected: PASS (all Task 2 tests green).

---

### Task 3: Instrumented Generative Pick Verifier & Hard Metrics

**Files:**
- Modify: `scripts/experiments/dual_track_utils.mjs`
- Modify: `tests/dualTrackExperiment.test.js`

**Interfaces:**
- Consumes: `findTmdbByTitleAndYear`, `fetchBatchFormattedDetailsMap`, `matchesWatchProviders`, `isSeriesVaultItem` from `src/services/tmdbService.js`; `isSameMovie` from `src/services/movieIdentity.js`; `matchesMoodCandidateGate`, `isExplicitMoodActive`, `normalizeMoodFilters` from `src/services/moodPolicy.js`; `compileActiveTasteRules`, `candidateMatchesAvoidRule` from `src/services/tasteRulesService.js`; `rankCandidatePool` from `src/services/rankerService.js`.
- Produces:
  - `verifyGenerativePicks(rawPicks, context, deps)` -> `Promise<{ survivors: Array, audit: Array<{ rawPick, status, tmdbId?, reason? }>, counts: Record<string, number> }>`
  - `computeArmMetrics({ armName, model, rawCount, verifiedReport, finalPicks, track1FinalIds, track1ShortlistIds, collabSimMap, latencyMs, usageMetadata })` -> `object`

- [ ] **Step 1: Write failing tests in `tests/dualTrackExperiment.test.js`**

Test cases using injected mock `finder` and `detailFetcher`:
1. Classifies every failure disposition accurately across a single batch without truncating at 2: `collision_watched`, `collision_watchlist`, `collision_excluded`, `hallucinated_or_unmatched`, `tv_series`, `duplicate_within_batch`, `failed_provider`, `failed_mood`, `failed_avoid`, and `survived`.
2. Keeps picks that overlap Track 1's candidate pool (does NOT drop them like `verifyAndScoreWildcardPicks` does).
3. `computeArmMetrics` computes collision rate, hallucination/TV rate, constraint violation rate, survival yield, overlap with Track 1 final-10 and Track 1 39-shortlist, median `vote_count`, count of 2024–2026 releases, and mean `collabSim` (for both all survivors and indexed-only survivors).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dualTrackExperiment.test.js`
Expected: FAIL (`verifyGenerativePicks` not exported).

- [ ] **Step 3: Implement `verifyGenerativePicks` and `computeArmMetrics` in `scripts/experiments/dual_track_utils.mjs`**

Ensure `verifyGenerativePicks` checks pre-TMDB watched/watchlist title+year collisions AND post-TMDB `tmdbId`/`imdbID` collisions via `isSameMovie`, checks `isSeriesVaultItem`, hydrates via `fetchBatchFormattedDetailsMap`, enforces provider/mood/avoid gates, and annotates each survivor with its CVEM `collabSim` (from `collabSimMap.get(tmdbId) ?? 0`) while keeping full `audit` entries for every raw pick.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dualTrackExperiment.test.js`
Expected: PASS.

---

### Task 4: Two-Pass Blind Ballot Builder & Automated Unblinding Scorer

**Files:**
- Modify: `scripts/experiments/dual_track_utils.mjs`
- Modify: `tests/dualTrackExperiment.test.js`

**Interfaces:**
- Produces:
  - `buildTwoPassBlindBallot({ scenarioId, scenarioLabel, arms, seed })` -> `{ markdown: string, key: object }`
  - `scoreBlindBallot(markdownText, blindKey)` -> `{ perArm: Record<string, object>, parsedMovies: number, unparsedMovies: number, summaryMarkdown: string }`

- [ ] **Step 1: Write failing tests in `tests/dualTrackExperiment.test.js`**

Test cases to pin:
1. Deduplicates identical `tmdbId` across multiple arms into a single Pass 1 movie entry (`Movie #N`), while recording all contributing arms in `key.movies[N].arms`.
2. Strips all arm names, `matchScore`, `sourceBucket`, and `isBlindspot` labels from the ballot markdown.
3. Pass 1 shows only Title, Year, Director, Genres, and Overview with fillable `Excitement: _/5` and `Discovery: _/5` slots; Pass 2 shows randomized anonymized `Pitch A`, `Pitch B` with `reason` + `anchorTitles` and fillable `Taste: _/5` slots.
4. `scoreBlindBallot` parses filled-in scores (`4/5`, `5`, `3.5/5`), credits every arm that recommended a shared movie for Pass 1 scores, credits the specific pitch's arm for Pass 2 Taste Understanding, and computes per-arm averages + Case 1/2/3 recommendation.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dualTrackExperiment.test.js`
Expected: FAIL (`buildTwoPassBlindBallot` not exported).

- [ ] **Step 3: Implement `buildTwoPassBlindBallot` and `scoreBlindBallot` in `scripts/experiments/dual_track_utils.mjs`**

Use a deterministic PRNG (`mulberry32`) seeded by scenario ID so runs are reproducible and Pass 2 pitch letters (`A`, `B`, ...) are shuffled independently per movie.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dualTrackExperiment.test.js`
Expected: PASS (all unit tests green).

---

### Task 5: CLI Runner Script `scripts/experiments/ab_dual_track.mjs`

**Files:**
- Create: `scripts/experiments/ab_dual_track.mjs`

**Interfaces:**
- CLI flags:
  - `--vault <path>` (default: `.data/cinemavault-backup-2026-11-20.json`)
  - `--round <1|2>` (default: `1`)
  - `--scenario <any_vibe|poetic_vibe|pk_streaming|refresh_3x>` (optional single-scenario filter)
  - `--resume` (skips already-checkpointed arms in `scripts/experiments/results/dual_track/checkpoint_<round>.json`)
  - `--dry-run` (formats vault, prints token estimate & exact call budget without calling Gemini/TMDB)
  - `--score <path-to-ballot.md> --key <path-to-blind-key.json>` (unblinds completed ballot and writes `scored_summary.md`)

- [ ] **Step 1: Implement `scripts/experiments/ab_dual_track.mjs`**

Key wiring details:
1. Load `.env` (`VITE_GEMINI_KEY`, `VITE_TMDB_KEY`) just like `scripts/experiments/run_phaseI3_model_eval.mjs:11-25`.
2. Load vault backup via `parseJsonBackupContent` from `src/services/vaultPortability.js`.
3. Load `public/models/item_embeddings_f16.bin` from disk via `fs.readFileSync` + `parseEmbeddingBinary` and pass `{ embeddingIndex, contentIndex: null, dnaIndex: null }` to `getMovieRecommendations`.
4. **Track 1 (Arm 1) strict model lock:** Call `getMovieRecommendations` with `personalMode: true` and `onDiagnostics` capturing `{ topCandidates, model, usageMetadata }`. Verify `diagnostics.model === "gemini-4-hydrogen"` — if a fallback happened, log an explicit warning and retry once after cooldown rather than silently mixing Flash-Lite into Arm 1. Record each pick's `sourceBucket` (`Gemini Wildcard` vs. math bucket).
5. **Arms 2 & 3 (Full-Vault Hydrogen & Flash-Lite):** Call `ai.models.generateContent` directly with exact model ID (`gemini-4-hydrogen` + `thinkingConfig: { thinkingLevel: "HIGH" }`; `gemini-3.5-flash-lite` + `thinkingConfig: { thinkingLevel: "LOW" }`) and `buildFullVaultResponseSchema`, then run `verifyGenerativePicks` (top 10 valid survivors).
6. **Arm 4 (Idea B — Hydrogen Dossier + Flash-Lite):** Reuse Track 1's exact `topCandidates` (39-shortlist), build the base prompt via `buildGeminiReRankPrompt`, inject Arm 2's `tasteThesis` via `buildDossierCurationPrompt`, run `gemini-3.5-flash-lite` (`thinkingLevel: "LOW"`), and merge via `mergeGeminiExplanationsWithRanker` (no extra TMDB calls needed!).
7. Enforce `MIN_HYDROGEN_GAP_MS = 16_000` between Hydrogen calls, write checkpoints after every arm, and emit:
   - `scripts/experiments/results/dual_track/metrics_report.json`
   - `scripts/experiments/results/dual_track/metrics_summary.md`
   - `scripts/experiments/results/dual_track/blind_ballot_round1.md`
   - `scripts/experiments/results/dual_track/blind_key_round1.json`

- [ ] **Step 2: Run `--dry-run` verification**

Run: `node scripts/experiments/ab_dual_track.mjs --dry-run`
Expected: Exits `0`, prints exact vault stats (127 movies, 8 series, 9 watchlist), estimated token count (~3,000 tokens), Hydrogen call count (`4 / 20`), Flash-Lite call count (`4`), and previews the formatted tiered vault header without making any network calls.

- [ ] **Step 3: Run full test suite to ensure zero regressions**

Run: `npm test`
Expected: All existing tests plus `tests/dualTrackExperiment.test.js` PASS.

---

### Task 6: Execute Round 1, Score Blindly, and Apply Decision Matrix

- [ ] **Step 1: Run Round 1 live experiment (~3–4 min, 4 Hydrogen + 4 Flash-Lite calls)**

Run: `node scripts/experiments/ab_dual_track.mjs --round 1`
Expected: Produces `metrics_summary.md`, `blind_ballot_round1.md`, and `blind_key_round1.json` under `scripts/experiments/results/dual_track/`.

- [ ] **Step 2: User scores `blind_ballot_round1.md` honestly (Pass 1 before Pass 2, without opening `blind_key_round1.json`)**

- [ ] **Step 3: Unblind and print decision matrix**

Run:
```bash
node scripts/experiments/ab_dual_track.mjs --score scripts/experiments/results/dual_track/blind_ballot_round1.md --key scripts/experiments/results/dual_track/blind_key_round1.json
```
Expected: Prints per-arm average **Excitement**, **Discovery**, **Taste Understanding**, **Survival Yield**, **Shortlist Overlap**, **Median Vote Count**, **2024–2026 Count**, and **Latency/Tokens**.

- [ ] **Step 4: Decide next step strictly from data**
  - **If Arm 4 (Hydrogen Dossier + Flash-Lite) ties or beats Arm 1 & approaches Arm 2:** Ship Idea B (*Hydrogen Taste Dossier* generated once every ~15 ratings + cached locally, injected into fast daily curation).
  - **If Arm 2 (Full-Vault Hydrogen) wins on Poetic Vibes / 2024–2026 / Blindspots while Arm 1 wins on Discovery/Grounding:** Run `--round 2` (`pk_streaming` + `refresh_3x`), then design **v6.0 Bucket F** (cached verified pool of 25–30 Hydrogen picks merged into `buildDiversifiedGeminiShortlist` with cold-slot protection).
  - **If Arm 1 (Current CinemaVault on Hydrogen) already wins cleanly:** Keep v5.6 architecture, enable Hydrogen cleanly for personal mode, and consider bumping `MAX_WILDCARD_PICKS` from `2 -> 3–4` on custom vibes.
