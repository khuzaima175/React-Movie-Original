# GameVault Phase 2 Design: Unified `Movies ⇄ Games` App

**Date:** 2026-11-27  
**Status:** Approved (Option 1 — Core GameVault + Supabase `user_games` Cloud Sync, reserving Vercel slot `12/12` for future `api/steam.js`)

## Goals & Constraints
- Add a first-class **GameVault** surface inside CinemaVault via a unified **`Movies ⇄ Games`** switcher sharing one account, one login, and one visual design language.
- Keep **CinemaVault** movie routes, tests, `DEFAULT_RANKER_WEIGHTS`, and initial JS bundle **100% untouched** (all `src/games/*` code and `public/models/games/*` binaries are strictly lazy-loaded on `/games*` and `/game/:id`).
- Stay within Vercel Hobby's **12 serverless function limit** (`10` existing + `1` unified `api/igdb.js` = **`11 / 12`**).
- Support zero-CORS local Vite development (`npm start`) via a lightweight Vite dev middleware mounting `api/igdb.js` at `/api/igdb` using `.env` server-side secrets (zero browser secret exposure).
- Zero new npm runtime dependencies in `package.json`.

## Architecture
1. **Backend Proxy (`api/igdb.js` + `vite.config.js` dev middleware):**
   - Protected by `api/_security.js` (`enforceApiSecurity`, bucket `"igdb"`).
   - Strict action allowlist (`search`, `details`, `batch`, `discover`) — never accepts raw client Apicalypse query strings.
   - Server-side Twitch OAuth `client_credentials` token caching with single-retry on `401` and upstream secret redaction.
2. **Local ML Engine (`src/games/services/`):**
   - `igdbService.js`: `/api/igdb` client + 30-day IndexedDB cache + canonical IGDB game normalizer.
   - `gameModelService.js`: Lazy session loaders for `game_ease_k80.cvea`, `game_embeddings_f16.bin`, `game_content_f16.bin`, `game_tuner_axes.json`, `game_ranker_weights.json`, and `game_steam_to_igdb.json`.
   - `gameRankerService.js`: Playtime- & status-weighted preference model, `EASE^R + Spectral-EASE` warm scoring, `bge-large` Tag-Dropout cold-start scoring (exclusives & 2024–2026 hits), calibrated `50–99%` match scores + badges, live popularity-decorrelated `Intensity` & `Tone` Taste Tuner, and hybrid Similar Games.
   - `gameOracleService.js`: Stratified ML candidate shortlist + Gemini editorial curation via existing `/api/gemini`, with deterministic math fallback and locked `matchScore`.
   - `gameVaultStorage.js` + `gameSyncService.js`: Isolated IndexedDB (`gamevault_vault_v1`), JSON/CSV/Steam-AppID import/export, and Supabase `public.user_games` cloud sync with strict RLS (`supabase/migrations/20261127000001_user_games_schema.sql`).
3. **UI (`NavBar.jsx`, `App.jsx`, `src/games/`):**
   - `Movies | Games` segmented toggle in `NavBar` + mobile bar + context-aware `Cmd+K` search.
   - 5 lazy-loaded pages: `/games` (Discover + Starter Calibration), `/games/explore` (For You + Catalog + Live Taste Tuner), `/games/vault` (Played/Backlog/Import/Export), `/games/oracle` (AI + Math Curation), `/game/:id` (Dossier + Rating Studio + Hybrid Similar Games).
