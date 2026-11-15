# Franchise Collection Guard & Steerable Taste Rules (v5.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate unguarded franchise/sequel recommendations via TMDB `belongs_to_collection` tracking and give viewers editable, persistent "Taste Rules" (Steer-style user memory) that steer TMDB retrieval, candidate gating, Gemini curation, and Film Companion chat while invalidating recommendation caches cleanly.

**Architecture:** Extract `collectionId` and `collectionName` from TMDB movie payloads (`tmdbService.js`) with zero extra network calls, propagate them through candidate enrichment and `verifyAndScoreWildcardPicks`, and enforce a soft `max-1-per-collectionId` cap alongside `max-2-per-director` in `mergeGeminiExplanationsWithRanker` plus a prompt sequel rule. In parallel, add a pure domain module `src/services/tasteRulesService.js` storing structured `{ id, text, polarity, keywords, genreIds, pinned, active, source, updatedAt }` rules backed by `AppContext` (`cinemavault_taste_rules_v1`) and Schema v2 JSON backups (`vaultPortability.js`), wiring active rules into Bucket A retrieval exclusions, cold/ranker keyword & genre penalties, Gemini curation + Chat prompts, cache hashing (`generateProfileHash`), and an on-demand *"Auto-Draft Rules from Vault"* control in `MovieRecommendations.jsx`. (`content_embeddings_f16.bin` contrastive training and 2-Vault Blend are intentionally deferred to a separate offline Colab `v6.0` plan after collecting 30–50 live `recSource` ratings; `dualClock` UI toggle and in-ranker 64-D MMR are explicitly omitted.)

**Tech Stack:** React 19, Vite, ES Modules, Node native test runner (`node --test`), TMDB `/3/movie/{id}` details + `/api/tmdb-batch`, Gemini `FAST_INTERACTIVE_CASCADE` / `CURATION_MODEL_CASCADE`, Schema v2 JSON portability (`vaultPortability.js`).

**Spec & Baseline:** Extends verified `HEAD` (`081f4cc` — which already ships `39`-candidate diversified shortlists, `[matchReasons]` badges, `[dismissed: <reason>]` tags, and live `wildcardPicks` TMDB verification; verified `249/249` tests passing). Keeps live Supabase Postgres schema unchanged (no unmigrated column writes that could trigger `PGRST204`).

## Global Constraints

- Preserve existing `249/249` test behavior and deterministic default `rankCandidatePool` scores when `tasteRules` is empty (`[]`).
- Zero extra TMDB network round trips per movie for franchise checks (reuse `belongs_to_collection` from existing `/3/movie/{id}` and `/api/tmdb-batch` responses).
- Zero ESM circular imports: `src/services/tasteRulesService.js` imports ONLY `./moodPolicy.js` at top level (`draftTasteRulesWithGemini` uses injected runners or dynamic `await import("./geminiService.js")`).
- Qualified vs unqualified genre negation rule: only unqualified genre negations (`"no horror"`, `"avoid documentaries"`, `"no musicals"`, `"no westerns"`) populate `avoidGenreIds`; qualified genre negations (`"No slow-burn period dramas"`, `"No cheesy action"`) extract phrases into `avoidKeywords` without blacklisting Drama (`18`) or Action (`28`).
- `cinemavault_taste_rules_v1` user rules must NEVER be evicted in `AppContext.jsx` `safeSetItem`'s `purgeOrder`.
- Enforce `buildGeminiReRankPrompt` hard budget (`<= 20,000` chars) with pinned `"avoid"` / `"prefer"` Taste Rules retained ahead of overflow extra notes or extended favorites.
- Maintain backward compatibility for existing `generateProfileHash(...)` 7-arg callers (8th `tasteRules = []` argument must be optional and emit identical hashes when empty).
- Preserve `"recommend nothing from watched/watchlist or TV series"` safety gates across all retrieval, wildcard, and diversity passes.

## Review Focus

