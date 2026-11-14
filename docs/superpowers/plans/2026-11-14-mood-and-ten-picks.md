# Mood-Driven Recommendations, "Match Vibe" End-to-End, 10 Picks & Refresh Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix CinemaVault's Film Oracle so selecting any of the 6 Mood presets or typing a custom "Match Vibe" query genuinely shifts retrieved candidates, ranker scores, and Gemini curation; raise the delivered recommendation count from 6 (shrinking to 4 in cache) to **10**; and rotate unseen picks on "Update Picks".

**Architecture:** Extract a zero-network canonical policy module (`src/services/moodPolicy.js`) shared across TMDB retrieval (`tmdbService.js`), the calibrated logistic ranker (`rankerService.js`), Gemini curation & smart caching (`geminiService.js`), and the Film Oracle UI (`MovieRecommendations.jsx` + `oracleViewHelpers.js`). Keep `"any"` mode with empty custom filters bit-for-bit invariant so offline MovieLens `evalRanker` benchmarks do not regress.

**Tech Stack:** React 18 (Vite), Vanilla ES Modules (`"type": "module"`), Node built-in test runner (`node --test`, `node:assert/strict`), `@google/genai` (plus `/api/*` Vercel proxy adapters).

**Spec:** User-scoped requirements from conversation (Mood accuracy across all 6 moods, full "Match Vibe" free-text filter enforcement, default recommendation target = `10`, cache reuse floor = `7`, session refresh exclusion; multi-account API key rotation explicitly excluded).

**Global Constraints:**
1. **Zero `"any"` Regression:** When `mood === "any"` and `moodFilters` has no active constraints, `DEFAULT_RANKER_WEIGHTS`, `scoreCandidate`, `buildBucketAParams`, `fetchCandidatePool` bucket quotas, and `generateProfileHash` (4-arg form) MUST behave identically to baseline (`evalRanker.test.js` and `recentReleaseSlots.test.js` remain green without relaxing assertions).
2. **Exact Count = `10`:** `DEFAULT_RECOMMENDATION_COUNT = 10` and `MIN_VALID_CACHE_COUNT = 7` across fallback ranker slices, Gemini re-rank prompts, OMDb fallback, backfill merging, and smart cache acceptance (never `4`, `6`, or `12`).
3. **Keyless Unit Tests:** All `node --test` suites run offline with dependency-injected mocks (`options.fetcher`, mock AI clients, in-memory `storage: null`) and zero live network calls.
4. **Preserve Unrelated Comments & API Compatibility:** Keep existing positional function signatures backward-compatible via optional trailing parameters/fields.

**Review Focus (Verify Before Completion):**
1. **Mood vs. Vault Gravity & `"any"` Invariant:** Does `comfort-watch` beat high-`collabSim` dark crime thrillers in `rankCandidatePool`, while `mood === "any"` produces exact baseline scores? *(Owned by Task 2 — `tests/moodRanker.test.js` + `tests/evalRanker.test.js`)*
2. **Cast Lock & Hidden-Gem Blockbuster Leak:** Does `buildBucketAParams` omit `with_cast` under explicit moods and set `vote_count.lte: 1500` on `hidden-gem` without breaking `any` `watchlistGenreIds` coverage? *(Owned by Task 1 & Task 2 — `tests/moodPolicy.test.js`, `tests/pipelineBugs.test.js`)*
3. **10-Pick Guarantee & Zombie 4-Card Cache:** Does Gemini returning `< 10` items backfill cleanly to `10` from ranked candidates, does `getSmartCache` reject stale `< 7`-item caches, and does `generateProfileHash` differentiate `moodFilters`? *(Owned by Task 3 — `tests/pipelineBugs.test.js`)*
4. **Match Vibe Proxy / Offline Fallback & React Closure Safety:** Does clicking "Match Vibe" fall back to deterministic local parsing when Gemini is unavailable, retain `{ withGenreIds, withoutKeywords, minYear, maxYear }`, and pass override values directly into `handleGetRecommendations`? *(Owned by Task 4 — `tests/oracleViewHelpers.test.js`)*
5. **Refresh Exhaustion Safety:** Does repeated "Update Picks" rotate TMDB pages + exclude `seenRecIds`, while gracefully relaxing exclusions instead of returning 0 picks when a narrow pool is exhausted? *(Owned by Task 3 & Task 4 — `tests/pipelineBugs.test.js`)*

