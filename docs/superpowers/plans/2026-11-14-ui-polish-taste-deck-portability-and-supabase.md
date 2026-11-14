# CinemaVault Editorial Polish, Rapid Taste Deck, Portability & Optional Supabase Sync Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace residual "AI-demo" chrome with a restrained cinema-editorial UI across the Navbar and wide Split Search modal, multiply Home poster density with live multi-page TMDB carousels and a filterable catalog mosaic wall, add a first-open & on-demand 20–30 film Rapid Taste Deck (Flashcard + Multi-Genre Grid modes), promote lossless Export/Import with preview diff and zero silent fake ratings, and add an optional zero-friction Supabase Auth + Postgres RLS cloud-sync layer.

**Architecture:** All pure logic (shortcut/UI formatting helpers, dual-engine catalog search & dedupe, multi-page Home discovery + mosaic filtering, 30-film multi-genre taste deck selection & onboarding gate, JSON/CSV/Letterboxd/IMDb import-export diffing, and lossless local-to-cloud vault merging) lives in zero-DOM ES modules under `src/services/` tested with `node --test`. React components consume those tested services, while global modals (`SearchModal`, `TasteDeckModal`, `BackupManagerModal`, `QuickRateModal`, `CloudSyncModal`, `RandomPicker`) are coordinated from `App.jsx` so every action works on every route without duplicating UI state. Guest usage runs 100% locally in `localStorage` first; Supabase Cloud Sync is strictly opt-in and degrades cleanly when unconfigured or paused.

**Tech Stack:** React `18.3.1`, Vite `5.1.4`, Tailwind CSS `v4.1.16` (`@tailwindcss/vite`), `lucide-react`, `framer-motion`, `@supabase/supabase-js` (pinned at install time in Task 6), Node built-in test runner (`node --test`).

**Spec:** Synthesized directly from the user's requirements on Nov 14, 2026 against merged `main` (`b8d9437`), [ARCHITECTURE.md](../../../ARCHITECTURE.md), and current Supabase React Auth/RLS docs. No separate external spec file precedes this plan.

## Global Constraints

- Baseline repo: React `18.3.1`, `vite` `5.1.4`, `"type": "module"`, ESM Node test runner (`npm test` -> `node --test`).
- Unit tests under `tests/*.test.js` must execute purely in Node (`node --test`) without requiring `jsdom` or live network calls.
- Security: `npm run build` (`build/assets/*.js`) must contain zero client-leaked secret keys (`AIza`, `sb_secret_`, `service_role`); only Vercel `/api/*` proxies handle `GEMINI_API_KEY`, `TMDB_API_KEY`, and `OMDB_API_KEY` in production, and only `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` may be exposed client-side with Postgres RLS enforced.
- Never silently invent ratings (`5`, `7`, or `8`) on quick-add, CSV import, or fallback records. Unrated entries remain `userRating: 0` (or route to `watchlist`).
- Zero AI-demo clichés in navigation, search, or onboarding chrome: remove lavender/purple gradients (`#c4b5fd`, `#a855f7`), pulsing neon status dots (`.live-ai-pulse`, `.live-studio-pulse`), `Command` key gimmicks, `"CinemaVault Spotlight"` footer copy, and spinning `Sparkles` loaders. Use `#0b0b0c` obsidian, `#141416`/`#1c1d20` hairline surfaces, `#f4f4f2` ivory ink, and `#e2b13c` warm amber strictly for rated stars, active film accents, and primary CTAs.
- Guest-first invariant: opening `/` must NEVER hit a forced login wall. Returning users (`watched.length >= 3`) must NEVER have the onboarding deck auto-pop over their homepage.

## Review Focus

- **Returning-user annoyance / onboarding loop:** Visiting `/` with `watched.length >= 3` OR reloading after clicking Skip / pressing `Escape` must keep `TasteDeckModal` closed automatically while keeping it launchable on demand from Navbar / Hero (`tests/tasteDeckService.test.js`, Task 4).
- **Duplicate or already-seen posters across multi-page Home feeds & Taste Deck:** Fetching `page=1` and `page=2` from TMDB or hydrating live popular picks into `buildTasteDeck` must exclude all `watched` + `watchlist` IDs (`tt*` and `tmdb_*`) and prevent duplicates across Hero, all 8 carousels, and `HomePosterGrid` (`tests/dashboardService.test.js`, Task 3; `tests/tasteDeckService.test.js`, Task 4).
- **Silent fake ratings (`5`/`7`/`8`) & leak/overwrites on Import/Export:** CSV rows missing ratings must never default to `5` or `7` (`BackupManagerModal.jsx:255,300`); JSON/CSV merge must preserve newer explicit ratings without erasing notes, and ObjectURLs must revoke after download (`tests/vaultPortability.test.js`, Task 5).
- **Search race conditions & ID collisions:** Rapid typing in `SearchModal` must drop stale async OMDb/TMDB responses via request-sequence ID + `AbortController`, merge local Vault/Watchlist hits with normalized `tmdb_<id>` / `tt*` status flags cleanly (`tests/searchService.test.js`, Task 2).
- **Supabase unconfigured / paused / RLS & Guest Merge Safety:** Missing `VITE_SUPABASE_*` vars or a paused free-tier project must leave the app working cleanly in local mode; first sign-in must merge guest local ratings with cloud rows via `mergeLocalAndCloudVault` instead of overwriting either side, and Postgres policies must enforce `TO authenticated`, `(select auth.uid()) = user_id`, and `WITH CHECK` (`tests/vaultSyncService.test.js`, Task 6).

---

### Task 1: Editorial Navbar Overhaul, Global Modal Lifting & De-"AI" Polish

**Files:**
- Create: `src/services/navHelpers.js`
- Test: `tests/navHelpers.test.js`
- Modify: `src/App.jsx:1-89`
- Modify: `src/components/NavBar.jsx:1-139`
- Modify: `src/components/VaultBanner.jsx:1-21,115-190`
- Modify: `src/pages/AIPage.jsx:1-85`
- Modify: `src/components/RandomPicker.jsx:1-14,135-145`
- Modify: `src/index.css:202-485,4895-5020,7245-7300`

**Interfaces:**
- Produces (`src/services/navHelpers.js`):
  - `getSearchShortcutHint(platform?: string): string` (returns `"⌘K"` for Mac platforms, `"/"` or `"Ctrl K"` for non-Mac/Windows/Linux)
  - `getCloudSyncBadgeLabel({ configured: boolean, userEmail?: string | null, status?: string }): string`
  - `formatVaultNavCount(count: number): string | null`
- Modifies `NavBar` props: `({ onOpenSearch, onOpenRandomPicker, onOpenBackup, onOpenTasteDeck, onOpenCloudSync, cloudUser })` — keeps existing `onOpenSearch` and `onOpenRandomPicker` backward-compatible when omitted.