- **Collection/director soft-cap underflow:** When fewer than `targetCount` distinct collections/directors exist in the ranked pool, overflow items must backfill cleanly so `recommendations.length === Math.min(targetCount, pool.length)`. -> Verified in Task 2.
- **Substring false positives & empty-rules regression:** Avoid-rule matching on words like `"war"` must match word boundaries rather than corrupting substrings (`"Star Wars"` vs `"award"`), and empty `tasteRules = []` must produce bit-for-bit identical scores and cache hashes to `HEAD`. -> Verified in Tasks 3 & 4.
- **Prompt budget squeeze with long rules:** Even with 8 max-length (`140`-char) active rules and full vault context, `buildGeminiReRankPrompt` must stay `<= 20,000` chars without stripping active Taste Rules. -> Verified in Task 4.
- **Offline/malformed AI rule draft failure & duplicates:** `"Auto-Draft Rules from Vault"` must fall back deterministically via `draftTasteRulesFallback` when Gemini is unavailable or returns invalid JSON, and rule add/normalize helpers must reject blank strings, enforce cap (`8` rules), and deduplicate case-insensitively. -> Verified in Task 3.
- **v1/v2 backup backward compatibility:** Old v1/v2 JSON backups lacking `preferences.tasteRules` must import cleanly without overwriting or crashing, while backups containing `preferences.tasteRules` round-trip cleanly. -> Verified in Task 5.

---

### Task 1: Extract & Propagate `collectionId` and `collectionName` Through TMDB Details & Wildcards

**Files:**
- Modify: `src/services/tmdbService.js:1185-1225`, `src/services/tmdbService.js:1384-1406`, `src/services/tmdbService.js:1529-1589`, `src/services/tmdbService.js:1847-1860`
- Modify: `src/services/geminiService.js:1839-1869`, `src/services/geminiService.js:2063-2095`
- Test: `tests/pipelineBugs.test.js`, `tests/geminiDualEngine.test.js`

**Interfaces:**
- Produces on formatted/enriched TMDB candidates, Vault entries (`bridgeTmdbToOmdb` / `mergeBackfilledMovieMetadata`), & `buildRecommendationEntry` output:
  - `collectionId: number | null` (positive integer from `data.belongs_to_collection?.id`, else `null`)
  - `collectionName: string | null` (trimmed name from `data.belongs_to_collection?.name`, else `null`)

- [ ] **Step 1: Write failing tests for collection field extraction, Vault bridge/backfill persistence, enrichment merge, and wildcard preservation**

Add to `tests/pipelineBugs.test.js`:
```js
test("formatTmdbMovieDetails, applyDetailsToCandidate, bridgeTmdbToOmdb, and mergeBackfilledMovieMetadata preserve belongs_to_collection metadata", async () => {
  const details = formatTmdbMovieDetails({
    id: 603692,
    title: "John Wick: Chapter 4",
    release_date: "2023-03-22",
    belongs_to_collection: { id: 404609, name: "John Wick Collection" },
    genres: [{ id: 28, name: "Action" }]
  });
  assert.equal(details.collectionId, 404609);
  assert.equal(details.collectionName, "John Wick Collection");

  const merged = applyDetailsToCandidate({ id: 603692, title: "John Wick: Chapter 4" }, details);
  assert.equal(merged.collectionId, 404609);
  assert.equal(merged.collectionName, "John Wick Collection");
});
```
Also assert `mergeBackfilledMovieMetadata` preserves `collectionId` and `collectionName` onto Vault items, `bridgeTmdbToOmdb` maps them on bridged entries, and add an assertion in `tests/geminiDualEngine.test.js` verifying a candidate (and `verifiedWildcards`) retains `collectionId` and `collectionName` across `mergeGeminiExplanationsWithRanker`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pipelineBugs.test.js`
Expected: FAIL (`details.collectionId` is `undefined`).

- [ ] **Step 3: Extract `collectionId` & `collectionName` in `tmdbService.js` and propagate in `geminiService.js`**

- In `formatTmdbMovieDetails(data, userRegion = "US")` (`src/services/tmdbService.js`), normalize `collectionId` (`Number.isSafeInteger(Number(data?.belongs_to_collection?.id)) && Number(data.belongs_to_collection.id) > 0 ? Number(data.belongs_to_collection.id) : null`) and `collectionName` (`String(data?.belongs_to_collection?.name || "").trim() || null`) and include both on the returned object.
- In `bridgeTmdbToOmdb`, `pickEnrichedDetails`, `applyDetailsToCandidate`, and `mergeBackfilledMovieMetadata` (`src/services/tmdbService.js`), preserve `collectionId` (`details.collectionId ?? existing.collectionId ?? null`) and `collectionName` (`pickRichValue(details.collectionName, existing.collectionName)`).
- In `verifyAndScoreWildcardPicks` (`fullCand` builder) and `buildRecommendationEntry` (`src/services/geminiService.js`), preserve `collectionId` and `collectionName` when present (`details?.collectionId ?? stub.collectionId ?? null`, etc.).

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/pipelineBugs.test.js tests/geminiDualEngine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/tmdbService.js src/services/geminiService.js tests/pipelineBugs.test.js tests/geminiDualEngine.test.js
git commit -m "feat(tmdb): extract and propagate belongs_to_collection metadata"
```

