# CinemaVault UX Overhaul, Opt-In Row Scroll, Explore "For You" & Decluttered Oracle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine horizontal row wheel scrolling so it never hijacks vertical page scrolling, add a cached 100-film personalized `"For You"` mode to Explore powered by the on-device ML ranker + dual Flash-Lite (`3.5-flash-lite` + `3.1-flash-lite`) with IndexedDB & optional Supabase sync, declutter the Film Oracle studio behind a unified `"Filters & Rules"` dropdown, replace jarring native OS `<select>` menus, fix unreleased-film and storage-eviction bugs, and elevate site-wide scroll animations and tactile motion.

**Architecture:** All new domain logic lives in focused pure ES modules (`scrollHelpers.js`, `exploreForYouService.js`, `exploreForYouCache.js`, `oracleViewHelpers.js`) tested via `node --test` before UI wiring. Explore `"For You"` reuses the existing local 5-bucket retrieval + 25k-film CVEM v1 ranker to select ~120 unseen candidates, runs a single compact Gemini Flash-Lite batch curation call per taste-profile hash (1 call out of 1,000/day across `3.5-flash-lite` + `3.1-flash-lite`), persists the ~80–100 curated films locally in IndexedDB (and optionally in Supabase `public.user_explore_picks` with RLS when signed in), and applies all Explore Deep Filters and quality-weighted shuffling client-side in zero API calls.

**Tech Stack:** React 18, Vite 5, Tailwind CSS v4, Framer Motion 12, Lucide React, Node built-in test runner (`node --test`), Google GenAI SDK (`@google/genai`), Supabase JS + Postgres 17 RLS.

**Spec:** [SPEC.md](../../../SPEC.md) (neutral obsidian palette, brass `--accent` reserved strictly for ratings/focus rings, zero emojis in UI/prompt copy, `transform`/`opacity`-only motion, full `prefers-reduced-motion` support).

---

## Global Constraints

- **Design Tokens & Aesthetic (`SPEC.md`):** Dark neutral obsidian (`--bg: #0d0e11`, `--surface-1..3`, `--hairline`), warm brass `--accent` strictly reserved for star ratings and focus rings. No neon gradients, no blur aura slop, no emojis anywhere in JSX or prompt strings.
- **Motion Discipline (`src/motion.js`):** Animate `transform` and `opacity` only; every scroll reveal, Ken Burns drift, and rAF glide MUST degrade cleanly when `prefers-reduced-motion: reduce` is enabled.
- **Public vs. Personal Edition Boundary:** Default Public UI never displays raw `gemini-` slugs or debug telemetry (`isDebugUiEnabled()` gates all model metadata).
- **Storage Safety:** Never store large multi-film catalogs (like 100-film Explore "For You" pools) in `localStorage`; persist large derived caches in IndexedDB (with memory fallback) and optional Supabase RLS when signed in. Sample vault rows (`isSample: true`) NEVER sync to Supabase.
- **No Unreleased Clutter by Default:** Default Explore & Discover feeds must exclude future unreleased placeholder titles unless the user explicitly enters a future `yearTo` or opts into upcoming releases.

## Review Focus

1. **Vertical Page Scroll Never Trapped by Horizontal Rows:** Scrolling down Discover (`/`) or Movie Detail (`/movie/:id`) with the mouse cursor passing across poster rows MUST smoothly scroll the page vertically unless the user explicitly clicked to engage a row or holds `Shift` — and moving the cursor away or pressing `Escape` immediately releases the row.
2. **Explore `"For You"` Cold Start, Quota Fallback, and Sample Vault Isolation:** A visitor with `< 3` rated films sees a clear prompt to calibrate or try a sample vault without crashing; a visitor whose Gemini quota is exhausted still receives ~80–100 ranked films from the local ML engine; sample vaults cache only locally in IndexedDB and NEVER write to `public.user_explore_picks` on Supabase.
3. **Explore `"For You"` Live Filter & Shuffle Integrity:** Applying Deep Filters (Genres, Decade, Runtime, Min IMDb, Exclude Genres, Hide Watched) in `"For You"` mode filters the 100-film pool instantaneously without firing new Gemini or TMDB calls; clicking `"Shuffle Order"` changes film ordering while keeping higher-affinity titles weighted earlier and never duplicating IDs.
4. **Custom Dark `<Select>` Keyboard & Viewport Safety:** Every replaced `<select>` (Explore Sort/Vote/Language/Country, Oracle Sort/Region, Vault Genre/Sort, Person Sort) supports click, `ArrowUp`/`ArrowDown`/`Enter`/`Escape`, closes on outside click, and never clips off-screen at `390px` mobile width.
5. **Dual Flash-Lite Model Allowlist & Thinking Budget:** `gemini-3.1-flash-lite` works both through `/api/gemini` proxy allowlist and direct BYOK, uses `thinkingLevel: "MINIMAL"` for fast/batch requests so output tokens are never consumed empty, and falls back smoothly if either `3.5-flash-lite` or `3.1-flash-lite` hits 429.

---

## File Structure Map

