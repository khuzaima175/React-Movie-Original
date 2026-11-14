# UI Declutter & Live Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate repeated/hardcoded Home posters, replace generic Unsplash hero banners with real unwatched TMDB spotlights, hide overflowing carousel scrollbars/unused arrows, declutter the AI Oracle setup & result cards behind progressive disclosure, and fix the 1–10 rating histogram in Vault DNA.

**Architecture:** Extract pure data/view-model logic into three focused service modules (`src/services/dashboardService.js`, `src/services/oracleViewHelpers.js`, `src/services/vaultStats.js`) so every transformation—cross-row deduplication, unseen spotlight selection, streaming summary formatting, and 1–10 rating binning—is covered by fast Node unit tests (`node --test`). Keep React components (`HeroBillboard.jsx`, `MovieCarouselRow.jsx`, `DashboardPage.jsx`, `MovieRecommendations.jsx`, `AIPage.jsx`, `VaultBanner.jsx`) thin, CSS rules centralized in `src/index.css`, and all network calls routed through existing `/api/*` + `apiTransport.js` proxy boundaries.

**Tech Stack:** React 18, React Router v6, Vite 5, Framer Motion, Lucide Icons, Node built-in `node:test`, TMDB API v3 (`/3/trending/movie/week`, `/3/discover/movie`), Vercel serverless proxy (`api/tmdb.js`).

**Spec:** User UI audit feedback & `HeroBillboard` / `DashboardPage` / `MovieRecommendations` / `VaultBanner` inspection (Nov 14, 2026). No separate spec file precedes this plan.

## Global Constraints

- Never bypass `src/services/apiTransport.js` (`fetchTmdbJson`, `hasTmdbBackend`) or expose `VITE_*_KEY` secrets in client code; only allow explicit TMDB read paths in `api/tmdb.js`.
- Keep Home discovery completely disjoint: zero movies already in `watched` or `watchlist`, zero duplicate titles across discovery carousels, and zero `images.unsplash.com` stock backdrop URLs.
- Preserve all recommendation feedback & online-learning hooks (`addAiFeedback` with `features`, `handleAdd`, `handleDismiss`, `getRecommendationExplanation` caching) and `[50, 99]` match scores.
- All new pure logic MUST be test-driven (`tests/*.test.js` written RED -> verified FAIL -> GREEN -> `npm test` + `npm run build` pass).
- Never drop `1★–5★` ratings when aggregating Vault stats (repulsion/negative feedback relies on scores `<= 4`).

## Review Focus

- **Offline / keyless Home experience (`!hasTmdbBackend()` or TMDB failure):** `loadHomeDiscoveryFeeds` must return disjoint curated fallback rows + hero slides with zero duplicates and zero thrown errors, and Hero must fall back cleanly without broken Unsplash stock imagery. (Pinned in Task 1: `tests/dashboardService.test.js`)
- **Seen-movie leakage on Home:** Movies already in `watched` or `watchlist` (matched by `imdbID`, `tmdbId`, numeric `id`, or normalized `title::year`) must be excluded from discovery rows and deprioritized/skipped in Hero spotlights when unwatched candidates exist. (Pinned in Task 1: `tests/dashboardService.test.js`)
- **Cross-row duplicate posters:** A trending movie that also matches user's top genres must appear in at most one discovery carousel row on Home. (Pinned in Task 1: `tests/dashboardService.test.js`)
- **Active hidden filters in collapsed AI Oracle Streaming bar:** When the Streaming drawer is collapsed and a user previously chose a region/provider list (e.g. `US` + `Netflix`, `Max`), the collapsed summary bar must visibly report active constraints so users aren't silently filtered without knowing. (Pinned in Task 3: `tests/oracleViewHelpers.test.js`)
- **Negative rating visibility (`1★–4★`):** `buildRatingHistogramBins` must accurately tally ratings `1..10` instead of clamping `< 6` into `6★`, and gracefully skip unrated `0`/`null` entries. (Pinned in Task 5: `tests/vaultStats.test.js`)

---

### Task 1: Live TMDB Discovery, Disjoint Home Rows & Real Spotlight Service