---

## Task 1: Canonical Mood Policy & Custom Vibe Parser (`src/services/moodPolicy.js`)

**Files:**
- Create: `src/services/moodPolicy.js`
- Create: `tests/moodPolicy.test.js`

**Interfaces:**
- `DEFAULT_RECOMMENDATION_COUNT = 10`, `MIN_VALID_CACHE_COUNT = 7`
- `MOOD_OPTIONS`: Array of 6 canonical mood presets (`any`, `mind-bending`, `dark-thriller`, `fun-popcorn`, `comfort-watch`, `hidden-gem`), each containing `{ id, label, desc, preferredGenreIds, discouragedGenreIds, withoutGenreIds, sortBy, voteAverageGte, voteCountGte, voteCountLte, relaxCastLock, promptDirective }`
- `getMoodPreset(moodId = "any")`: Returns matching preset or `any` preset
- `normalizeMoodFilters(raw = null)`: Normalizes `{ query, moodId, withGenres, withGenreIds, withoutKeywords, minYear, maxYear }` using a canonical genre-name dictionary; returns `null` when all fields are empty/inactive
- `isExplicitMoodActive(mood = "any", moodFilters = null)`: Returns boolean (`true` iff `mood !== "any"` or normalized `moodFilters` has genre/keyword/year/query constraints)
- `parseFreeTextMoodFallback(rawQuery = "")`: Zero-network parser mapping common vibe phrases, decades (`"90s"`, `"after 2015"`), and genre names into normalized filter shape
- `buildMoodFilterHashSegment(moodFilters = null)`: Returns deterministic URL-safe hash string (empty string when `null`)

**Steps:**

- [ ] **Step 1: Write failing tests in `tests/moodPolicy.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RECOMMENDATION_COUNT,
  MIN_VALID_CACHE_COUNT,
  MOOD_OPTIONS,
  getMoodPreset,
  normalizeMoodFilters,
  isExplicitMoodActive,
  parseFreeTextMoodFallback,
  buildMoodFilterHashSegment
} from "../src/services/moodPolicy.js";

test("constants and MOOD_OPTIONS define 10-pick defaults and distinct mood constraints", () => {
  assert.equal(DEFAULT_RECOMMENDATION_COUNT, 10);
  assert.equal(MIN_VALID_CACHE_COUNT, 7);
  assert.deepEqual(MOOD_OPTIONS.map((m) => m.id), [
    "any",
    "mind-bending",
    "dark-thriller",
    "fun-popcorn",
    "comfort-watch",
    "hidden-gem"
  ]);

  const hiddenGem = getMoodPreset("hidden-gem");
  assert.equal(hiddenGem.voteCountLte, 1500);
  assert.equal(hiddenGem.relaxCastLock, true);

  const comfort = getMoodPreset("comfort-watch");
  assert.ok(comfort.preferredGenreIds.includes(35)); // Comedy
  assert.ok(comfort.discouragedGenreIds.includes(53)); // Thriller
  assert.ok(comfort.withoutGenreIds.includes(27)); // Horror
});

test("normalizeMoodFilters resolves genre names, clamps years, and builds deterministic hashes", () => {
  assert.equal(normalizeMoodFilters(null), null);
  assert.equal(normalizeMoodFilters({ moodId: "any" }), null);

  const a = normalizeMoodFilters({
    query: "like Drive but quieter",
    moodId: "dark-thriller",
    withGenres: ["Crime", "Sci-Fi"],
    withoutKeywords: ["Loud Explosions", "superhero"],
    minYear: 1995,
    maxYear: 2022
  });
  const b = normalizeMoodFilters({
    query: "like Drive but quieter",
    moodId: "dark-thriller",
    withGenres: ["Science Fiction", "crime"],
    withoutKeywords: ["superhero", "loud explosions"],
    minYear: 1995,
    maxYear: 2022
  });

  assert.deepEqual(a.withGenreIds, [80, 878]);
  assert.equal(buildMoodFilterHashSegment(a), buildMoodFilterHashSegment(b));
  assert.ok(isExplicitMoodActive("any", a));
  assert.equal(isExplicitMoodActive("any", null), false);
});

test("parseFreeTextMoodFallback extracts mood, decade, genres, and exclusions offline", () => {
  const cozy90s = parseFreeTextMoodFallback("cozy 90s comedy with no horror");
  assert.equal(cozy90s.moodId, "comfort-watch");
  assert.ok(cozy90s.withGenres.includes("Comedy"));
  assert.equal(cozy90s.minYear, 1990);
  assert.equal(cozy90s.maxYear, 1999);
  assert.ok(cozy90s.withoutKeywords.some((k) => k.includes("horror")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/moodPolicy.test.js`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `../src/services/moodPolicy.js`.