| File | Responsibility |
| --- | --- |
| `src/services/scrollHelpers.js` | Modify — gate wheel-to-horizontal glide behind `Shift+Wheel` or explicit engaged state; expose engagement controller helpers. |
| `src/hooks/useHorizontalWheelScroll.js` | Modify — manage opt-in row engagement (`isEngaged`, `engage`, `release`, `toggleEngaged`), auto-release on `pointerleave` / outside click / `Escape`. |
| `src/components/MovieCarouselRow.jsx` | Modify — wire opt-in `"Scroll row"` pill + row border click engagement + subtle engaged highlight. |
| `src/components/SimilarFilmsStrip.jsx` | Modify — wire opt-in row engagement pill + `<ScrollRevealSection>` entrance. |
| `src/components/CollectionTimeline.jsx` | Modify — wire opt-in row engagement pill + `<ScrollRevealSection>` entrance. |
| `api/gemini.js` | Modify — allowlist `"gemini-3.1-flash-lite"`. |
| `src/services/geminiService.js` | Modify — add `"gemini-3.1-flash-lite"` to `PUBLIC_CURATION_CASCADE`, `FAST_INTERACTIVE_CASCADE`, `EXPLORE_FOR_YOU_CASCADE`, `MODEL_DISPLAY_NAMES`, `getModelThinkingConfig`, timeouts. |
| `src/services/exploreForYouService.js` | Create — build ~120-candidate pool from local ML ranker + single-shot Flash-Lite batch curation for ~80–100 verified TMDB films + `weightedShuffleForYou` + `filterForYouCatalog`. |
| `src/services/exploreForYouCache.js` | Create — IndexedDB local cache (7-day TTL, keyed by `profileHash`, memory fallback) + optional Supabase `user_explore_picks` read/write guarded against `isSample` & guest state. |
| `supabase/migrations/20261120000000_explore_for_you_cache.sql` | Create — RLS-hardened `public.user_explore_picks` table (1 row per user, capped JSONB items). |
| `src/services/exploreService.js` | Modify — support `mode: "catalog" \| "for-you"`, `sortBy: "for_you"`, `includeUpcoming: boolean`, default `primary_release_date.lte` = today when `yearTo` is empty. |
| `src/pages/ExplorePage.jsx` & `src/styles/explore.css` | Modify — add `Catalog | For You` header toggle, `Shuffle Order` & `Refresh Picks` controls, match score/vibe tag display, `animateOnScroll`, custom `<Select>`, `useDocumentTitle("Explore")`. |
| `src/components/ui/Select.jsx` & `src/components/ui/index.js` | Create / Modify — accessible dark glass editorial `<Select>` primitive replacing native OS `<select>`. |
| `src/components/OraclePreferencesPopover.jsx` | Create — unified `"Filters & Rules"` popover/drawer housing Region, Streaming Services, Taste Rules + Auto-Draft, and BYOK AI Key. |
| `src/components/MovieRecommendations.jsx` & `src/styles/oracle.css` | Modify — declutter 5-tier Studio Deck into a clean 2-tier Command Bar + `OraclePreferencesPopover`, animated mood pills, staggered scroll reveals on pick rows. |
| `src/services/dashboardService.js` & `src/context/AppContext.jsx` | Modify — add release-date ceiling to Discover TMDB discover lanes so unreleased placeholders stay out; expand `safeSave` `purgeOrder` to prevent storage quota errors. |
| `src/components/ui/Tabs.jsx` & `src/components/ScrollRevealSection.jsx` | Modify / Create — add spring `layoutId` underline to `Tabs`; create reusable GPU scroll-reveal wrapper for Movie Details, Vault, Oracle, and Strips. |
| `src/components/HeroBillboard.jsx`, `src/components/MovieDetails.jsx`, `src/pages/{MoviePage,PersonPage,ComparePage}.jsx`, `src/styles/*.css` | Modify — subtle Hero Ken Burns drift, poster specular hover craft, section scroll reveals, missing `useDocumentTitle` calls, custom `<Select>` adoption. |

---

## Phase 1: Safe Opt-In Horizontal Row Scrolling

### Task 1: Gate Horizontal Wheel Scroll Behind Opt-In Row Engagement & `Shift+Wheel`

**Files:**
- Modify: `src/services/scrollHelpers.js`
- Modify: `src/hooks/useHorizontalWheelScroll.js`
- Modify: `src/components/MovieCarouselRow.jsx`
- Modify: `src/components/SimilarFilmsStrip.jsx`
- Modify: `src/components/CollectionTimeline.jsx`
- Modify: `src/styles/nav-discover.css`
- Modify: `src/index.css`
- Test: `tests/scrollHelpers.test.js`

**Interfaces:**
- Produces in `src/services/scrollHelpers.js`:
  - `computeHorizontalWheelDelta(input)` extended with `{ engaged = false, shiftKey = false, requireActivation = true }` -> returns `null` when `requireActivation && !engaged && !shiftKey`.
  - `attachHorizontalWheelScroll(el, options)` accepts `isEngagedFn?: () => boolean` and `requireActivation?: boolean` (defaults to `true`).
- Produces in `src/hooks/useHorizontalWheelScroll.js`:
  - `useHorizontalWheelScroll(deps = [], existingRef = null)` returns `{ ref, isEngaged, engage, release, toggleEngaged, handleTrackClick }` where clicking non-interactive row track/border engages the row, and `pointerleave` on the row container, outside `pointerdown`, or `Escape` auto-releases it.