- [ ] **Step 1: Write failing tests in `tests/navHelpers.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  getSearchShortcutHint,
  getCloudSyncBadgeLabel,
  formatVaultNavCount
} from "../src/services/navHelpers.js";

test("getSearchShortcutHint adapts shortcut glyph to OS platform", () => {
  assert.equal(getSearchShortcutHint("MacIntel"), "⌘K");
  assert.equal(getSearchShortcutHint("Win32"), "Ctrl K");
  assert.equal(getSearchShortcutHint("Linux x86_64"), "Ctrl K");
  assert.equal(getSearchShortcutHint(""), "Ctrl K");
});

test("formatVaultNavCount formats positive counts concisely and hides zero", () => {
  assert.equal(formatVaultNavCount(0), null);
  assert.equal(formatVaultNavCount(-2), null);
  assert.equal(formatVaultNavCount(35), "35");
  assert.equal(formatVaultNavCount(1240), "1,240");
});

test("getCloudSyncBadgeLabel distinguishes guest, synced user, and syncing states", () => {
  assert.equal(getCloudSyncBadgeLabel({ configured: false }), "Local Backup");
  assert.equal(getCloudSyncBadgeLabel({ configured: true, userEmail: null }), "Cloud Sync");
  assert.equal(
    getCloudSyncBadgeLabel({ configured: true, userEmail: "khuzaima@example.com", status: "syncing" }),
    "Syncing..."
  );
  assert.equal(
    getCloudSyncBadgeLabel({ configured: true, userEmail: "khuzaima@example.com", status: "idle" }),
    "Synced"
  );
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/navHelpers.test.js`
Expected: FAIL (`Cannot find module '.../src/services/navHelpers.js'`).

- [ ] **Step 3: Implement `src/services/navHelpers.js`**

Export `getSearchShortcutHint(platform)`, `formatVaultNavCount(count)`, and `getCloudSyncBadgeLabel({ configured, userEmail, status })` with deterministic pure string outputs matching Step 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/navHelpers.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Lift shared modal state into `src/App.jsx` and wire global keyboard shortcuts**

In `src/App.jsx`:
- Add state hooks alongside `isSearchOpen` & `isRandomPickerOpen`: `isBackupOpen`, `isTasteDeckOpen` (wired in Task 4, default `false` here), `isCloudSyncOpen` (wired in Task 6), and `quickRateTarget` (`useState(null)`).
- Add a global `keydown` listener in `AppContent`: `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"` toggles `isSearchOpen`; pressing `/` while focus is outside `<input>`, `<textarea>`, `<select>`, or `contentEditable` opens `isSearchOpen`.
- Mount `<BackupManagerModal isOpen={isBackupOpen} onClose={() => setIsBackupOpen(false)} />` and `<QuickRateModal movie={quickRateTarget} watched={watched} watchlist={watchlist} onClose={() => setQuickRateTarget(null)} onSaveWatched={addWatched} onAddToWatchlist={addToWatchlist} />` at `AppContent` level, passing `onOpenBackup={() => setIsBackupOpen(true)}`, `onOpenTasteDeck={() => setIsTasteDeckOpen(true)}`, `onOpenCloudSync={() => setIsCloudSyncOpen(true)}` to `NavBar` and routes.
- Update the footer copy at `src/App.jsx:67` from `"Personal Film Vault & Taste Intelligence"` to `"Personal Film Log & Recommendations"`.

- [ ] **Step 6: Redesign `src/components/NavBar.jsx` + editorial CSS in `src/index.css`**

Refactor `NavBar.jsx` & `.nav-bar-stream` styles (`src/index.css:202-485`):
- **Left brand & inline links:** Flat editorial typography (`Cinema` + `.brand-accent` `Vault`), clean geometric `Film` mark (remove glowing `.brand-icon-box` neon box shadow), navigation tabs **`Discover`** (`/`), **`Vault`** (`/vault` + clean muted numeric count via `formatVaultNavCount`), and **`Oracle`** (`/ai` — neutral `#b6b6b2` default, `#f4f4f2` active with `#e2b13c` crisp `2px` underline positioned `0.2rem` right beneath the text instead of floating `-1.7rem` at header border). Zero lavender `#c4b5fd`/`#a855f7` gradients, zero `Sparkles` in navbar.
- **Right controls:**
  - Compact architectural search trigger (`Search films...` + `getSearchShortcutHint(navigator?.platform)` badge).
  - Primary amber ghost CTA button **`Quick Taste`** (`onClick={onOpenTasteDeck}`, icon `SlidersHorizontal` or `Clapperboard` — hidden/condensed nicely on tiny viewports).
  - Watchlist link (`Bookmark` + count when `watchlist.length > 0`).
  - Single reusable `<Menu>` dropdown from `src/components/ui/Menu.jsx` (`Library & Sync` / `MoreHorizontal` trigger): items for **`Import / Export Ratings`** (`onOpenBackup`), **`Pick Random Film`** (`onOpenRandomPicker`, disabled or omitted when both lists empty), and **`Cloud Sync`** (`onOpenCloudSync` when configured, with `getCloudSyncBadgeLabel` status indicator).
  - Mobile bottom bar (`mobile-stream-bar`): 4 clean tabs (`Discover`, `Vault`, `Quick Taste`, `Search` — replacing `Sparkles` with `Compass` / `Film` / `Bookmark` / `Layers`).

- [ ] **Step 7: Remove remaining "AI-ish" indicators in `VaultBanner.jsx`, `AIPage.jsx`, `RandomPicker.jsx`, and `src/index.css`**

- In `src/components/VaultBanner.jsx:115-186`: remove `<span className="live-studio-pulse" />`; rename the gear `"Backup"` button at line `180` to **`Import / Export`** (using `ArrowUpDown` icon); replace `Sparkles` in Taste DNA button with `BarChart3`; wire `onOpenBackup` from parent or fallback prop cleanly.
- In `src/pages/AIPage.jsx:25-78`: remove `<span className="live-ai-pulse" />`, change `"Syncing Ready"` / `.ai-sync-pill` pulsing green dot to quiet hairline text pill (`"${watched.length} films logged"` or `"No films logged yet"`), replace tab `Sparkles` icon with `Compass` and copy `"Personalized picks tuned to your rated films."`.
- In `src/components/RandomPicker.jsx:137-140`: replace `Sparkles` + `"Oracle Pick"` with `Film` + `"Tonight's Pick"`.
- In `src/index.css:4895-5020,7245-7300`: clean `.live-studio-pulse`, `.live-ai-pulse`, and glow shadows from `.btn-insights-glow` and `.nav-bar-stream`.

- [ ] **Step 8: Run test suite and verify**