- [ ] **Step 3: Implement `src/services/moodPolicy.js`**

Write clean, dependency-free policy data and helpers matching all exported contracts:
- Include canonical `GENRE_NAME_TO_ID` dictionary matching `tmdbService.js` (`action: 28`, `adventure: 12`, `animation: 16`, `comedy: 35`, `crime: 80`, `documentary: 99`, `drama: 18`, `family: 10751`, `fantasy: 14`, `history: 36`, `horror: 27`, `music: 10402`, `musical: 10402`, `mystery: 9648`, `romance: 10749`, `"sci-fi": 878`, `"science fiction": 878`, `thriller: 53`, `war: 10752`, `western: 37`).
- In `normalizeMoodFilters(raw)`, sort `withGenreIds` ascending and sort lowercased `withoutKeywords` inside `buildMoodFilterHashSegment` so order differences produce identical cache hashes.
- In `parseFreeTextMoodFallback(rawQuery)`, detect mood hint keywords (`twist|mind-bending|cerebral|puzzle|surreal` -> `mind-bending`; `dark|noir|gritty|bleak|thriller` -> `dark-thriller`; `fun|popcorn|blockbuster|exciting` -> `fun-popcorn`; `comfort|cozy|warm|feel-good|wholesome|rewatchable` -> `comfort-watch`; `hidden|underrated|indie|obscure|cult` -> `hidden-gem`), decade expressions (`/\b(19\d0|20\d0)s\b/i` or `90s` -> `1990..1999`, `"after YYYY"`, `"before YYYY"`), negative phrases (`/\b(?:no|without|not|avoid|quieter than)\s+([a-z0-9\s-]{2,24})/gi`), and any known genre names.

- [ ] **Step 4: Run test to verify pass**

Run: `node --test tests/moodPolicy.test.js`
Expected: PASS (`3 / 3`).

- [ ] **Step 5: Commit Task 1**

```bash
git add src/services/moodPolicy.js tests/moodPolicy.test.js
git commit -m "feat: add canonical mood policy and offline vibe parser"
```

---

## Task 2: Mood-Aware TMDB Candidate Retrieval & Logistic Ranker (`tmdbService.js`, `rankerService.js`)

**Files:**
- Modify: `src/services/tmdbService.js` (reuse `GENRE_NAME_TO_ID`/`moodPolicy`, update `buildBucketAParams`, `fetchBucketA`, `fetchBucketD`, `fetchCandidatePool`)
- Modify: `src/services/rankerService.js` (add `computeMoodScoreAdjustment`, update `scoreCandidate`, `rankCandidatePool`)
- Create: `tests/moodRanker.test.js`

**Interfaces:**
- `buildBucketAParams(profile = {}, mood = "any", options = {}, apiKey = "")`:
  - Existing 3-4 arg callers on `"any"` produce exact legacy output (`lovedGenreIds.slice(0,4) + watchlistGenreIds.slice(0,3)`, `with_cast` kept when `"any"`).
  - Under explicit mood (`isExplicitMoodActive(mood, options.moodFilters)`): drops `with_cast` lock when `preset.relaxCastLock || explicitMood`; uses mood `preferredGenreIds` (or `moodFilters.withGenreIds`) without diluting with off-mood user genres (except `hidden-gem`, which inherits user loved genres + sets `"vote_count.lte": "1500"`); merges `preset.withoutGenreIds`; applies `minYear`/`maxYear` (`primary_release_date.gte`/`.lte`) and `options.page`.
