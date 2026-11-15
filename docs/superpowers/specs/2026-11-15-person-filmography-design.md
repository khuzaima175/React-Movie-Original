# Interactive Actor, Director & Crew Filmography Design

**Date:** November 15, 2026  
**Target:** CinemaVault (`main`)  
**Status:** Approved interactively via preview comparison ([person-filmography-designs.html](file:///C:/Users/Khzuaima/.gemini/antigravity/brain/fc5786da-b007-4721-83ba-56d09d5aed1a/person-filmography-designs.html))

## Intent & Problem

On movie detail pages (`/movie/:id`), Starring Cast cards (`castDetails`) and Creative Credits (`Director`, `Screenplay & Writers`, `Cinematography`, `Original Score`) are static labels. Users want to click any actor, director, or key crew member directly from a movie page to explore that person's filmography, immediately see which of their movies are already rated in the Vault or Watchlist, and jump to those films or Quick Rate / Watchlist unseen ones without losing context.

## Chosen Approach (Hybrid Modal Overlay + Full Profile Route)

1. **Primary Click Behavior — Modal Overlay (`PersonFilmographyModal`):**
   - Clicking any cast card or credit name on [MovieDetails.jsx](../../../src/components/MovieDetails.jsx) opens a dark editorial modal overlay without unmounting or losing scroll position on the current movie page.
   - Header displays portrait, name, department, 1-line bio summary (when available), personal **Vault Affinity Stats** (`Watched`, `Avg Rating ★`, `Watchlist`), `"View Full Profile →"` action button, and Close (`X` / `ESC`).
2. **Escalation — Dedicated Full Profile Page (`/person/:id` via `PersonPage`):**
   - Clicking `"View Full Profile →"` (preserving the active department tab via `?dept=<tab>`) navigates to `/person/:id`, rendering full portrait, expandable biography, birth metadata, IMDb external link, Vault stats, department tabs, status/sort filters, filmography search, and interactive movie cards.
   - Reuses the warm session cache populated by the modal so opening the full profile after viewing the modal requires zero duplicate TMDB fetches.

**Rejected Alternatives:**
- *Modal-only without route:* No shareable URL, tight space for long biographies, no browser history entry when browsing deeper into full filmographies.
- *Full-route-only without modal:* Forces navigation away from the current movie on every casual click, losing context when comparing several cast/crew members on one film.

## Key Constraints & Edge Cases

- **Proxy & Secret Safety:** All person lookups route through `/api/tmdb` via `fetchTmdbJson` in production builds (`ALLOWED_TMDB_PATH_RE` permits `/3/search/person` and `/3/person/\d+(?:/movie_credits)?`, still blocking traversal, non-GET requests, and spoofed `api_key` parameters).
- **TMDB ID & OMDb Fallback Integrity:** `formatTmdbMovieDetails` preserves numeric TMDB person IDs for Director, Writers, Cinematographer, and Composer alongside `castDetails`. OMDb-only fallback cast entries must use `id: null` (fixing the existing array-index `id: i` bug where index `1` would resolve to George Lucas) and resolve cleanly by name via `/3/search/person`.
- **Noise Deduplication & Vault Overlay:** Multiple credits for the same film (e.g., actor + producer, director + writer) merge cleanly per `tmdbId`. `"Self"` / talk-show / archive credits are excluded from default feature-film listings unless the person's catalog consists exclusively of documentary credits. Vault matches use `findMatchingMovie` (`src/services/movieIdentity.js`) so `tt...`, `tmdb_...`, and title+year entries match accurately without homonym collisions.
- **Z-Index & Escape Stacking:** `PersonFilmographyModal` renders below `QuickRateModal` (`z-index: 8500` vs `<Modal>` `9999`), and pressing `Escape` inside `PersonFilmographyModal` or any open `[role="dialog"]` must NOT trigger `MovieDetails`'s `Escape` `navigate(-1)` close handler.
- **Editorial Design & Offline Tests:** Styling (`src/styles/person.css`) follows `tokens.css` (`--bg`, `--surface-1..3`, `--text-1..3`, gold `--accent` reserved strictly for ratings & focus rings). Pure business logic lives in `src/services/personService.js` so `node --test` exercises every rule deterministically without JSDOM.