**Files:**
- Modify: `api/tmdb.js:1-3`
- Modify: `src/services/tmdbService.js:823-850`
- Create: `src/services/dashboardService.js`
- Modify: `tests/apiProxy.test.js`
- Create: `tests/dashboardService.test.js`

**Interfaces:**
- Consumes:
  - `fetchTmdbJson(path, queryParams, options)` & `hasTmdbBackend(options)` from `src/services/apiTransport.js`
  - `extractTasteProfile(watched, watchlist, options)` & exported `normalizeTmdbItem(m, sourceBucket, providerMatchedByQuery)` from `src/services/tmdbService.js`
- Produces in `src/services/dashboardService.js`:
  - `buildSeenCollisionSet(watched = [], watchlist = []): Set<string>`
  - `excludeSeenAndPlaced(items = [], seenSet = new Set(), placedSet = new Set()): Array<Object>`
  - `toDashboardCardItem(tmdbItem): Object` (sets `id`, `tmdbId`, `imdbID: tmdb_${tmdbId}`, `title`, `year`, `imdbRating`, `poster`, `backdrop` at `w1280`, `genre`, `plot`)
  - `buildHeroSlides(liveRows = [], watchlist = [], watched = [], fallbackPool = [], limit = 5): Array<Object>`
  - `loadHomeDiscoveryFeeds({ watched = [], watchlist = [], userRegion = "US", hasBackend = hasTmdbBackend(), fetchTmdb = fetchTmdbJson, now = Date.now(), storage = null }): Promise<{ heroSlides: Array<Object>, rows: Array<Object>, isLive: boolean }>`

- [ ] **Step 1: Write failing tests in `tests/apiProxy.test.js` and `tests/dashboardService.test.js`**

Add a proxy allowlist test in `tests/apiProxy.test.js` asserting:
- `GET /api/tmdb?path=/3/trending/movie/week` forwards with server `TMDB_API_KEY` and returns `200`.
- `GET /api/tmdb?path=/3/trending/person/week` returns `400`.

Create `tests/dashboardService.test.js` with tests covering:
1. `excludeSeenAndPlaced` filters out items matching `watched`/`watchlist` across `imdbID`, `tmdbId`, numeric `id`, and `title::year`, and mutates `placedSet` so duplicate items in row 2 are stripped.
2. `buildHeroSlides` skips already-watched items when unwatched TMDB-backdrop slides exist, avoids `unsplash.com` URLs, and prefers `w1280` backdrops.
3. `loadHomeDiscoveryFeeds` (offline / `hasBackend: false`) returns >= 3 non-empty discovery rows whose titles are strictly disjoint across all rows and exclude `watched`/`watchlist`.
4. `loadHomeDiscoveryFeeds` (live mock `fetchTmdb` returning overlapping `/3/trending/movie/week` and `/3/discover/movie` items + cached reuse on second call via mock `sessionStorage`) produces non-overlapping `rows` with `isLive: true`, skips repeat network fetches on second call within same profile/day, and sets `imdbID` as `tmdb_<id>` so `/movie/:id` resolves natively.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/apiProxy.test.js tests/dashboardService.test.js`
Expected: FAIL (`/3/trending/movie/week` returns `400`; `src/services/dashboardService.js` missing).

- [ ] **Step 3: Implement TMDB trending proxy rule, export `normalizeTmdbItem`, and create `src/services/dashboardService.js`**

1. In `api/tmdb.js`, extend `ALLOWED_TMDB_PATH_RE` to include `trending\/movie\/(?:day|week)`.
2. In `src/services/tmdbService.js:823`, add `export` to `normalizeTmdbItem`.
3. Create `src/services/dashboardService.js`:
   - Normalize collision keys (`id:${raw}`, `tmdb:${num}`, `imdb:${lower}`, `title:${lower}::${year4}`).
   - When `hasBackend` is truthy, run concurrent `fetchTmdb("/3/trending/movie/week", ...)` plus `/3/discover/movie` queries for:
     - **Picked For Your Taste** (top 2 `lovedGenreIds` joined with `|` when user has ratings, sorted `vote_average.desc`, `vote_count.gte=250`),
     - **Recent Releases** (`primary_release_date.gte` = 12 months ago, sorted `popularity.desc`, `vote_count.gte=80`),
     - **Acclaimed Hidden Gems** (`vote_average.gte=7.4`, `vote_count.gte=300`, `vote_count.lte=4500`, `sort_by=vote_average.desc`).
   - Wrap each request individually with `.catch(() => ({ results: [] }))`, map items via `normalizeTmdbItem` -> `toDashboardCardItem` (converting `/t/p/original` backdrop paths to `/t/p/w1280` for Hero sharpness and faster load), pass sequentially through `excludeSeenAndPlaced`, and fill from strictly disjoint offline fallback rows (without Unsplash URLs) if TMDB is unconfigured or returns too few items.
   - Cache result cleanly under `cinemavault_home_feeds_v1` in `storage ?? window?.sessionStorage` keyed by daily UTC date + user region + seen count so rapid Home re-visits stay instant and invalidate when vault changes.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/apiProxy.test.js tests/dashboardService.test.js`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add api/tmdb.js src/services/tmdbService.js src/services/dashboardService.js tests/apiProxy.test.js tests/dashboardService.test.js