- `fetchCandidatePool(profile, mood = "any", watchedMovies = [], watchlistMovies = [], options = {})`:
  - Rebalances quotas ONLY when `isExplicitMoodActive(mood, options.moodFilters)`: Bucket B gets 20% (max 12), Bucket C gets 12% (max 8), Bucket A gets remaining ~68% so mood-targeted candidates form the majority.
  - Passes `options.excludeIds` into collision filtering (`Array.isArray(options.excludeIds)`) and forwards `page: options.page || 1` to Bucket A & D.
  - Under `mood === "any"` with default options: quotas remain exact `35%` B / `20%` C / remainder A (preserving `tests/recentReleaseSlots.test.js`).
- `computeMoodScoreAdjustment(candidate = {}, mood = "any", moodFilters = null)` (exported from `rankerService.js`):
  - Returns `0` when `!isExplicitMoodActive(mood, moodFilters)`.
  - Computes additive logit delta from preferred genre hits (`+1.6..+2.4`), preferred misses (`-1.4`), discouraged genre hits (`-2.2` Horror on `comfort-watch`, `-1.1` others capped at `-2.4`), `hidden-gem` vote bounds (`50..1500` -> `+2.0`, `>15000` -> `-2.2`), and `moodFilters` year/keyword/genre rules.
- `rankCandidatePool(candidates = [], context = {}, weights = DEFAULT_RANKER_WEIGHTS, topK = 30, options = {}, reserve = undefined)`:
  - Filters `excludeIds = context.excludeIds || options.excludeIds` (matching `id`/`tmdbId`/`imdbID`) when provided.
  - Reads `mood = context.mood ?? options.mood ?? "any"` and `moodFilters = context.moodFilters ?? options.moodFilters ?? null`; adds `computeMoodScoreAdjustment` into `z` after baseline linear combination (`0` when `"any"`, leaving `"any"` bit-for-bit identical).

**Steps:**

- [ ] **Step 1: Write failing tests in `tests/moodRanker.test.js`**

Test cases:
1. `buildBucketAParams`: `"any"` keeps `with_cast` and legacy genres; `"comfort-watch"` omits `with_cast`, sets `with_genres: "35|10751|10749|16"` (not dark user Thriller `53`), excludes Horror `27`; `"hidden-gem"` sets `"vote_count.lte": "1500"`; custom `moodFilters` sets `primary_release_date.gte` / `.lte` and `"page": "2"`.
2. `fetchCandidatePool`: `"any"` preserves 35/20/45 split; `"comfort-watch"` promotes Bucket A share (`>= 60%`) and respects `options.excludeIds`.
3. `rankCandidatePool` `"any"` invariance: running with `{ mood: "any" }` yields exact same `_rankerScore` and order as omitting `mood`.
4. `rankCandidatePool` mood separation: given identical vault preferences and strong `collabSim = 0.6` on *Dark Grim Thriller* (`genres: [80, 53, 18]`, 20k votes) vs lower `collabSim = 0.25` on *Warm Comfort Comedy* (`genres: [35, 10751]`, 3k votes) and *Cult Hidden Gem* (`genres: [18, 9648]`, 600 votes), switching `context.mood` between `"dark-thriller"`, `"comfort-watch"`, and `"hidden-gem"` flips `#1` to the matching film.
5. `rankCandidatePool` custom filters & `excludeIds`: filters out `excludeIds` and penalizes out-of-year / blocked-keyword films under `moodFilters`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/moodRanker.test.js`
Expected: FAIL (`computeMoodScoreAdjustment` missing, `comfort-watch` still includes `with_cast` & dark score order).

- [ ] **Step 3: Update `src/services/tmdbService.js` and `src/services/rankerService.js`**

- In `src/services/tmdbService.js`:
  - Import `{ getMoodPreset, normalizeMoodFilters, isExplicitMoodActive } from "./moodPolicy.js"`.
  - Update `buildBucketAParams` (`lines 329-413`) with `explicitMood` branch, `vote_count.lte`, `without_genres`, `primary_release_date.gte`/`.lte`, `page`, and cast lock relaxation while preserving the exact `"any"` codepath.
  - Update `fetchBucketA` and `fetchBucketD` (`page` passthrough, capped >= 1) and `fetchCandidatePool` (`collisionSets` also ingests `options.excludeIds`, plus rebalanced `bucketBTarget`/`bucketCTarget` only when `isExplicitMoodActive(mood, options.moodFilters)` is true). Ensure helper normalization attaches numeric `tmdbGenreIds` when candidates come from keyword/search fallback.
- In `src/services/rankerService.js`:
  - Import `{ getMoodPreset, normalizeMoodFilters, isExplicitMoodActive, GENRE_NAME_TO_ID } from "./moodPolicy.js"`.
  - Implement and export `computeMoodScoreAdjustment(candidate, mood, moodFilters)` with a tiny `extractCandidateGenreIds(candidate)` helper.
  - Update `scoreCandidate` (accept optional `context` / `moodAdjustment` cleanly, or compute `moodAdjustment` inside `rankCandidatePool` after baseline `scoreCandidate` so existing 2-arg `scoreCandidate(features, weights)` callers stay unaffected!) — **cleaner:** apply `moodAdj = explicitMood ? computeMoodScoreAdjustment(c, mood, moodFilters) : 0` inside `rankCandidatePool` right onto `z` before `sigmoid(z)`! And expose `generateMatchReasons` mood badge awareness only when `mood !== "any"`.

- [ ] **Step 4: Run mood tests and regression benchmarks**

Run: `node --test tests/moodPolicy.test.js tests/moodRanker.test.js tests/recentReleaseSlots.test.js tests/evalRanker.test.js`
Expected: PASS on all suites, with zero regression in `evalRanker.test.js`.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/services/tmdbService.js src/services/rankerService.js tests/moodRanker.test.js
git commit -m "feat: make TMDB discovery and calibrated ranker mood- and filter-aware"
```

