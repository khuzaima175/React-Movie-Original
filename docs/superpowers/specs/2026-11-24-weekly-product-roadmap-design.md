# CinemaVault Weekly Product Roadmap — Master Design Spec

**Date:** 2026-11-24  
**Status:** Proposed for Approval  
**Order:** Approach A — Foundation → Quick Couch & Discovery Wins → Social & Retention (`Track 1 → Track 6`)

---

## 1. Intent & Why

CinemaVault already has a verified recommendation engine (`v6.1`: sparse full-rank `EASE^R 14k×64` + `SVD-64` hybrid + `128-D` neural semantic cold-start embeddings), guest-first local persistence, optional Supabase cloud sync, and opt-in public profiles with Taste Twin compatibility.

What keeps CinemaVault feeling like an impressive solo engineering demo rather than a weekly consumer product are **six concrete product and architecture gaps**:
1. Primary `watchedMovies` and `watchlist` arrays still sit in synchronous 5 MB `localStorage` with lossy compaction.
2. Streaming badges on film pages are non-clickable static pills, and the PWA lacks a Service Worker and proper maskable app icons.
3. Users can pick discrete mood presets or type prompts, but cannot smoothly steer recommendations in `< 1 ms` or explicitly break out of their dominant genre bubble.
4. Movie night is frequently a two-person negotiation, yet ranking is strictly single-player.
5. Discovery lacks human-curated, shareable themed lists with personality.
6. The app is 100% reactive—nothing notifies users when a watchlisted film lands on one of their streaming services or a high-match release drops.

This roadmap closes all six gaps across **six independently shippable, independently testable tracks** without breaking guest mode, offline accuracy benchmarks (`NDCG@10/20`), or existing user vaults.

---

## 2. Reconciled Scope (Building on What Exists)

| Critique Area | Already in Codebase | Remaining Gap Solved by This Roadmap |
| :--- | :--- | :--- |
| **#7 Storage** | IndexedDB for TMDB details (`apiTransport.js`) & Explore pools (`exploreForYouCache.js`); Supabase `user_vault_items` | **Track 1:** Migrate primary `watchedMovies` & `watchlist` from `localStorage` into `cinemavault_vault_v1` IDB store with lossless migration. |
| **#3 Couch & PWA** | `public/manifest.json` (`standalone`), `<link rel="manifest">` in `index.html`, TMDB `watch/providers` badges | **Track 2:** Capture TMDB regional JustWatch `link` + smart provider launch URLs; add maskable `192/512` icons + Service Worker caching app shell & `/models/*`. |
| **#5 Tuner & #6 Anti-Bubble** | Discrete mood pills (`moodPolicy.js`), `tasteRules`, Explore acclaim slider, passive 14% outlier slice in `buildDiversifiedGeminiShortlist` | **Track 3:** Real-time `< 1 ms` 4-dial Taste Tuner (**Era**, **Familiarity**, **Pacing**, **Tone**) + explicit **Break My Bubble** switch on Explore (For You) and Oracle. |
| **#1 Two-Player** | Opt-in `@username` public profiles with 64-D `taste_vector` & `computeTasteTwinCompatibility` (`communityService.js`) | **Track 4:** Watch Together Nash-welfare 2-player merger (`/together`, `/together/:code`), supporting both `@username` friends and guest 1-click partner rooms + mutual swipe deck. |
| **#2 User Lists** | Drafted Phase 4 plan (`2026-11-15-phase4-custom-lists-checklists-and-sync.md`) for private custom lists & Canon Checklists | **Track 5:** Execute & extend Phase 4 with `is_public`, `slug`, shareable `/list/:slug` pages, list bookmarking/cloning, and live viewer Taste Match % badges. |
| **#4 Alerts** | In-tab `backgroundJobs` & on-demand "Best From Your Watchlist Tonight" | **Track 6:** Daily backend provider-availability diffing (`pg_cron` + Edge Function / Vercel Cron), `user_notifications` in-app bell, and Weekly Email Digest (Resend). |

---

## 3. Goals, Non-Goals & Anti-Goals