git commit -m "feat(home): add live TMDB discovery service with cross-row deduplication and spotlight selection"
```

---

### Task 2: Hero Billboard, Carousel Overflow Chrome & Live `DashboardPage` Wiring

**Files:**
- Modify: `src/components/HeroBillboard.jsx`
- Modify: `src/components/MovieCarouselRow.jsx`
- Modify: `src/pages/DashboardPage.jsx`
- Modify: `src/App.jsx:71`
- Modify: `src/index.css:4172-4270,4465-4490,8758-8855`
- Test: `tests/dashboardService.test.js`

**Interfaces:**
- Consumes: `loadHomeDiscoveryFeeds`, `buildSeenCollisionSet`, `buildHeroSlides`, `shouldShowCarouselArrows(scrollWidth, clientWidth)` (exported helper in `dashboardService.js` or inline check) from `src/services/dashboardService.js`.
- Modifies `HeroBillboard({ slides = null, watched = [], watchlist = [], onAddWatched, onAddToWatchlist })`:
  - Renders dynamic `slides` prop with compact gradient + subtly blurred poster fallback when `slide.backdrop` is absent (zero Unsplash stock images).
  - Supports **Plan to Watch** / **In Watchlist** (via `onAddToWatchlist` for unwatched spotlights), **Details** (`/movie/:id`), and **Ask AI Oracle** (`/ai` navigation).
- Modifies `MovieCarouselRow`:
  - Hides scrollbar tracks via CSS (`scrollbar-width: none; -ms-overflow-style: none;`) and toggles `<` `>` arrow controls based on horizontal overflow (`scrollWidth > clientWidth + 4`).

- [ ] **Step 1: Add failing test for overflow helper and hero slide ordering in `tests/dashboardService.test.js`**

Export and test `shouldShowCarouselArrows(scrollWidth, clientWidth)`:
- `shouldShowCarouselArrows(800, 1200) === false`
- `shouldShowCarouselArrows(1202, 1200) === false` (2px rounding tolerance)
- `shouldShowCarouselArrows(1450, 1200) === true`

Run `node --test tests/dashboardService.test.js` -> Expected: FAIL (`shouldShowCarouselArrows` not exported).

- [ ] **Step 2: Export `shouldShowCarouselArrows` and update `HeroBillboard.jsx`, `MovieCarouselRow.jsx`, `DashboardPage.jsx`, `App.jsx`, `src/index.css`**

1. Export `shouldShowCarouselArrows(scrollWidth = 0, clientWidth = 0)` from `src/services/dashboardService.js` (`scrollWidth > clientWidth + 4`).
2. In `src/index.css`:
   - Compact `.hero-billboard`: `height: clamp(34rem, 52vh, 48rem); min-height: 34rem; max-height: 48rem;` on desktop (preserving mobile responsive rule at `8759`).
   - Add `.hero-backdrop-blurred` styling for offline fallback slides without `backdrop`.
   - On `.carousel-track` (`L4476`): add `scrollbar-width: none; -ms-overflow-style: none;` to override global `* { scrollbar-width: thin; }`.
3. In `src/components/HeroBillboard.jsx`:
   - Accept `{ slides = null, watched = [], watchlist = [], onAddWatched, onAddToWatchlist }`, remove Unsplash stock URLs, prefer `onAddToWatchlist` (`Plan to Watch` / `In Watchlist`) for unwatched spotlights alongside `Details` and `Ask AI Oracle` (`/ai`).
4. In `src/components/MovieCarouselRow.jsx`:
   - Measure overflow using `shouldShowCarouselArrows` on mount, `movies` change, and `ResizeObserver`, rendering `<` `>` arrow controls only when `canScroll` is true.
5. In `src/pages/DashboardPage.jsx`:
   - Load feeds asynchronously via `loadHomeDiscoveryFeeds({ watched, watchlist, userRegion })` with cancellation guard.
   - Render: Hero (`slides`), `Saved Watchlist`, disjoint live/fallback discovery rows (`Picked For Your Taste`, `Trending Now`, `Recent Releases`, `Acclaimed Hidden Gems`), and `Your Vault Highlights` (`watched`).
6. In `src/App.jsx:71`, update footer credit copy to `TMDB, OMDb & Gemini AI`.

- [ ] **Step 3: Run tests and production build**

Run: `node --test tests/dashboardService.test.js && npm test && npm run build`
Expected: PASS (`npm test` all green, `vite build` exits `0`).

- [ ] **Step 4: Commit**

```bash
git add src/services/dashboardService.js src/components/HeroBillboard.jsx src/components/MovieCarouselRow.jsx src/pages/DashboardPage.jsx src/App.jsx src/index.css tests/dashboardService.test.js
git commit -m "feat(home-ui): wire live disjoint TMDB rows, compact unwatched hero, and hide carousel scrollbars"
```

---

### Task 3: Declutter AI Oracle Studio Setup (`AIPage.jsx` & `MovieRecommendations.jsx`)

**Files:**
- Create: `src/services/oracleViewHelpers.js`
- Modify: `src/pages/AIPage.jsx`
- Modify: `src/components/MovieRecommendations.jsx:460-775`
- Modify: `src/index.css:7355-7480,8525-8595`
- Create: `tests/oracleViewHelpers.test.js`

**Interfaces:**
- Produces in `src/services/oracleViewHelpers.js`:
  - `formatStreamingSummary(userRegion = "GLOBAL", userWatchProviders = [], availableRegions = [], providers = []): { summaryText: string, hasCustomFilter: boolean }`

- [ ] **Step 1: Write failing tests in `tests/oracleViewHelpers.test.js`**

Test cases:
1. `formatStreamingSummary("GLOBAL", [], AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS)` returns `{ summaryText: "All Regions • Any Platform", hasCustomFilter: false }`.
2. `formatStreamingSummary("US", [8, 1899], AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS)` returns `{ summaryText: "United States • Netflix, Max (HBO)", hasCustomFilter: true }`.
3. `formatStreamingSummary("GB", [8, 9, 337, 1899], AVAILABLE_REGIONS, POPULAR_WATCH_PROVIDERS)` truncates list cleanly (`"United Kingdom • 4 streaming services"`, `hasCustomFilter: true`).

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/oracleViewHelpers.test.js`
Expected: FAIL (`src/services/oracleViewHelpers.js` missing).

