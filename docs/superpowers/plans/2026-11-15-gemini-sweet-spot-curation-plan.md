# Gemini Sweet-Spot Curation Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un-handcuff Gemini curation across [src/services/geminiService.js](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.js) and [src/services/rankerService.js](file:///g:/Important%20Projects/movie-ratings/src/services/rankerService.js) using the "Sweet-Spot Combo": strip prompt `Match: XX%` and `#1–#15` obedience bias (`#1`), widen the LLM shortlist to `38–40` stratified picks (`#3`), surface `20–25` favorites + all `userNote`s + `[Loved Series / Anime]` (`#4`), and allow `1–2` strictly TMDB/vault/provider/mood-verified `wildcardPicks` (`#6`), while skipping `#2` and `#5` so calibrated descending `matchScore`, `% Match` honesty, and strict mood vetoes stay 100% intact.

**Architecture:** Pre-flight repository verification confirms `feat/gemini-curation-upgrade` does not exist locally — all prior Task 1–5 curation prompt and metadata commits (`248b462`–`0214173`) are already on `main` at `0214173`. We preserve `rankCandidatePool`'s pure mathematical ranking (`evalHarness.js`, offline benchmarks, and `!ai` fallback untouched), introduce a dedicated `buildDiversifiedGeminiShortlist` wrapper (`~25` core + `~8` quality cold `2024–2026` + `~6` diverse outliers = `39`), expand `buildGeminiReRankPrompt` compactly within `<= 20,000` chars, and add an isolated `verifyAndScoreWildcardPicks` + backfill path inside `reRankCandidatesWithGemini` / `mergeGeminiExplanationsWithRanker`.

**Tech Stack:** React 18 / Vite ESM modules (`src/services/*.js`), Node native test runner (`npm test`, currently `241 / 241` passing across `28` suites on `0214173`), TMDB `/3/search/movie` + `/api/tmdb-batch` hydration, Google Gemini `responseSchema` structured JSON.