---

### Task 2: Enforce Soft `max-1-per-collectionId` Cap & Prompt Sequel Guardrail

**Files:**
- Modify: `src/services/geminiService.js:1668-1765`, `src/services/geminiService.js:1889-1925`, `src/services/geminiService.js:2220-2370`
- Test: `tests/geminiDualEngine.test.js`

**Interfaces:**
- Consumes: `collectionId`, `collectionName` from Task 1.
- Produces in `src/services/geminiService.js`:
  - `normalizeCollectionCapKey(entry, candidate = null) => string` (`"col:<collectionId>"` or `""`)
  - `selectWithSoftVarietyCaps(items = [], desiredTotal = DEFAULT_RECOMMENDATION_COUNT, { maxPerDirector = 2, maxPerCollection = 1 } = {}) => Array`
  - Prompt candidate line annotation `Collection: <collectionName>` (truncated cleanly when budget shrinks) + TASK guardrail: `- Franchise rule: Prefer max 1 film per franchise/collection, and never recommend a numbered sequel/Part 2+ unless an earlier installment in that franchise appears in the user's Vault.`

- [ ] **Step 1: Write failing tests for collection capping, soft underflow backfill, and sequel prompt rule**

Add to `tests/geminiDualEngine.test.js`:
1. `test("mergeGeminiExplanationsWithRanker enforces max 1 per collectionId across recommendations and backfills while preserving underflow fallback", ...)` — pass 2 picks in `recommendations` sharing `collectionId: 404609` plus an uncollected backfill item; expect only 1 pick from `404609` in the selected output until unique collections are exhausted, AND if the pool only has items from `404609`, backfill overflow so output still meets `targetCount` (also verify `buildRankerFallbackResponse` offline fallback respects the same cap).
2. `test("buildGeminiReRankPrompt includes franchise sequel guardrail and Collection tag when collectionName is present", ...)` — verify candidate `Collection: John Wick Collection` appears and prompt mentions sequel/franchise rule.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/geminiDualEngine.test.js`
Expected: FAIL (`John Wick 2` & `John Wick 3` both selected despite sufficient non-collection alternatives; no `Collection:` annotation or sequel rule).

- [ ] **Step 3: Implement `selectWithSoftVarietyCaps` and prompt annotation in `src/services/geminiService.js`**

- Replace `selectWithSoftDirectorCap` usage inside **both** `mergeGeminiExplanationsWithRanker` and `buildRankerFallbackResponse` (`src/services/geminiService.js:2354`) with `selectWithSoftVarietyCaps(poolItems, desiredTotal, { maxPerDirector: 2, maxPerCollection: 1 })` tracking both `dirKey` (`>= maxPerDirector`) and `collectionKey` (`normalizeCollectionCapKey(entry, candidate)`, `>= maxPerCollection`). When deferring to `overflow`, preserve priority ordering on backfill so `result.length === desiredTotal`.
- In `formatCandidatePromptBlock`, append `Collection: ${cleanStr(c.collectionName).slice(0, 60)}` inside `detailParts` when `!tightBudget` (`plotLimit >= 80`), and add the 1-line franchise rule under `TASK:`.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/geminiDualEngine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/geminiService.js tests/geminiDualEngine.test.js
git commit -m "feat(gemini): add soft max-1-per-collection cap and sequel prompt guardrail"
```

