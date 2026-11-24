# Track 2: Streaming Launch Links & Real PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn static "Where to Stream" provider badges into 1-tap clickable streaming links (via TMDB's regional JustWatch universal link + provider fallbacks) and upgrade CinemaVault into a genuine offline-shell PWA with proper maskable icons and model-binary caching.

**Architecture:** Extract `watchProviderLink` (`providerRegion.link`) inside `src/services/tmdbService.js`, resolve safe clickable URLs in pure `src/services/watchLinkService.js`, and upgrade `MovieDetails.jsx` and `CompareWorkbench.jsx` provider badges to accessible `<a>` links with JustWatch attribution. Generate proper `192×192` and `512×512` maskable icons in `public/icons/`, update `public/manifest.json` + `vercel.json`, and register a lightweight production Service Worker (`public/sw.js`) that caches `/models/*` (`~9.8 MB`) and static build assets.

**Tech Stack:** React 18, Vite, Web App Manifest, Service Worker Cache API, Node native test runner (`node --test`).

**Spec:** [docs/superpowers/specs/2026-11-24-weekly-product-roadmap-design.md](../specs/2026-11-24-weekly-product-roadmap-design.md)

## Global Constraints
- Never fabricate proprietary `netflix://title/<id>` or `primevideo://` IDs that TMDB does not provide; always use official TMDB/JustWatch `watchProviderLink` or safe HTTPS provider web search URLs.
- Include TMDB-required `"Streaming data powered by JustWatch"` attribution beside clickable provider links.
- Service Worker must NEVER cache `/api/*` or Supabase auth/REST responses, and must only register in production (`import.meta.env.PROD`) so `vite dev` HMR is never disrupted.
- Update `vercel.json` SPA catch-all rewrite exclusion so `/sw.js` and `/icons/*` serve directly rather than returning `/index.html`.

## Review Focus
1. **Missing `watchProviderLink`:** Older cached TMDB records without `watchProviderLink` must still produce a valid HTTPS provider search URL (never `href=""` or `javascript:`).
2. **Special characters in titles:** Titles like `"Se7en"`, `"Spider-Man: Across the Spider-Verse"`, or `"Amélie"` must be safely URI-encoded in fallback search URLs.
3. **SW cache invalidation on deploy:** Bumping `CACHE_VERSION` in `public/sw.js` must purge old static caches on `activate` so users never stay stuck on stale JS chunks.
4. **SW bypass on `/api/` & Supabase:** Requests to `/api/*` or cross-origin `*.supabase.co` must always pass directly to network without touching Cache Storage.
5. **Safari/iOS PWA metadata:** `index.html` must include `apple-touch-icon` and `apple-mobile-web-app-capable` tags alongside `manifest.json`.

---

### Task 1: Pure `watchLinkService.js` & TMDB `watchProviderLink` Extraction

**Files:**
- Create: `src/services/watchLinkService.js`
- Modify: `src/services/tmdbService.js:1239-1315`
- Test: `tests/watchLinkService.test.js`