- [ ] **Step 1: Write failing tests in `tests/scrollHelpers.test.js`**
  Add tests proving:
  1. `computeHorizontalWheelDelta` returns `null` by default (`requireActivation: true`, `engaged: false`, `shiftKey: false`) so plain vertical scrolling over a row NEVER hijacks vertical page scroll.
  2. Returns non-null horizontal delta when `engaged: true` OR `shiftKey: true` (while still respecting left/right `<= 4px` edges and native `deltaX`).
  3. `attachHorizontalWheelScroll(el, { isEngagedFn: () => active })` ignores wheel events without `preventDefault()` while `active === false`, intercepts and glides smoothly when `active === true` OR `e.shiftKey === true`, and immediately stops any active glide if `active` flips back to `false`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/scrollHelpers.test.js`
  Expected: FAIL (currently intercepts wheel without `engaged` or `shiftKey`).

- [ ] **Step 3: Implement opt-in gating in `src/services/scrollHelpers.js` and `src/hooks/useHorizontalWheelScroll.js`**
  - Update `computeHorizontalWheelDelta` signature to check `if (requireActivation && !engaged && !shiftKey) return null;` before scaling `deltaY`.
  - Update `attachHorizontalWheelScroll(el, options)` to read `engaged = typeof options.isEngagedFn === "function" ? Boolean(options.isEngagedFn()) : Boolean(options.engaged)` and pass `shiftKey: Boolean(e.shiftKey)` + `requireActivation: options.requireActivation !== false`.
  - Update `useHorizontalWheelScroll(deps = [], existingRef = null)` to manage `isEngaged` state via ref + React state, attach global `keydown` (`Escape`) and outside `pointerdown` release listeners while engaged, attach `pointerleave` auto-release on the row wrapper, and expose `handleTrackClick(e)` (engages when clicking the track/rail background rather than inside an interactive card button/link).

- [ ] **Step 4: Wire opt-in `"Wheel scroll"` toggle pill & engaged ring on `MovieCarouselRow.jsx`, `SimilarFilmsStrip.jsx`, `CollectionTimeline.jsx`**
  - Add a subtle editorial button (e.g. `ArrowLeftRight` Lucide icon + `"Scroll row"` / `"Scrolling · Esc"`) in each row header when `canScroll` (Discover) or overflowing (Similar Films / Franchise Timeline), plus `onClick={handleTrackClick}` and `onPointerLeave={release}` on the strip container.
  - Style `[data-wheel-engaged="true"]` in `src/styles/nav-discover.css` and `src/index.css` with a crisp `1px solid var(--hairline-strong)` highlight ring and muted status pill (zero neon glow).

- [ ] **Step 5: Run tests and verify pass**
  Run: `node --test tests/scrollHelpers.test.js`
  Expected: PASS (all tests green).

- [ ] **Step 6: Commit**
  `git add src/services/scrollHelpers.js src/hooks/useHorizontalWheelScroll.js src/components/MovieCarouselRow.jsx src/components/SimilarFilmsStrip.jsx src/components/CollectionTimeline.jsx src/styles/nav-discover.css src/index.css tests/scrollHelpers.test.js && git commit -m "feat(ui): make horizontal row wheel scroll opt-in via row engagement or Shift+Wheel"`

---

## Phase 2: Dual Flash-Lite Cascade & Explore "For You" (100-Film Personalized Mode)

### Task 2: Add Live Verified `gemini-3.1-flash-lite` to Cascades & API Proxy Allowlist (1,000/day Free Pool)

**Files:**
- Modify: `api/gemini.js:5-15`
- Modify: `src/services/geminiService.js:58-165`
- Modify: `scripts/list_gemini_models.mjs`
- Test: `tests/apiProxy.test.js`, `tests/geminiDualEngine.test.js`

**Interfaces:**
- Produces in `src/services/geminiService.js`:
  - `EXPLORE_FOR_YOU_CASCADE = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-2.5-flash"]`
  - `"gemini-3.1-flash-lite"` added right after `"gemini-3.5-flash-lite"` in `PUBLIC_CURATION_CASCADE` and `FAST_INTERACTIVE_CASCADE`, registered in `MODEL_DISPLAY_NAMES` (`"Gemini 3.1 Flash-Lite"`), `getModelThinkingConfig` (`{ thinkingLevel: isFast ? "MINIMAL" : "LOW" }`), and `getDefaultAttemptTimeoutMs`.

- [ ] **Step 1: Write failing tests in `tests/apiProxy.test.js` and `tests/geminiDualEngine.test.js`**
  - In `tests/apiProxy.test.js`: assert `ALLOWED_GEMINI_MODELS.has("gemini-3.1-flash-lite")` is `true` and POST `/api/gemini` with `model: "gemini-3.1-flash-lite"` succeeds.
  - In `tests/geminiDualEngine.test.js`: assert `PUBLIC_CURATION_CASCADE.slice(0, 2)` is `["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]`, `EXPLORE_FOR_YOU_CASCADE.slice(0, 2)` is `["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]`, and `getModelThinkingConfig("gemini-3.1-flash-lite", "fast")` returns `{ thinkingLevel: "MINIMAL" }` while `"curation"` returns `{ thinkingLevel: "LOW" }`.