---

### Task 3: Build Steerable Taste Rules Domain Service (`src/services/tasteRulesService.js`)

**Files:**
- Create: `src/services/tasteRulesService.js`
- Create: `tests/tasteRulesService.test.js`

**Interfaces:**
- Consumes: `resolveGenreId` / `GENRE_NAME_TO_ID` from `src/services/moodPolicy.js` (ONLY top-level static import allowed — zero static imports from `geminiService.js` or `apiTransport.js` to avoid ESM circular dependencies). `draftTasteRulesWithGemini` accepts injected `{ executeCascade, sanitizeAndParseJSON, createGeminiClient, modelCascade }` or loads `./geminiService.js` dynamically via `await import("./geminiService.js")`.
- Produces in `src/services/tasteRulesService.js`:
  - `MAX_TASTE_RULES = 8`, `MAX_RULE_TEXT_LENGTH = 140`
  - `normalizeTasteRules(rawRules = []) => Array<TasteRule>` (validates `id`, trims `text <= 140`, normalizes `polarity: "prefer" | "avoid"`, `pinned: boolean`, `active: boolean`, extracts structured `genreIds: number[]` & `keywords: string[]`, deduplicates case-insensitively on normalized text, caps at `8`).
  - `extractRuleSignals(text = "", polarity = "prefer") => { genreIds: number[], keywords: string[] }` (prevents the broad genre blacklist trap: for `"avoid"` rules, only populate `avoidGenreIds` on **unqualified** genre negations such as `"no horror"`, `"avoid documentaries"`, `"no musicals"`, `"no westerns"`; when qualifiers/adjectives precede a genre noun like `"No slow-burn period dramas"` or `"No cheesy action"`, leave `genreIds: []` and extract cleaned phrases into `keywords` for word-boundary `candidateMatchesAvoidRule` + Gemini prompt).
  - `compileActiveTasteRules(rules = []) => { activeRules: TasteRule[], preferRules: TasteRule[], avoidRules: TasteRule[], avoidGenreIds: number[], preferGenreIds: number[], avoidKeywords: string[], preferKeywords: string[] }`
  - `candidateMatchesAvoidRule(candidate = {}, avoidRules = []) => { matched: boolean, matchedRuleText: string | null }` (uses word-boundary regex `\\b...\\b` against normalized genres, `keywordNames`, `tagline`, `overview`/`plot`).
  - `candidateMatchesPreferRule(candidate = {}, preferRules = []) => { matched: boolean, matchedRuleText: string | null }` (uses word-boundary regex / genre ID match for modest `+0.6` ranker boost).
  - `buildTasteRulesHashSegment(rules = []) => string` (returns `""` when zero active rules; deterministic sorted hash otherwise).
  - `draftTasteRulesFallback(watched = [], profile = {}, feedbackLog = []) => Array<TasteRule>` (deterministic heuristic drafting rules from repeated `userNote`s, disliked genres/tropes, and top anchors when AI is offline/unavailable).
  - `draftTasteRulesWithGemini(ai, { watched, profile, feedbackLog, existingRules, geminiDeps }) => Promise<Array<TasteRule>>` (1 structured `FAST_INTERACTIVE_CASCADE` call generating concise rules via injected deps or dynamic `await import("./geminiService.js")`, falling back cleanly to `draftTasteRulesFallback` on error/empty output).

- [ ] **Step 1: Write failing unit tests in `tests/tasteRulesService.test.js`**

Test cases:
1. `normalizeTasteRules` deduplicates case-insensitively, rejects empty strings, truncates `text` to `140` chars, caps at `8`, and preserves `pinned` / `active` flags.
2. **Broad Genre Blacklist Trap test:** `extractRuleSignals("No slow-burn period dramas", "avoid")` returns `genreIds: []` (does NOT add `18` / Drama!) and extracts phrase `"slow-burn period drama"` / `"period drama"` into `keywords`, whereas `extractRuleSignals("No horror or musicals", "avoid")` populates `genreIds: [27, 10402]`.
3. `candidateMatchesAvoidRule` flags `"A Slow Period Drama"` with plot `"courtly slow-burn period drama"` for `"avoid: No slow-burn period dramas"`, **and does NOT false-positive** `"Star Wars: A New Hope"` against `"avoid: No gritty war movies"` (`\bwar\b` must not match `"Wars"`!).
4. `buildTasteRulesHashSegment([]) === ""` and toggles/edits produce distinct hashes.
5. `draftTasteRulesFallback` synthesizes at least 2 concrete rules from a sample vault containing high-rated sci-fi/anime notes and low-rated slow/bleak dismissals, `draftTasteRulesWithGemini(null, ...)` falls back gracefully without throwing, and `tasteRulesService.js` has zero static top-level imports from `geminiService.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tasteRulesService.test.js`
Expected: FAIL (`ERR_MODULE_NOT_FOUND` for `src/services/tasteRulesService.js`).