**Interfaces:**
- Consumes: `data["watch/providers"]?.results?.[region]` in `tmdbService.js`
- Produces:
  ```js
  export const PROVIDER_SEARCH_TEMPLATES = Object.freeze({
    8: (q) => `https://www.netflix.com/search?q=${q}`,         // Netflix
    9: (q) => `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${q}`, // Amazon Prime Video
    119: (q) => `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${q}`,
    337: (q) => `https://www.disneyplus.com/search?q=${q}`,    // Disney+
    1899: (q) => `https://play.max.com/search?q=${q}`,         // Max
    384: (q) => `https://play.max.com/search?q=${q}`,
    350: (q) => `https://tv.apple.com/search?term=${q}`,       // Apple TV+
    15: (q) => `https://www.hulu.com/search?q=${q}`,           // Hulu
    386: (q) => `https://www.peacocktv.com/watch/search?q=${q}`,
    531: (q) => `https://www.paramountplus.com/search/?q=${q}`,
    11: (q) => `https://mubi.com/en/search?query=${q}`,        // MUBI
    258: (q) => `https://www.criterionchannel.com/search?q=${q}`
  });

  export function resolveProviderLaunchUrl({ providerId, providerName, title, year, watchProviderLink })
  // returns { href: string, mode: "justwatch" | "provider-search" | "web-search", label: string }
  ```

- [ ] **Step 1: Write failing tests in `tests/watchLinkService.test.js`**

Test:
1. Returns `mode: "justwatch"` with verified `https://www.themoviedb.org/movie/.../watch` link when `watchProviderLink` is a valid `https://` URL.
2. Falls back to `PROVIDER_SEARCH_TEMPLATES[8]` (Netflix search) with properly encoded `"Amélie"` when `watchProviderLink` is absent.
3. Falls back to generic JustWatch search (`https://www.justwatch.com/us/search?q=...`) for unknown provider IDs without `watchProviderLink`.
4. Rejects non-HTTP(S) schemes (e.g., `javascript:alert(1)`) in `watchProviderLink`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/watchLinkService.test.js`  
Expected: FAIL.

- [ ] **Step 3: Implement `src/services/watchLinkService.js` and extract `watchProviderLink` in `src/services/tmdbService.js`**

In `tmdbService.js:1239-1315`, extract `watchProviderLink: typeof providerRegion?.link === "string" ? providerRegion.link : null` and include it on the returned movie details object.

- [ ] **Step 4: Run tests**

Run: `node --test tests/watchLinkService.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/watchLinkService.js src/services/tmdbService.js tests/watchLinkService.test.js
git commit -m "feat(streaming): extract TMDB watchProviderLink and resolve provider launch URLs"
```

---

### Task 2: Clickable Streaming Pills in `MovieDetails.jsx` & `CompareWorkbench.jsx`

**Files:**
- Modify: `src/components/MovieDetails.jsx:1384-1441`
- Modify: `src/components/CompareWorkbench.jsx:888-905`
- Modify: `src/index.css` (hover/focus styling for clickable `.stream-provider-pill`)

**Interfaces:**
- Consumes: `resolveProviderLaunchUrl` from `src/services/watchLinkService.js`
- Produces: Interactive `<a href={...} target="_blank" rel="noopener noreferrer">` provider pills with `ExternalLink` icon and JustWatch attribution footer.

- [ ] **Step 1: Update `MovieDetails.jsx` and `CompareWorkbench.jsx`**

Replace static `<div className="stream-provider-pill">` items in Subscription Stream, Free with Ads, and Buy/Rent with `<a href={launch.href} target="_blank" rel="noopener noreferrer" className="stream-provider-pill stream-provider-pill--interactive" aria-label={launch.label}>`. Add subtle `"Powered by JustWatch"` attribution line in `.stream-header-row`.

- [ ] **Step 2: Verify build and existing tests**

Run: `npm run build && npm test`  
Expected: Build succeeds cleanly; all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/MovieDetails.jsx src/components/CompareWorkbench.jsx src/index.css
git commit -m "feat(ui): make streaming provider badges 1-tap launchable"
```

---

### Task 3: Production PWA Icons, Manifest & Model-Caching Service Worker

**Files:**
- Create: `scripts/generate_pwa_icons.mjs` (or static SVG/PNG assets: `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`, `public/icons/apple-touch-icon.png`)
- Create: `public/sw.js`
- Create: `src/services/swRegistration.js`
- Modify: `public/manifest.json`
- Modify: `index.html:28-35`
- Modify: `src/index.jsx`
- Modify: `vercel.json:7-12`
- Test: `tests/swRouting.test.js`

**Interfaces:**
- Produces:
  ```js
  // src/services/swRegistration.js
  export function classifySwRequest(url, method = "GET")
  // returns "bypass" | "cache-first-model" | "cache-first-asset" | "network-first-nav"
  export function registerServiceWorker({ isProd, navigatorObj } = {})
  ```

- [ ] **Step 1: Write failing tests in `tests/swRouting.test.js`**

Test `classifySwRequest`:
- `/api/tmdb?path=movie/1` → `"bypass"`
- `https://xyz.supabase.co/rest/v1/user_vault_items` → `"bypass"`
- `POST /models/item_ease_k64.cvea` → `"bypass"`
- `GET /models/item_ease_k64.cvea` → `"cache-first-model"`
- `GET /assets/index-abc123.js` → `"cache-first-asset"`
- `GET /vault` → `"network-first-nav"`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/swRouting.test.js`  
Expected: FAIL.

- [ ] **Step 3: Implement `swRegistration.js`, `public/sw.js`, icons, `manifest.json`, `index.html`, and `vercel.json`**

- Update `vercel.json` rewrite negative lookahead to exclude `sw\\.js|icons/`:
  `"/((?!api/|assets/|models/|icons/|sw\\.js|manifest\\.json|og-image\\.png).*)"`
- Add `Cache-Control: no-cache` header for `/sw.js` in `vercel.json`.
- Update `public/manifest.json` with `192×192`, `512×512`, and `maskable` `512×512` icons + `shortcuts` (`/ai` Film Oracle, `/explore` Explore, `/vault?tab=watchlist` Watchlist).
- Wire `registerServiceWorker()` in `src/index.jsx` guarded by `import.meta.env.PROD`.

- [ ] **Step 4: Run tests and production build**

Run: `node --test tests/swRouting.test.js && npm run build`  
Expected: PASS and `build/sw.js`, `build/manifest.json`, `build/icons/` all present in output.

- [ ] **Step 5: Commit**

```bash
git add public/sw.js public/manifest.json public/icons/ index.html vercel.json src/index.jsx src/services/swRegistration.js tests/swRouting.test.js
git commit -m "feat(pwa): add maskable icons, manifest shortcuts, and model-caching service worker"
```
