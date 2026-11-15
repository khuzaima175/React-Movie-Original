# Phase 3: Side-by-Side Decision & Research Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable users to dock up to 3 films from anywhere in CinemaVault (`MovieDetails`, `MovieCard`, `/explore`, `/vault`) and open a full Side-by-Side Decision & Research Matrix (`CompareModal` overlay + shareable `/compare?ids=...` route) comparing ratings, ROI/budget, runtime deltas, shared cast/crew, motif overlap, regional streaming availability, and Vault Taste Resonance.

**Architecture:** Isolate pure comparison math, intersection detection, currency/runtime parsing, URL serialization, and session persistence helpers inside `src/services/compareService.js` verified by `node --test`. Manage session-scoped `compareItems` (max 3, deduplicated via `isSameMovie`) in `AppContext.jsx`, and mount a persistent non-intrusive `CompareDock.jsx` + `CompareModal.jsx` + `<Route path="/compare">` backed by a single shared `<CompareWorkbench />` view.

**Tech Stack:** React 18, React Router v6, TMDB + OMDb hydration (`fetchTmdbMovieDetails`, `findTmdbByImdbId`, `fetchOmdbJson`), optional on-device `CVEM v1` similarity (`embeddingService.js`), Node ESM native test runner (`node --test`), Vite.

---

### Spec & Global Constraints
- **Design Spec:** [docs/superpowers/specs/2026-11-15-research-hub-and-studio-design.md](../specs/2026-11-15-research-hub-and-studio-design.md)
- **Constraint 1 (Zero Permanent DB Pollution):** `compareItems` lives in `sessionStorage` (`cinemavault_compare_v1`), capped at 3 unique films via `isSameMovie()`. Never write compare selections into `watched`, `watchlist`, or Supabase Postgres tables.
- **Constraint 2 (Single Shared Matrix Component):** `CompareModal.jsx` and `ComparePage.jsx` (`/compare?ids=...`) must both render `<CompareWorkbench />` rather than duplicating comparison JSX tables.
- **Constraint 3 (UI Layering & Bulk Bar Coexistence):** `CompareDock` renders at `z-index: var(--z-bulk)` (`65`). When `VaultBulkBar` (`VaultPage` Manage Mode) or mobile bottom tabs (`.mobile-stream-bar` at `<=900px`) are visible, `CompareDock` must clear them cleanly (via `padding-bottom` / conditional suppression on `/compare`) and yield `Escape` handling to any higher `role="dialog"` (`QuickRateModal` at `9999`).
- **Constraint 4 (Conditional Model Availability):** Remember only `/models/item_embeddings_f16.bin` (`CVEM v1`) is deployed in `public/models/` (`cinematic_dna_u8.bin` is absent). Predicted taste fit and inter-film vector cosine must use `loadDefaultEmbeddingIndex()` with graceful `null` UI fallback when a film is missing from the index (e.g., brand-new releases).

---

### Review Focus (5 Failure Modes Pinned by Tests)
1. **Card Stub -> Full Matrix Hydration:** Adding a film to Compare from a lightweight `MovieCard` (which lacks `runtime`, `budget`, `castDetails`, `keywords`, `streamProviders`, `rtScore`) must trigger concurrent hydration (`fetchTmdbMovieDetails` + `fetchOmdbJson`) without losing Vault `userRating`/`userNote` from local state.
2. **Duplicate Identity & 3-Slot Cap Enforcement:** Adding `"tt0816692"` and later `"tmdb_157336"` (Interstellar under both ID schemes) must toggle/deduplicate cleanly via `isSameMovie()` rather than adding duplicates; adding a 4th film cleanly reports `{ status: "full" }` or replaces/rejects deterministically without corrupting state.
3. **Currency & Runtime Parsing Safety:** Missing or `"N/A"` box office/budget (`"$0"`, `null`, `"N/A"`) must never produce `Infinity` ROI multiples or `NaN min` runtime diffs in `buildCompareMatrix()`.
4. **Cross-Entity Person Link Integrity:** Shared Actors and Shared Crew in `computeCompareOverlap()` must preserve TMDB `personId` so clicking any shared filmmaker/star navigates accurately to `/person/:id`.
5. **Shareable `/compare?ids=...` Refresh & Empty State:** Visiting `/compare?ids=tt0816692,tmdb_27205` directly in a fresh browser tab with empty `sessionStorage` must resolve and render both films; opening `/compare` with `< 2` IDs must show a clean empty/search selector prompt instead of an error screen.

---

### Task 1: Pure `compareService.js` — Queue Ops, Metrics, Intersection & Taste Fit

**Files:**
- Create: `src/services/compareService.js`
- Test: `tests/compareService.test.js`