Run: `node --test tests/navHelpers.test.js`
Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/services/navHelpers.js tests/navHelpers.test.js src/App.jsx src/components/NavBar.jsx src/components/VaultBanner.jsx src/pages/AIPage.jsx src/components/RandomPicker.jsx src/index.css
git commit -m "feat(nav-ui): redesign editorial navbar, lift global modals, and remove AI chrome"
```

---

### Task 2: Wide Theater Search Modal (TMDB Primary + OMDb Fallback + Visual Poster Empty State & Live Preview)

**Files:**
- Create: `src/services/searchService.js`
- Test: `tests/searchService.test.js`
- Modify: `src/components/SearchModal.jsx:1-290`
- Modify: `src/App.jsx` (pass `onQuickRate={(movie) => setQuickRateTarget(movie)}` to `SearchModal`)
- Modify: `src/index.css:9629-9849`

**Interfaces:**
- Consumes: `fetchTmdbJson`, `fetchOmdbJson` (`src/services/apiTransport.js`), `TMDB_ID_TO_GENRE` (`src/services/tmdbService.js`), `buildSeenCollisionSet` (`src/services/dashboardService.js`).
- Produces (`src/services/searchService.js`):
  - `mapTmdbSearchItem(tmdbItem: object): SearchMovieItem`
  - `mergeAndRankSearchResults({ query, localMatches, tmdbResults, omdbResults, watched, watchlist }): SearchMovieItem[]`
  - `searchCatalogMovies({ query, watched, watchlist, fetchTmdb, fetchOmdb, apiKey, signal }): Promise<SearchMovieItem[]>`
  - `loadSearchTrendingPosters({ watched, watchlist, fetchTmdb, limit?: number }): Promise<SearchMovieItem[]>`

- [ ] **Step 1: Write failing tests in `tests/searchService.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  mapTmdbSearchItem,
  mergeAndRankSearchResults,
  searchCatalogMovies,
  loadSearchTrendingPosters
} from "../src/services/searchService.js";

test("mapTmdbSearchItem converts TMDB result to unified search record with genres, backdrop, and score", () => {
  const item = mapTmdbSearchItem({
    id: 272,
    title: "Batman Begins",
    release_date: "2005-06-10",
    vote_average: 7.72,
    poster_path: "/4MpN4kIEqUjW8OPtOQJXlTdHiJV.jpg",
    backdrop_path: "/ew5FcYi4.jpg",
    genre_ids: [28, 80, 18],
    overview: "Driven by tragedy, billionaire Bruce Wayne..."
  });
  assert.equal(item.imdbID, "tmdb_272");
  assert.equal(item.tmdbId, 272);
  assert.equal(item.Title, "Batman Begins");
  assert.equal(item.Year, "2005");
  assert.equal(item.imdbRating, "7.7");
  assert.match(item.Poster, /w342/);
  assert.match(item.backdrop, /w780/);
  assert.match(item.genre, /Action/);
});

test("mergeAndRankSearchResults deduplicates TMDB and OMDb entries and annotates inVault / userRating", () => {
  const watched = [{ imdbID: "tt0372784", title: "Batman Begins", year: "2005", userRating: 9 }];
  const watchlist = [{ imdbID: "tmdb_414906", tmdbId: 414906, title: "The Batman", year: "2022" }];
  const merged = mergeAndRankSearchResults({
    query: "batman",
    tmdbResults: [
      { imdbID: "tmdb_272", tmdbId: 272, Title: "Batman Begins", Year: "2005", imdbRating: "7.7", popularity: 80 },
      { imdbID: "tmdb_414906", tmdbId: 414906, Title: "The Batman", Year: "2022", imdbRating: "7.8", popularity: 95 }
    ],
    omdbResults: [
      { imdbID: "tt0372784", Title: "Batman Begins", Year: "2005", Type: "movie", Poster: "https://ex/p.jpg" }
    ],
    watched,
    watchlist
  });
  assert.equal(merged.length, 2);
  const begins = merged.find((m) => m.Title === "Batman Begins");
  assert.equal(begins.inVault, true);
  assert.equal(begins.userRating, 9);
  const theBatman = merged.find((m) => m.Title === "The Batman");
  assert.equal(theBatman.inWatchlist, true);
});

test("searchCatalogMovies matches instant local vault hits, prefers TMDB, and falls back to OMDb when TMDB returns empty", async () => {
  const results = await searchCatalogMovies({
    query: "batman",
    watched: [{ imdbID: "tt0468569", title: "The Dark Knight", year: "2008", userRating: 10 }],
    watchlist: [],
    fetchTmdb: async () => ({ results: [] }),
    fetchOmdb: async () => ({
      Response: "True",
      Search: [{ imdbID: "tt0096895", Title: "Batman", Year: "1989", Type: "movie", Poster: "N/A" }]
    })
  });
  assert.equal(results.some((r) => r.Title === "Batman"), true);
});