- [ ] **Step 3: Implement `formatStreamingSummary` and declutter Studio Deck in `MovieRecommendations.jsx`, `AIPage.jsx`, `src/index.css`**

1. Create `src/services/oracleViewHelpers.js` implementing `formatStreamingSummary`.
2. Update `.vibe-chips-grid` in `src/index.css`:
   - Desktop (`> 768px`): `grid-template-columns: repeat(3, minmax(0, 1fr));` (balanced `3×2` grid with zero orphan card on row 2).
   - Tablet/mobile (`<= 768px`): `grid-template-columns: repeat(2, minmax(0, 1fr));`.
   - Tighten `.ai-studio-deck` padding/gaps (`padding: 2.2rem; gap: 2rem;`).
3. Update `MovieRecommendations.jsx` (`renderStudioDeck`):
   - Remove the duplicate right-hand mood hint (`activeMoodObj.label: activeMoodObj.desc` already shown inside `.vibe-chip-card`).
   - Add local state `const [isStreamingOpen, setIsStreamingOpen] = useState(false);`.
   - Collapse Streaming Access & Region by default into a single-line summary bar showing `formatStreamingSummary(...)` + `[Customize ▾ / Done ▴]`; reveal region dropdown and 12 provider chips only when expanded.
   - Remove the internal engineering footer caption (`"TMDB 3-Bucket Waterfall Engine • Google Gemini Strict Re-Ranking • Zero Hallucinations"`).