---

## Task 3: 10-Pick Pipeline Orchestration, Mood Prompting, Backfill & Smart Cache (`geminiService.js`, `pipelineBugs.test.js`)

**Files:**
- Modify: `src/services/geminiService.js`
- Modify: `tests/pipelineBugs.test.js`

**Interfaces:**
- Import `{ DEFAULT_RECOMMENDATION_COUNT, MIN_VALID_CACHE_COUNT, buildMoodFilterHashSegment, getMoodPreset, normalizeMoodFilters } from "./moodPolicy.js"` (and re-export `DEFAULT_RECOMMENDATION_COUNT`, `MIN_VALID_CACHE_COUNT`).
- `getSmartCache(hash, watched = [], watchlist = [])`: Returns cached object only when `validRecs.length >= MIN_VALID_CACHE_COUNT` (`7`).
- `generateProfileHash(profile, watchlistGenres = [], mood = "any", providers = [], moodFilters = null)`: Keeps 4-arg return byte-identical; appends `_${segment}` when `moodFilters` produces non-empty segment.
- `buildGeminiReRankPrompt(profile, mood, topCandidates = [], context = {})`: Uses `targetCount = context.targetCount || DEFAULT_RECOMMENDATION_COUNT` (`10`), includes `Mood Directive: ...` and explicit custom filter constraints when active, includes compact `votes` + `year` metadata per candidate, requests `Array of ${targetCount} items`.
- `mergeGeminiExplanationsWithRanker(geminiRecs = [], topCandidates = [], context = {}, targetCount = DEFAULT_RECOMMENDATION_COUNT)`: Resolves `effectiveTarget = Number(context?.targetCount ?? targetCount) || DEFAULT_RECOMMENDATION_COUNT`, preserves Gemini-curated items, and deterministically backfills remaining slots (up to `Math.min(effectiveTarget, topCandidates.length)`) from top-ranked unused candidates so output never drops below 10 when 10+ candidates exist.
- `buildRankerFallbackResponse(topCandidates, profile, modelInfo, reason, targetCount = DEFAULT_RECOMMENDATION_COUNT)`: Uses `.slice(0, targetCount)`.
- `reRankCandidatesWithGemini(ai, profile, mood, candidates, options = {})`: Passes `mood`, `moodFilters`, `excludeIds` to `rankCandidatePool(..., options.topK || 30, ...)`, and respects `targetCount = options.targetCount || DEFAULT_RECOMMENDATION_COUNT`.
- `generateWithOmdbFallback(...)`: Requests `targetCount` (`10`) items instead of `6`.
- `getMovieRecommendations(watchedMovies = [], watchlist = [], onProgress, options = {})`: Forwards `moodFilters`, `excludeIds`, `page`, `targetCount` to `fetchCandidatePool`, filters Bucket E (`embeddingCandidates`) and merged candidates against `excludeIds`, and if strict `excludeIds` reduces merged candidates below `targetCount`, relaxes exclusions gracefully on a fallback pass so refresh never empties results.