test("loadSearchTrendingPosters returns fallback visual posters when TMDB is unavailable", async () => {
  const list = await loadSearchTrendingPosters({
    watched: [],
    watchlist: [],
    fetchTmdb: async () => null,
    limit: 8
  });
  assert.equal(list.length, 8);
  assert.ok(list.every((item) => item.Poster && item.Title));
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/searchService.test.js`
Expected: FAIL (`Cannot find module '.../src/services/searchService.js'`).

- [ ] **Step 3: Implement `src/services/searchService.js`**

- `mapTmdbSearchItem`: build normalized `SearchMovieItem` (`imdbID`, `tmdbId`, `Title`, `title`, `Year`, `year`, `imdbRating`, `Poster`, `poster`, `backdrop`, `genre`, `plot`, `popularity`, `Type: "movie"`).
- `mergeAndRankSearchResults`: match against local `watched` and `watchlist` (by `imdbID`, `tmdbId`, and normalized `title::year`), deduplicate OMDb + TMDB duplicates preferring TMDB rich metadata while keeping valid `tt*` IDs when present, attach `{ inVault, inWatchlist, userRating }`, and preserve relevance order (exact prefix -> popularity -> vote score).
- `searchCatalogMovies`: run instant local filter + parallel TMDB `/3/search/movie` (`>= 2` chars) + OMDb fallback only if `query` starts with `tt` or TMDB yielded `< 3` results.
- `loadSearchTrendingPosters`: fetch `/3/trending/movie/week` (`page: 1`), map via `mapTmdbSearchItem`, fall back to 8 iconic classics with posters when offline.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/searchService.test.js`
Expected: PASS (4/4).

- [ ] **Step 5: Upgrade `src/components/SearchModal.jsx` and styles in `src/index.css`**

Transform `SearchModal.jsx` (`max-width: 920px` theater sheet in `.search-spotlight-card`):
- Input placeholder `"Search films by title or browse trending posters..."` (`>= 2` chars trigger debounced `220ms` search using a monotonic `requestIdRef` guard + `AbortController` so stale responses are dropped).
- Filter toggle pills directly under input: `All`, `In My Vault`, `Watchlisted` (filtering displayed items client-side cleanly).
- Replace spinning `Sparkles` loader (`SearchModal.jsx:189`) with `<Loader2 size={18} className="spin-icon" />`.
- **Empty / short query state (`< 2` chars):** Render `"Popular Right Now"` as a visual 4–8 column poster grid loaded from `loadSearchTrendingPosters` (each poster tile clickable to open details or hover `+` rate via `onQuickRate`) instead of bare `"TRENDING DISCOVERIES"` command chips; remove `Command` icon and `"CinemaVault Spotlight"` footer (`SearchModal.jsx:257,282`).
- **Active results state:** Split layout on desktop (`>= 768px`):
  - **Left column (`55%`):** result rows with `52×76px` poster, Title, Year, Genre summary, Rating `★` badge, status badge (`Vault ★9` or `Watchlisted`), and inline **`+` Rate / Bookmark button** (`e.stopPropagation(); onQuickRate?.(m)`).
  - **Right preview pane (`45%`):** Selected result's backdrop banner (`aspect-ratio: 16/9`), title, year, genres, TMDB rating, 3-line synopsis, and direct action buttons (**`Open Film Page`** + **`Rate or Save`** via `onQuickRate`).

- [ ] **Step 6: Run tests**

Run: `node --test tests/searchService.test.js`
Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/services/searchService.js tests/searchService.test.js src/components/SearchModal.jsx src/App.jsx src/index.css
git commit -m "feat(search): upgrade spotlight into wide theater search with visual trending grid and live preview"
```

---

### Task 3: High-Density Multi-Page Home Discovery & Interactive Poster Wall

**Files:**
- Modify: `src/services/dashboardService.js:1-329`
- Test: `tests/dashboardService.test.js`
- Create: `src/components/HomePosterGrid.jsx`
- Modify: `src/pages/DashboardPage.jsx:1-98`
- Modify: `src/components/HeroBillboard.jsx:40-202`
- Modify: `src/index.css:4173-4503,4704-4725`

**Interfaces:**
- Consumes (`DashboardPage` & `HomePosterGrid`): `loadHomeDiscoveryFeeds`, `collectCatalogMosaic`, `FALLBACK_ROWS`.
- Produces (`src/services/dashboardService.js`):
  - `loadHomeDiscoveryFeeds({ watched, watchlist, userRegion, hasBackend, fetchTmdb, now, storage }): Promise<{ heroSlides, rows, mosaicPool, isLive }>` (8 live curated rows × up to 20 posters each when online, 48+ fallback posters across 4 rows when offline, cache key bumped to `"cinemavault_home_feeds_v2"`).
  - `collectCatalogMosaic({ rows: Array, selectedGenre?: string, limit?: number }): { items: Array, totalCount: number, availableGenres: string[] }`

- [ ] **Step 1: Extend failing tests in `tests/dashboardService.test.js`**

Add tests to `tests/dashboardService.test.js`:
- `loadHomeDiscoveryFeeds returns up to 8 live rows (~20 posters/row via page 1+2) with zero cross-row or watched/watchlist duplicates and populates mosaicPool`
- `loadHomeDiscoveryFeeds offline fallback provides at least 36 unique posters across curated rows`
- `collectCatalogMosaic filters items by selectedGenre case-insensitively, preserves deduplication, and caps by limit`

- [ ] **Step 2: Run `tests/dashboardService.test.js` to verify new tests fail**

Run: `node --test tests/dashboardService.test.js`
Expected: FAIL on missing `collectCatalogMosaic`, `mosaicPool`, and `< 8` rows / `< 36` fallback count.

- [ ] **Step 3: Implement multi-page 8-row live feeds, expanded `FALLBACK_ROWS`, and `collectCatalogMosaic` in `src/services/dashboardService.js`**

- Bump `HOME_FEEDS_CACHE_KEY` to `"cinemavault_home_feeds_v2"`.
- In `toDashboardCardItem` (`dashboardService.js:114`), format `vote_average` explicitly to 1 decimal (`Number(tmdbItem.vote_average).toFixed(1)`), addressing prior review minor.
- Fetch **8 distinct TMDB lanes** in `loadHomeDiscoveryFeeds` (including `page=1` & `page=2` on `taste` and `trending` so dense 20-card rows still remain disjoint after excluding `watched`/`watchlist`):
  1. `taste`: `Picked For Your Taste` / `Acclaimed Cinema Picks` (pages `1 & 2`)
  2. `trending`: `Trending This Week` (`/3/trending/movie/week` pages `1 & 2`)
  3. `recent`: `New & Notable Releases` (`primary_release_date.gte: recentFloor`, pages `1 & 2`)
  4. `classics`: `All-Time Essential Classics` (`vote_average.gte: 8.0`, `vote_count.gte: 3000`, `primary_release_date.lte: 2014-12-31`)
  5. `gems`: `Hidden Gems` (`vote_average.gte: 7.4`, `vote_count: 300..4500`)
  6. `thrillers`: `Crime, Noir & Thrillers` (`with_genres: "53|80|9648"`, `vote_count.gte: 600`, `sort_by: "vote_average.desc"`)
  7. `scifi`: `Sci-Fi & Speculative Worlds` (`with_genres: "878|14"`, `vote_count.gte: 600`, `sort_by: "vote_average.desc"`)
  8. `world`: `World Cinema & Festival Picks` (`without_original_language: "en"`, `vote_average.gte: 7.4`, `vote_count.gte: 400`, `sort_by: "vote_average.desc"`)
- Pass every lane through `excludeSeenAndPlaced(..., seenSet, placedSet).slice(0, 20)`.
- Expand `FALLBACK_ROWS` to **48 distinct iconic posters across 4 balanced lanes** (`trending`, `acclaimed`, `genreClassics`, `worldAndModern`).
- Implement `collectCatalogMosaic({ rows, selectedGenre = "All", limit = 36 })` to deduplicate rows + filter by genre chip + return `{ items, totalCount, availableGenres }`.

- [ ] **Step 4: Run `tests/dashboardService.test.js` to verify pass**

Run: `node --test tests/dashboardService.test.js`
Expected: PASS (all old + 3 new tests).

- [ ] **Step 5: Build `<HomePosterGrid />`, update `DashboardPage.jsx`, `HeroBillboard.jsx`, and compact card CSS**

- Create `src/components/HomePosterGrid.jsx`: renders `"Explore Full Catalog"` heading with genre filter bar (`availableGenres`: `All`, `Drama`, `Thriller`, `Sci-Fi`, `Crime`, `Action`, `Animation`, `Comedy`) + responsive multi-column poster grid (`.home-poster-mosaic-grid`: `grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr))`) rendering `<MovieCard />` items with `"Show 24 More Posters"` pagination button (`visibleCount` increments by 24).
- Update `src/pages/DashboardPage.jsx`: render the 8 carousels plus `<HomePosterGrid rows={feeds.rows} watched={watched} onSelectMovie={handleSelectMovie} onQuickAdd={setQuickAddMovie} onAddWatched={addWatched} />`, and forward `onOpenTasteDeck` prop into `HeroBillboard`.
- Update `src/components/HeroBillboard.jsx:192-198` & `src/index.css:4173-4200,4704-4725`:
  - Compact hero height `clamp(30rem, 44vh, 42rem)` so first poster row sits prominently in viewport.
  - Tighten `.unified-movie-card` default flex-basis to `16.2rem` on desktop so **8+ posters fit across each carousel row**.
  - Replace the Hero's `Sparkles` `"AI Oracle"` button with a clean **"Quick Taste (30)"** button triggering `onOpenTasteDeck` (fallback navigating to `/ai` if omitted).

- [ ] **Step 6: Run tests and verify**

Run: `node --test tests/dashboardService.test.js`
Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/services/dashboardService.js tests/dashboardService.test.js src/components/HomePosterGrid.jsx src/pages/DashboardPage.jsx src/components/HeroBillboard.jsx src/index.css
git commit -m "feat(home): expand live discovery to 8 rows x 20 posters and add filterable catalog poster wall"
```

---

### Task 4: First-Open & On-Demand "Rapid Taste Deck" (20–30 Multi-Genre Flashcards + Poster Grid Wall)