4. Trim `AIPage.jsx` header subtitle/spacing slightly so the studio control panel leads cleanly.

- [ ] **Step 4: Run tests and build**

Run: `node --test tests/oracleViewHelpers.test.js && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/oracleViewHelpers.js src/pages/AIPage.jsx src/components/MovieRecommendations.jsx src/index.css tests/oracleViewHelpers.test.js
git commit -m "feat(ai-oracle): use balanced 3x2 mood grid and collapse streaming filters behind summary toggle"
```

---

### Task 4: Clean & Scannable AI Oracle Results & Progressive Card Drawer

**Files:**
- Modify: `src/services/oracleViewHelpers.js`
- Modify: `src/components/MovieRecommendations.jsx:84-146,829-1255`
- Modify: `src/index.css:8130-8280`
- Modify: `tests/oracleViewHelpers.test.js`

**Interfaces:**
- Consumes: `formatModelDisplayName` from `src/services/geminiService.js`.
- Produces in `src/services/oracleViewHelpers.js`:
  - `formatRecBadgeSummary(modelInfo, isCacheValid): { freshnessLabel: string, freshnessTone: string, modelLabel: string, tooltip: string }`
- Preserves existing `addAiFeedback` payloads (`features`, `sourceBucket`, `matchScoreAtTime`), `handleAdd`, `handleDismiss`, and `handleRequestDeepExplanation` state/cache behavior.

- [ ] **Step 1: Add failing tests for `formatRecBadgeSummary` in `tests/oracleViewHelpers.test.js`**