### Goals
- **Guest-First Continuity:** Tracks 1, 2, 3, and Track 4 (guest room mode) work 100% without sign-in. Signed-in users get multi-device sync, public lists, and alerts.
- **Zero-Dependency Client Discipline:** Keep using native IndexedDB (matching `exploreForYouCache.js` & `apiTransport.js`), native Web APIs, and existing React 18 / Tailwind / Lucide / Framer Motion / Supabase stack—do not add heavy runtime libraries (no Dexie, no Redux).
- **Zero Model Binary Bloat:** Track 3's Pacing and Tone axes run on zero-shot semantic projection over the already-shipped `content_embeddings_f16.bin` (or lightweight JSON anchor vectors `< 5 KB`) plus genre/keyword heuristics.
- **Postgres & RLS Rigor:** Every new Supabase table uses `bigint generated always as identity` or time-ordered keys, explicit foreign-key indexes, `revoke all ... from public`, RLS enabled, and `(select auth.uid())` caching in every policy.

### Non-Goals
- **Native Apple TV / Android TV / iOS / Android apps** — separate native platforms out of scope for this web roadmap.
- **Brittle undocumented deep-link scraping (`netflix://title/<id>`)** — TMDB does not expose proprietary Netflix/Prime internal title IDs; we use TMDB's official regional JustWatch `link` (which deep-links natively on iOS/Android via OS Universal Links) plus safe provider web-search fallbacks.
- **Changing default offline accuracy weights (`DEFAULT_RANKER_WEIGHTS`)** — Track 3's Tuner and Anti-Bubble adjustments are strictly opt-in runtime modifiers; default `tunerConfig` (`neutral`) must produce bit-identical ranking to `v6.1`.

### Anti-Goals (Failure Modes Even If Features Work)
- Losing or duplicating a single movie during the `localStorage → IndexedDB` vault migration.
- Breaking offline/guest cold start by blocking initial render on network or failing in Safari private browsing (where IDB can throw).
- Exposing private vaults, `isSample` demo items, or private lists through unauthenticated queries or leaked RLS policies.
- Spamming users with duplicate availability alerts for the same `(movie, provider)` pair.

---

## 4. Approaches Considered

### Approach A (Chosen): Staged Foundation → Quick Wins → Social & Retention
Ship 6 independent tracks in order: `Track 1 (IDB) → Track 2 (Streaming Links + PWA) → Track 3 (Live Tuner + Anti-Bubble) → Track 4 (Watch Together) → Track 5 (Public Lists) → Track 6 (Alerts + Digest)`.
- **Trade-offs:** Delays headline social features until Tracks 1–3 are rock-solid, but prevents rewriting storage/PWA/ranker layers twice and ships measurable user value at the end of every single track.

### Approach B (Rejected): Product-First Order (`Track 4 → Track 3 → Track 5 → Track 1`)
- **Why rejected:** Building Watch Together and Custom Lists on top of the 5 MB `localStorage` compaction hack increases quota-overflow risk right as payload size grows (`lists` + `watched` + `watchlist`).

### Approach C (Rejected): Single Monolithic Release
- **Why rejected:** Couples client storage migrations, SW caching, math ranking, and Supabase cron/email infrastructure into one high-risk branch with delayed verification.

---

## 5. Cross-Track Architecture & Shared Contracts

### 5.1 IndexedDB Vault Store (`src/services/vaultStorageService.js` — Track 1)
- Database: `cinemavault_vault_v1`, version `1`, object store `kv` (keys: `"watchedMovies"`, `"watchlist"`, `"customLists"`, `"migrationMeta"`).
- **Boot & Hydration:** On mount, `AppContext` synchronously initializes from a tiny pointer/legacy `localStorage` read if unmigrated, then asynchronously hydrates from `vaultStorageService.loadVaultState()`. Once migrated (`localStorage.getItem("cinemavault_vault_idb_migrated_v1") === "1"`), `localStorage` no longer stores full movie arrays (keeping only a compact `< 4 KB` summary snapshot for instant first-paint badge counts if desired, or empty-safe skeleton while IDB resolves in `< 15 ms`).
- **Private-Browsing Fallback:** If `indexedDB` is unavailable or throws (`SecurityError` / `InvalidStateError`), transparently falls back to existing `safeSetStorageItem` + in-memory store so guest mode never breaks.