**Files:**
- Create: `src/services/tasteDeckService.js`
- Test: `tests/tasteDeckService.test.js`
- Create: `src/components/TasteDeckModal.jsx`
- Modify: `src/App.jsx` (auto-open check on fresh load + pass `onOpenBackup` into `TasteDeckModal` `"Import Existing Ratings"`)
- Modify: `src/pages/AIPage.jsx` / `src/components/MovieRecommendations.jsx` (add `"Calibrate Taste (30 Films)"` button on sparse/empty state)
- Modify: `src/index.css` (add `.taste-deck-*` styles)

**Interfaces:**
- Consumes: `buildSeenCollisionSet` (`src/services/dashboardService.js`), `getRatingTier`, `RATING_TIERS`, `prepareQuickRatePayload`, `prepareWatchlistPayload` (`src/services/ratingTiers.js`).
- Produces (`src/services/tasteDeckService.js`):
  - `TASTE_ONBOARDING_DISMISSED_KEY = "cinemavault_taste_onboarding_dismissed_v1"`
  - `CORE_TASTE_DECK` (30 multi-genre crowd-pleasers across Action, Sci-Fi, Crime, Drama, Thriller, Animation, Comedy, Horror, Romance, World Cinema)
  - `buildTasteDeck({ watched, watchlist, livePool, deckSize = 30 }): Array<DeckMovie>` (filters watched via `buildSeenCollisionSet`, preserves genre diversity via round-robin interleaving, pads with unseen `livePool` up to `deckSize`)
  - `shouldAutoShowTasteOnboarding({ watchedCount, dismissedFlag }): boolean` (`watchedCount < 3 && dismissedFlag !== "true"`)

- [ ] **Step 1: Write failing tests in `tests/tasteDeckService.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_TASTE_DECK,
  buildTasteDeck,
  shouldAutoShowTasteOnboarding
} from "../src/services/tasteDeckService.js";

test("CORE_TASTE_DECK covers at least 8 distinct genres with 30 valid poster records", () => {
  assert.equal(CORE_TASTE_DECK.length, 30);
  const genres = new Set(CORE_TASTE_DECK.map((m) => m.primaryGenre));
  assert.ok(genres.size >= 8);
  assert.ok(CORE_TASTE_DECK.every((m) => m.imdbID && m.title && m.poster));
});

test("buildTasteDeck excludes watched films, interleaves genres, and tops up from livePool", () => {
  const watched = CORE_TASTE_DECK.slice(0, 5).map((m) => ({ imdbID: m.imdbID, title: m.title }));
  const livePool = Array.from({ length: 10 }, (_, idx) => ({
    imdbID: `tmdb_${9000 + idx}`,
    tmdbId: 9000 + idx,
    title: `Live Film ${idx}`,
    year: "2024",
    poster: `https://image.tmdb.org/t/p/w500/live${idx}.jpg`,
    genre: idx % 2 === 0 ? "Drama" : "Sci-Fi",
    imdbRating: "7.8"
  }));
  const deck = buildTasteDeck({ watched, watchlist: [], livePool, deckSize: 30 });
  assert.equal(deck.length, 30);
  const watchedIds = new Set(watched.map((w) => w.imdbID));
  assert.equal(deck.some((m) => watchedIds.has(m.imdbID)), false);
  // First 3 cards should not all share the same primaryGenre
  const firstGenres = new Set(deck.slice(0, 3).map((m) => m.primaryGenre));
  assert.ok(firstGenres.size >= 2);
});

test("shouldAutoShowTasteOnboarding triggers only for new users (< 3 watched) who have not dismissed", () => {
  assert.equal(shouldAutoShowTasteOnboarding({ watchedCount: 0, dismissedFlag: null }), true);
  assert.equal(shouldAutoShowTasteOnboarding({ watchedCount: 2, dismissedFlag: "false" }), true);
  assert.equal(shouldAutoShowTasteOnboarding({ watchedCount: 3, dismissedFlag: null }), false);
  assert.equal(shouldAutoShowTasteOnboarding({ watchedCount: 0, dismissedFlag: "true" }), false);
});
```

- [ ] **Step 2: Run `tests/tasteDeckService.test.js` to verify failure**

Run: `node --test tests/tasteDeckService.test.js`
Expected: FAIL (`Cannot find module '.../src/services/tasteDeckService.js'`).

- [ ] **Step 3: Implement `src/services/tasteDeckService.js`**

- Populate `CORE_TASTE_DECK` (30 curated iconic/recent films across Action, Sci-Fi, Crime, Drama, Thriller, Animation, Comedy, Horror, Romance, World Cinema, each with `imdbID`, `tmdbId`, `title`, `year`, `primaryGenre`, `genre`, `director`, `runtime`, `imdbRating`, `poster`, `plot`).
- Implement `interleaveByGenre()` round-robin ordering across `primaryGenre` buckets after filtering out `watched` via `buildSeenCollisionSet(watched, [])` and deduplicating against `livePool`, returning up to `deckSize` items.
- Implement `shouldAutoShowTasteOnboarding({ watchedCount, dismissedFlag })`.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/tasteDeckService.test.js`
Expected: PASS (3/3).

- [ ] **Step 5: Build `src/components/TasteDeckModal.jsx` + wire auto-onboarding & launchers**

Build `TasteDeckModal` (`({ isOpen, initialMode = "flashcards", onClose, onDismissForever, onOpenImport })`):
- **Header bar:**
  - Title `"Taste Calibration"` + live counter (`"Rated ${sessionRatedCount} this session • ${watched.length} in Vault"`).
  - View mode switcher tabs: **`Flashcard Deck (Fast 30)`** vs **`20+ Film Wall (All Genres)`**.
  - Secondary link **`Import Ratings (CSV / JSON)`** (closes modal and opens `BackupManagerModal` on Import tab) + clear **`Done / Skip`** button (calls `onDismissForever?.()` and `onClose()`).
- **Mode A — `Flashcard Deck` (1-by-1 Rapid Flow):**
  - Renders current card (`deck[index]`): subtle poster backdrop blur, crisp `2:3` poster, Title, Year, Director, Runtime, genre tags, IMDb `★`, 2-line premise.
  - **1-Click `1–10` Rating Bar (`RATING_TIERS` from `ratingTiers.js`):** clicking `1..10` OR pressing keys `1–9` / `0` (`=10`) immediately saves `prepareQuickRatePayload(currentMovie, score)` to `addWatched()`, increments session count, shows `150ms` `"Saved ★X"` feedback pill, and advances to `index + 1` (guarded cleanly against double-tap during transition timeout).
  - Action buttons: **`← Previous`** (`ArrowLeft`), **`Plan to Watch`** (`W`), **`Skip / Haven't Seen`** (`S` or `ArrowRight`).
  - Completion card when deck finishes: shows genre summary of ratings added + primary CTAs **`View Personalized Recommendations`** (navigates `/ai`) and **`Explore Home`**.
- **Mode B — `20+ Film Wall` (Popular Multi-Genre Grid):**
  - Shows 20–30 cards on one wide grid with genre label badges on top of posters and an interactive **hover / tap `1–10` quick-rating strip + `Bookmark` toggle** directly at the foot of each poster tile so users can rapid-rate dozens of recognized titles on one screen without leaving the overlay!