**Steps:**

- [ ] **Step 1: Update `tests/pipelineBugs.test.js` expectations & add new failing tests**

- Inspect lines `180-360` of `tests/pipelineBugs.test.js` only if exact mock pool arrays need expanding from 6/8 items to 12 items and assertions updated from `6` to `10` (for the 3 existing tests covering `reRankCandidatesWithGemini` fallback, null response, and keyless ranker completion).
- Add new failing test cases in `tests/pipelineBugs.test.js`:
  1. `getSmartCache` rejects caches that shrink below `7` un-watched picks (e.g. cached 10 -> user watched 4 -> remaining 6 returns `null`; cached 10 -> watched 2 -> remaining 8 returns valid cache).
  2. `generateProfileHash` distinguishes two different `moodFilters` objects while keeping 4-arg `"any"` hash unchanged.
  3. `reRankCandidatesWithGemini` shortlists up to `30` candidates to Gemini, prompt demands `10` recommendations + mood directive, and when Gemini only returns `6` items, `mergeGeminiExplanationsWithRanker` backfills cleanly to `10` without duplicates.
  4. `getMovieRecommendations` with `excludeIds` omits previously shown IDs and switches cleanly if exclusions exhaust pool.

- [ ] **Step 2: Run `tests/pipelineBugs.test.js` to confirm failure**

Run: `node --test tests/pipelineBugs.test.js`
Expected: FAIL on 10-pick length, cache `< 7` threshold, prompt `"Select 10"` / mood directive, and backfill count.

- [ ] **Step 3: Update `src/services/geminiService.js`**