Assert `formatRecBadgeSummary`:
- Keyless / offline fallback (`model: null`) returns friendly `modelLabel: "Local Ranker"`, `freshnessLabel: "Fresh Picks"` (or `"Saved Picks"` when `isCacheValid: true`).
- Primary active model (`model: "gemini-4-hydrogen", isFallback: false`) returns `"Gemini 4 Hydrogen"` without repeating raw technical model slug or `"500KB LRU Cache"` inside `modelLabel`/`freshnessLabel` (raw slug, pipeline, cooldown, and token details stay in `tooltip`).
- Fallback model (`isFallback: true`) returns `"Fallback: <displayName>"`.

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/oracleViewHelpers.test.js`
Expected: FAIL (`formatRecBadgeSummary` is not exported).

- [ ] **Step 3: Implement `formatRecBadgeSummary` and streamline AI Oracle results & card chrome**

1. Export `formatRecBadgeSummary(modelInfo, isCacheValid)` from `src/services/oracleViewHelpers.js` reusing `formatModelDisplayName` from `geminiService.js`.
2. In `MovieRecommendations.jsx` (`recs-toolbar` & `ModelUsageBadge`):
   - Replace raw technical toolbar pills (`"500KB LRU Cache"`, `"Live 3-Bucket Re-ranked"`, concatenated raw slugs) with `freshnessLabel` (`Saved Picks` / `Fresh Picks`) and `modelLabel` from `formatRecBadgeSummary`, preserving technical cache/cooldown/token metrics inside `title` tooltip.
3. Simplify each `.recommendation-card` default state in `MovieRecommendations.jsx`:
   - Keep default card focused on 5 scannable pieces: **Poster + Trailer play button**, **Title / Year / Genre**, **IMDb + Taste Match %**, **Critique quote** (+ up to 2 `Stream on` badges cleanly inline), and **Action row (`Plan to Watch`, `Why It Fits`, `Not for me`)**.
   - Move `matchReasons` pills cleanly inside `.rec-explanation-drawer` (`Why It Fits` / `Hide Details`) alongside `sourceBucket` note and the `"Deep Critic Why"` trigger button so the default card height stays crisp and uncrowded.
4. Balance vertical spacing in `src/index.css` around `.recommendation-card` and `.rec-actions`.

- [ ] **Step 4: Run full test suite & build**

Run: `node --test tests/oracleViewHelpers.test.js && npm test && npm run build`
Expected: PASS (`npm test` all green, `vite build` exits `0`).

- [ ] **Step 5: Commit**

```bash
git add src/services/oracleViewHelpers.js src/components/MovieRecommendations.jsx src/index.css tests/oracleViewHelpers.test.js
git commit -m "refactor(ai-results): streamline recommendation cards and move secondary match pills into details drawer"
```

---

### Task 5: Full 1–10 Rating Histogram in Vault DNA (`VaultBanner.jsx`)

**Files:**
- Create: `src/services/vaultStats.js`
- Modify: `src/components/VaultBanner.jsx:78-85,204-234`
- Modify: `src/index.css:5077-5125,8965-8995`
- Create: `tests/vaultStats.test.js`

**Interfaces:**
- Produces in `src/services/vaultStats.js`:
  - `buildRatingHistogramBins(watched = []): { bins: Array<{ score: number, label: string, count: number, heightPct: number }>, maxCount: number }` (descending scores `10..1`, tallying numeric ratings rounded `1..10` and skipping `0`/null unrated entries cleanly without clamping `< 6` into `6`).

- [ ] **Step 1: Write failing test in `tests/vaultStats.test.js`**

Test cases:
- Mixed ratings `[10, 9, 8.4, 4, 2, 1]` produce `bins` of length `10` (`score: 10..1`) with counts `{ 10: 1, 9: 1, 8: 1, 4: 1, 2: 1, 1: 1 }` and zeros elsewhere — confirming `1★–5★` films are NOT clamped into `6★`.
- Empty vault returns 10 zero-count bins (`maxCount === 1` safe denominator, `heightPct === 0`).
- Unrated entries (`userRating: 0` or `undefined` without `imdbRating`) are ignored cleanly.

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/vaultStats.test.js`
Expected: FAIL (`src/services/vaultStats.js` missing).

- [ ] **Step 3: Implement `buildRatingHistogramBins`, wire into `VaultBanner.jsx`, and adjust CSS for 10 bars**

1. Create `src/services/vaultStats.js` exporting `buildRatingHistogramBins`.
2. Update `VaultBanner.jsx`: replace hardcoded `{ 10: 0, 9: 0, 8: 0, 7: 0, 6: 0 }` and `Math.max(6, ...)` clamp with `buildRatingHistogramBins(watched)`, updating the subtitle from `"6★ → 10★ frequency"` to `"1★ → 10★ frequency"`.
3. Update `.histogram-bars-spacious` & `.hist-track-housing` in `src/index.css` (`gap: 0.45rem;`, `.hist-track-housing { width: 1.8rem; max-width: 100%; }`, `.hist-label-text { font-size: 1.05rem; }`) so all 10 bars fit comfortably on both desktop and mobile without overflow.

- [ ] **Step 4: Run tests & production build**

Run: `node --test tests/vaultStats.test.js && npm test && npm run build`
Expected: PASS (100% tests pass, production build exits `0`).

- [ ] **Step 5: Commit**

```bash
git add src/services/vaultStats.js src/components/VaultBanner.jsx src/index.css tests/vaultStats.test.js
git commit -m "fix(vault): support full 1-10 rating histogram in Vault DNA panel"
```

---

## Verification Gate (End-of-Branch)

Run after all 5 tasks complete:
- `npm test` (0 failures, 0 skipped)
- `npm run build` (clean bundle, verify zero `VITE_*_KEY` leaks when `.env` lacks `VITE_*_KEY`)
- Visual verification via dev server on `/`, `/vault`, and `/ai`: confirm no duplicate Home posters across rows, compact unwatched Hero spotlight with real TMDB backdrop or clean gradient, zero visible scrollbar tracks on carousels, `3×2` balanced AI Oracle mood grid, collapsed Streaming bar by default, scannable cards, and `1★–10★` histogram in Vault DNA.