- In `src/App.jsx`: check `shouldAutoShowTasteOnboarding({ watchedCount: watched.length, dismissedFlag: localStorage.getItem(TASTE_ONBOARDING_DISMISSED_KEY) })` once on initial mount (opening `TasteDeckModal` in `"grid"` / `"flashcards"` — default `"grid"` on first open so visitors immediately see the 20 popular multi-genre tiles with a 1-click switch to `"flashcards"`, and `"flashcards"` when clicked from the **`Quick Taste (30)`** button!).

- [ ] **Step 6: Run tests and verify**

Run: `node --test tests/tasteDeckService.test.js`
Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/services/tasteDeckService.js tests/tasteDeckService.test.js src/components/TasteDeckModal.jsx src/App.jsx src/pages/AIPage.jsx src/index.css
git commit -m "feat(onboarding): add Rapid Taste Deck with 1-click Flashcard and 20-poster multi-genre grid modes"
```

---

### Task 5: Lossless Export & Import Upgrades (Preview Diff, Universal Formats, Zero Fake Ratings)

**Files:**
- Create: `src/services/vaultPortability.js`
- Test: `tests/vaultPortability.test.js`
- Modify: `src/services/csvImport.js:169-218` (recognize `const` / `your rating` IMDb headers cleanly)
- Modify: `src/components/BackupManagerModal.jsx:1-688`
- Modify: `src/components/VaultBanner.jsx:179-186`

**Interfaces:**
- Consumes: `parseCSVImport`, `buildWatchedRecordFromImport` (`src/services/csvImport.js`), `fetchOmdbJson`, `fetchTmdbJson` (`src/services/apiTransport.js`), `mapTmdbSearchItem` (`src/services/searchService.js`).
- Produces (`src/services/vaultPortability.js`):
  - `buildBackupJsonPayload({ watched, watchlist, userRegion, userWatchProviders, now?: number }): object`
  - `buildRatingsCsv({ watched, watchlist, format: "cinemavault" | "letterboxd" }): string`
  - `parseJsonBackupContent(content: string): { watched: Array, watchlist: Array, preferences?: object }`
  - `summarizeImportDiff({ existingWatched, existingWatchlist, incomingWatched, incomingWatchlist, mode }): { newWatchedCount: number, updatedRatingCount: number, newWatchlistCount: number, duplicatesSkipped: number, mergedWatched: Array, mergedWatchlist: Array }`
  - `resolveCsvRowFallbackRecord(row: object): { status: "watched" | "watchlist", record: object }` (ZERO silent `5` or `7` rating defaults!)

- [ ] **Step 1: Write failing tests in `tests/vaultPortability.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBackupJsonPayload,
  buildRatingsCsv,
  parseJsonBackupContent,
  summarizeImportDiff,
  resolveCsvRowFallbackRecord
} from "../src/services/vaultPortability.js";
import { parseCSVImport } from "../src/services/csvImport.js";

test("buildBackupJsonPayload and buildRatingsCsv serialize rated films, TMDB IDs, and omit fake zeroes on Letterboxd export", () => {
  const watched = [
    { imdbID: "tmdb_157336", tmdbId: 157336, title: "Interstellar", year: "2014", userRating: 10, dateWatched: "2026-10-01T00:00:00.000Z" },
    { imdbID: "tt0111161", title: "Shawshank", year: "1994", userRating: 0 }
  ];
  const json = buildBackupJsonPayload({ watched, watchlist: [], userRegion: "US", userWatchProviders: [8], now: 1700000000000 });
  assert.equal(json.schemaVersion, 2);
  assert.equal(json.watched.length, 2);

  const fullCsv = buildRatingsCsv({ watched, watchlist: [], format: "cinemavault" });
  assert.match(fullCsv, /TMDB ID/);
  assert.match(fullCsv, /157336/);

  const lbCsv = buildRatingsCsv({ watched, watchlist: [], format: "letterboxd" });
  const lines = lbCsv.trim().split("\n");
  assert.equal(lines.length, 2); // Header + Interstellar only; unrated entry omitted from Letterboxd ratings export
});

test("parseJsonBackupContent accepts both v1/v2 objects and bare rating arrays", () => {
  const fromArray = parseJsonBackupContent(JSON.stringify([{ title: "Dune", year: "2021", userRating: 9 }]));
  assert.equal(fromArray.watched.length, 1);
  assert.equal(fromArray.watched[0].title, "Dune");

  const fromObj = parseJsonBackupContent(JSON.stringify({ watched: [{ imdbID: "tt1", title: "A", userRating: 8 }], watchlist: [] }));
  assert.equal(fromObj.watched.length, 1);
});

test("summarizeImportDiff supports add_new, merge_update, and replace modes deterministically", () => {
  const existingWatched = [{ imdbID: "tt1", title: "Film A", userRating: 6 }];
  const incomingWatched = [
    { imdbID: "tt1", title: "Film A", userRating: 9 },
    { imdbID: "tt2", title: "Film B", userRating: 8 }
  ];
  const mergeRes = summarizeImportDiff({
    existingWatched,
    existingWatchlist: [],
    incomingWatched,
    incomingWatchlist: [],
    mode: "merge_update"
  });
  assert.equal(mergeRes.newWatchedCount, 1);
  assert.equal(mergeRes.updatedRatingCount, 1);
  assert.equal(mergeRes.mergedWatched.find((m) => m.imdbID === "tt1").userRating, 9);
});

test("resolveCsvRowFallbackRecord never invents fake 5 or 7 ratings for unrated rows", () => {
  const unrated = resolveCsvRowFallbackRecord({ title: "Some Film", year: "2020", rating: null, type: "" });
  assert.equal(unrated.status, "watchlist");

  const explicitUnratedWatched = resolveCsvRowFallbackRecord({ title: "Watched Film", year: "2020", rating: null, type: "Watched" });
  assert.equal(explicitUnratedWatched.status, "watched");
  assert.equal(explicitUnratedWatched.record.userRating, 0);
});

test("parseCSVImport recognizes IMDb Const and Your Rating headers", () => {
  const csv = "Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres\ntt0111161,10,2026-05-01,The Shawshank Redemption,https://www.imdb.com/title/tt0111161/,movie,9.3,142,1994,Drama";
  const parsed = parseCSVImport(csv);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].imdbId, "tt0111161");
  assert.equal(parsed.rows[0].rating, 10);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/vaultPortability.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/services/vaultPortability.js` & IMDb header recognition in `src/services/csvImport.js`**

- In `src/services/csvImport.js:169-182`: widen `imdbIdIdx` match for exact `const` (`h === "const" || h.includes("imdb") || h.includes("id")`) and `dateRated` fallback when `Watched Date`/`Date` absent (`h === "date rated"`). Also preserve optional `tmdbId`, `poster`, `director`, `genre`, `runtime`, `imdbRating` columns when re-importing CinemaVault CSV so no re-lookup is required when already present!
- Implement `src/services/vaultPortability.js` with `buildBackupJsonPayload`, `buildRatingsCsv`, `parseJsonBackupContent`, `summarizeImportDiff` (`"add_new"` | `"merge_update"` | `"replace"`), and `resolveCsvRowFallbackRecord` (no `5` or `7` rating fallback).

- [ ] **Step 4: Run tests (`vaultPortability.test.js` + existing `csvImport.test.js`)**

Run: `node --test tests/vaultPortability.test.js tests/csvImport.test.js`
Expected: PASS.

- [ ] **Step 5: Refactor `src/components/BackupManagerModal.jsx` + `src/components/VaultBanner.jsx`**

- In `BackupManagerModal.jsx`:
  - Support initial tab prop `initialTab` (default `"export"`).
  - Export JSON using Blob + `URL.createObjectURL` + cleanup `URL.revokeObjectURL` (`setTimeout(..., 1000)` on `exportJSON`, `exportGeneralCSV`, `exportLetterboxdCSV`).
  - Import: add JSON preview summary before applying when `pendingImport` is parsed, add 3 clear mode pills (`Add New Only`, `Merge & Update`, `Replace Vault`), replace `userRating: row.rating || 5` & `|| 7` (`lines 255, 300`) with `resolveCsvRowFallbackRecord` / `row.rating || 0`, replace `Sparkles` spinner (`line 387`) with `Loader2`, and add TMDB `/3/search/movie` fallback when `fetchOmdbJson` fails or returns `"False"`.
- In `VaultBanner.jsx:179-186`: keep clear label `"Import / Export"` instead of `"Backup"`.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/services/vaultPortability.js src/services/csvImport.js tests/vaultPortability.test.js src/components/BackupManagerModal.jsx src/components/VaultBanner.jsx
git commit -m "feat(portability): upgrade Export/Import with preview diff, IMDb/JSON array support, and zero fake ratings"
```