**Interfaces:**
```js
export const COMPARE_MAX_ITEMS = 3;
export const COMPARE_STORAGE_KEY = "cinemavault_compare_v1";

export function toCompareStub(movie)
export function toggleCompareItem(currentList = [], movie)
// returns { items: nextList, action: "added" | "removed" | "full" }

export function parseCurrencyUsd(raw) // number | null
export function parseRuntimeMins(raw) // number | null
export function buildCompareUrl(items = []) // "/compare?ids=..."
export function parseCompareUrlIds(searchString = "") // string[] (max 3)

export function computeCompareOverlap(hydratedMovies = [], embeddingIndex = null)
// returns { sharedActors: [{ id, name, rolesByMovie }], sharedCrew: [{ id, name, rolesByMovie }], sharedGenres: string[], sharedKeywords: [{ id?, name }], pairVectorSims: [{ aTitle, bTitle, similarityPct }] }

export function buildCompareMatrix(hydratedMovies = [], { watched = [], watchlist = [], embeddingIndex = null } = {})
// returns {
//   items: annotatedItems,
//   rows: { imdb, rt, metascore, tmdb, runtime, budget, revenue, roi, vaultScore, vaultMatchPct, streamProviders },
//   leaders: { imdb: number[], rt: number[], metascore: number[], tmdb: number[], runtimeShortest: number[], revenue: number[], vaultMatch: number[] },
//   overlap
// }
```

- [ ] **Step 1: Write the failing test**
  Create `tests/compareService.test.js`:
  ```js
  import test from "node:test";
  import assert from "node:assert/strict";
  import { encodeEmbeddingBinary, parseEmbeddingBinary } from "../src/services/embeddingService.js";
  import {
    COMPARE_MAX_ITEMS,
    toggleCompareItem,
    parseCurrencyUsd,
    parseRuntimeMins,
    buildCompareUrl,
    parseCompareUrlIds,
    computeCompareOverlap,
    buildCompareMatrix
  } from "../src/services/compareService.js";

  test("toggleCompareItem deduplicates IMDb/TMDB identities and enforces 3-film limit", () => {
    let state = [];
    state = toggleCompareItem(state, { imdbID: "tt0816692", tmdbId: 157336, title: "Interstellar" }).items;
    assert.equal(state.length, 1);

    // Same movie by tmdbId alone removes cleanly instead of duplicating
    const removed = toggleCompareItem(state, { tmdbId: 157336, title: "Interstellar" });
    assert.equal(removed.action, "removed");
    assert.equal(removed.items.length, 0);

    // Fill 3 slots then block 4th cleanly
    for (const id of [1, 2, 3]) {
      state = toggleCompareItem(state, { tmdbId: id, title: `Movie ${id}` }).items;
    }
    const fourth = toggleCompareItem(state, { tmdbId: 4, title: "Movie 4" });
    assert.equal(fourth.action, "full");
    assert.equal(fourth.items.length, COMPARE_MAX_ITEMS);
  });

  test("parseCurrencyUsd and parseRuntimeMins safely reject N/A and zero budgets", () => {
    assert.equal(parseCurrencyUsd("$165,000,000"), 165000000);
    assert.equal(parseCurrencyUsd("N/A"), null);
    assert.equal(parseCurrencyUsd("$0"), null);
    assert.equal(parseRuntimeMins("169 min"), 169);
    assert.equal(parseRuntimeMins(148), 148);
    assert.equal(parseRuntimeMins("N/A"), null);
  });

  test("computeCompareOverlap finds shared actors/crew with personIds, shared genres/keywords, and vector similarity", () => {
    const buf = encodeEmbeddingBinary([
      { tmdbId: 10, vec: [1, 0, 0] },
      { tmdbId: 20, vec: [0.8, 0.6, 0] }
    ]);
    const idx = parseEmbeddingBinary(buf);
    const overlap = computeCompareOverlap([
      {
        tmdbId: 10,
        title: "Film A",
        genre: "Sci-Fi, Thriller",
        directorDetails: [{ id: 525, name: "Christopher Nolan" }],
        castDetails: [{ id: 2037, name: "Cillian Murphy", character: "Fischer" }],
        keywords: ["dream", "heist"]
      },
      {
        tmdbId: 20,
        title: "Film B",
        genre: "Drama, Sci-Fi",
        directorDetails: [{ id: 525, name: "Christopher Nolan" }],
        castDetails: [{ id: 2037, name: "Cillian Murphy", character: "Oppenheimer" }],
        keywords: ["biography", "dream"]
      }
    ], idx);

    assert.equal(overlap.sharedCrew[0].id, 525);
    assert.equal(overlap.sharedActors[0].id, 2037);
    assert.deepEqual(overlap.sharedGenres, ["Sci-Fi"]);
    assert.ok(overlap.sharedKeywords.some((k) => k.name.toLowerCase() === "dream"));
    assert.equal(overlap.pairVectorSims[0].similarityPct, 80);
  });

  test("buildCompareMatrix identifies column winners and handles missing financials without NaN ROI", () => {
    const matrix = buildCompareMatrix(
      [
        { tmdbId: 10, title: "A", imdbRating: "8.8", runtime: "148 min", budget: "$160,000,000", revenue: "$800,000,000" },
        { tmdbId: 20, title: "B", imdbRating: "8.1", runtime: "120 min", budget: "N/A", revenue: "$200,000,000" }
      ],
      { watched: [{ tmdbId: 10, userRating: 9 }], watchlist: [] }
    );
    assert.deepEqual(matrix.leaders.imdb, [0]);
    assert.equal(matrix.items[0].roiLabel, "5.0×");
    assert.equal(matrix.items[1].roiLabel, "—");
    assert.equal(matrix.items[0].vaultRating, 9);
  });

  test("buildCompareUrl and parseCompareUrlIds round-trip canonical IDs capped at 3", () => {
    const url = buildCompareUrl([{ imdbID: "tt0816692" }, { tmdbId: 27205 }]);
    assert.equal(url, "/compare?ids=tt0816692%2Ctmdb_27205");
    assert.deepEqual(parseCompareUrlIds(url.split("?")[1]), ["tt0816692", "tmdb_27205"]);
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/compareService.test.js`
  Expected: FAIL (`Cannot find module '../src/services/compareService.js'`).