- [ ] **Step 2: Run tests to verify failure**
  Run: `node --test tests/apiProxy.test.js tests/geminiDualEngine.test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement `gemini-3.1-flash-lite` support in `api/gemini.js`, `src/services/geminiService.js`, and `scripts/list_gemini_models.mjs`**
  - Add `"gemini-3.1-flash-lite"` to `ALLOWED_GEMINI_MODELS` in `api/gemini.js`.
  - Update `PUBLIC_CURATION_CASCADE`, `FAST_INTERACTIVE_CASCADE`, export `EXPLORE_FOR_YOU_CASCADE`, add `MODEL_DISPLAY_NAMES["gemini-3.1-flash-lite"]`, update `getModelThinkingConfig` (`gemini-3.1-flash-lite` -> `{ thinkingLevel: isFast ? "MINIMAL" : "LOW" }`), and include `"gemini-3.1-flash-lite"` in `getDefaultAttemptTimeoutMs` and `scripts/list_gemini_models.mjs`.

- [ ] **Step 4: Run tests to verify pass**
  Run: `node --test tests/apiProxy.test.js tests/geminiDualEngine.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add api/gemini.js src/services/geminiService.js scripts/list_gemini_models.mjs tests/apiProxy.test.js tests/geminiDualEngine.test.js && git commit -m "feat(ai): add gemini-3.1-flash-lite to cascades, proxy allowlist, and Explore For You cascade"`

---

### Task 3: Build Explore `"For You"` 100-Film Personalized Engine (`exploreForYouService.js`)

**Files:**
- Create: `src/services/exploreForYouService.js`
- Test: `tests/exploreForYouService.test.js`

**Interfaces:**
- Consumes: `extractTasteProfile`, `fetchCandidatePool`, `fetchEmbeddingCandidates` (`tmdbService.js`); `rankCandidatePool`, `DEFAULT_RANKER_WEIGHTS` (`rankerService.js`); `loadDefaultEmbeddingIndex`, `buildCollabSimMapFromIndex`, `buildRepulsionMapFromIndex`, `getCollabCatalogMax` (`embeddingService.js`); `EXPLORE_FOR_YOU_CASCADE`, `executeCascade`, `createGeminiClient`, `generateProfileHash` (`geminiService.js`); `resolveGeminiKey` (`apiTransport.js`); `findMatchingMovie` (`movieIdentity.js`); `filterExploreResults` (`exploreService.js`).
- Produces in `src/services/exploreForYouService.js`:
  - `EXPLORE_FOR_YOU_TARGET_COUNT = 100`
  - `EXPLORE_FOR_YOU_MIN_RATED = 3`
  - `buildExploreForYouProfileHash({ watched, watchlist, tasteRules, userRegion }) -> string`
  - `buildExploreForYouBatchPrompt(profile, candidates, { watched, tasteRules, targetCount = 100 }) -> string` (compact prompt `<= 28,000` chars listing candidate IDs + titles/years/genres/scores for 1-shot Flash-Lite scoring & vibe tagging)
  - `mergeExploreForYouResponse(candidates, geminiItems, { targetCount = 100 }) -> Array<ForYouFilm>` (strictly verifies every returned `tmdbId` against the input TMDB candidate map — zero hallucinations — attaches `forYouScore` 50–99, `vibeTag`, `forYouReason`, and backfills from the deterministic local ML ranker up to `targetCount`)
  - `weightedShuffleForYou(items, seed) -> Array<ForYouFilm>` (quality-weighted seeded shuffle: `key = forYouScore + (seededRand - 0.5) * 26`, preserving affinity bias while producing a fresh order on every session/shuffle with zero duplicates)
  - `filterForYouCatalog(items, filters, watched, watchlist) -> Array<ForYouFilm>` (applies all Explore Deep Filters locally: `genres` AND/OR, `withoutGenres`, `yearFrom`, `yearTo`, `runtimeMin`, `runtimeMax`, `minImdb`, `minVotes`, `language`, `country`, `hideWatched`, `sortBy` supporting `"for_you"`, `"popularity.desc"`, `"vote_average.desc"`, `"primary_release_date.desc"`, `"vote_count.desc"`)
  - `generateExploreForYouPool({ watched, watchlist, tasteRules, feedbackLog, userRegion, userWatchProviders, aiClient?, candidates?, targetCount = 100 }) -> Promise<{ items, profileHash, source: "gemini-flash-lite" | "local-ranker", modelUsed: string | null, generatedAt: number }>`

- [ ] **Step 1: Write failing tests in `tests/exploreForYouService.test.js`**
  Cover:
  1. `buildExploreForYouBatchPrompt` stays `< 28,000` chars even for 120 candidates + 50 watched films and contains zero emojis.
  2. `mergeExploreForYouResponse` rejects hallucinated `tmdbId` values not present in the verified candidate pool, keeps AI-curated `forYouScore`/`vibeTag`/`forYouReason`, deduplicates IDs, and backfills deterministically from the local ranker up to `targetCount` (e.g. 100).
  3. `weightedShuffleForYou` returns a permutation of exact same length & unique IDs, varies ordering across different seeds, and keeps top-affinity items statistically ahead of low-affinity items.
  4. `filterForYouCatalog` filters locally by genre (`and`/`or`), `withoutGenres`, `yearFrom`/`yearTo`, `minImdb`, `language`, `hideWatched`, and sorts by `for_you` vs `vote_average.desc` vs `primary_release_date.desc`.
  5. `generateExploreForYouPool` with a failing/null `aiClient` still returns `source: "local-ranker"` with ranked unseen films (Review Focus #2).

- [ ] **Step 2: Run test to verify failure**
  Run: `node --test tests/exploreForYouService.test.js`
  Expected: FAIL (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Implement `src/services/exploreForYouService.js`**
  - For single-shot Gemini Flash-Lite batching, pass `config: { responseMimeType: "application/json", maxOutputTokens: 8192, thinkingConfig: { thinkingLevel: "MINIMAL" } }` through `executeCascade(ai, EXPLORE_FOR_YOU_CASCADE, ..., { cascadeType: "fast" })` so the single JSON response (`[{ id, s, tag, r }]` compact keys) scores & tags up to 100 verified TMDB candidates in one fast call without exceeding output token limits.
  - Strictly exclude any watched film or `dismissed` / `already_seen` film from `feedbackLog`.

- [ ] **Step 4: Run test to verify pass**
  Run: `node --test tests/exploreForYouService.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add src/services/exploreForYouService.js tests/exploreForYouService.test.js && git commit -m "feat(explore): add 100-film personalized For You engine with single-shot Flash-Lite batching"`

---

### Task 4: Local IndexedDB + Optional Supabase `user_explore_picks` Cache Layer

**Files:**
- Create: `supabase/migrations/20261120000000_explore_for_you_cache.sql`
- Create: `src/services/exploreForYouCache.js`
- Test: `tests/exploreForYouCache.test.js`

**Interfaces:**
- Consumes: `getSupabaseClient`, `hasSupabaseConfig` (`supabaseClient.js`); `isSampleItem` (`sampleVaultService.js`).
- Produces in `src/services/exploreForYouCache.js`:
  - `EXPLORE_FOR_YOU_TTL_MS = 7 * 24 * 60 * 60 * 1000` (7 days)
  - `compactForYouItemForCache(movie)` -> strips bloated fields, preserves card + Deep Filter fields (`tmdbId`, `imdbID`, `id`, `title`, `year`, `poster`, `genre`, `tmdbGenreIds`, `imdbRating`, `vote_average`, `vote_count`, `runtime`, `original_language`, `originCountry`, `release_date`, `forYouScore`, `vibeTag`, `forYouReason`).
  - `loadExploreForYouCache({ profileHash, userId?, hasSampleData?, supabaseClient?, idb? }) -> Promise<{ items, source, modelUsed, generatedAt, from: "idb" | "supabase" } | null>`
  - `saveExploreForYouCache({ profileHash, items, source, modelUsed, generatedAt, userId?, hasSampleData?, supabaseClient?, idb? }) -> Promise<void>`
  - `clearExploreForYouCache({ userId?, supabaseClient?, idb? }) -> Promise<void>`

- [ ] **Step 1: Create Supabase RLS migration `supabase/migrations/20261120000000_explore_for_you_cache.sql`**
  Follow Supabase Postgres best practices strictly:
  - Table `public.user_explore_picks` (`user_id uuid primary key references auth.users(id) on delete cascade`, `profile_hash text not null`, `source text not null default 'local-ranker'`, `model_used text`, `items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 120)`, `updated_at timestamptz not null default now()`).
  - Attach `public.touch_updated_at()` trigger; `alter table public.user_explore_picks enable row level security;`; `revoke all on public.user_explore_picks from public, anon;`; `grant select, insert, update, delete on public.user_explore_picks to authenticated;`; 4 policies (`select`, `insert`, `update`, `delete`) using `(select auth.uid()) = user_id`.

- [ ] **Step 2: Write failing tests in `tests/exploreForYouCache.test.js`**
  Cover:
  1. `compactForYouItemForCache` preserves all card + filter fields while stripping oversized blobs (`overview`, `credits`, `videos`, etc.).
  2. Local cache round-trips cleanly with memory fallback when `indexedDB` is absent, expires stale records past `EXPLORE_FOR_YOU_TTL_MS`, and misses on changed `profileHash`.
  3. When `userId` is set and `hasSampleData` is `false`, `loadExploreForYouCache` falls back to Supabase when local cache misses and re-hydrates local cache; `saveExploreForYouCache` upserts to `user_explore_picks` cleanly.
  4. When `hasSampleData: true` (Review Focus #2), Supabase `from("user_explore_picks")` is NEVER called on load or save.

- [ ] **Step 3: Run test to verify failure**
  Run: `node --test tests/exploreForYouCache.test.js`
  Expected: FAIL (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 4: Implement `src/services/exploreForYouCache.js`**
  - Use IndexedDB database `cinemavault_explore_for_you_v1` (store `pools`) with silent fallback to an in-memory `Map` (never writes large pools to `localStorage`).
  - Guard all Supabase network calls inside `try/catch` so missing migration or offline state fails open cleanly to local cache without user-facing crashes.

- [ ] **Step 5: Run test to verify pass**
  Run: `node --test tests/exploreForYouCache.test.js`
  Expected: PASS.

- [ ] **Step 6: Commit**
  `git add supabase/migrations/20261120000000_explore_for_you_cache.sql src/services/exploreForYouCache.js tests/exploreForYouCache.test.js && git commit -m "feat(explore): add IndexedDB and optional Supabase RLS cache for For You pools"`

---

### Task 5: Wire Explore `"For You"` Button, Mode Toggle, Shuffle, Refresh & Scroll Animations

**Files:**
- Modify: `src/services/exploreService.js`
- Modify: `src/pages/ExplorePage.jsx`
- Modify: `src/styles/explore.css`
- Test: `tests/exploreService.test.js`

**Interfaces:**
- Consumes: `generateExploreForYouPool`, `buildExploreForYouProfileHash`, `weightedShuffleForYou`, `filterForYouCatalog`, `EXPLORE_FOR_YOU_MIN_RATED` (`exploreForYouService.js`); `loadExploreForYouCache`, `saveExploreForYouCache` (`exploreForYouCache.js`).
- Produces in `src/services/exploreService.js`:
  - `DEFAULT_EXPLORE_FILTERS` extended with `mode: "catalog"` (`"catalog" | "for-you"`), `includeUpcoming: false`.
  - `EXPLORE_FOR_YOU_SORT_OPTIONS` starting with `{ id: "for_you", label: "Best Match For You" }`.
  - `parseExploreSearchParams` / `buildExploreSearchParams` round-trip `mode=for-you`, `sortBy=for_you`, and `upcoming=1`.

- [ ] **Step 1: Write failing tests in `tests/exploreService.test.js`**
  Assert:
  1. `buildExploreRoute({ mode: "for-you", sortBy: "for_you" })` round-trips cleanly via `parseExploreSearchParams`.
  2. `buildTmdbDiscoverParams` caps `primary_release_date.lte` to today's ISO date (`YYYY-MM-DD`) by default when `yearTo` is unset and `includeUpcoming` is `false`, and omits the cap when `includeUpcoming: true` or explicit `yearTo` is supplied.

- [ ] **Step 2: Run test to verify failure**
  Run: `node --test tests/exploreService.test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement Explore `"For You"` mode in `src/services/exploreService.js`, `src/pages/ExplorePage.jsx`, and `src/styles/explore.css`**
  - Add clean segmented mode switch in `.explore-header` (`All Catalog` | `Movies You'll Like` with `Sparkles` icon and smooth `layoutId` pill indicator).
  - In `for-you` mode:
    - If `watched.length < 3`, show a crisp editorial onboarding card with **"Calibrate Taste"** and **"Try a sample vault"** actions (zero crash, zero blank screen).
    - Otherwise load from `loadExploreForYouCache` first; on miss (or when user clicks **"Refresh Picks"**), call `generateExploreForYouPool` and save via `saveExploreForYouCache`.
    - Apply `weightedShuffleForYou(items, shuffleSeed)` on initial visit and whenever user clicks **"Shuffle Order"** (instantaneous, 0 API calls).
    - Filter client-side with `filterForYouCatalog` so every Deep Filter sidebar control works live on the ~100-film pool!
    - Render a subtle match percentage pill (`94% match`) and concise `vibeTag` under/above cards cleanly (zero raw model slugs in Public mode).
  - Pass `animateOnScroll={true}` and `revealIndex={idx}` to `<MovieCard>` in `ExplorePage.jsx`, and wire `useDocumentTitle("Explore")`.