- [ ] **Step 3: Implement `src/services/tasteRulesService.js`**

Create `src/services/tasteRulesService.js` with ONLY `./moodPolicy.js` imported at top level, implementing all exported helpers above cleanly with unqualified vs qualified genre negation detection, word-boundary matching (`escapeRegex`, `\b...\b` for single/multi-word phrases), and dynamic import/injection inside `draftTasteRulesWithGemini` (preserving existing pinned rules ahead of AI suggestions, capped at `MAX_TASTE_RULES = 8`).

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/tasteRulesService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/tasteRulesService.js tests/tasteRulesService.test.js
git commit -m "feat(taste-rules): add steerable user memory service with offline fallback"
```

---

### Task 4: Wire `tasteRules` Into Retrieval, Ranker Penalties, Gemini Prompts, Chat, and Cache Hashing

**Files:**
- Modify: `src/services/tmdbService.js:573-660` (`buildBucketAParams`)
- Modify: `src/services/rankerService.js:545-686` (`rankCandidatePool`, `scoreCandidate`)
- Modify: `src/services/geminiService.js:1083-1099` (`generateProfileHash`), `src/services/geminiService.js:1573-1837` (`buildGeminiReRankPrompt`), `src/services/geminiService.js:2475-2483` & `2894-2907`
- Modify: `src/services/geminiChatService.js:7-29` (`sendChatMessage`)
- Test: `tests/moodRanker.test.js`, `tests/geminiDualEngine.test.js`, `tests/tasteRulesService.test.js`

**Interfaces:**
- `buildBucketAParams(profile, mood, options = {}, apiKey)` reads `options.tasteRules` -> appends ONLY unqualified active `"avoid"` `avoidGenreIds` cleanly into `without_genres` (merged without duplicating preset exclusions).
- `rankCandidatePool(candidates, context = {}, ...)` reads `context.tasteRules`:
  - When active `"avoid"` rules match via `candidateMatchesAvoidRule(cand, avoidRules)`, applies a strong calibrated logit penalty (`-3.5`, and excludes during explicit mood gating alongside `withoutKeywords`).
  - When active `"prefer"` rules match via `candidateMatchesPreferRule(cand, preferRules)`, applies a modest `+0.6` logit boost.
  - When `context.tasteRules` is omitted or empty (`[]`), does zero work (`0` logit change).
- `buildDiversifiedGeminiShortlist(rankedPool, watched, disliked, context = {})` reads `context.tasteRules` (avoid rules) and rejects candidates matching `candidateMatchesAvoidRule(cand, avoidRules)` from Slice 2 (`8` cold slots), Slice 3 (`6` outlier slots), and top-up slots.
- `verifyAndScoreWildcardPicks(...)` also rejects any wildcard candidate matching `candidateMatchesAvoidRule(fullCand, avoidRules)`.
- `generateProfileHash(profile, watchlistGenres, mood, providers, moodFilters, userRegion, watched, tasteRules = [])` keeps 7-arg callers identical when `tasteRules` has 0 active rules, appending `_tr_<hash>` whenever active rules exist.
- `buildGeminiReRankPrompt(profile, mood, topCandidates, context = {})` reads `context.tasteRules`, formats `USER'S STEERABLE TASTE RULES (Follow strictly):` (`[PINNED Prefer] ...` / `[Avoid] ...`), and pins `tasteRulesLimit` above secondary extra favorites/notes in the adaptive `< 20,000`-char budget cascade.
- `sendChatMessage(userMessage, chatHistory, watchedMovies, tasteRules = [])` optionally accepts 4th `tasteRules` arg and injects active rules into `systemInstruction`.