**Spec:** User "Sweet-Spot Combo" specification (`#1`, `#3 Tuned`, `#4`, `#6`; skip `#2`, `#5`) extending [docs/superpowers/plans/2026-11-15-gemini-curation-prompt-and-signal-upgrade.md](file:///g:/Important%20Projects/movie-ratings/docs/superpowers/plans/2026-11-15-gemini-curation-prompt-and-signal-upgrade.md) and [SPEC.md](file:///g:/Important%20Projects/movie-ratings/SPEC.md).

## Global Constraints

- **Skip `#2` & `#5` completely:** `mergeGeminiExplanationsWithRanker` MUST retain final `enriched.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1))`, `matchScore` MUST stay computed deterministically by the calibrated ranker (`50–99%`), and `rankCandidatePool` / `matchesMoodCandidateGate` strict mood vetoes MUST remain untouched.
- **No model weight or eval changes:** Do NOT modify `DEFAULT_RANKER_WEIGHTS`, `public/models/ranker_weights.json`, `public/models/item_embeddings_f16.bin`, `scoringUtils.js`, `contentSimService.js` cold-item fallback logic, or the `"N/A"` poster convention.
- **Pure math callers preserved:** Direct callers of `rankCandidatePool` (`evalHarness.js`, `rankerService.test.js`, `moodRanker.test.js`, `!ai` ranker fallback) must continue receiving pure mathematical descending `rankerProbability` ordering (+ `reserve`).
- **Prompt hard ceiling:** `buildGeminiReRankPrompt` output must remain `<= 20,000` characters (`PROMPT_CHAR_LIMIT = 20000`) even on worst-case 40-candidate + 25-favorite + many-notes + series inputs.
- **Existing prompt contracts kept intact unless explicitly superseded by `#1`:** Keep `USER'S FAVORITE ANCHOR FILMS:` (up to 10 primary anchors so `tests/geminiDualEngine.test.js:790-795` stays exact), `USER'S DISLIKED / DISMISSED FILMS (Avoid similar tone):`, `RECENT WATCH STREAK:`, `NEAR MISSES`, `USER'S WATCHLIST`, `PRE-RANKED CANDIDATE MOVIES (Top N):`, `select 10 distinct`, `Array of 10 items`, and candidate `[matchReasons]` badges.

## Review Focus

- Wildcard candidate overlapping `watched`, `watchlist`, `excludeIds`, or already-shortlisted candidates via mixed IDs (`tt...` vs `tmdb_<id>` vs `title::year`) -> must be rejected via `isSameMovie` and auto-backfilled to `10` picks.
- Wildcard resolving on TMDB to a TV series (`Dark`, `Solo Leveling`, range year `"2017–2020"`) or wrong-year remake -> must be blocked by `{ strict: true }` + `isSeriesVaultItem` and auto-backfilled cleanly.
- Wildcard violating active streaming providers (`userProviders`) or explicit mood/custom vibe rules (`matchesMoodCandidateGate`), or failing during TMDB lookup/`429` -> must drop only the wildcard, never abort Gemini's remaining shortlist picks, and backfill up to `targetCount`.
- Valid wildcards colliding with `selectWithSoftDirectorCap` truncation when Gemini also outputs `10` shortlist picks -> verified wildcards (`<= 2`) must reserve slots cleanly before shortlist tail slicing, stay capped by soft max-2-per-director, get real calibrated `matchScore`s, and still follow descending `matchScore` sort.
- Adversarial vault with `25` favorites, `80+` long `180`-char `userNote`s, `10` loved series, custom vibe constraints, and `40` rich candidates -> progressive tightening in `buildGeminiReRankPrompt` must stay strictly `<= 20,000` characters while never omitting core anchors, dislikes, or candidates.

---

### Task 1: Un-Bias the Prompt (`#1`) & Raise Char Budget Guard to `<= 20,000` (`geminiService.js`)

**Files:**
- Modify: `src/services/geminiService.js:1532-1633` (`buildGeminiReRankPrompt`, `formatCandidatePromptBlock`, `renderPrompt`, `PROMPT_CHAR_BUDGET`)
- Test: `tests/geminiDualEngine.test.js:1183-1268`

**Interfaces:**
- Consumes: `profile`, `mood`, `topCandidates`, `context` (`watched`, `watchlist`, `feedbackLog`, `embeddingIndex`, `moodFilters`, `targetCount`).
- Produces: unbiased candidate lines (no `| Match: XX%`, retains `[matchReasons]`), neutral `TASK:` curation rules (no `#1–#15` / `#16–#30` hierarchy), updated schema hint for optional `wildcardPicks`, and `prompt.length <= 20000`.

- [ ] **Step 1: Verify repo baseline and write failing tests for `#1` in `tests/geminiDualEngine.test.js`**

Run baseline check first (`node --test` / `git branch --show-current`) to confirm `main` is clean and see the current exact passing count on `0214173`. Then update `tests/geminiDualEngine.test.js:1183-1268` to assert:
```js
assert.doesNotMatch(prompt, /\|\s*Match:\s*\d+%|\|\s*Match:\s*N\/A/, "Must omit calibrated % Match from candidate lines");
assert.doesNotMatch(prompt, /#1[–-]#?15/i, "Must remove #1-#15 obedience directive");
assert.doesNotMatch(prompt, /calibrated ranker score/i, "Must avoid anchoring Gemini on hidden math rank");
assert.match(prompt, /wildcardPicks/i, "Documents optional outside wildcardPicks slot");
// Keep candidate metadata checks (118m, English, US, CA, cast x3, themes x5, Plot <= 250) and high Taste-Twin matchReasons test green.
// On 40-candidate worst-case fixture:
assert.ok(fullPrompt.length <= 20000, `Expected <= 20000 chars, got ${fullPrompt.length}`);
```

- [ ] **Step 2: Run targeted test to confirm it fails on current `main` prompt**

Run: `node --test tests/geminiDualEngine.test.js`
Expected: FAIL because `prompt` still contains `| Match: 76%`, `#1–#15`, and `calibrated ranker score`.

- [ ] **Step 3: Update `buildGeminiReRankPrompt` in `src/services/geminiService.js`**

1. In `formatCandidatePromptBlock`: remove `matchDisplay` and `| Match: ${matchDisplay}` from `baseLine`, keeping `ID`, `"title" (year)`, `Dir`, `Genres`, `TMDB` rating/votes, `[matchReasons]`, and `[runtime | langs]`.
2. In `renderPrompt`:
   - Replace `"Do NOT invent scores—each candidate already has a calibrated ranker score."` with `"Do NOT output numeric match percentages—evaluate fit independently from taste signals, themes, cast, directors, and plots."`
   - Replace `- Ranker balance: Favor #1–#15 ranked picks by default; promote a #16–#30 candidate...` with `- Curate openly: Every listed candidate already cleared availability and safety filters. Judge picks across the full list equally on tone, pacing, directorial voice, plots, user notes, and diversity.`
   - Instruct that `wildcardPicks` is optional (`0` to `2` films *not* already in `PRE-RANKED CANDIDATE MOVIES` that fit even better — verified automatically via TMDB/vault/provider/mood gates before inclusion).
3. Update progressive char budget in `buildGeminiReRankPrompt`:
   - Set `PROMPT_CHAR_BUDGET = 19200` and `PROMPT_CHAR_LIMIT = 20000`.
   - Step down `{ plotLimit: 250, taglineLimit: 70 }` -> `{ plotLimit: 250, taglineLimit: 0 }` -> dynamically computed `tightenedPlot = Math.max(80, ...)` -> `{ plotLimit: 60, taglineLimit: 0 }` so worst-case 40-candidate prompts always satisfy `prompt.length <= 20000`.

- [ ] **Step 4: Run targeted tests and full suite**

Run (PowerShell): `node --test tests/geminiDualEngine.test.js tests/pipelineBugs.test.js; if ($LASTEXITCODE -eq 0) { npm test }`
Expected: PASS (`fail 0 | skipped 0`).

- [ ] **Step 5: Commit Task 1**

```bash
git add src/services/geminiService.js tests/geminiDualEngine.test.js
git commit -m "feat(gemini): un-bias curation prompt and raise budget guard to 20k chars"
```

---

### Task 2: Diversified `38–40` Shortlist (`~25` Core + `~8` Cold `2024–2026` + `~6` Outliers) (`rankerService.js`, `geminiService.js`)

**Files:**
- Modify: `src/services/rankerService.js` (export `buildDiversifiedGeminiShortlist` + constants)
- Modify: `src/services/geminiService.js:1884-1953` (`reRankCandidatesWithGemini`)
- Test: `tests/rankerService.test.js`, `tests/pipelineBugs.test.js`

**Interfaces:**
- Produces (exported from `src/services/rankerService.js`):
  `buildDiversifiedGeminiShortlist(candidates = [], context = {}, weights = DEFAULT_RANKER_WEIGHTS, options = {}, reserve = undefined) -> Array<Candidate>`
  with defaults `{ coreLimit: 25, coldLimit: 8, outlierLimit: 6, shortlistLimit: 39, coldMinYear: 2024, coldMaxYear: 2026, minColdVoteAverage: 6.4, minColdVoteCount: 40 }`.
- Consumes (`reRankCandidatesWithGemini` in `src/services/geminiService.js`): passes `options.topK` (defaulting to `39`, preserving explicit smaller/custom `options.topK` when passed) and skips shortlist outlier diversification when `!ai` (`rankCandidatePool` pure fallback stays intact).

- [ ] **Step 1: Write failing tests for `buildDiversifiedGeminiShortlist` & `reRankCandidatesWithGemini` widening**

Add tests in `tests/rankerService.test.js` and `tests/pipelineBugs.test.js`:
1. Given 60 eligible candidates (top 30 high-`collabSim` Sci-Fi by 1 director `Christopher Nolan`, plus 10 quality cold `2024–2026` films with `rawCollabSim === 0` & `vote_average >= 7.0`, plus 10 distinct-director/genre/decade outliers ranked `#31–#50`):
   - `buildDiversifiedGeminiShortlist` returns `39` items (`[38, 40]`), including `<= 25` core picks, all `8` quality cold `2024–2026` slots (and rejects low-rated `4.5★` cold junk), and `6` diverse outliers introducing new directors/genres/eras.
   - Respects active `mood` + `matchesMoodCandidateGate` and `userProviders` identically to `rankCandidatePool`.
   - `rankCandidatePool(..., 30)` on the exact same inputs remains unchanged.
2. In `tests/pipelineBugs.test.js`: verify `getMovieRecommendations` with `candidates` size `55` (and mock `aiClient`) shortlists `39` candidates into `PRE-RANKED CANDIDATE MOVIES (Top 39)` while keeping the existing `pool35` minus 5 excluded test passing at `30`.

- [ ] **Step 2: Run targeted tests to confirm they fail**

Run: `node --test tests/rankerService.test.js tests/pipelineBugs.test.js`
Expected: FAIL — `buildDiversifiedGeminiShortlist` not exported / `reRankCandidatesWithGemini` caps at `30`.

- [ ] **Step 3: Implement `buildDiversifiedGeminiShortlist` and wire into `reRankCandidatesWithGemini`**

1. In `src/services/rankerService.js`:
   - `coreRanked = rankCandidatePool(candidates, context, weights, Math.min(coreLimit, shortlistLimit), options, reserve)`
   - `fullRanked = rankCandidatePool(candidates, context, weights, candidates.length, options, null)` (gets exact `rankerProbability`, `features.rawCollabSim`, and strict `mood`/`provider` gating for the entire eligible pool).
   - Helper `extractCandidateYear(c)` from `release_date || year || Year`.
   - Slice 2 (`~8` Cold `2024–2026`): filter `fullRanked` not yet in `selected` where `(c.features?.rawCollabSim ?? c.collabSim ?? 0) === 0`, quality guard `(vote_average == null || vote_average >= 6.4) && (vote_count === 0 || vote_count >= 40)`, preferring `year in [2024, 2026]` (falling back to older `collabSim === 0` only if `< coldLimit` recent cold titles exist).
   - Slice 3 (`~6` Diverse Outliers): greedily select up to `outlierLimit` remaining high-quality `(vote_average == null || vote_average >= 6.5)` items from `fullRanked` scoring each candidate deterministically by unseen director (`+2.0`), underrepresented genre (`+1.0`), and underrepresented decade (`+0.8`), breaking ties by `rankerProbability` descending.
   - Top-up any remaining slots below `Math.min(shortlistLimit, fullRanked.length)` by `rankerProbability` descending.
2. In `src/services/geminiService.js`:
   - In `reRankCandidatesWithGemini`, keep `fallbackLimit = Math.max(targetCount, options.topK || 30)` if `!ai`; when `ai` is present, set `shortlistLimit = Math.max(targetCount, options.topK || 39)` and build `topCandidates` via `buildDiversifiedGeminiShortlist` (with exhaustion-guard padding preserved when `excludeIds` leaves `< targetCount`).

- [ ] **Step 4: Run tests**

Run (PowerShell): `node --test tests/rankerService.test.js tests/pipelineBugs.test.js; if ($LASTEXITCODE -eq 0) { npm test }`
Expected: PASS (`fail 0 | skipped 0`).

- [ ] **Step 5: Commit Task 2**

```bash
git add src/services/rankerService.js src/services/geminiService.js tests/rankerService.test.js tests/pipelineBugs.test.js
git commit -m "feat(ranker): widen Gemini shortlist to 39 with cold 2024+ and diverse slices"
```

---

### Task 3: Expand Vault Prompt Context (`#4`: `20–25` Favorites, All `userNote`s, `[Loved Series / Anime]`) (`geminiService.js`)

**Files:**
- Modify: `src/services/geminiService.js:1175-1635` (`buildGeminiReRankPrompt`, vault context helpers)
- Test: `tests/geminiDualEngine.test.js`

**Interfaces:**
- Consumes: `context.watched` (films + TV series with `Type: "series"` or year range, `userRating`, `userNote`/`notes`), `profile.weightedRatings`, `preset`, `moodFilters`.
- Produces deterministic prompt sections (omitted cleanly when empty) while keeping `USER'S FAVORITE ANCHOR FILMS:` max `10` items and total prompt `<= 20,000` chars:
  - `ADDITIONAL TOP FAVORITES:` (ranks `11..25` of `>= 8★` items, compact `- "Title" (Year) [Rating/10]`).
  - `ADDITIONAL VIEWER NOTES:` (every rated movie/series carrying non-empty `userNote`/`notes` not already printed in anchors, dislikes, streak, or near-misses).
  - `LOVED SERIES / ANIME:` (`isSeriesVaultItem(m)` with `userRating >= 8`, tagged `[Series]`).

- [ ] **Step 1: Write failing tests covering `#4` + adversarial Review Focus note flood in `tests/geminiDualEngine.test.js`**

Add test cases in `tests/geminiDualEngine.test.js`:
1. Vault with `26` `>= 8★` movies (including #15 rated `8★` with no note, #22 rated `8★` with note, two `7★` films outside Near Miss top-4 that carry `userNote`s, and `2` loved TV/anime series `Dark` (`10★`) & `Attack on Titan` (`9★`, `Year: "2013–2023"`)):
   - Confirms `prompt` includes `25` distinct `>= 8★` favorites (`10` in `USER'S FAVORITE ANCHOR FILMS:` + `15` in `ADDITIONAL TOP FAVORITES:`, omitting #26), includes *every* non-empty `userNote` in `ADDITIONAL VIEWER NOTES:` without duplicating anchor/dislike notes, and renders `LOVED SERIES / ANIME:` with `[Series]` tags.
   - Confirms empty-section case (minimal 1-movie test fixture) omits all 3 new headings cleanly so minimal fixtures remain clean.
2. **Adversarial Review Focus test:** `40` loaded candidates + `25` favorites + `10` loved series + `80` watched movies each with `180`-char `userNote`s -> `assert.ok(prompt.length <= 20000)` AND core `USER'S FAVORITE ANCHOR FILMS:` / `DISLIKED` / `PRE-RANKED CANDIDATE MOVIES` sections remain intact.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/geminiDualEngine.test.js`
Expected: FAIL — favorites past #10, non-anchor `userNote`s, and `LOVED SERIES / ANIME:` absent from prompt.

- [ ] **Step 3: Implement helper selectors and `<= 20,000` progressive compaction in `src/services/geminiService.js`**

1. Add focused helper `buildExtendedVaultContextSections({ watched, profile, anchorEntries, dislikedLines, recentItems, nearMissLines, maxFavorites = 25, maxSeries = 12 })`:
   - Collect `>= 8★` favorites via same weight/rating/date comparator as `selectMoodStratifiedAnchors`; subtract `anchorEntries` (`10`) -> take up to `maxFavorites - anchorEntries.length` (`15`) compact lines (`- "Title" (Year) [Rating/10]${formatSeriesTag(m)}`).
   - Collect `lovedSeriesLines`: deduplicated `isSeriesVaultItem(m)` with `userRating >= 8`, sorted deterministically (`rating desc, date desc, title asc`), capped at `maxSeries`, formatted `- "Title" (Year) [Rating/10] [Series]${formatNoteSuffix(m, 140)}`.
   - Collect `extraNoteLines`: track `alreadyPrinted` movies (`isSameMovie`) whose notes were already rendered in `anchorEntries`, `disliked`, `recentStreak`, or `nearMisses`; for every remaining rated/noted item with trimmed `userNote || notes`, emit `- "Title" (Year) [${r}/10]${formatSeriesTag(m)}: "${note}"`.
2. In `renderPrompt({ plotLimit, taglineLimit, extendedFavoritesLimit, notesLimit, noteLen })`, allow progressive budget trimming *after* candidate `taglineLimit: 0` and plot tightening down to `60` chars ONLY when `prompt.length > 19600` (trims tail of `extraNoteLines` -> `broaderFavorites` if an extreme 80+ note vault exceeds `19,600` chars), enforcing final `prompt.length <= 20000`.

- [ ] **Step 4: Run targeted tests and full suite**

Run (PowerShell): `node --test tests/geminiDualEngine.test.js; if ($LASTEXITCODE -eq 0) { npm test }`
Expected: PASS (`fail 0 | skipped 0`).

- [ ] **Step 5: Commit Task 3**

```bash
git add src/services/geminiService.js tests/geminiDualEngine.test.js
git commit -m "feat(gemini): surface 25 favorites, all user notes, and loved series under 20k budget"
```

---

### Task 4: Verified `1–2` `wildcardPicks` Pipeline with Calibrated Scoring, Gate Checks & Backfill (`#6`) (`geminiService.js`)

**Files:**
- Modify: `src/services/geminiService.js:1728-2092` (`mergeGeminiExplanationsWithRanker`, `reRankCandidatesWithGemini`, exported `verifyAndScoreWildcardPicks`)
- Test: `tests/geminiDualEngine.test.js`, `tests/pipelineBugs.test.js`

**Interfaces:**
- Produces (exported from `src/services/geminiService.js`):
  `verifyAndScoreWildcardPicks(rawWildcards = [], context = {}, options = {}) -> Promise<Array<ScoredCandidate>>`
  where `context` consumes `{ watched, watchlist, excludeIds, existingCandidates, profile, mood, moodFilters, userRegion, userProviders, embeddingIndex, contentIndex, dnaIndex, collabSimMap, repulsionMap, rankerWeights, rankerOptions }`, and `options` accepts optional `wildcardFinder` / `detailFetcher` / `fetchFn` / `maxWildcards = 2`.
- Consumes: `findTmdbByTitleAndYear(..., { strict: true })`, `fetchBatchFormattedDetailsMap` (or `detailFetcher`), `isSeriesVaultItem`, `isSameMovie`, `matchesWatchProviders`, `matchesMoodCandidateGate`, `buildContentSimMap` (`coldOnly: true`, `enableStructuredFallback: true`), `buildDnaSimMap`, and `rankCandidatePool(..., { collabNormalization: "catalog-max" }, null)`.
- Updated optional 4th context key in `mergeGeminiExplanationsWithRanker(result, rankedCandidates, profile, context, targetCount)`: supports optional `context.verifiedWildcards = []` cleanly without breaking any existing 3/4/5-arg callers.

- [ ] **Step 1: Write failing tests covering valid wildcards + all Review Focus rejection/backfill cases**

Add tests in `tests/geminiDualEngine.test.js`:
1. **Valid wildcard happy path (`targetCount = 10`, skipping `#2` & keeping `#5`):**
   - Gemini returns `10` shortlist `recommendations` plus `2` `wildcardPicks`: Wildcard A (`93%` calibrated math score via injected TMDB details) and Wildcard B (`79%` calibrated math score via injected TMDB details).
   - Verifies both wildcards resolve via strict TMDB search (`strict: true`), carry `sourceBucket: "Gemini Wildcard"`, keep deterministic `matchScore` computed by `rankCandidatePool` (never LLM-invented), appear inside the final `10` recommendations ordered strictly by descending `matchScore` (`#2` skipped -> calibrated order holds!), and keep `recommendations.length === 10`.
2. **Rejection + Auto-Backfill cases (`Review Focus` 1–4):**
   - Wildcard matching a watched movie (even mismatched `tmdb_` vs `tt...` ID via `isSameMovie`), watchlist movie, or `excludeIds` -> rejected and `10/10` auto-backfilled from shortlist.
   - Wildcard resolving only to a TV series (`isSeriesVaultItem` or null movie search because `/3/search/movie` + `strict: true` rejects range/remake mismatch) -> rejected and auto-backfilled.
   - Wildcard missing user's selected `userProviders` (`matchesWatchProviders === false`) -> rejected and auto-backfilled.
   - Wildcard failing `matchesMoodCandidateGate` (`explicitMood = "comfort-watch"` with Horror `genre_ids: [27]`) -> rejected and auto-backfilled (`#5` intact!).
   - Wildcard TMDB lookup throwing or returning `429` -> caught cleanly, main `recommendations` still return `10/10` without triggering Gemini fallback error!

- [ ] **Step 2: Run targeted tests to confirm they fail**

Run: `node --test tests/geminiDualEngine.test.js`
Expected: FAIL — `verifyAndScoreWildcardPicks` does not exist and `wildcardPicks` are ignored/dropped.

- [ ] **Step 3: Implement `verifyAndScoreWildcardPicks` and update `mergeGeminiExplanationsWithRanker` + `reRankCandidatesWithGemini` in `src/services/geminiService.js`**

1. Add `MAX_WILDCARD_PICKS = 2` and optional `wildcardPicks` array in `reRankCandidatesWithGemini`'s `generationConfig.responseSchema` (do NOT add `"wildcardPicks"` to `required`!).
2. Implement `verifyAndScoreWildcardPicks(rawWildcards = [], context = {}, options = {})`:
   - Slice `(0, MAX_WILDCARD_PICKS)`; skip blanks or `isSeriesVaultItem(pick)` (check year string & title tags).
   - For each remaining pick (`<= 2`), resolve via `options.wildcardFinder ? options.wildcardFinder(pick.title, pick.year) : findTmdbByTitleAndYear(pick.title, pick.year, { ...options, strict: true })` wrapped in `try/catch` (ignore failures/429s gracefully).
   - Deduplicate resolved `tmdbId`s; batch-hydrate full details via `detailFetcher` or `fetchBatchFormattedDetailsMap` imported cleanly from `tmdbService.js` (checking if `fetchBatchFormattedDetailsMap` needs export in `tmdbService.js` — export `fetchBatchFormattedDetailsMap` + `formatTmdbMovieDetails` cleanly if not exported, reusing the single 40-ID `/api/tmdb-batch` + 30-day IndexedDB cache path!).
   - Build normalized candidate record (`tmdbId`, `imdbID`, `title`, `year`, `release_date`, `overview`, `genre`, `tmdbGenreIds`, `tmdbKeywords`, `castIds`, `crewPersonId`, `streamProviders`, `freeProviders`, `providersHydrated: true`, `hydrated: true`, `sourceBucket: "Gemini Wildcard"`).
   - Reject strictly if:
     - `isSeriesVaultItem(fullCand)`
     - Matches any `watched`, `watchlist`, `existingCandidates`, or `verifiedSoFar` via `isSameMovie` or `excludeIds`
     - `hasProviderFilter && !matchesWatchProviders(fullCand, userProviders)`
     - `explicitMood && !matchesMoodCandidateGate(fullCand, mood, moodFilters)`
   - Score each valid candidate deterministically with full-pool maps: compute `contentSimMap` (`buildContentSimMap(..., [fullCand], { collabIndex: embeddingIndex, collabSimMap, enableStructuredFallback: true, coldOnly: true })`) & `dnaSimMap` (`buildDnaSimMap(..., [fullCand])`), pull `collabSimMap` & `repulsionMap` from `context` (which already cover the whole `embeddingIndex`), and run `rankCandidatePool([fullCand], rankerCtxForWildcard, weights, 1, { ...options.rankerOptions, collabNormalization: "catalog-max" }, null)`! (Ensure `rankCandidatePool` still sees `catalogMax` from the full `collabSimMap` — verified because `getCollabCatalogMax(collabSimMap)` iterates `collabSimMap.values()`!).
3. Update `mergeGeminiExplanationsWithRanker`:
   - Build `wildcardPoolItems` (up to `2`) and `geminiPoolItems` (deduplicated against wildcards + each other), plus `rankedBackfillItems`.
   - Select `targetCount` via `selectWithSoftDirectorCap`: pass `[...wildcardPoolItems, ...geminiPoolItems, ...rankedBackfillItems]`, guaranteeing valid verified wildcards (`<= 2`) claim slots before the shortlist tail is sliced while automatically backfilling up to `10` from `geminiPoolItems` + `rankedBackfillItems` whenever any wildcard is rejected or absent.
   - Preserve final `enriched.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1))` cleanly!
4. Wire `verifyAndScoreWildcardPicks` in `reRankCandidatesWithGemini` right after parsing `result.wildcardPicks`, passing `{ verifiedWildcards }` into `mergeGeminiExplanationsWithRanker`.

- [ ] **Step 4: Run full test matrix & verify no regressions**

Run (PowerShell): `node --test tests/geminiDualEngine.test.js tests/pipelineBugs.test.js; if ($LASTEXITCODE -eq 0) { npm test }`
Expected: PASS (`fail 0 | skipped 0`).

- [ ] **Step 5: Commit Task 4**

```bash
git add src/services/tmdbService.js src/services/geminiService.js tests/geminiDualEngine.test.js tests/pipelineBugs.test.js
git commit -m "feat(gemini): add verified 1-2 wildcardPicks with calibrated scoring and auto-backfill"
```

---

### Task 5: Root Docs Sync, Clean Build Check & Verification Summary

**Files:**
- Modify: `ARCHITECTURE.md`, `SPEC.md`, `LOCAL_MODEL_GUIDE.md`, `summary.md`, `README.md`

**Interfaces:**
- Reflect exact final passing `npm test` count, `2302`-module Vite build verification, `39`-candidate stratified shortlist (`25 + 8 + 6`), `<= 20,000` char unbiased prompt, `25` favorites / all notes / `[Loved Series / Anime]`, and `<= 2` TMDB/vault/provider/mood-verified `wildcardPicks`.

- [ ] **Step 1: Inspect final `git diff` across `src/` & `tests/` and capture exact final `npm test` + `npm run build` outputs**

Run (PowerShell): `npm test; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: `fail 0 | skipped 0`, Vite production build exits `0`.

- [ ] **Step 2: Update root markdown docs cleanly (verify exact test count and symbol names from code before writing)**

Update relevant prompt/shortlist/wildcard sections and test counts across `README.md`, `SPEC.md`, `LOCAL_MODEL_GUIDE.md`, `summary.md`, and `ARCHITECTURE.md`.

- [ ] **Step 3: Re-run verification after final `.md` edit**

Run (PowerShell): `npm test; if ($LASTEXITCODE -eq 0) { npm run build }`
Expected: `fail 0 | skipped 0`, `vite build` exits `0`.

- [ ] **Step 4: Commit Docs**

```bash
git add ARCHITECTURE.md LOCAL_MODEL_GUIDE.md README.md SPEC.md summary.md
git commit -m "docs: document sweet-spot Gemini curation upgrade and updated test suite"
```