- [ ] **Step 4: Run tests to verify pass**
  Run: `node --test tests/exploreService.test.js tests/exploreForYouService.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add src/services/exploreService.js src/pages/ExplorePage.jsx src/styles/explore.css tests/exploreService.test.js && git commit -m "feat(explore): add personalized Movies You'll Like mode with cache, shuffle, and unreleased filter"`

---

## Phase 3: Accessible Dark `<Select>` Primitive & Decluttered Film Oracle Overhaul

### Task 6: Build Editorial Dark `<Select>` Component & Replace All Native OS `<select>` Dropdowns

**Files:**
- Create: `src/components/ui/Select.jsx`
- Modify: `src/components/ui/index.js`
- Modify: `src/pages/ExplorePage.jsx`
- Modify: `src/components/MovieRecommendations.jsx`
- Modify: `src/components/VaultBanner.jsx`
- Modify: `src/components/PersonFilmographyExplorer.jsx`
- Modify: `src/styles/primitives.css` (or `src/index.css` if primitives live there — check before editing)
- Test: `tests/selectPrimitive.test.js`

**Interfaces:**
- Consumes: `resolveMenuAlignment` (`src/services/navHelpers.js`).
- Produces in `src/components/ui/Select.jsx` (and pure helper `src/services/selectHelpers.js` for Node tests):
  - `getNextSelectIndex(options, currentIndex, key)` handling `ArrowDown`, `ArrowUp`, `Home`, `End` with wraparound and disabled-option skipping.
  - `<Select value={string|number} onChange={(val) => void} options={Array<{ value, label, sublabel? }>} ariaLabel={string} icon?={LucideIcon} align?="left"|"right" className?={string} size?="sm"|"md" />`.