---

### Task 6: Optional Supabase Auth & Postgres Cloud Vault Sync (Zero Guest Friction)

> **Execution decision gate for orchestrator before starting Task 6:** Before executing SQL against Supabase MCP, ask the user whether to **restore** paused project `"Movie Rating App"` (`dyetfuefrbpxriviuosq`) / `"Movie Tracker"` (`pjgafgungxyjfkcbvkwt`) or **create** a new CinemaVault project (since org `xrztytwsncxxewhecjal` has `AI learning Companion` active and Free plan allows 2 active projects at once). Apply schema via Supabase MCP (`execute_sql` / migration + `get_advisors` security & performance check) ONLY once target project ref is confirmed.

**Files:**
- Modify: `package.json` (`@supabase/supabase-js` pinned exact/caret version via `npm install`)
- Modify: `.env.example` (document `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`)
- Create: `supabase/migrations/20261114000000_init_cinemavault_schema.sql`
- Create: `src/services/supabaseClient.js`
- Create: `src/services/vaultSyncService.js`
- Test: `tests/vaultSyncService.test.js`
- Create: `src/components/CloudSyncModal.jsx`
- Modify: `src/context/AppContext.jsx` & `src/App.jsx`

**Interfaces:**
- Consumes (`src/context/AppContext.jsx`): existing `watched`, `watchlist`, `userRegion`, `userWatchProviders`, `setWatched`, `setWatchlist`, `setUserRegion`, `setUserWatchProviders`.
- Produces:
  - `src/services/supabaseClient.js`: `hasSupabaseConfig()`, `getSupabaseClient()`.
  - `src/services/vaultSyncService.js`:
    - `getCanonicalMovieKey(movie): string` (`tt*` or `tmdb_<id>` or `movie.id`)
    - `mapLocalMovieToDbRow(movie, status, userId, nowIso?): DbVaultRow`
    - `mapDbRowToLocalMovie(row): object`
    - `mergeLocalAndCloudVault({ localWatched, localWatchlist, cloudRows, localUpdatedMap? }): { mergedWatched, mergedWatchlist, toUpsertCloud: Array }`

- [ ] **Step 1: Write failing tests in `tests/vaultSyncService.test.js`**

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  getCanonicalMovieKey,
  mapLocalMovieToDbRow,
  mapDbRowToLocalMovie,
  mergeLocalAndCloudVault
} from "../src/services/vaultSyncService.js";

test("mapLocalMovieToDbRow and mapDbRowToLocalMovie round-trip ratings, notes, and recommendation metadata losslessly", () => {
  const movie = {
    imdbID: "tmdb_157336",
    tmdbId: 157336,
    title: "Interstellar",
    year: "2014",
    poster: "https://image.tmdb.org/t/p/w500/p.jpg",
    genre: "Sci-Fi, Drama",
    director: "Christopher Nolan",
    runtime: 169,
    imdbRating: 8.7,
    userRating: 10,
    userNote: "Theater IMAX rewatch",
    dateWatched: "2026-10-15T12:00:00.000Z",
    castIds: [10297],
    tmdbGenreIds: [878, 18],
    tmdbKeywords: [1432]
  };
  const dbRow = mapLocalMovieToDbRow(movie, "watched", "user-123", "2026-11-14T01:00:00.000Z");
  assert.equal(dbRow.movie_key, "tmdb_157336");
  assert.equal(dbRow.status, "watched");
  assert.equal(dbRow.user_rating, 10);
  assert.deepEqual(dbRow.metadata.tmdbKeywords, [1432]);

  const restored = mapDbRowToLocalMovie(dbRow);
  assert.equal(restored.imdbID, "tmdb_157336");
  assert.equal(restored.userRating, 10);
  assert.equal(restored.userNote, "Theater IMAX rewatch");
  assert.deepEqual(restored.castIds, [10297]);
});

test("mergeLocalAndCloudVault preserves guest local ratings, gives watched precedence over watchlist, and queues cloud upserts", () => {
  const localWatched = [
    { imdbID: "tt0111161", title: "Shawshank", userRating: 9, updatedAt: "2026-11-14T02:00:00.000Z" },
    { imdbID: "tmdb_272", tmdbId: 272, title: "Batman Begins", userRating: 8 }
  ];
  const localWatchlist = [
    { imdbID: "tt0133093", title: "The Matrix" }
  ];
  const cloudRows = [
    { movie_key: "tt0111161", imdb_id: "tt0111161", status: "watched", title: "Shawshank", user_rating: 7, metadata: {}, updated_at: "2026-11-10T00:00:00.000Z" },
    { movie_key: "tt0133093", imdb_id: "tt0133093", status: "watched", title: "The Matrix", user_rating: 10, metadata: {}, updated_at: "2026-11-12T00:00:00.000Z" },
    { movie_key: "tmdb_550", tmdb_id: 550, imdb_id: "tmdb_550", status: "watchlist", title: "Fight Club", metadata: {}, updated_at: "2026-11-11T00:00:00.000Z" }
  ];

  const merged = mergeLocalAndCloudVault({ localWatched, localWatchlist, cloudRows });
  assert.equal(merged.mergedWatched.length, 3);
  assert.equal(merged.mergedWatched.find((m) => m.imdbID === "tt0111161").userRating, 9);
  // Matrix is watched in cloud so removed from watchlist
  assert.equal(merged.mergedWatchlist.some((m) => m.imdbID === "tt0133093"), false);
  assert.equal(merged.mergedWatchlist.some((m) => m.imdbID === "tmdb_550"), true);
  // Local-only Batman Begins + newer local rating for Shawshank queued for upsert
  const upsertKeys = merged.toUpsertCloud.map((r) => r.movie_key);
  assert.ok(upsertKeys.includes("tmdb_272"));
  assert.ok(upsertKeys.includes("tt0111161"));
});

