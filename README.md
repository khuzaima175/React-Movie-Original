# CinemaVault

<div align="center">

![CinemaVault Preview](assets/screenshots/discover.png)

A local-first film tracker and recommender. It combines an on-device taste model, multi-bucket TMDB retrieval, and Gemini-based curation, with optional Supabase sync.

[![React 18](https://img.shields.io/badge/React-18.3-61dafb?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Vite 5](https://img.shields.io/badge/Vite-5.4-646cff?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Local ML CVEM v1](https://img.shields.io/badge/Local_ML-CVEM_v1_25k_f16-e2b13c?style=for-the-badge)](./LOCAL_MODEL_GUIDE.md)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-Resilient_Cascade-8e75ff?style=for-the-badge&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.0-38bdf8?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Framer Motion](https://img.shields.io/badge/Framer_Motion-12-ff0055?style=for-the-badge&logo=framer&logoColor=white)](https://www.framer.com/motion/)
[![Supabase Sync](https://img.shields.io/badge/Cloud_Sync-Optional_Supabase_RLS-3ecf8e?style=for-the-badge&logo=supabase&logoColor=white)](./ARCHITECTURE.md#20-opt-in-multi-user-supabase-cloud-sync-postgres-rls-schema--merge-engine)
[![Tests](https://img.shields.io/badge/Tests-node--test-46d369?style=for-the-badge)](#contributing-and-tests)

[Features](#features) · [Screenshots](#screenshots) · [Why CinemaVault](#why-cinemavault) · [How it works](#how-it-works) · [Quick start](#quick-start) · [Known limitations](#known-limitations)

</div>

---

## Why CinemaVault

Problems this project is built around:

- Browsing streaming services for a film to watch can take a long time.
- General AI chatbots often recommend the same mainstream titles, or invent films and release years.
- Math-based recommenders can struggle with old rating logs, bulk-imported Letterboxd backlogs that look like recent watches, and films released after the collaborative training data ends.
- Streaming availability depends on the viewer's country.
- Ratings are scattered across services, spreadsheets, and notes.

CinemaVault keeps your film log in your browser by default. It uses your ratings to build a local taste model, retrieves candidates from TMDB, ranks them with a deterministic model, and only then asks Gemini to choose and explain among already-verified titles.

---

## At a glance

| Area | What it does |
| :--- | :--- |
| Local taste model | 25,000-film collaborative embedding index (3,300,016 bytes, float16), per-user rating normalization, recency decay, persona mixtures, and a 64×64 ridge fold-in. Runs in the browser. |
| Recommendations | Five retrieval buckets, a calibrated logistic ranker, and 10 picks from a 39-candidate shortlist. Verified TMDB titles only. |
| Vibes | Six preset moods plus free-text "Match Vibe" queries such as "like Drive but quieter." |
| Gemini cascade & BYOK | Dual Flash-Lite cascade (`gemini-3.5-flash-lite` + `gemini-3.1-flash-lite`, up to 1,000 free requests/day) with error-specific cooldowns, optional browser-local personal Gemini key (`cv_user_gemini_key`), and deterministic on-device ranker fallback when shared quota is at capacity. |
| Editions (Public / Personal) | Clean Public Edition by default; toggle Personal/Debug UI with `?debug=1` (`?debug=0` to clear) or build with `VITE_APP_EDITION=personal`. |
| Streaming | 12 services, 13 provider alias families, 15 regions. |
| Rating studio | Ascending 10-bar cinema fader with editorial color grading, rolling score readout, live percentile calibration, same-tier pills, optional 4-aspect craft scores, and watch-session log. |
| Demo onboarding | One-click `"Try a sample vault"` loads 14 rated films + 6 watchlist films locally without touching cloud sync. |
| Import and export | Letterboxd and CinemaVault CSV import, Schema v2 JSON backup, and a diff preview before applying. |
| Discovery & Explore For You | Discover's **"Picked For Your Taste"** row mirrors your real `CVEM v1` **"Movies You'll Like"** pool with match badges + `"See all →"`; `/explore` hosts a filterable workbench and 3-wave progressive ~250-film personalized pool backed by Web Worker ML and non-blocking background curation. |
| Universal Match Predictor & Oracle Concierge | On-device `"For You"` Match `%` + calibrated `Est. X.X/10` prediction on Movie Detail pages and instant Match `%` pills in Search; Flagship **Film Oracle** Tonight's Concierge with 4 starter presets, instant `$0.00` Watchlist Tonight ranker, `#1 Top Pick Tonight` Spotlight hero, and centered Film Companion chat splitting watched references into inline chips. |
| Community & Public Profiles | Privacy-first opt-in Community Mode in `/account` (`is_public = false` by default) unlocking shareable `/u/:username` profiles (Top 4 Showcase, Watch Diary, Spoiler-Safe Reviews, Follows, **64-D Taste Twin %**, and *"Films They Loved You Haven't Seen"*) plus CinemaVault Community ratings & reviews on Movie Detail pages. |
| Compare | Two to three films side by side, with shared cast, genres, and taste similarity. |
| Sync & Accounts | Optional `/auth` (Email + Password, Magic Link, Password Reset) and `/account` dashboard backed by Supabase Auth + Postgres row-level security, syncing ratings, watchlist, streaming preferences, taste rules, and your 250-film Explore For You cache while keeping Guest Mode 100% unlocked. |
| Security | Serverless `/api/*` proxies keep API keys out of the browser bundle, bound prompt payloads, and support optional Upstash Redis daily caps. |

---

## Screenshots

| Discover & Spotlight | Explore Workbench |
| :---: | :---: |
| ![Discover Spotlight and Watchlist](assets/screenshots/discover.png) | ![Explore Catalog Filters](assets/screenshots/explore.png) |

| Film Oracle Picks | My Vault & Taste Insights |
| :---: | :---: |
| ![Film Oracle Recommendations](assets/screenshots/oracle.png) | ![My Vault and Insights](assets/screenshots/vault.png) |

| Ascending 10-Bar Rating Studio | Side-by-Side Comparison |
| :---: | :---: |
| ![Movie Detail Rating Studio](assets/screenshots/movie-rating-studio.png) | ![3-Film Comparison Matrix](assets/screenshots/compare.png) |

---

## Features

### 1. Recommendation engine

Recommendations come from local math first. Gemini does not generate titles.

1. **Taste model.** Ratings are z-scored against each user's own distribution and modulated by a rating-tiered recency decay (about an 11.5-month half-life with asymptotic floors — `0.45` for 10/10 masterpieces or rewatched favorites, `0.30` for 9/10, `0.20` for 8/10, `0.25` for `<= 4/10` dislikes, and `0.10` for mid-tier watches — so all-time favorites never vanish). Undated and bulk-imported entries get a 180-day prior. Positive taste is clustered into one to four personas, blended with a ridge fold-in vector, and disliked films push nearby candidates down.
2. **Candidate retrieval.** Five buckets run:
   - **Bucket B (keyword successors):** films sharing micro-keywords with your highest-rated anchor (rated 9 or higher).
   - **Bucket C (auteur network):** acclaimed films from your most-watched directors, cinematographers, composers, and writers.
   - **Bucket A (semantic discovery):** TMDB discover results filtered by loved genres, watchlist genres, mood, and regional streaming.
   - **Bucket D (recent releases):** films from the last 18 months with reasonable acclaim, capped at 12.
   - **Bucket E (embedding neighbors):** up to 30 unseen nearest neighbors from the local index, or 15 when an explicit mood is active.
3. **Ranking.** A 12-feature logistic ranker scores the pool. Under "Any Vibe," collaborative similarity is normalized against the whole catalog, and metadata is damped while collaborative signal is weak. Under an explicit mood, the ranker shifts weight toward genre fit and hard-gates candidates against the mood's rules. Display scores fall between 50 and 99 and preserve rank order.
4. **Curation.** The shortlist of 39 candidates (25 top-ranked, 8 releases from 2024–2026, 6 outliers) goes to Gemini with a prompt capped at 20,000 characters. Gemini picks 10 and may propose up to two extra titles. Each extra title must pass TMDB verification, the vault and watchlist exclusions, the streaming filter, and the mood gate before it appears.
5. **Fallback & Optional Personal Key.** If shared quota is at capacity or every model fails, the top 10 on-device ranker results appear with a calm notice and an optional **"Use your own Gemini key"** trigger. Keys saved there stay strictly in your browser's `localStorage` (`cv_user_gemini_key`) and call Google AI directly without touching CinemaVault servers or Supabase.

Each pick includes "Because you rated" links to films in your vault. The Refresh button rotates through unseen candidates without repeats.

### 2. Vibes and free-text matching

- **Mind-Bending:** plot-driven and cerebral.
- **Dark Thriller:** tense, gritty, often neo-noir.
- **Fun Popcorn:** high-energy crowd pleasers.
- **Comfort Watch:** warm and rewatchable.
- **Hidden Gem:** acclaimed films with fewer than 2,000 TMDB votes.
- **Any Vibe:** the default, using your full taste profile.

Free-text queries such as "pre-2000 cozy comedy, no horror" are parsed into genre, exclusion, and year constraints. The parser runs offline with keyword rules and uses Gemini's fast model when available.

### 3. AI chat and "Discuss This Film"

- The chat uses your films rated 8 or higher, your notes, and any active taste rules.
- **Discuss This Film** on a movie page opens `/ai?tab=chat` with a pinned film context bar.
- Spoiler-safe mode is on by default for films you haven't watched. You can allow spoilers from the context bar.
- Film titles in replies appear as cards with details, trailer, and watchlist actions.
- Chat is limited to cinema topics.

### 4. Streaming availability

- Services: Netflix, Amazon Prime Video, Disney+, Max, Apple TV+, Hulu, Paramount+, Peacock, Criterion Channel, Tubi, Pluto TV, and Freevee.
- Provider alias families group ad-supported tiers, kids tiers, and channel versions (for example, Netflix Standard with Ads).
- Regions: GLOBAL, US, GB, CA, AU, JP, KR, FR, DE, ES, IT, IN, BR, MX, and SE.
- Recommendations and cache keys are region-specific.

### 5. Cinema Roulette

Pick a random film from your Watchlist or your Watched list, with an animated reveal and quick links to the trailer and synopsis.

### 6. Taste analytics

- **Rating delta:** your rating minus the IMDb rating for each film, grouped into five bands from "critical contrarian" to "strong favorite."
- **Screen time:** total runtime of watched films, shown in days, hours, and minutes.
- **Distribution:** exact 1–10 counts, including low ratings.

### 7. Rating studio

- An ascending 10-bar cinema fader (`1` to `10`) with editorial color grading, rolling serif score readout, and a tier label for each score. Clicking a bar locks your score (`Save X/10 to Vault`), while hovering previews without saving accidentally.
- **Live calibration:** as you hover or lock a score, the stage shows your percentile in the vault and a compact two-column strip of up to two films rated the same or nearest.
- **Progressive review drawer:** toggle `+ Add tags, craft breakdown & note` when desired to attach Quick Review Tags, 4-aspect craft ratings, Watch Log metadata, or a short review note without cluttering the studio card.
- **Optional craft scores (1–5):** story, direction, performances, and visuals and sound.
- **Watch log:** format (streaming, theater, IMAX or Dolby, physical media), rewatch count, and watch date.
- **Notes and tags:** a short note and one-tap tags such as `#TightPacing` or `#WeakEnding`. Notes in Quick Rate are capped at 200 characters. Notes are passed to Gemini up to 180 characters.
- **Score effects:** a 10 sets an anchor for keyword matching. Scores of 4 and below feed negative keyword and embedding repulsion.

### 8. Filmography and person pages

Click any cast member or crew credit to open their filmography in an overlay, with department tabs, status filters, watchlist and rate actions, and your stats for their films. A full `/person/:id` page is also available.

### 9. CSV and data portability

- **Letterboxd import:** star glyphs (for example, ★★★★½) and 1–5 scales convert to the 10-point scale. Headers are matched by name.
- **Dates:** `Watched Date` takes priority over `Date`. Impossible dates such as 2026-02-30 are rejected. Timestamps more than 24 hours in the future are rejected.
- **Bulk-import guard:** if at least 10 logged dates cluster heavily (the top three days hold 30% or more of rows, or the span is under 14 days), they are treated as a bulk import and get the 180-day prior.
- **Rewatch handling:** duplicate diary rows collapse to the newest date. If the newest row has no rating, the most recent earlier rating is kept.
- **Backup:** Schema v2 JSON (includes region, providers, and taste rules), a CinemaVault CSV, and a Letterboxd-style CSV.
- **Import modes:** Merge and Update, Add New Only, or Replace Vault. A diff preview appears before anything changes.
- **Unrated rows** stay unrated. Missing ratings are never filled in.
- **Background backfill:** missing TMDB IDs, keywords, and cast are filled in gradually, skipping TV series.

### 10. Search and trailers

- `Cmd + K` (Mac) or `Ctrl + K` (Windows and Linux), or `/` outside text fields, opens search.
- Search queries OMDb and TMDB in parallel, merges results, shows instant `"For You"` Match `%` pills on unseen candidates, and lets you jump straight into Explore filtering via **"View all in Explore"** (`Shift + Enter`).
- Trailers prefer an official English trailer, then other trailers, then teasers. Playback opens on YouTube. Films with no trailer data link to a YouTube search.

### 11. Interface & Two Editions

- Dark, neutral palette with brass accents reserved strictly for ratings and focus rings, plus custom dark glass `<Select>` menus across every filter and sort control.
- Discover hero carousel with subtle ambient Ken Burns drift that pauses on hover and disables under `prefers-reduced-motion`.
- Decluttered 2-tier Film Oracle command bar (sliding Mood pill rail + unified Vibe bar) moving Streaming region/platforms, Taste Rules + Auto-Draft, and Personal AI Key into a unified **"Filters & Rules"** popover (bottom sheet on mobile).
- GPU-accelerated scroll reveals and spring sliding tabs that honor `prefers-reduced-motion`.
- Toast notifications with Undo for deletions.
- **Public Edition (default):** clean consumer labels (`"AI Curated"`, `"On-Device Engine"`), dual Flash-Lite prioritized curation (`gemini-3.5-flash-lite` + `gemini-3.1-flash-lite`), and one-click `"Try a sample vault"` onboarding.
- **Personal / Debug Edition (`?debug=1` or `VITE_APP_EDITION=personal`):** reveals the Gemini model cascade bar, per-message model chips, cascade cooldown tooltips, and primary Hydrogen curation (`npm run start:personal` / `npm run build:personal`).

### 12. First-visit taste deck & Sample Vault

On a first visit with fewer than three rated films, a 30-film deck opens. Visitors can rate films directly, import a CSV/JSON backup, or click **"Try a sample vault"** to populate a 14-film rated demo library (+6 watchlist films) with a one-click **"Clear sample data"** banner (sample rows never sync to Supabase).

### 13. Discover hub

- Rows of unwatched released films, with films already in your vault or watchlist excluded across all rows.
- **Opt-in smooth horizontal row scrolling:** plain vertical mouse wheel scrolling always scrolls the page cleanly; click **"Scroll row"** (or the row border) or hold `Shift + Wheel` to smoothly glide any horizontal row left/right (auto-releases on pointer leave, outside click, or `Esc`).
- A filterable "All Films" grid, 24 posters per page.
- Offline, the app shows built-in fallback rows.

### 14. Explore workbench (`/explore`) & "Movies You'll Like"

- **All Catalog mode:** direct title and franchise search (`?q=`) plus deep filters across genres (include and exclude), decades or custom years, runtime, minimum rating, minimum votes, language, country, keyword and person search, streaming services, and hide-watched.
- **"Movies You'll Like" mode (`?mode=for-you`):** combines your full on-device ML taste stack (25k CVEM v1 collaborative embeddings, content embeddings, cinematic DNA, negative repulsion, and personalized logistic ranker) with a single-shot Flash-Lite pass over the top flagship picks to build a **~250-film** personalized library of unseen TMDB-verified movies with match percentages and editorial vibe tags.
  - Cached locally in IndexedDB (7-day TTL) and optionally synced per user via the RLS-protected Supabase `public.user_explore_picks` table (sample vaults stay strictly local).
  - Supports instant client-side Deep Filtering across your personalized pool and quality-weighted **"Shuffle"** reordering with zero extra API calls.
- Every filter is stored in the URL, so searches can be shared and reloaded.
- Clicking a genre or keyword on a movie page opens `/explore` with that filter applied.

### 15. Compare (`/compare`)

- Add up to three films with the Compare button on any card or detail page. A dock at the bottom of the screen tracks them, and the tray is stored in `sessionStorage` under `cinemavault_compare_v1`.
- The comparison table highlights the best value in each row. It covers IMDb, Rotten Tomatoes, Metascore, TMDB score, runtime, budget, box office, return on budget, your rating, and taste similarity.
- Shared cast and crew link to filmographies. Shared genres and keywords link to `/explore`. Pairwise similarity bars come from the local embedding index.
- Comparison URLs can be copied and shared.

### 16. Cloud sync and secure API proxies

- **Local first:** the app works fully offline with no sign-in.
- **Optional sign-in:** if you configure Supabase, you can sign in by email and sync across devices. Rows are protected by row-level security. Merging gives watched entries priority over watchlist entries, prevents deleted items from coming back, and excludes sample demo entries.
- **Proxies:** `GEMINI_API_KEY`, `TMDB_API_KEY`, and `OMDB_API_KEY` stay on the server behind `/api/*` routes, with model and path allowlists, payload/output bounds, and rate limits (with optional Upstash Redis daily caps). Production browser bundles contain no API keys.

---

## How it works

```mermaid
flowchart LR
    A["Your vault\n(ratings, notes, CSV/JSON imports)"] --> B["On-device taste model\n• Relative weight cutoff\n• Persona mixture + ridge fold-in\n• Dislike repulsion"]
    B --> C["Candidate retrieval\n• B keyword successors\n• C auteur network\n• A discover + mood\n• D recent releases\n• E embedding neighbors"]
    C --> D["Logistic ranker\n• Catalog-normalized collaborative score\n• Mood gate\n• Verified streaming"]
    D --> E["Gemini cascade\n• 39-candidate shortlist → 10 picks\n• Verified wildcards\n• Ranker fallback"]
    E --> F["Cache (24h)\nRefresh rotation"]
```

**Taste model.** Ratings are normalized per user and modulated by a rating-tiered recency floor so recent obsessions surface first while 10/10 masterpieces and rewatched favorites stay strong anchors for years (and the embedding cutoff scales against the vault's strongest signal, so long-running vaults keep their taste profile). Liked films form up to four personas, and disliked films push nearby candidates down.

**Negative signals.** Keywords from films rated 4 or below become `without_keywords` filters (the top five, in pipe-OR form). These filters replace whole-genre bans. The ranker also applies a mild keyword penalty and embedding repulsion around disliked films.

**Mood policy.** When a mood or free-text vibe is active, the ranker shifts weight from collaborative to metadata features and applies hard gates. "Any Vibe" keeps the default pipeline.

**Recent-release reserve.** Under "Any Vibe," two shortlist slots are reserved for recent releases that pass a quality floor. Their score ignores the novelty bonus so popular acclaimed films can compete.

**Cache.** Results are cached for 24 hours under a key built from loved genres, watchlist genres, providers, region, mood, custom filters, and a hash of your vault ratings, notes, and taste rules. Logging or editing a rating invalidates the cache. A cached set is used only if it still has at least seven valid picks.

**Refresh.** Refresh cycles through TMDB pages 1–5 and excludes up to 120 recently shown IDs. If that leaves too few candidates, the list is filled from the rest of the ranked pool.

**Gemini cascade.** Models are tried in order (dual Flash-Lite `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` first in Public mode; full cascade in Personal mode). Errors are classified:

| Error class | Trigger | Cooldown |
| :--- | :--- | :--- |
| Quota | HTTP 429 or quota messages | Server retry time, or 2 or 10 minutes |
| Transient | 503, 504, timeouts, network errors | 30 seconds |
| Invalid config | HTTP 400 | 30 minutes |
| Auth | 401, 403, 404 | 30 minutes |
| Proxy rate limit | Proxy returned 429 | No model cooldown; the cascade stops |

Hydrogen uses a 35-second timeout; interactive Flash models use a 15-second timeout, and the Explore "Movies You'll Like" batch curation pass uses a 25-second timeout with minimal thinking. The whole cascade is capped at 45 seconds, and a working model is remembered for 30 minutes.

### When something fails

The app is designed to degrade rather than stop. Each missing dependency has a defined fallback:

| Missing piece | What happens |
| :--- | :--- |
| Gemini (no key, quota, or every model fails) | The top 10 on-device ranker results appear with a calm notice and optional BYOK prompt. |
| TMDB unavailable, or fewer than 6 candidates harvested | The app switches to the OMDb-based pipeline, which checks Gemini picks against OMDb. |
| Embedding file missing (`item_embeddings_f16.bin`) | Collaborative scoring is off. Ranking relies on the structured fallback (genres, keywords, cast, crew, and overview), and recent releases carry more weight through Bucket D. |
| Supabase not configured | Sync is disabled. The app runs fully as a guest. |
| Proxy rate limit hit | The cascade stops for that request and the proxy's `Retry-After` time is respected. |

Check the "About these picks" panel in Oracle to see which pipeline produced the current list.

---

## Storage, backups, and data loss

- **Guest vault:** stored in `localStorage` (about 5 MB per browser origin). This is comfortable for typical vaults of a few thousand films. Very large hydrated vaults can exceed the limit, and cloud sync is the intended path beyond that.
- **TMDB detail cache:** stored in IndexedDB for 30 days.
- **Explore "Movies You'll Like" cache:** stored locally in IndexedDB (`cinemavault_explore_for_you_v1`) for 7 days (up to 300 ranked picks per profile hash, LRU-capped at 5 snapshots, with instant stale-while-revalidate fallback + 3-wave progressive streaming) and optionally synced per signed-in user to Supabase `public.user_explore_picks` (up to 250 picks; sample vaults stay strictly local).
- **Recommendation cache:** capped at 500 KB. The oldest entries are evicted first.
- **Compare tray:** stored in `sessionStorage` (`cinemavault_compare_v1`).
- **Quota recovery:** if the browser reports a storage quota error, derivative caches (including prefixed `cinemavault_home_feeds_v2::*` discover caches) are purged first in a deterministic order (`storageEviction.js`). Vault data and Taste Rules are kept.
- **Clearing site data deletes the guest vault.** If you are not signed in to Supabase, the only recovery path is a Schema v2 JSON backup. Export one regularly from the Backup manager.

---

## Data flow and privacy

| Destination | What is sent | When |
| :--- | :--- | :--- |
| TMDB and OMDb | Title, ID, and search or discover parameters. No notes or ratings. | Search, discovery, detail pages, and candidate harvesting. |
| Gemini | A prompt containing your loved genres, anchor films, notes (up to 180 characters each), recent watches, dislikes, watchlist titles, and candidate films, bounded to 20,000 characters. Chat prompts include the films and notes you discuss. | Curation, chat, and vibe parsing. Only when AI features are used. |
| Supabase | Your vault rows (excluding `isSample` demo rows), ratings, notes, metadata, and optional Explore "Movies You'll Like" cache (`user_explore_picks`, excluding sample vaults). | Only after you sign in and enable sync. |
| Your browser only | The vault, caches, spend tracking, feedback log, taste rules, and optional personal Gemini key (`cv_user_gemini_key`). | Always. |

In production, Gemini, TMDB, and OMDb requests pass through your own `/api/*` routes (unless a visitor supplies their own Gemini key locally, which calls Google AI directly from the browser). Upstream providers still receive the request contents and see the caller's IP address. The project does not add third-party analytics, and spend tracking stays on your device.

If you do not want vault content sent to Gemini, do not use the AI features (Oracle curation, chat, and free-text vibes). Browsing, rating, search, and the local model still work without them.

---

## Known limitations

- **Training data cutoff.** The collaborative embeddings come from MovieLens 32M, which ends around late 2023. Films released after that have no collaborative signal. They can appear through Bucket D and the structured fallback, but their ranking is less reliable than older films.
- **Shared rate limits across serverless instances.** Without `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` configured, rate limits stay in-memory per serverless instance and reset on cold starts. Configuring Upstash enables durable daily per-IP (`GEMINI_DAILY_PER_IP`, default `30`) and global (`GEMINI_DAILY_GLOBAL`, default `450`) caps.
- **Gemini quota.** Heavy shared usage can exhaust free-tier quota. The app then serves on-device ranker output and lets users optionally attach their own AI Studio key.
- **Benchmarks are offline.** The metrics in [LOCAL_MODEL_GUIDE.md](./LOCAL_MODEL_GUIDE.md) measure the deterministic ranker on MovieLens-derived data and a small set of sample vaults. They are not measures of user satisfaction.
- **Gemini curation is not benchmarked offline.** Its quality is tracked only through in-app `recSource` telemetry.
- **Metadata depends on TMDB and OMDb.** Missing or outdated provider data (for example, streaming availability) shows up as missing or stale in the app.
- **Streaming data is region-specific.** A title can be listed in one region and not another, and availability changes often.
- **Trailers depend on TMDB video records.** Some films have no record, and the app falls back to a YouTube search.

---

## Technology stack

| Layer | Technology | Notes |
| :--- | :--- | :--- |
| Framework | React 18.3 | Context for app state + lazy-loaded route bundles. |
| Build | Vite 5.4 | Dev server and production bundle (`build` & `build:personal`). |
| Local model | CVEM v1 float16 index, ridge fold-in, logistic ranker | Runs in the browser. |
| AI | Gemini cascade + optional browser-local BYOK | Curation, chat, and mood parsing. |
| Serverless | Vercel Functions (`api/*.js`) | Keeps server keys off the client; bounded payloads; optional Upstash Redis daily caps. |
| Cloud sync (optional) | Supabase Auth and Postgres 15+ with row-level security | Email sign-in. |
| Styling | Tailwind CSS v4 + editorial CSS variables | Minimal dark theme. |
| Motion | Framer Motion 12 | Respects reduced-motion settings. |
| Movie data | TMDB API v3, OMDb API | |
| Storage | `localStorage`, `sessionStorage` (compare tray), IndexedDB (TMDB detail cache & Explore For You pool) | Guest vault stays in the browser. |
| Tests | `node --test`, `scripts/run_eval.mjs` | Offline suites and a rolling evaluation harness. |

---

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/khuzaima175/React-Movie-Original.git
cd React-Movie-Original
npm install
```

### 2. Configure keys

Create `.env.local` in the project root (see [.env.example](./.env.example)):

```env
# Server-side secrets for the /api/* proxies (vercel dev or production)
GEMINI_API_KEY=your_gemini_api_key_here
TMDB_API_KEY=your_tmdb_api_key_here
OMDB_API_KEY=your_omdb_api_key_here

# Optional shared Upstash Redis daily caps for /api/gemini
# UPSTASH_REDIS_REST_URL=https://your-upstash-url.upstash.io
# UPSTASH_REDIS_REST_TOKEN=your_upstash_rest_token_here
# GEMINI_DAILY_PER_IP=30
# GEMINI_DAILY_GLOBAL=450

# Optional local-only fallback when running `npm start` without `vercel dev`
# VITE_GEMINI_KEY=your_local_dev_gemini_key_here
# VITE_TMDB_KEY=your_local_dev_tmdb_key_here
# VITE_OMDB_KEY=your_local_dev_omdb_key_here

# Optional Supabase sync (publishable key only; protected by row-level security)
# VITE_SUPABASE_URL=https://your-project-ref.supabase.co
# VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
```

Keys are available from:
- [Google AI Studio](https://aistudio.google.com/) (Gemini)
- [TMDB](https://www.themoviedb.org/documentation/api)
- [OMDb](http://www.omdbapi.com/apikey.aspx)
- [Supabase](https://supabase.com/) (optional)

### 3. Setup notes

These are the points most likely to cause problems on first run:

- **The `/api/*` proxies only run under `vercel dev` or on Vercel.** Plain `npm start` does not serve them. Without the `VITE_*` dev keys, AI and TMDB calls fail, and the app falls back as described under "When something fails." Use `vercel dev`, or set the `VITE_*` keys for local development.
- **Never put `VITE_*` keys in a deployed build.** Any `VITE_` variable is compiled into the browser bundle and is visible to anyone. They are for local development only.
- **Production rejects requests without a browser origin.** When deployed, requests with no `Origin` header and no `Sec-Fetch-Site: same-origin` (or `same-site`) get a 403. This means `curl` against a deployed copy will fail. Test with a browser, or call the proxies from the same site.
- **`ALLOWED_ORIGIN` is optional.** Set it to a comma-separated list if you serve the app from a domain other than the default Vercel host.
- **`gemini-4-argon` is blocked by default.** It returns 403 unless `ENABLE_ARGON` is set to `"true"` on the server.
- **Supabase sync needs two things before it works:** the migrations in `supabase/migrations/` (`20261114000000_init_cinemavault_schema.sql`, `20261120000000_explore_for_you_cache.sql`, and `20261120120000_profile_prefs_and_for_you_cap.sql`) applied to your project, and Email Auth / Redirect URLs configured in the Supabase Auth dashboard.

### 4. Run, test, and build

```bash
npm start                    # Public edition dev server
npm run start:personal       # Personal/Debug edition dev server (shows model telemetry)
npm test                     # Offline service and API tests
npm run check:secrets        # Verify .env keys are not present in git history
node scripts/run_eval.mjs    # Offline evaluation harness
npm run build                # Public production bundle in build/
npm run build:personal       # Personal edition bundle
npm run serve                # Preview the production build
```

---

## Contributing and tests

- Service, ranking, storage, sync, and API-proxy logic is tested with `node --test`. Test files live in `tests/` and run with `npm test`.
- UI components (`src/components/` and `src/pages/`) are checked with `npm run build` and browser verification.
- Changes to ranking, the cache hash, or the cascade should add or update a test in `tests/`, because these affect results silently.
- `scripts/run_eval.mjs` runs the offline ranker evaluation. If you change ranker weights, run it and report the change in the pull request.

---

## Typical session

1. **Start.** Use `"Try a sample vault"` for instant onboarding, rate 30 films in Taste Calibration, or import a Letterboxd CSV or Schema v2 JSON backup.
2. **Browse.** Use Discover for unwatched rows (with opt-in smooth row scrolling) and the "All Films" grid. Use `/explore` to filter the full catalog or switch to **"Movies You'll Like"** (`?mode=for-you`) to deep-filter and shuffle ~250 taste-matched films instantly. Use `Cmd + K` or `/` to search.
3. **Rate and discuss.** Open a film, set a rating with the live percentile readout, optionally add craft scores and a watch format, then click **Discuss This Film**. Sign in to sync if you use more than one device.
4. **Review stats.** Open the Vault page for screen time and the rating distribution.
5. **Pick a film.** Open Oracle, choose a vibe or type one, filter by your streaming services, and browse the 10 picks. Refresh for new candidates.
6. **Compare or roll.** Add up to three films to `/compare` to see the differences, or open Cinema Roulette to choose one at random.

---

## Documentation, history, and license

- **[LOCAL_MODEL_GUIDE.md](./LOCAL_MODEL_GUIDE.md):** plain-English guide to the local model, its provenance, the evaluation runs, the errors found and fixed along the way, and verification commands.
- **[ARCHITECTURE.md](./ARCHITECTURE.md):** full technical and mathematical specification.
- **[SPEC.md](./SPEC.md):** UI design tokens and component specification.
- **[docs/superpowers/](./docs/superpowers):** historical design specs and implementation plans.

**License.** Application source code is [MIT licensed](./LICENSE).

**Data and third-party notices:**
- This product uses the TMDB API but is not endorsed or certified by TMDB.
- Movie metadata from [OMDb](http://www.omdbapi.com/).
- AI features use [Google Gemini](https://ai.google.dev/).
- The bundled embedding file is derived from the MovieLens 32M dataset by [GroupLens Research](https://grouplens.org/datasets/movielens/32m/). It is distributed for non-commercial research and educational use under the MovieLens terms. If you deploy this app commercially, check those terms or replace the file.