- [ ] **Step 1: Write failing tests in `tests/selectPrimitive.test.js`**
  Test `getNextSelectIndex` across `ArrowDown`, `ArrowUp`, `Home`, `End`, wraparound, empty options, and disabled items.

- [ ] **Step 2: Run test to verify failure**
  Run: `node --test tests/selectPrimitive.test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement `src/services/selectHelpers.js` and `src/components/ui/Select.jsx`, export from `src/components/ui/index.js`**
  - Dark obsidian glass panel (`bg-[#14161b]/98 backdrop-blur-xl border border-white/10`), smooth Framer Motion enter/exit (`opacity + scale + y`), viewport edge clamping via `resolveMenuAlignment`, active checkmark (`Check` icon), full keyboard support (`ArrowUp`/`ArrowDown`/`Home`/`End`/`Enter`/`Space`/`Escape`), click-outside close, and focus restoration on close.

- [ ] **Step 4: Replace every native `<select>` across `ExplorePage.jsx`, `MovieRecommendations.jsx`, `VaultBanner.jsx`, and `PersonFilmographyExplorer.jsx`**
  - Verify `rg -n "<select\b" src/` returns `0` matches across user-facing surfaces!

- [ ] **Step 5: Run tests and build**
  Run: `node --test tests/selectPrimitive.test.js && npm run build`
  Expected: PASS and exit 0.

- [ ] **Step 6: Commit**
  `git add src/services/selectHelpers.js src/components/ui/Select.jsx src/components/ui/index.js src/pages/ExplorePage.jsx src/components/MovieRecommendations.jsx src/components/VaultBanner.jsx src/components/PersonFilmographyExplorer.jsx tests/selectPrimitive.test.js && git commit -m "feat(ui): add dark editorial Select primitive and replace all native OS select menus"`

---

### Task 7: Overhaul Film Oracle Studio — Clean 2-Tier Command Bar + Unified `"Filters & Rules"` Dropdown

**Files:**
- Create: `src/components/OraclePreferencesPopover.jsx`
- Modify: `src/services/oracleViewHelpers.js`
- Modify: `src/components/MovieRecommendations.jsx`
- Modify: `src/styles/oracle.css`
- Test: `tests/oracleViewHelpers.test.js`

**Interfaces:**
- Produces in `src/services/oracleViewHelpers.js`:
  - `summarizeOraclePreferences({ userRegion, userWatchProviders, tasteRules, usingOwnKey }) -> { badgeCount: number, summaryText: string }` (e.g., `badgeCount: 3`, `"US · 2 platforms · 1 rule"` or `"Filters & Rules"` when default).
- Produces in `src/components/OraclePreferencesPopover.jsx`:
  - `<OraclePreferencesPopover isOpen onClose triggerRef userRegion setUserRegion userWatchProviders setUserWatchProviders toggleWatchProvider tasteRules onAddRule onToggleRule onEditRule onDeleteRule onPinRule onAutoDraft isDraftingRules watchedCount usingOwnKey onOpenKeyModal />` — tabbed clean dropdown/sheet (`Streaming` | `Taste Rules` | `AI Key`) moving ALL secondary Oracle settings off the main stage.

- [ ] **Step 1: Write failing tests in `tests/oracleViewHelpers.test.js`**
  Assert `summarizeOraclePreferences` returns `{ badgeCount: 0, summaryText: "Filters & Rules" }` when default (`GLOBAL`, no providers, no active rules, shared key), counts active region/providers/rules accurately, and contains zero emojis or `gemini-` strings.

- [ ] **Step 2: Run test to verify failure**
  Run: `node --test tests/oracleViewHelpers.test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement `summarizeOraclePreferences`, `OraclePreferencesPopover.jsx`, and decluttered `MovieRecommendations.jsx` + `src/styles/oracle.css`**
  - Replace the heavy 5-row stacked Studio Deck with a crisp 2-tier editorial Command Center:
    - **Tier 1:** Single horizontal **Mood Pill Rail** (`Any Vibe`, `Mind-Bending`, `Dark Thriller`, `Fun Popcorn`, `Comfort Watch`, `Hidden Gem`) with Lucide icons, Framer Motion `layoutId="oracle-mood-pill"` sliding active background, and concise subtitle tooltip/caption.
    - **Tier 2:** Unified **Vibe Command Bar** (`Search` icon + input `"Describe a vibe (e.g., 'like Drive but quieter')"` + inline `"Filters & Rules"` dropdown trigger with badge count + primary `"Find Picks"` / `"Match Vibe"` CTA).
    - Move `Where to Watch` (Region + 12 Platforms), `Taste Rules` (Prefer/Avoid editor + `Auto-Draft Rules from Vault`), and `Personal AI Key` cleanly inside `OraclePreferencesPopover` (anchored dropdown on desktop using `resolveMenuAlignment`, bottom sheet on mobile `<= 640px`).
    - When recommendations are present, collapse into a sleek 1-line **Editorial Toolbar** (`Recommended for You` · `About` · `Mood` · `Filters & Rules` · `Sort` · `Refresh`) so the films dominate the viewport!
    - Add smooth staggered scroll reveals (`motion.article` / `useScrollReveal`) on each recommendation card row.

- [ ] **Step 4: Run tests and build**
  Run: `node --test tests/oracleViewHelpers.test.js && npm run build`
  Expected: PASS and exit 0.

- [ ] **Step 5: Commit**
  `git add src/services/oracleViewHelpers.js src/components/OraclePreferencesPopover.jsx src/components/MovieRecommendations.jsx src/styles/oracle.css tests/oracleViewHelpers.test.js && git commit -m "refactor(oracle): declutter Film Oracle studio into 2-tier command bar and unified Filters & Rules popover"`

---

## Phase 4: Bug Fixes, Site-Wide Dynamic Motion & Editorial Visual Overhaul

### Task 8: Bug Sweep — Discover Unreleased-Film Guard, `localStorage` Eviction Hardening & Route Titles

**Files:**
- Modify: `src/services/dashboardService.js`
- Modify: `src/context/AppContext.jsx:50-120`
- Modify: `src/pages/ComparePage.jsx`
- Modify: `src/pages/MoviePage.jsx`
- Modify: `src/pages/PersonPage.jsx`
- Test: `tests/dashboardService.test.js`, `tests/appStorage.test.js` (create pure eviction test helper)

**Interfaces:**
- Produces in `src/services/dashboardService.js`:
  - `getTodayIsoDate(now = Date.now()) -> "YYYY-MM-DD"` applied as `"primary_release_date.lte"` on Discover `taste`, `recent`, `gems`, `thrillers`, `scifi`, `world` TMDB discover queries so unreleased future placeholders (like `Toy Story 5`) never appear in `"Picked For Your Taste"` or `"New & Notable Releases"`.
- Produces in `src/context/AppContext.jsx`:
  - Export `STORAGE_PURGE_ORDER` containing `cinemavault_smart_cache_v4`, `cinemavault_smart_cache_v3`, `cinemavault_home_feeds_v2`, `cinemavault_working_model_curation_v1`, `cinemavault_working_model_fast_v1`, `cinemavault_explanations_v1`, `cinemavault_recs_model_v1`, `cinemavault_recs_v1`, `cinemavault_recs_hash_v1`, `cinemavault_feedback_v1`.

- [ ] **Step 1: Write failing tests in `tests/dashboardService.test.js`**
  Assert `loadHomeDiscoveryFeeds` passes `"primary_release_date.lte"` equal to today's ISO date on the `taste` (`Picked For Your Taste`) and `recent` (`New & Notable Releases`) TMDB discover calls, and filters out items whose `release_date` is in the future when `now` is pinned.

- [ ] **Step 2: Run test to verify failure**
  Run: `node --test tests/dashboardService.test.js`
  Expected: FAIL.

- [ ] **Step 3: Implement Discover release-date guard, `localStorage` purge list expansion, and missing `useDocumentTitle` calls**
  - Add `primary_release_date.lte: todayIso` to live Discover TMDB lanes in `src/services/dashboardService.js` and wrap `HOME_FEEDS_CACHE_KEY` write safely.
  - Expand `purgeOrder` in `src/context/AppContext.jsx` to evict `cinemavault_home_feeds_v2` and working-model keys before triggering a critical storage warning.
  - Wire `useDocumentTitle("Compare")` in `ComparePage.jsx`, dynamic film/person titles via `useDocumentTitle` in `MoviePage.jsx` / `PersonPage.jsx` (preserving title cleanup on unmount).

- [ ] **Step 4: Run tests to verify pass**
  Run: `node --test tests/dashboardService.test.js tests/navHelpers.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add src/services/dashboardService.js src/context/AppContext.jsx src/pages/ComparePage.jsx src/pages/MoviePage.jsx src/pages/PersonPage.jsx tests/dashboardService.test.js && git commit -m "fix: exclude unreleased placeholders from Discover, harden storage eviction, and add route titles"`

---

### Task 9: Site-Wide Dynamic Motion, Scroll Animations & Editorial Visual Polish

**Files:**
- Create: `src/components/ScrollRevealSection.jsx`
- Modify: `src/components/ui/Tabs.jsx`
- Modify: `src/components/HeroBillboard.jsx`
- Modify: `src/components/MovieDetails.jsx`
- Modify: `src/components/VaultBanner.jsx`
- Modify: `src/components/MovieCard.jsx`
- Modify: `src/styles/nav-discover.css`
- Modify: `src/styles/vault.css`
- Modify: `src/styles/explore.css`
- Modify: `src/styles/oracle.css`
- Modify: `src/index.css`

**Interfaces:**
- Produces in `src/components/ScrollRevealSection.jsx`:
  - `<ScrollRevealSection as?="section"|"div" delay?={number} className?={string} children />` — GPU-only `opacity + translateY(18px)` reveal powered by `useScrollReveal` (`viewport` + scroll fallback, instant visible under `prefers-reduced-motion`).
- Produces in `src/components/ui/Tabs.jsx`:
  - `<Tabs tabs activeTab onChange layoutIdPrefix?={string} className?={string} />` with Framer Motion spring sliding active hairline (`layoutId={`${layoutIdPrefix}-tab-indicator`}`).

- [ ] **Step 1: Upgrade `Tabs.jsx` with sliding spring hairline and create `ScrollRevealSection.jsx`**
  - Keep `Tabs` backward-compatible (`layoutIdPrefix` defaults to a unique `useId()` so multiple `Tabs` on different views never collide!).
  - Implement `ScrollRevealSection` using `useScrollReveal` + `motion` (`transform + opacity` only, respects `useReducedMotion()`).

- [ ] **Step 2: Apply dynamic scroll reveals and editorial craft polish across key surfaces**
  - **Discover (`HeroBillboard.jsx`, `nav-discover.css`):** Add subtle slow Ken Burns scale drift (`scale: 1 → 1.05` over `8s`, paused on hover, disabled under `prefers-reduced-motion`) on active Hero backdrop; polish Discover section dividers and ambient top vignette.
  - **Cards (`MovieCard.jsx`, `nav-discover.css`, `index.css`):** Add crisp `1px` warm specular top/edge catch-light on hover, smooth micro-scale poster image reveal inside `overflow: hidden`, and staggered action-pill entrance on hover.
  - **Movie Details (`MovieDetails.jsx`, `SimilarFilmsStrip.jsx`, `CollectionTimeline.jsx`):** Wrap Narrative/Cast/Credits, Streaming Hub, Franchise Timeline, and Movies Like This in `<ScrollRevealSection>` so sections glide in smoothly as you scroll down a film dossier.
  - **Vault (`VaultBanner.jsx`, `vault.css`):** Animate Score Distribution histogram bars and Genre Affinity progress bars cleanly on drawer open (`scaleY` / `scaleX` transform with staggered spring).
  - **Global Scrollbar & Surface Depth (`index.css`, `explore.css`, `oracle.css`):** Subtle editorial depth on sticky Explore filter rail, smoother transitions on interactive filter pills (`active` scale tap feedback `0.97`), and verify zero `prefers-reduced-motion` regressions.

- [ ] **Step 3: Run full unit test suite and production build**
  Run: `npm test && npm run build`
  Expected: All tests PASS and build exits 0.

- [ ] **Step 4: Commit**
  `git add src/components/ScrollRevealSection.jsx src/components/ui/Tabs.jsx src/components/HeroBillboard.jsx src/components/MovieDetails.jsx src/components/SimilarFilmsStrip.jsx src/components/CollectionTimeline.jsx src/components/VaultBanner.jsx src/components/MovieCard.jsx src/styles/ src/index.css && git commit -m "feat(ui): elevate site-wide scroll animations, sliding tabs, hero motion, and tactile card craft"`

---

### Task 10: End-to-End Browser Verification, Fresh Media Pass & Final Gate

**Files:**
- Update (if UI changed visibly): `assets/screenshots/discover.png`, `assets/screenshots/explore.png`, `assets/screenshots/oracle.png`, `public/og-image.png`
- Update: `README.md` (document Explore `"For You"`, `gemini-3.1-flash-lite` 1,000/day Flash-Lite fallback, and opt-in row wheel scroll)

- [ ] **Step 1: Live Playwright verification (desktop `1440x900` + mobile `390x844`) on local dev server**
  Delegate to `browser` subagent and verify:
  1. **Discover (`/`):** Plain vertical scroll over poster rows scrolls the page vertically without hijacking; clicking `"Scroll row"` pill (or `Shift+Wheel`) smoothly glides the row horizontally; moving mouse away or pressing `Escape` releases back to vertical page scroll; Hero Ken Burns & staggered row reveals look smooth; zero unreleased placeholders in `"Picked For Your Taste"`.
  2. **Explore (`/explore`):** Custom dark `<Select>` opens cleanly without blue OS chrome; clicking `"Movies You'll Like"` loads ~80–100 personalized picks, Deep Filters filter them instantaneously, `"Shuffle Order"` reorders cleanly, cards animate on scroll, and `< 3` rated films shows onboarding CTA cleanly.
  3. **Film Oracle (`/ai`):** Decluttered 2-tier Command Bar renders cleanly above the fold; `"Filters & Rules"` popover opens Region/Streaming, Taste Rules + Auto-Draft, and AI Key; sliding `Tabs` underline glides smoothly between `Picks` and `Film Companion`; zero `gemini-` slugs appear in Public mode.
  4. **Movie Details (`/movie/tt0816692`):** Scroll-reveal sections enter smoothly; `"Movies Like This"` row respects opt-in wheel scroll; `0` console errors and `0` `localStorage` quota warnings!

- [ ] **Step 2: Refresh affected gallery screenshots & social preview**
  Capture crisp Public Edition screenshots for updated Discover, Explore (`For You` active), and decluttered Film Oracle; regenerate `public/og-image.png` (`1200x630`); visually inspect every PNG via `read_file`.

- [ ] **Step 3: Full verification gate**
  Run:
  - `npm test` -> Expected: 0 failures, 0 skipped
  - `npm run build` -> Expected: exit 0
  - `npm run build:personal` -> Expected: exit 0
  - `rg "AIzaSy" build/` -> Expected: empty
  - `rg -n "<select\b" src/` -> Expected: empty

- [ ] **Step 4: Commit & report**
  `git add assets/screenshots/ public/og-image.png README.md && git commit -m "docs: refresh screenshots and README for Explore For You and decluttered Oracle"`

---

## Self-Review

1. **Spec coverage:** Opt-in horizontal row scroll -> Task 1; Dual Flash-Lite (`3.5` + `3.1`, 1,000/day) -> Task 2; Explore `"For You"` 100-film engine + local math + single-shot Flash-Lite + weighted shuffle -> Task 3; Local IndexedDB + optional Supabase `user_explore_picks` RLS cache -> Task 4; Explore UI mode toggle & filter compatibility -> Task 5; Custom dark `<Select>` -> Task 6; Decluttered Film Oracle 2-tier Command Bar + unified `"Filters & Rules"` popover -> Task 7; Unreleased placeholder bug + `localStorage` quota eviction bug + route titles -> Task 8; Site-wide scroll reveals, sliding tabs, Hero Ken Burns, card hover craft -> Task 9; End-to-end browser QA & refreshed screenshots -> Task 10. Every user request item and discovered bug maps directly to a task.
2. **Step scan:** Every code step names exact file paths, exported function signatures, CSS targets, and test assertions without dumping implementation transcripts or leaving TBDs.
3. **Type consistency:** `EXPLORE_FOR_YOU_CASCADE` (T2) -> consumed by `exploreForYouService.js` (T3); `generateExploreForYouPool`, `buildExploreForYouProfileHash`, `weightedShuffleForYou`, `filterForYouCatalog` (T3) & `loadExploreForYouCache`/`saveExploreForYouCache` (T4) -> consumed by `ExplorePage.jsx` (T5); `Select` (T6) -> consumed across `ExplorePage`, `MovieRecommendations`, `VaultBanner`, `PersonFilmographyExplorer` (T6–T7); `ScrollRevealSection` & `Tabs` (T9) -> consumed across Movie Details, Oracle, Vault.
4. **Review Focus:** All 5 failure modes map directly to tests in T1, T2, T3, T4, T5, T6, and live Playwright checks in T10.
5. **Proportion:** 10 focused, right-sized tasks across 4 coherent phases, each ending in a green test run and clean commit.