- Update `getSmartCache`, `generateProfileHash`, `buildGeminiReRankPrompt`, `mergeGeminiExplanationsWithRanker`, `buildRankerFallbackResponse`, `reRankCandidatesWithGemini`, `generateWithOmdbFallback`, and `getMovieRecommendations` per Interfaces above.
- Keep `parseFreeTextMoodWithGemini(null, ...)` returning `null` cleanly when no AI client is passed so existing offline degradation tests stay intact.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/pipelineBugs.test.js tests/geminiDualEngine.test.js tests/moodRanker.test.js`
Expected: PASS (`0` failures).

- [ ] **Step 5: Commit Task 3**

```bash
git add src/services/geminiService.js tests/pipelineBugs.test.js
git commit -m "feat: raise pipeline target to 10 picks with mood curation, backfill, and cache floor 7"
```

---

## Task 4: Wire "Match Vibe" End-to-End, Refresh Rotation & Cache Floor in Oracle UI (`oracleViewHelpers.js`, `MovieRecommendations.jsx`)

**Files:**
- Modify: `src/services/oracleViewHelpers.js` (add pure helpers `formatActiveVibeNote`, `nextRefreshExcludeState`)
- Modify: `tests/oracleViewHelpers.test.js` (or inspect & extend existing helper tests)
- Modify: `src/components/MovieRecommendations.jsx`

**Interfaces:**
- `formatActiveVibeNote(filters, moodOptions = MOOD_OPTIONS)` in `src/services/oracleViewHelpers.js`: Formats human-readable status note (e.g. `"Active vibe: Comfort Watch • Comedy • Before 2000 • Avoiding horror"`) or fallback note cleanly.
- `nextRefreshExcludeState(prevState = { seenIds: [], page: 1 }, currentRecs = [], forceRefresh = false)` in `src/services/oracleViewHelpers.js`: When `!forceRefresh`, returns `{ seenIds: [], excludeIds: [], page: 1 }`; when `forceRefresh` is true, appends IDs from `currentRecs` (`tmdbId`/`id`/`imdbID`) into a deduplicated bounded array (`<= 120` IDs) and advances `page` cyclically (`1 -> 2 -> 3 -> 4 -> 5 -> 1`), returning `{ seenIds, excludeIds, page }`.
- In `src/components/MovieRecommendations.jsx`:
  - Replace local `MOOD_OPTIONS` with canonical import from `../services/moodPolicy`.
  - Add `activeMoodFilters` state (`null` by default) + `refreshStateRef` (`{ seenIds: [], page: 1 }`).
  - Include `activeMoodFilters` in `currentHash` and `setSmartCache` hash calculation.
  - Raise cache reuse guard in `useEffect` (`lines 168-180`) from `>= 4` to `>= MIN_VALID_CACHE_COUNT` (`7`).
  - Pass `{ mood: effectiveMood, moodFilters: effectiveFilters, excludeIds, page, userRegion, userProviders, feedbackLog, targetCount: DEFAULT_RECOMMENDATION_COUNT }` to `getMovieRecommendations` (using override args in `handleGetRecommendations` to eliminate stale closure state when `"Match Vibe"` changes mood/filters).
  - In `handleApplyFreeTextMood`: try `createGeminiClient(resolveGeminiKey())` + `parseFreeTextMoodWithGemini`, fall back to `parseFreeTextMoodFallback(query)` whenever offline or null, store normalized `activeMoodFilters`, set `selectedMood` if matched, reset `refreshStateRef` to `{ seenIds: [], page: 1 }`, set `moodParseNote` via `formatActiveVibeNote`, and trigger `handleGetRecommendations({ forceRefresh: true, moodOverride: nextMood, moodFiltersOverride: normalized })`.
  - When user clicks a `MOOD_OPTIONS` preset button or **"Start over"**, clear `activeMoodFilters`, clear `moodParseNote` (and `customMoodQuery` on Start over), and reset `refreshStateRef` so switching moods never leaks prior free-text filters or exclusions.

**Steps:**

- [ ] **Step 1: Inspect `tests/oracleViewHelpers.test.js` and add failing helper tests**

Add tests in `tests/oracleViewHelpers.test.js` covering:
1. `formatActiveVibeNote` renders preset label, genres, year bounds, and avoided keywords concisely.
2. `nextRefreshExcludeState` accumulates shown film IDs up to cap (`120`) and increments TMDB page (`1 -> 2 -> 3 ...`, resetting cleanly when `forceRefresh` is false or on mood switch).

- [ ] **Step 2: Run helper tests to confirm failure**

Run: `node --test tests/oracleViewHelpers.test.js`
Expected: FAIL (`formatActiveVibeNote` and `nextRefreshExcludeState` not exported).

- [ ] **Step 3: Implement helpers in `oracleViewHelpers.js` and wire `MovieRecommendations.jsx`**

- Implement `formatActiveVibeNote` and `nextRefreshExcludeState` in `src/services/oracleViewHelpers.js`.
- Refactor `src/components/MovieRecommendations.jsx` (`lines 54-61`, `126-261`, `168-235`, `323-355`, mood selector pill handler & UI badge for active vibe if query active).

- [ ] **Step 4: Run full test suite and production Vite build**

Run:
- `npm test`
- `npm run build`
Expected:
- All tests in `node --test` pass (`0` failures, `0` skipped).
- `vite build` succeeds with zero bundle/import errors.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/services/oracleViewHelpers.js src/components/MovieRecommendations.jsx tests/oracleViewHelpers.test.js
git commit -m "feat: wire Match Vibe filters, 10-pick cache floor, and refresh rotation in Oracle UI"
```

---

## Plan Self-Review Checklist
- [x] Every user request is addressed: 6 mood accuracy, full Match Vibe filter execution, 10 recommendations (`DEFAULT_RECOMMENDATION_COUNT = 10`, cache floor `7`), refresh rotation (`excludeIds` + page increment).
- [x] Zero `"any"` regression guaranteed via explicit `isExplicitMoodActive` branch guard.
- [x] File paths, function names, and signatures verified against current repository files before writing.
- [x] Every task has exact test -> fail -> implement -> verify -> commit steps with no skipped checks.