- [ ] **Step 1: Write failing tests across `tests/moodRanker.test.js` and `tests/geminiDualEngine.test.js`**

Tests:
1. `generateProfileHash(p, wg, "any", [], null, "US", w)` === `generateProfileHash(p, wg, "any", [], null, "US", w, [])`, while adding/editing an active rule changes the hash.
2. `buildBucketAParams` appends unqualified `"avoid"` genre IDs (e.g., Horror `27` from `"No horror or gore"`) to `without_genres`, while qualified `"No slow-burn period dramas"` does NOT add Drama (`18`).
3. `rankCandidatePool` applies `-3.5` avoid-rule penalty to a candidate matching `"No slow-burn period dramas"` and modest `+0.6` boost to a `"Prefer cyberpunk noir"` match, without affecting scores when `tasteRules = []`.
4. `buildDiversifiedGeminiShortlist` rejects avoid-rule matches from Slice 2 cold / Slice 3 outlier slots, and `verifyAndScoreWildcardPicks` rejects avoid-rule wildcards.
5. `buildGeminiReRankPrompt` renders active rules clearly AND keeps all `pinned: true` / active rules intact when overflowing long vault context trims secondary lists under `<= 20,000` chars.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/moodRanker.test.js tests/geminiDualEngine.test.js`
Expected: FAIL on the 4 new assertions.

- [ ] **Step 3: Implement wiring cleanly in `tmdbService.js`, `rankerService.js`, `geminiService.js`, and `geminiChatService.js`**

Follow existing conventions in each file:
- Pass `tasteRules: options.tasteRules` cleanly from `getMovieRecommendations` -> `fetchCandidatePool` (`Bucket A`) & `reRankCandidatesWithGemini` -> `rankCandidatePool` & `buildGeminiReRankPrompt`.
- Keep `DEFAULT_RANKER_WEIGHTS` (`public/models/ranker_weights.json`) unchanged so offline MovieLens benchmark parity stays intact.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/tasteRulesService.test.js tests/moodRanker.test.js tests/geminiDualEngine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/tmdbService.js src/services/rankerService.js src/services/geminiService.js src/services/geminiChatService.js tests/moodRanker.test.js tests/geminiDualEngine.test.js
git commit -m "feat(recs): wire steerable tasteRules across retrieval, ranker, Gemini prompt, chat, and cache hash"
```

---

### Task 5: Persist `tasteRules` (`AppContext` + Schema v2 Backup), Expose Oracle UI Editor, Sync Docs, and Verify Build