test("getCanonicalMovieKey falls back predictably across imdbID, tmdbId, and id", () => {
  assert.equal(getCanonicalMovieKey({ imdbID: "tt0111161", tmdbId: 278 }), "tt0111161");
  assert.equal(getCanonicalMovieKey({ tmdbId: 278 }), "tmdb_278");
  assert.equal(getCanonicalMovieKey({ id: "custom_1" }), "custom_1");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/vaultSyncService.test.js`
Expected: FAIL.

- [ ] **Step 3: Author hardened Postgres migration `supabase/migrations/20261114000000_init_cinemavault_schema.sql`**

Create migration following Supabase & Postgres Best Practices:
- `public.profiles` (`id uuid primary key references auth.users(id) on delete cascade`, `display_name text`, `user_region text not null default 'GLOBAL'`, `preferred_providers integer[] not null default '{}'::integer[]`, `updated_at timestamptz not null default now()`).
- `public.user_vault_items` (`id bigint generated always as identity primary key`, `user_id uuid not null references auth.users(id) on delete cascade`, `movie_key text not null`, `status text not null check (status in ('watched','watchlist'))`, `tmdb_id integer`, `imdb_id text`, `title text not null`, `year text`, `poster text`, `genre text`, `director text`, `runtime integer`, `imdb_rating numeric(3,1)`, `user_rating smallint check (user_rating is null or (user_rating >= 0 and user_rating <= 10))`, `user_note text`, `date_watched timestamptz`, `is_bulk_imported boolean not null default false`, `metadata jsonb not null default '{}'::jsonb`, `updated_at timestamptz not null default now()`, `unique (user_id, movie_key)`).
- Index `create index if not exists user_vault_items_user_status_idx on public.user_vault_items (user_id, status, updated_at desc);`.
- Enable RLS + revoke public/anon access (`revoke all on public.profiles, public.user_vault_items from public, anon; grant select, insert, update, delete on public.profiles, public.user_vault_items to authenticated;`).
- Four explicit policies per table (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) scoped strictly `to authenticated` using `(select auth.uid()) = id` / `(select auth.uid()) = user_id` in both `USING` and `WITH CHECK`.
- Helper trigger `public.touch_updated_at()` (`security invoker`, `set search_path = ''`).

- [ ] **Step 4: Install `@supabase/supabase-js` & implement `src/services/supabaseClient.js` + `src/services/vaultSyncService.js`**

- Install `@supabase/supabase-js`: run `npm install @supabase/supabase-js --save-exact` and update `.env.example` with commented `VITE_SUPABASE_URL=` and `VITE_SUPABASE_PUBLISHABLE_KEY=`.
- Implement `src/services/supabaseClient.js` returning `null` when unconfigured (zero crash in keyless / GitHub Pages / `node --test`).
- Implement `src/services/vaultSyncService.js` (pure conversion & deterministic merge logic).

- [ ] **Step 5: Run `tests/vaultSyncService.test.js` to verify pass**

Run: `node --test tests/vaultSyncService.test.js`
Expected: PASS (3/3).

- [ ] **Step 6: Create `src/components/CloudSyncModal.jsx` and wire opt-in sync in `src/context/AppContext.jsx` & `src/App.jsx`**

- Use `supabase.auth.getClaims()` on mount and subscribe cleanly to `supabase.auth.onAuthStateChange(...)`.
- Offer passwordless Email OTP / Magic Link (`supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })`) + Sign Out + `"Sync Now"` button.
- On initial sign-in (`userId` becomes set), fetch `user_vault_items`, run `mergeLocalAndCloudVault`, update React state + upsert any local-only/newer rows to Supabase in batches of 100.
- When signed in, enqueue debounced upserts/deletes on `addWatched`, `deleteWatched`, `addToWatchlist`, `deleteWatchlist`; when offline or signed out, do nothing (zero errors!).
- Optionally run MCP `get_advisors` (`security` and `performance`) after applying the migration to the chosen Supabase project.

- [ ] **Step 7: Commit Task 6**

```bash
git add package.json package-lock.json .env.example supabase/migrations/20261114000000_init_cinemavault_schema.sql src/services/supabaseClient.js src/services/vaultSyncService.js tests/vaultSyncService.test.js src/components/CloudSyncModal.jsx src/context/AppContext.jsx src/App.jsx src/components/NavBar.jsx
git commit -m "feat(supabase): add opt-in auth, Postgres RLS schema, and lossless cloud vault sync"
```

---

### Task 7: Full Test Matrix, Secret/Bundle Audit & Headless Browser Verification

**Files:**
- All tests under `tests/*.test.js`
- Output bundle `build/assets/`

- [ ] **Step 1: Run complete unit test suite**

Run: `npm test`
Expected: 100% PASS, zero skipped, zero failed (143 existing + ~16 new tests).

- [ ] **Step 2: Verify production build & zero secret leaks**

Run: `npm run build`
Check bundle cleanly exits 1 (0 matches) on leaked keys:
Run: `rg -n "AIza|sb_secret_|service_role" build/assets`
Expected: `npm run build` succeeds; secret scan returns 0 matches.

- [ ] **Step 3: Live headless browser verification (fresh empty state + populated vault state)**

Start local preview/dev server cleanly and verify via `browser` subagent:
1. **Fresh guest profile (`watched = []`):** auto-opens **Taste Calibration** deck showing **20 multi-genre film wall**, switching to **Flashcard (Fast 30)** rates `3` films via click (`1–10`) cleanly saving without `8` fallback, clicking `"Skip & Browse Home"` persists dismissal across page reload.
2. **Editorial Navbar & Search (`Ctrl+K` / button):** verify flat editorial nav (no purple AI glow, `Quick Taste` pill, Library menu opens **Import / Export Ratings** & **Cloud Sync**); empty Search renders **Popular Right Now poster wall** (not bare chips); searching `"batman"` renders split preview + `+ Rate` action cleanly.
3. **Home poster density:** verify multiple live carousels + filterable **Catalog Mosaic Grid** with `"Show 24 More Posters"` + zero duplicate posters across Hero and carousels.
4. **Export / Import Modal:** verify JSON & CSV download actions succeed without errors and preview summary renders accurately on upload, with zero console errors.

- [ ] **Step 4: Final clean verification & branch merge readiness**

Re-run `npm test` after any final polish before finishing.

---

## Plan Self-Review Checklist (Verified Inline)
1. **Spec coverage:** Navbar (`Task 1`), Search UI (`Task 2`), More Posters on Home (`Task 3`), First-open 20-poster multi-genre deck + Rapid 30-film Flashcard button (`Task 4`), Export & Import upgrades (`Task 5`), Less AI'ish visual polish (`Task 1` + `Task 2` + `Task 7`), Supabase recommendation + opt-in integration (`Task 6`) — 100% covered.
2. **Consistency:** `getCanonicalMovieKey`, `buildSeenCollisionSet`, `prepareQuickRatePayload`, `prepareWatchlistPayload`, `mergeLocalAndCloudVault`, and `TASTE_ONBOARDING_DISMISSED_KEY` match exact names across Interfaces and Tasks.
3. **Review Focus coverage:** Every one of the 5 failure modes maps explicitly to unit tests in Tasks 2, 3, 4, 5, and 6.