### 5.2 Streaming Launch Contract (`src/services/watchLinkService.js` — Track 2)
- `tmdbService.js` preserves `watchProviderLink: providerRegion?.link || null` (TMDB's JustWatch regional page with official universal links).
- `resolveProviderLaunchUrl({ providerId, providerName, title, year, watchProviderLink })` returns:
  1. `watchProviderLink` as primary verified deep-link landing page when present (with explicit provider badge + `"Open on JustWatch / <Provider>"` or direct web search fallback URL for Netflix, Prime Video, Disney+, Max, Apple TV+, Hulu, Peacock, Paramount+, MUBI, Criterion Channel).
  2. Always opens safely with `target="_blank" rel="noopener noreferrer"`.
- Service Worker (`public/sw.js`, registered in `src/index.jsx` in production builds only):
  - **Cache-First + Stale-While-Revalidate** for `/models/*.bin`, `/models/*.cvea`, `/models/*.json`, and `/assets/*` (versioned cache name `cinemavault-static-v1`).
  - **Network-First** for HTML navigation requests and `/api/*` (never caches stale API mutations or auth tokens).

### 5.3 Live Taste Tuner & Anti-Bubble Contract (`src/services/tunerService.js` — Track 3)
- State shape:
  ```js
  export const DEFAULT_TUNER_STATE = Object.freeze({
    era: 0,          // -1 (Classic / Pre-1985) .. 0 (Neutral) .. +1 (Modern / 2015+)
    familiarity: 0,  // -1 (Comfort / Crowd-Pleaser) .. 0 (Neutral) .. +1 (Hidden Gem / Obscure)
    pacing: 0,       // -1 (Slow Burn / Meditative) .. 0 (Neutral) .. +1 (Adrenaline / Propulsive)
    tone: 0,         // -1 (Bleak & Cynical) .. 0 (Neutral) .. +1 (Warm & Uplifting)
    antiBubble: false
  });
  ```
- **Pure Client Scoring (`applyTunerToPool(items, tunerState, context)`):**
  - Runs in `< 1 ms` over 250 Explore For You items or 100 Oracle candidates without calling Gemini or TMDB.
  - `era`: smooth sigmoid/linear delta based on candidate release year relative to 2000.
  - `familiarity`: smooth delta on `log10(vote_count)` (high `familiarity > 0` boosts low-vote acclaimed films; `< 0` boosts iconic high-vote crowd-pleasers).
  - `pacing` & `tone`: hybrid of deterministic genre/keyword anchor scores + optional cosine projection onto two precomputed 128-D axis direction vectors (`public/models/tuner_axes.json`, ~2 KB, distilled from `content_embeddings_f16.bin` anchor centroids).
  - `antiBubble`: extracts user's top 1–2 dominant genres (`dominantGenreIds` from `watched` >= 7/10); penalizes candidates whose primary genre is in `dominantGenreIds` (`-1.4` logit) while adding a bonus (`+0.8`) for high latent `collabSim`/`contentSim` films *outside* those genres, surfacing cross-genre thematic twins.
- **Invariant:** When `isTunerNeutral(tunerState)` is `true`, `applyTunerToPool` returns the input list in exact original order.

### 5.4 Watch Together Contract (`src/services/watchTogetherService.js` — Track 4)
- **Joint Scoring Math (`scoreJointCandidate(scoreA, scoreB, mode = "harmony")`):**
  - Default `"harmony"` uses damped harmonic mean (Nash-like welfare): $\frac{2 \cdot s_A \cdot s_B}{s_A + s_B + \epsilon}$ with a hard floor penalty if $\min(s_A, s_B) < 0.35$ (prevents one partner hating the pick).
  - Hard-drops any film in `watchedA ∪ watchedB` and any film matching `avoidRulesA ∪ avoidRulesB`.
- **Two Entry Paths on `/together`:**
  1. **Registered Pair:** Pick any public `@username` (or followed friend) → blends your full local EASE^R+SVD scores with their public `taste_vector` cosine score + excludes their public `community_ratings` watched set.
  2. **1-Click Shareable Room (`/together/:code`):** Supabase table `public.watch_sessions` (short 8-char code, 48-hour expiry, host 64-D vector + watched TMDB IDs + avoid rules, guest 64-D vector + watched IDs + swipe votes). Partner without an account opens `/together/:code`, taps 5–10 quick films (or imports/connects vault), and both swipe `Yes / Pass` on the merged Top 15 until a mutual match pops!

### 5.5 Curated Public Lists Contract (`src/services/listsService.js` — Track 5)
- Builds directly on [2026-11-15-phase4-custom-lists-checklists-and-sync.md](../plans/2026-11-15-phase4-custom-lists-checklists-and-sync.md) (`user_lists`, Canon Checklists, Schema v3 backups, `AddToListPopover`), extending:
  - `user_lists` adds `is_public boolean not null default false`, `slug text unique`, `bookmark_count integer not null default 0`.
  - New `public.user_list_bookmarks` table (`user_id`, `list_id`, RLS own-row write, public count trigger).
  - New route `/list/:slug` (`PublicListPage.jsx`): renders any public list (even for guests!), shows curator `@handle`, and overlays live **personal Taste Match %** on every film using the viewer's local vault (`tasteMatchService.js`), plus 1-click **"Bookmark List"** or **"Clone to My Vault"**.

### 5.6 Watchlist Availability & High-Match Alerts Contract (Track 6)
- **Database Schema (`supabase/migrations/`):**
  - `profiles` adds `alert_email_enabled boolean not null default false`, `alert_frequency text not null default 'weekly' check (alert_frequency in ('weekly', 'off'))`, `last_digest_sent_at timestamptz`.
  - `public.watchlist_provider_snapshots` (`user_id`, `tmdb_id`, `region`, `provider_ids integer[]`, `checked_at`) — stores last known streaming providers per watchlisted film so we only alert on **new arrivals**.
  - `public.user_notifications` (`id bigint identity`, `user_id`, `type` in `('watchlist_available', 'high_match_release')`, `tmdb_id`, `title`, `poster`, `provider_id integer not null default 0`, `provider_name`, `match_pct`, `watch_link`, `read_at`, `emailed_at`, `created_at`, unique dedupe constraint `(user_id, type, tmdb_id, provider_id)` for clean Supabase `onConflict` upsert deduplication).
- **Backend Jobs:**
  - Vercel Cron (`vercel.json` `crons`) hitting `api/cron-watchlist-alerts.js` (daily at `06:00 UTC`, authenticated via `CRON_SECRET`) and `api/cron-weekly-digest.js` (Fridays `15:00 UTC`, sends clean HTML digest via Resend API when `RESEND_API_KEY` is configured, gracefully no-ops with clear log if unset).
  - *(Why Vercel Cron over `pg_cron` calling external HTTP: CinemaVault already hosts serverless TMDB/Gemini proxies in `api/` on Vercel with `TMDB_API_KEY` and env secrets already wired there, avoiding duplicate secrets in Postgres Vault.)*
- **Client UI:** `NotificationBell.jsx` in `NavBar.jsx` (unread dot badge, popover list with clickable deep-link & mark-read) + toggle controls in `AccountPage.jsx`.

---

## 6. Staged Implementation Plan Index

Each track has its own standalone, TDD-structured implementation plan in `docs/superpowers/plans/`:

1. [Track 1 — IndexedDB Vault Migration](../plans/2026-11-24-track1-indexeddb-vault-migration.md)
2. [Track 2 — Streaming Launch Links & Real PWA](../plans/2026-11-24-track2-streaming-links-and-pwa.md)
3. [Track 3 — Live Taste Tuner & Break My Bubble Mode](../plans/2026-11-24-track3-live-tuner-and-anti-bubble.md)
4. [Track 4 — Watch Together (Two-Player Taste Merge & Swipe Room)](../plans/2026-11-24-track4-watch-together-social-merge.md)
5. [Track 5 — Curated Public Lists, Bookmarks & Social Sharing](../plans/2026-11-24-track5-public-curated-lists-and-sharing.md)
6. [Track 6 — Watchlist Availability Alerts & Weekly Email Digest](../plans/2026-11-24-track6-watchlist-alerts-and-digest.md)