- [ ] **Step 3: Implement `src/services/compareService.js`**
  - Reuse `isSameMovie`, `findMatchingMovie` (`movieIdentity.js`), `getCanonicalMovieKey` (`vaultSyncService.js`), and `computeUserEmbedding` (`embeddingService.js`) cleanly.
  - Handle tie-breaking cleanly on column leaders (multiple winners highlighted when tied on exact same top score).
  - For Vault Taste Fit (`vaultMatchPct`), map `cosine` from user centroid `(-0.2..0.85)` safely into an intuitive clamped `[0..99]` % indicator ONLY when `embeddingIndex` contains both user profile films and the candidate `tmdbId` (otherwise `null`).

- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/compareService.test.js`
  Expected: PASS (all 5 tests green).

- [ ] **Step 5: Commit**
  `git add src/services/compareService.js tests/compareService.test.js; if ($LASTEXITCODE -eq 0) { git commit -m "feat(compare): add compareService matrix, overlap analytics, and URL helpers" }`

---

### Task 2: Session Compare State in `AppContext.jsx` + Floating `CompareDock.jsx`

**Files:**
- Modify: `src/context/AppContext.jsx`
- Create: `src/components/CompareDock.jsx`
- Create: `src/styles/compare.css`
- Modify: `src/App.jsx`

**Interfaces:**
```js
// Added cleanly to AppContext value:
compareItems,       // MovieStub[] (max 3)
toggleCompare,      // (movie) => { action: "added"|"removed"|"full", items }
removeCompareItem,  // (idOrMovie) => void
clearCompare,       // () => void
isCompareOpen,      // boolean
openCompareModal,   // () => void
closeCompareModal   // () => void
```

- [ ] **Step 1: Add Compare state & actions to `src/context/AppContext.jsx`**
  - Load initial `compareItems` safely from `sessionStorage.getItem(COMPARE_STORAGE_KEY)` with `try/catch` returning `[]`.
  - Sync changes back to `sessionStorage`.
  - Expose `toggleCompare` (delegating to `toggleCompareItem`), `removeCompareItem`, `clearCompare`, `isCompareOpen`, `openCompareModal`, `closeCompareModal`, plus optional brief warning toast/status callback if `"full"` (3/3 slots reached).

- [ ] **Step 2: Build `src/components/CompareDock.jsx` + Dock styles in `src/styles/compare.css`**
  - Render nothing when `compareItems.length === 0` or current route `pathname === "/compare"`.
  - Compact floating Obsidian capsule showing up to 3 poster chips (`PosterImage` + title + `×` remove), `"Clear"`, and `"Compare (N/3)"` primary CTA (`disabled={compareItems.length < 2}`).
  - Add `"Add Film"` slot or hint when only 1 film is docked (`"Pick 1 more film to compare"`).
  - Positioned safely above `.mobile-stream-bar` on small viewports (`bottom: calc(6.8rem + env(safe-area-inset-bottom))` below `900px`) and gracefully offset above `.vault-bulk-bar` if visible.

- [ ] **Step 3: Mount `CompareDock` and `CompareModal` cleanly in `src/App.jsx`**
  - Render `<CompareDock />` and `<CompareModal />` alongside global modals in `AppContent`.

- [ ] **Step 4: Build check**
  Run: `npm run build`
  Expected: Zero errors.

- [ ] **Step 5: Commit**
  `git add src/context/AppContext.jsx src/components/CompareDock.jsx src/styles/compare.css src/App.jsx; if ($LASTEXITCODE -eq 0) { git commit -m "feat(compare): add session compare state in AppContext and floating CompareDock" }`

---

### Task 3: `<CompareWorkbench />`, `CompareModal.jsx` & `/compare` Deep-Link Page

**Files:**
- Create: `src/components/CompareWorkbench.jsx`
- Create: `src/components/CompareModal.jsx`
- Create: `src/pages/ComparePage.jsx`
- Modify: `src/App.jsx`
- Modify: `src/styles/compare.css`

- [ ] **Step 1: Implement `<CompareWorkbench movieIdsOrItems onNavigatePerson onNavigateMovie onAddFromSearch />`**
  - Accepts either initial movie items (`compareItems`) OR URL `ids` from `/compare?ids=...`.
  - Hydrates every slot concurrently via `fetchTmdbMovieDetails` + `findTmdbByImdbId` + `fetchOmdbJson` (caching in an in-memory `Map` so toggling back never re-fetches), plus lazily loads `loadDefaultEmbeddingIndex()`.
  - Calls `buildCompareMatrix(hydratedMovies, { watched, watchlist, embeddingIndex })`.
  - Renders clean structured sections:
    1. **Hero Poster Header Columns** (2 or 3 columns desktop, horizontal scroll snap cleanly on mobile) with Quick Watchlist/Remove/Navigate `/movie/:id` actions + `"Copy Share Link"` button.
    2. **Critics & Community Consensus** (IMDb, Rotten Tomatoes %, Metascore, TMDB score + vote count) highlighting exact column winners in ivory/gold tabular styling.
    3. **Your Vault Fit & Status** (Your rating/notes or `"In Watchlist"`, plus `CVEM` Vault Taste Resonance `%` badge).
    4. **Production & Financials** (Year, Runtime + delta, MPAA Rating, Budget, Worldwide Revenue, ROI multiple, Origin Country, Languages).
    5. **Shared DNA & Creative Overlap Strip**: Clickable chips for Shared Cast & Shared Crew (clicking triggers `onNavigatePerson(personId)` -> `/person/:id`), Shared Genres & `#Motifs` (clicking navigates `/explore?...`), and Inter-Film Semantic Match `%`.
    6. **Where to Watch (`userRegion`)**: Regional streaming/rent/free badges stacked per column.

