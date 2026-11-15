# CinemaVault Research Hub, Rating Studio & Movie Companion — Design Spec

**Date:** 2026-11-15
**Baseline Commit:** `397a637` (`main`)
**Scope:** 6 coordinated upgrades transforming CinemaVault from a rating log + AI recommender into an end-to-end film research studio:
1. **Next-Level Rating Studio UI** (Unified 1–10 dial, live Vault percentile calibration & same-score anchors, contextual quick tags, expandable craft sub-scores & watch session log)
2. **"Discuss This Film" Button → Movie-Aware AI Chat** (Deep-link + session-persisted movie dossier, Vault score awareness, spoiler-safety switch, dynamic starter prompts)
3. **Side-by-Side Compare Matrix (`Movie A vs Movie B [vs Movie C]`)** (Floating dock, hydrated critics/financial/provider/runtime comparison, shared cast & crew, motif/genre/64-D embedding overlap)
4. **"Find Exact Movies" Filter Workbench (`/explore`)** (Full `/3/discover/movie` multi-facet workbench with bidirectional URL params, decade/runtime/vote presets, exclude genres, person/keyword autocomplete, regional provider filter, hide-watched toggle)
5. **Custom Research Lists & Canon Checklists + Sync/Portability** (User-created playlists/lists, Canon progression checklists with auto-completion vs `watched`, Schema v3 JSON portability, optional Supabase `user_lists` sync with soft-delete tombstones)
6. **Movie Page "Rabbit Hole" Discovery (`MovieDetails`)** (Franchise / Trilogy chronological strip via `/3/collection/:id`, clickable Genres & `#Cinematic Motifs` into `/explore`, hybrid 64-D `CVEM v1` + TMDB Recommendations carousel)

---

## 1. Visual System & Interaction Invariants

All UI changes adhere strictly to `src/styles/tokens.css`, `src/styles/primitives.css`, and existing z-index / Escape-key stacking rules:
- **Color & Surface Tokens:** Obsidian `#0d0e11` (`--bg`), `#14161b` (`--surface-1`), `#1c1e25` (`--surface-2`), `#252831` (`--surface-3`), hairlines `rgba(255, 255, 255, 0.08)` (`--hairline`), text `#f3f1eb` / `#a8a7a1` / `#6e6d68`.
- **Gold Accent Discipline (`--accent: #e5b84b`):** Reserved strictly for user rating scores/stars, active Rating Studio score chip, and keyboard focus rings (`--focus-ring`). No neon glows or colored drop shadows (`--sh-1` / `--sh-2` / `--sh-3` monochrome elevation only). Primary buttons remain warm ivory (`--btn-primary-bg: #f3f1eb`, `--btn-primary-fg: #0d0e11`).
- **Typography & Tabular Numbers:** Editorial serif/display headings via `.display-title`; numeric scores, box office, runtimes, percentiles, and counts use `.tabular-num`. Base scale `1rem = 10px`.
- **Z-Index Hierarchy (`tokens.css` & component styles):**
  - `--z-nav: 40` (`NavBar`)
  - `--z-hover: 50` (card hover overlays)
  - `--z-menu: 60` (dropdown `Menu.Panel`, `AddToListPopover`)
  - `--z-bulk: 65` (`.mobile-stream-bar` at `<=900px`, `VaultBulkBar`, and **`CompareDock`** — positioned cleanly so `VaultBulkBar` and `CompareDock` never collide)
  - `8500` (`PersonFilmographyModal`, `CompareModal`)
  - `9999` (`Modal` / `QuickRateModal` — always topmost)
- **Escape-Key Stacking:** Any lower modal/page (`MovieDetails`, `PersonFilmographyModal`, `CompareModal`) must yield `Escape` handling cleanly whenever a higher `role="dialog"` is mounted on top.

---

## 2. Data Model Additions (Backward-Compatible)

All additions to watched movie objects sit as optional properties alongside core fields (`imdbID`, `tmdbId`, `title`, `year`, `userRating`, `userNote`, `dateWatched`, `updatedAt`). Existing v1/v2 records remain 100% valid:
1. **`ratingBreakdown` (optional on watched items):** `{ story?: 1..5, direction?: 1..5, acting?: 1..5, visuals?: 1..5 }`. Automatically preserved inside `user_vault_items.metadata` JSONB by `mapLocalMovieToDbRow()` in `src/services/vaultSyncService.js` (`CORE_SQL_FIELDS` excludes it, so it persists cleanly to Supabase with zero table alterations!).
2. **`watchMeta` (optional on watched items):** `{ format?: "theater"|"streaming"|"imax"|"physical"|"home", rewatchCount?: number, containsSpoilers?: boolean }`. Also automatically persisted inside `metadata` JSONB.
3. **`keywordItems` (enriched TMDB movie details):** `[{ id: number, name: string }]` stored alongside existing `tmdbKeywords: number[]` and `keywordNames: string[]` in `formatTmdbMovieDetails()` (`tmdbService.js`) and passed through `MovieDetails.jsx`, plus forwarding `collectionId` and `collectionName` onto normalized `movie` state in `MovieDetails.jsx`.
4. **`customLists` (new top-level array in `AppContext`):**
   - Persisted locally in `localStorage` under `cinemavault_custom_lists_v1`.
   - Item schema:
     ```js
     {
       id: "list_<slugOrTimestampRandom>",
       name: "Slow-Burn 90s Thrillers",
       description: "...",
       sourceChecklistId: null | string, // if cloned from Canon Checklist
       createdAt: "2026-11-15T...",
       updatedAt: "2026-11-15T...",
       deletedAt: null | "2026-11-15T...", // tombstone for multi-device sync merge
       items: [
         {
           movieKey: "tt0114369",
           imdbID: "tt0114369",
           tmdbId: 807,
           title: "Se7en",
           year: "1995",
           poster: "...",
           director: "David Fincher",
           genre: "Crime, Mystery, Thriller",
           runtime: "127 min",
           imdbRating: 8.6,
           addedAt: "2026-11-15T..."
         }
       ]
     }
     ```