**Files:**
- Modify: `src/context/AppContext.jsx:160-220`, `src/context/AppContext.jsx:965-1012` (never add `cinemavault_taste_rules_v1` to `safeSetItem`'s `purgeOrder`)
- Modify: `src/services/vaultPortability.js:94-112`, `src/services/vaultPortability.js:188-197`
- Modify: `src/components/BackupManagerModal.jsx:140-255`
- Modify: `src/components/MovieRecommendations.jsx:136-256`, `src/components/MovieRecommendations.jsx:640-790`
- Modify: `src/components/AIChat.jsx` (pass `tasteRules` from `useApp()` into `sendChatMessage`)
- Modify: `src/styles/oracle.css`
- Modify: `ARCHITECTURE.md`, `SPEC.md` (document Collection Guard + Steerable Taste Rules and sync exact test count)
- Test: `tests/vaultPortability.test.js`

**Interfaces:**
- `AppContext` provides: `tasteRules: TasteRule[]`, `setTasteRules`, `addTasteRule`, `updateTasteRule`, `deleteTasteRule`, `toggleTasteRuleActive`, `toggleTasteRulePin`. Stored under `cinemavault_taste_rules_v1` in `localStorage`.
- `buildBackupJsonPayload({ ..., tasteRules = [] })` stores `preferences.tasteRules` in schema v2 backups; `parseJsonBackupContent` returns `preferences.tasteRules` if present without failing on v1/older backups.
- `MovieRecommendations.jsx` passes `tasteRules` into `generateProfileHash` (`currentHash` + `newHash`) and `getMovieRecommendations(..., { tasteRules })`, and renders a compact collapsible **"Taste Rules (Steering)"** card inside the Oracle studio/filter deck (`Add prefer/avoid rule`, click chip to toggle active, pin/edit/delete icons, and `"Auto-Draft from Vault"` button calling `draftTasteRulesWithGemini`).

- [ ] **Step 1: Write failing round-trip & backward-compat test in `tests/vaultPortability.test.js`**

Add test asserting:
1. `buildBackupJsonPayload({ watched, watchlist, userRegion: "US", userWatchProviders: [8], tasteRules: [{ id: "r1", text: "No bleak misery", polarity: "avoid", active: true }] })` embeds `preferences.tasteRules`.
2. `parseJsonBackupContent` preserves `preferences.tasteRules` when present AND parses legacy backups lacking `tasteRules` with zero errors.

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/vaultPortability.test.js`
Expected: FAIL (`preferences.tasteRules` missing).

- [ ] **Step 3: Wire `AppContext`, `vaultPortability.js`, `AIChat.jsx`, `MovieRecommendations.jsx`, and `oracle.css`**

- Locate all callers of `buildBackupJsonPayload` and `applyVaultImportSnapshot` (`rg -n "buildBackupJsonPayload|applyVaultImportSnapshot" src/`) before editing so JSON backup restore seamlessly restores imported `preferences.tasteRules` (normalized via `normalizeTasteRules`) when present.
- In `AppContext.jsx`, persist `tasteRules` safely via `safeSetItem("cinemavault_taste_rules_v1", ...)` (do **not** alter Supabase `profiles` SQL columns unless a future migration is applied, and NEVER add `cinemavault_taste_rules_v1` to `safeSetItem`'s `purgeOrder`).
- In `BackupManagerModal.jsx`, wire `tasteRules` into `buildBackupJsonPayload` and pass `preferences.tasteRules` into `applyVaultImportSnapshot` (and clean up JSON import preview text if relevant).
- In `MovieRecommendations.jsx`, pass `tasteRules` to `generateProfileHash` and `getMovieRecommendations`, and render compact rule pills + add input + `"Auto-Draft"` action in `renderStudioDeck`.
- Sync `ARCHITECTURE.md` and `SPEC.md` with the new Collection Guard & Steerable Taste Rules documentation and updated test count.

- [ ] **Step 4: Run full test suite and production Vite build**

Run:
- `npm test`
- `npm run build`
Expected:
- `npm test`: `fail 0 | skipped 0` across all suites (including all new tests).
- `npm run build`: clean Vite build exit `0`.

- [ ] **Step 5: Commit**

```bash
git add src/context/AppContext.jsx src/services/vaultPortability.js src/components/BackupManagerModal.jsx src/components/MovieRecommendations.jsx src/components/AIChat.jsx src/styles/oracle.css tests/vaultPortability.test.js ARCHITECTURE.md SPEC.md
git commit -m "feat(ui): persist editable tasteRules, add backup round-trip and Oracle steering drawer"
```

---

## Explicitly Out of Scope (Deferred to Separate Future Plans)

1. **`v6.0` Cold-Start Contrastive Encoder (`/models/content_embeddings_f16.bin`):** Wait until 30–50 real `recSource` ratings accumulate, then create a separate Python/Colab ML plan (`scripts/colab_train_content_embeddings.py` + `scripts/experiments/run_partial_mask_eval.mjs`) covering 40k–50k TMDB titles up through 2026–2027 with contrastive item co-liking supervision and calibrated cold-only scoring weights.
2. **"Watch With Someone" 2-Vault Blend Mode:** Separate social feature using least-misery safety floor (`min(p_A, p_B) >= 0.55`) ranked by geometric mean `sqrt(p_A * p_B)` + combined anchor Gemini explanation.
3. **Rejected from codebase evidence:** Exposure of `dualClock` UI binge toggle (`tmdbService.js:287`) and in-ranker `64-D` MMR (`rankCandidatePool`) — deferred/skipped because bulk-imported logs default to `daysSince = 180` and cold 2024–2026 films lack `64-D` CF vectors.