- [ ] **Step 2: Build `CompareModal.jsx` & `ComparePage.jsx` (`/compare`)**
  - `CompareModal.jsx`: Portal dialog (`z-index: 8500`, `Escape` stacking check yielding to higher `[role="dialog"]`, focus restoration on close). Header shows `"Open Full Compare Page"` (`buildCompareUrl(compareItems)`).
  - `ComparePage.jsx`: Reads `parseCompareUrlIds(searchParams)` (or falls back to `compareItems`), renders `<CompareWorkbench />` full-bleed inside `.page-rail`, adds `<Route path="/compare" element={<ComparePage />} />` in `App.jsx`.

- [ ] **Step 3: Wire `+ Compare` Triggers Across Surfaces**
  - **`MovieDetails.jsx`:** Add crisp `+ Compare` / `In Compare (N/3)` button next to `"Discuss This Film"` & Trailer CTA.
  - **`MovieCard.jsx`:** Support `onToggleCompare` / `isInCompare` OR read `toggleCompare` / `compareItems` safely from `useApp()` (passing optional `showCompareButton` prop or clean compact `Scale`/`GitCompare` icon inside `.unified-overlay-actions` so users can dock straight from Discover, Explore, Search, or Vault!).

- [ ] **Step 4: Run Full Phase 3 Tests & Production Build**
  Run: `npm test; if ($LASTEXITCODE -eq 0) { npm run build }`
  Expected: All unit tests pass; Vite builds cleanly.

- [ ] **Step 5: Commit**
  `git add src/components/CompareWorkbench.jsx src/components/CompareModal.jsx src/pages/ComparePage.jsx src/components/MovieDetails.jsx src/components/MovieCard.jsx src/styles/compare.css src/App.jsx; if ($LASTEXITCODE -eq 0) { git commit -m "feat(compare): add CompareWorkbench matrix, CompareModal, /compare route, and card triggers" }`