5. **`compareItems` (session-scoped in `AppContext`):**
   - Array of up to **3** normalized movie stubs persisted in `sessionStorage` (`cinemavault_compare_v1`), keyed via `isSameMovie()` (`movieIdentity.js`). Never pollutes permanent Vault tables.

---

## 3. Navigation & Route Map

Existing routes (`/`, `/movie/:id`, `/person/:id`, `/vault`, `/ai`) remain unchanged. Extensions:
- **`/explore`** (`ExplorePage.jsx`): Deep TMDB filter workbench with URL query serialization (`?genres=878&yearFrom=2010&yearTo=2026&minImdb=7.5&sort=vote_average.desc&hideWatched=1`). Linked from:
  - `NavBar` desktop navigation (`Discover`, `Explore`, `Vault`, `Oracle`) + mobile bottom bar (5 clean 1-word tabs: `Discover`, `Explore`, `Vault`, `Oracle`, `Search`).
  - Clickable Genres & `#Cinematic Motifs` chips on `MovieDetails.jsx`.
  - Quick CTA button on `DashboardPage` / `HeroBillboard` empty/hero controls.
- **`/ai?tab=chat&movie=<canonicalId>&tmdbId=<num>`** (`AIPage.jsx`): Syncs `aiSection` (`"recs" | "chat"`) and optional focused movie context from URL search params + `sessionStorage` cache so page reloads preserve active film discussion context.
- **`/compare?ids=<id1>,<id2>[,<id3>]`** (`ComparePage.jsx`): Standalone deep-link route sharing `<CompareWorkbench>` with `CompareModal` overlay (so comparing works inline anywhere via `CompareDock` OR as a shareable research URL).
- **`/vault?tab=watched|watchlist|lists|checklists`** (`VaultPage.jsx` + `VaultBanner.jsx`): Adds **Lists** and **Checklists** sub-views (plus `listId` param) cleanly integrated with Vault search/stats header.

---

## 4. TMDB API Proxy Security Boundary (`api/tmdb.js`)

Before client services call any new TMDB routes, `ALLOWED_TMDB_PATH_RE` in `api/tmdb.js` must be updated in lockstep to allow strictly:
- `/3/discover/movie` (already allowed)
- `/3/search/(?:movie|person|keyword)` (adds `keyword` autocomplete)
- `/3/collection/\d+` (adds Franchise / Trilogy Timeline)
- `/3/movie/\d+(?:\/(?:keywords|credits|watch\/providers|videos|release_dates|external_ids|recommendations|similar))?` (adds `recommendations` and `similar`)
- Existing `/3/trending/movie/(?:day|week)`, `/3/person/\d+(?:\/movie_credits)?`, `/3/find/[a-zA-Z0-9_-]+` preserved verbatim.

Non-matching paths, path traversal (`..`), and query overrides of `api_key` continue returning `400` with secret scrubbing.

---

## 5. Portability & Cloud Persistence Strategy

- **JSON Backup (`vaultPortability.js`):** Exports bump to `schemaVersion: 3` including `customLists` alongside `watched`, `watchlist`, and `preferences`. `parseJsonBackupContent()` remains backward-compatible with bare arrays, v1, and v2 payloads. `summarizeImportDiff()` accepts `existingLists` + `incomingLists` and merges deterministically (`merge_update`, `add_new`, `replace`).
- **Supabase Cloud Sync (`supabase/migrations/20261115000000_add_user_lists.sql` + `vaultSyncService.js`):**
  - Creates `public.user_lists` (`user_id uuid`, `list_id text`, `name text`, `description text`, `source_checklist_id text`, `items jsonb`, `created_at timestamptz`, `updated_at timestamptz`, `deleted_at timestamptz`, `primary key (user_id, list_id)`) with strict authenticated-only RLS (`(select auth.uid()) = user_id`), reusing `public.touch_updated_at()`.
  - Client `pullAndSyncUserLists()` merges active + soft-deleted (`deleted_at`) lists deterministically by timestamp and gracefully handles unmigrated backends (`42P01` / Postgres missing table error) without blocking core `user_vault_items` sync.

---

## 6. Modular Implementation Plan Sequence

Because all 6 capabilities span distinct layers cleanly separated by pure ESM services and focused components, implementation is decomposed into **4 sequential, independently testable plans**:

1. **Phase 1 — Studio Rating UI & Movie-Aware AI Chat:** `docs/superpowers/plans/2026-11-15-phase1-rating-studio-and-film-chat.md`
2. **Phase 2 — Explore Deep Filter & Movie Page Rabbit Hole:** `docs/superpowers/plans/2026-11-15-phase2-explore-filter-and-rabbit-hole.md`
3. **Phase 3 — Side-by-Side Decision & Research Matrix:** `docs/superpowers/plans/2026-11-15-phase3-side-by-side-compare.md`
4. **Phase 4 — Custom Lists, Canon Checklists, v3 Backup & Cloud Sync:** `docs/superpowers/plans/2026-11-15-phase4-custom-lists-checklists-and-sync.md`

Every plan follows strict Node ESM unit testing (`npm test`), zero JSX test imports, and final production bundle verification (`npm run build`).
