# CinemaVault — "Streaming-Grade" Frontend Overhaul (v1.2 Deep-Dive Specification & Plan)

**Target Application:** CinemaVault (`khuzaima175/React-Movie-Original`)  
**Objective:** Replace the "AI-demo" aesthetic (cyan `#38bdf8` glows, gradient pills, orb background, emoji chips, badge clutter) with a restrained, content-first, streaming-platform-grade frontend. Retain 100% of existing features, data structures, and services with zero regressions, consolidating secondary controls into accessible menus and introducing portal-based hover-preview cards and synchronized motion.

> **Status Note (Updated Nov 15, 2026 — `main`):** The v1.2 frontend overhaul described in Sections 1–5 is **complete and live on `main`** (with v1.2 **§3.1** standalone `HoverPreviewCard`, **§3.2** `MovieCard` `"row"`/`"grid"`/`"list"` dwell-preview contract, and **Phase 3** initial `Home / My Vault / Recommendations` nav labels superseded by **Section 7** below — specifically `Discover / Vault / Oracle` three-route navigation, `HomePosterGrid` + `QuickRateModal`, and the centralized `App.jsx` modal hub), followed by the v4.0–v4.2 recommender upgrades in Section 6 and the **v4.3–v5.1 editorial polish, live discovery hub, rapid taste deck, shared praise/critique quick review tags (`quickReviewTags.js`), Schema v2 portability (with cross-ID duplicate collapse, `preferences.tasteRules`, `collectionId`/`collectionName` persistence & series-guarded lazy TMDB vault backfill), serverless `/api/*` proxy isolation (including `/api/tmdb-batch` and `/3/search/person` + `/3/person/:id` allowlists), opt-in Supabase cloud sync, canonical mood policy, 10-pick rotation, Sweet-Spot (`<= 20,000`-char unbiased 39-pick shortlist, top-25 favorites, all notes, `LOVED SERIES / ANIME`, & TMDB-verified `wildcardPicks`) Gemini curation upgrade, Step 2/3B `catalog-max` + persona mixture + Ridge fold-in upgrades, v5.1 Franchise Collection Guard (`selectWithSoftVarietyCaps` max-1-per-collection) + Steerable Taste Rules (`tasteRulesService.js` + Oracle `"Taste Rules"` drawer), and interactive Actor / Director / Crew click-through (`PersonFilmographyModal` + `PersonFilmographyExplorer` + `/person/:id` `PersonPage` + `personService.js` + `src/styles/person.css`)** documented in **Section 7** below as well as [ARCHITECTURE.md](./ARCHITECTURE.md), [LOCAL_MODEL_GUIDE.md](./LOCAL_MODEL_GUIDE.md), and [summary.md](./summary.md). All **274 / 274** Node unit tests across **31** suites and production Vite builds (`2309` modules) pass cleanly.

---

## 1. System Architecture & Context Wireframes

```mermaid
graph TD
  subgraph Global Shell [App.jsx & AppContext]
    AppProvider --> Shell[NavBar & App Shell]
    Shell --> Routes[Route View Container]
    AppProvider --> GlobalModals[SearchModal / BackupModal / RandomPickerModal]
    AppProvider --> ToastLayer[ToastNotification (Top-Center)]
  end

  subgraph Route Pages
    Routes --> Home[DashboardPage / Home]
    Routes --> Vault[VaultPage]
    Routes --> AI[AIPage]
    Routes --> Movie[MoviePage]
    Routes --> Person[PersonPage]
  end

  subgraph Shared UI Primitives
    Button --> Shell & Home & Vault & AI & Movie
    IconButton --> Shell & Home & Vault & AI & Movie
    Menu --> Shell & Vault & AI
    Tabs --> Shell & Vault & AI
    Modal --> GlobalModals
    StatCell --> Vault
    Accordion --> Vault & AI
  end

  subgraph Portal Layer
    Home --> HoverPreview[HoverPreviewCard (Portaled to document.body)]
  end
```

### Global Modals & Navigation Wiring
To ensure that all features from the consolidation map (Watchlist, Portability, Random Picker, Search, Manage Vault) are triggerable from anywhere (including the new NavBar Profile/Overflow Menu):
- `App.jsx` coordinates modal open/close states (`isSearchOpen`, `isBackupOpen`, `isRandomPickerOpen`).
- `NavBar` receives triggers: `onOpenSearch`, `onOpenBackup`, `onOpenRandomPicker`.
- `VaultPage` and `DashboardPage` seamlessly communicate with the same modals without prop duplication.

---

## 2. Token Layer & Tailwind v4 Theme Specification

### `:root` CSS Design Tokens (`src/index.css`)
```css
:root {
  /* Surfaces (Neutral Charcoal, NOT Blue-tinted) */
  --bg: #0b0b0c;
  --surface-1: #141416;
  --surface-2: #1c1d20;
  --surface-3: #242528;
  --hairline: rgba(255, 255, 255, 0.08);
  --hairline-strong: rgba(255, 255, 255, 0.16);

  /* Typography Colors */
  --text-1: #f4f4f2;
  --text-2: #b6b6b2;
  --text-3: #8a8a86;

  /* Brand Accent & Semantic */
  --accent: #e2b13c;                  /* "Vault Brass" logo, stars, active underline, focus ring ONLY */
  --accent-dim: rgba(226, 177, 60, 0.14);
  --match: #46d369;                   /* Match-score text only */
  --danger: #e5484d;

  /* Button Tokens */
  --btn-primary-bg: #f5f5f1;
  --btn-primary-fg: #0b0b0c;
  --btn-primary-hover: #ffffff;
  --btn-secondary-bg: rgba(255, 255, 255, 0.14);
  --btn-secondary-hover: rgba(255, 255, 255, 0.22);

  /* Radius (Pills Banned, except progress bars/typing dots) */
  --r-poster: 4px;
  --r-control: 6px;
  --r-card: 8px;
  --r-menu: 10px;
  --r-modal: 14px;

  /* Shadows (Black-only, no colored glows) */
  --sh-1: 0 1px 2px rgba(0, 0, 0, 0.4);
  --sh-2: 0 4px 12px rgba(0, 0, 0, 0.45);
  --sh-3: 0 12px 32px rgba(0, 0, 0, 0.55);
  --sh-hover: 0 14px 40px rgba(0, 0, 0, 0.65);

  /* Layout & Spacing */
  --nav-h: 64px;
  --container: 1440px;
  --gutter: 48px;
  --section-gap: 56px;
  --row-gap: 24px;

  /* Z-Index Hierarchy */
  --z-nav: 40;
  --z-hover: 50;
  --z-menu: 60;
  --z-bulk: 65;
  --z-modal: 80;
  --z-toast: 90;

  /* Motion & Timing */
  --hero-slide: 9s;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --dur-1: 0.12s;
  --dur-2: 0.2s;
  --dur-3: 0.32s;
  --dur-4: 0.56s;
}

/* Tailwind v4 @theme Binding */
@theme {
  --color-bg: var(--bg);
  --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-hairline: var(--hairline);
  --color-hairline-strong: var(--hairline-strong);
  --color-text-1: var(--text-1);
  --color-text-2: var(--text-2);
  --color-text-3: var(--text-3);
  --color-accent: var(--accent);
  --color-accent-dim: var(--accent-dim);
  --color-match: var(--match);
  --color-danger: var(--danger);
  --radius-poster: var(--r-poster);
  --radius-control: var(--r-control);
  --radius-card: var(--r-card);
  --radius-menu: var(--r-menu);
  --radius-modal: var(--r-modal);
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
```

### Whitelisted Gradients (Only 3 Allowed)
1. **Hero scrim:** `linear-gradient(90deg, rgba(11,11,12,.92), rgba(11,11,12,.55) 45%, transparent 75%)` + `linear-gradient(0deg, var(--bg), transparent 35%)`.
2. **Poster hover overlay:** `linear-gradient(0deg, rgba(0,0,0,.85), transparent 60%)`.
3. **Skeleton shimmer sweep.**

---

## 3. Detailed Component Contracts & Deep-Dive Specifications

### 3.1 `HoverPreviewCard.jsx` (Portal-Based Architecture)
- **Problem Solved:** Prevents carousel scroller (`overflow-x: auto`) and CSS edge fade mask from clipping the expanded preview card or fighting `scroll-snap`.
- **Portal Destination:** `createPortal(document.body)`.
- **Props & State Contract:**
  ```typescript
  interface HoverPreviewCardProps {
    movie: MovieObject;
    triggerRect: DOMRect | null;
    isOpen: boolean;
    onClose: () => void;
    onSelectMovie: (id: string) => void;
    onAddWatched: (movie: MovieObject) => void;
    isWatched: boolean;
  }
  ```
- **Lifecycle & Physics:**
  - On 250ms dwell, renders at `triggerRect` coordinates with `position: fixed`.
  - Spring-animates to width ≈320px with action panel using `springHover` (`{ type: "spring", stiffness: 320, damping: 28, mass: 0.8 }`).
  - Viewport boundary checking: clamps within 16px safe margins, flips vertically above trigger if bottom clearance is <300px.
  - 150ms pointer-leave grace timer, shared with any dropdown menus inside the preview.
  - Closes on scroll, wheel, resize, route change, or Escape.

### 3.2 `MovieCard.jsx` Variant API
- **Props:**
  ```typescript
  interface MovieCardProps {
    movie: MovieObject;
    variant?: "row" | "grid" | "list";
    onSelectMovie?: (id: string) => void;
    onAddWatched?: (movie: MovieObject) => void;
    onDeleteMovie?: (id: string) => void;
    isWatched?: boolean;
    isManageMode?: boolean;
    isSelected?: boolean;
    onToggleSelect?: (id: string) => void;
  }
  ```
- **Behaviors:**
  - `variant="row"`: In-row card **never scales**. Dispatches trigger rect on 250ms dwell to `HoverPreviewCard`. Rating corner chip (`rgba(0,0,0,0.7)`).
  - `variant="grid"`: Standard responsive grid card with hover overlay scrim and quick action buttons. Supports manage selection checkbox.
  - `variant="list"`: Clean tabular row (delegates to `WatchedMovieRow`).

### 3.3 `Menu.jsx` (Accessible Dropdown Primitive)
- **A11y Features:**
  - Trigger button with `aria-haspopup="menu"`, `aria-expanded={isOpen}`, `aria-controls`.
  - Panel with `role="menu"`.
  - Standard action items: `role="menuitem"`, `tabindex={0}`.
  - Multi-select checkbox items: `role="menuitemcheckbox"`, `aria-checked={checked}`.
  - Keyboard navigation: `ArrowDown` / `ArrowUp` (roving focus), `Home` / `End`, `Escape` to close and return focus to trigger button.
  - Animated with Framer Motion `scale: 0.98 -> 1` + fade (140ms), origin top-right.

### 3.4 `Tabs.jsx` (Underline Tabs Primitive)
- **Props:** `tabs: Array<{ id: string, label: string, count?: number, icon?: ReactNode }>`, `activeTab: string`, `onChange: (id: string) => void`, `layoutId: string`.
- **Indicator:** 2px brass underline (`--accent`) with smooth sliding transition using Framer Motion `layoutId`.

---

## 4. Phased Implementation Plan

### Phase 1: Tokens, Tailwind Mapping & Global Cleanup
*Commit: `chore(theme): replace design tokens with neutral streaming palette`*

- **[MODIFY] [index.html](./index.html)**:
  - Load Google Font **Inter** (400, 500, 600, 700, 800) with `display=swap`.
  - Set `<meta name="theme-color" content="#0b0b0c">`, preconnect to `fonts.gstatic.com`, add brass SVG favicon.
- **[MODIFY] [src/index.css](./src/index.css)**:
  - Complete rewrite of `:root` with neutral streaming tokens, z-scale, and font definitions.
  - Configure Tailwind v4 `@theme` block.
  - Global scrollbar: `scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent`.
  - Delete legacy cyan glows, gradient borders, orb styling, and pill radius overrides.
- **[MODIFY] [src/components/AnimatedBackground.jsx](./src/components/AnimatedBackground.jsx)**:
  - Delete gradient orbs and animated grid lines.
  - Render static subtle vignette (`radial-gradient(1200px 400px at 50% -10%, rgba(255,255,255,.03), transparent)`).
- **[NEW] [src/motion.js](./src/motion.js)**:
  - Export motion presets: `EASE`, `reveal`, `stagger`, `cardIn`, `springHover`.
- **[MODIFY] [src/services/geminiService.js](./src/services/geminiService.js)**:
  - Recolor `getFallbackPoster` SVG to tokens (charcoal `#141416`, brass stroke `#e2b13c`, text `--text-2`) while keeping logic and caching untouched.

---

### Phase 2: Core UI Primitives (`src/components/ui/*`)
*Commit: `feat(ui): add button/menu/tabs/modal primitives`*

- **[NEW] [src/components/ui/Button.jsx](./src/components/ui/Button.jsx)**:
  - Variants: `primary` (white), `secondary` (translucent gray), `ghost` (hairline border), `quiet` (borderless text-only).
  - Sizes: `sm`, `md`. Interactive `scale: 0.98` press feedback, 120ms background transitions.
- **[NEW] [src/components/ui/IconButton.jsx](./src/components/ui/IconButton.jsx)**:
  - Accessible square button for icon triggers with built-in `aria-label` and brass focus ring.
- **[NEW] [src/components/ui/Menu.jsx](./src/components/ui/Menu.jsx)**:
  - Accessible dropdown with `role="menu"`, Escape key, outside click handling, roving tabindex, and keyboard arrow navigation.
  - Supports standard actions (`role="menuitem"`) and multi-select items (`role="menuitemcheckbox"` with `aria-checked`).
- **[NEW] [src/components/ui/Tabs.jsx](./src/components/ui/Tabs.jsx)**:
  - Underline tabs with 2px brass active indicator sliding via Framer Motion `layoutId`.
- **[NEW] [src/components/ui/Modal.jsx](./src/components/ui/Modal.jsx)**:
  - Backdrop fade + panel entrance animation (`scale: 0.96 -> 1`, 200ms) with Esc handling, focus return, and `role="dialog"`.
- **[NEW] [src/components/ui/Skeleton.jsx](./src/components/ui/Skeleton.jsx)**:
  - Neutral `--surface-2` shimmer sweep for poster, text, and cell loading states.
- **[NEW] [src/components/ui/SectionHeader.jsx](./src/components/ui/SectionHeader.jsx)**:
  - Section header with H2 title on left and hover-revealed quiet link on right.
- **[NEW] [src/components/ui/StatCell.jsx](./src/components/ui/StatCell.jsx)**:
  - Clean hairline-bordered stat cell displaying micro-label, tabular H2 value, and muted delta text.
- **[NEW] [src/components/ui/Accordion.jsx](./src/components/ui/Accordion.jsx)**:
  - Collapsible container with smooth height animation for secondary metrics and taste explanations.

---

### Phase 3: Shell Architecture & Global Modals
*Commit: `feat(shell): text-link nav, overflow menus, page transitions`*

- **[MODIFY] `Logo.jsx` (consolidated into [src/components/NavBar.jsx](./src/components/NavBar.jsx))**:
  - Clean SVG vault-dial / film glyph in brass accent (`--accent`) + "CinemaVault" 700 / `-0.02em`.
- **[MODIFY] [src/components/NavBar.jsx](./src/components/NavBar.jsx)**:
  - 64px header: transparent over billboard, transitioning to `rgba(11,11,12,.92)` + `backdrop-filter: blur(10px)` + bottom hairline on scroll (>40px).
  - Navigation links: text links (`Home`, `My Vault`, `Recommendations`) with brass sliding underline tabs. Tabular counts (`My Vault 115`).
  - Right group: search `IconButton` (opens modal), profile/overflow `Menu` containing: *Watchlist (count)*, *Random Picker*, *Import/Export Portability*, *Manage Vault*, *GitHub Link*.
  - Mobile bottom navigation using unified token styling.
- **[MODIFY] `Main.jsx` (layout tokens integrated into [src/App.jsx](./src/App.jsx) & `src/pages/*`)**:
  - Standardize container, gutter, and section-gap tokens with `min-height: calc(100vh - var(--nav-h))`.
- **[MODIFY] [src/App.jsx](./src/App.jsx)**:
  - Wire global modals (`SearchModal`, `BackupManagerModal`, `RandomPickerModal`).
  - Route transitions via `<Routes location={location} key={location.pathname}>` wrapped in `AnimatePresence mode="wait"`.
  - Scroll-to-top on route change.
  - Slim editorial footer (hairline top, micro logo, OMDb/Gemini attribution, "Built by Khuzaima").
- **[MODIFY] [src/components/SearchModal.jsx](./src/components/SearchModal.jsx)**:
  - 640px modal at 15vh, borderless 1.25rem input over hairline, 40×60 poster thumbnail list, footer micro text (`↑↓ navigate · ↵ open · esc close`).
- **[MODIFY] [src/components/BackupManagerModal.jsx](./src/components/BackupManagerModal.jsx)**:
  - Restyle using `Modal.jsx`, `Tabs.jsx`, and `Button.jsx` primitives while keeping all CSV/Letterboxd/JSON import/export and merge logic intact.
- **[MODIFY] [src/components/ToastNotification.jsx](./src/components/ToastNotification.jsx)**:
  - Top-center placement under navbar (slide-down 8px) with hairline border, `--sh-2`, and `--z-toast: 90` to avoid bulk bar collision.
- **[MODIFY] [src/components/ErrorBoundary.jsx](./src/components/ErrorBoundary.jsx)**:
  - Restyle crash boundary with design tokens, neutral icon, and secondary retry button.

---

### Phase 4: Home, Billboard & Portal-Based Hover Preview
*Commit: `feat(home): billboard hero + hover-preview rows`*

- **[NEW] `HoverPreviewCard.jsx` (preview interaction integrated into [src/components/MovieCard.jsx](./src/components/MovieCard.jsx))**:
  - Portaled to `document.body`, `position: fixed`, `z-index: var(--z-hover)`.
  - Triggered on 250ms dwell; spring-expands smoothly from trigger rect to preview bounds (`scale: 1 -> 1.05`, width ≈320px).
  - Viewport clamping with 16px safe margins (vertical flip if clearance < 300px).
  - Closes on scroll, wheel, resize, route change, Escape, or pointer leave with 150ms grace timer.
  - Mobile touch support: 450ms long-press.
- **[MODIFY] [src/components/MovieCard.jsx](./src/components/MovieCard.jsx)**:
  - Variant API: `variant="row" | "grid" | "list"`.
  - `variant="row"`: card never scales, passes trigger rect on 250ms dwell to `HoverPreviewCard`. Rating corner chip (`rgba(0,0,0,.7)`).
  - `variant="grid"`: standard card with hover overlay actions.
- **[MODIFY] [src/components/HeroBillboard.jsx](./src/components/HeroBillboard.jsx)**:
  - Height: `clamp(520px, 78vh, 720px)` full-bleed backdrop.
  - Synchronized motion: `--hero-slide: 9s` driving auto-advance and Ken Burns zoom (`scale: 1 -> 1.06` over 9s) with 700ms crossfade.
  - Pauses on hover, `:focus-within`, and `document.hidden`.
  - Backdrop source fallback: blur-cover composition (poster `object-fit: cover` + `scale(1.25)` + `blur(48px) saturate(.9)` under scrims).
  - Container: micro-label "Featured", title in `--fs-hero`, meta row (brass ★, year, runtime, muted genres), 2-line clamped overview with "More" toggle, primary white `Details` button + secondary `＋/✓ Vault` button.
- **[MODIFY] [src/components/MovieCarouselRow.jsx](./src/components/MovieCarouselRow.jsx)**:
  - Native horizontal scroll with edge fade mask (`mask-image`), hidden scrollbar, scroll-snap.
  - Row hover reveals quiet arrow buttons (`scrollBy(0.9 * clientWidth)`) and `SectionHeader` with "See all →".
  - Section scroll-reveal with Framer Motion `whileInView` (`once: true, margin: "-80px"`).
- **[MODIFY] [src/components/PosterImage.jsx](./src/components/PosterImage.jsx)**:
  - Explicit aspect ratio (`2/3`), `loading="lazy"`, `decoding="async"`, skeleton placeholder.
- **[MODIFY] [src/pages/DashboardPage.jsx](./src/pages/DashboardPage.jsx)**:
  - Clean section gaps and structured catalogue rows.

---

### Phase 5: Vault Page & Analytics
*Commit: `feat(vault): compact analytics + menu-based filters`*

- **[MODIFY] [src/pages/VaultPage.jsx](./src/pages/VaultPage.jsx)**:
  - Top-right `⋯ Manage` Menu (Portability, "Select titles..." entering bulk mode, Clear).
  - `Genre` multi-select `Menu` (shows active count + clear option).
  - `Sort` dropdown `Menu`.
  - Grid view uses `MovieCard variant="grid"`, list view uses `WatchedMoviesList`.
  - Search input with max-width 320px.
- **[MODIFY] [src/components/VaultBanner.jsx](./src/components/VaultBanner.jsx)**:
  - Single-row editorial header: H1 "My Vault" + meta line (`115 films · 237h 27m · ★ 8.1 avg`) + taste tagline.
  - Underline `Tabs` for *Watched (count)* and *Plan to Watch (count)* with unique `layoutId="vault-tabs"`.
- **[MODIFY] `VaultAnalyticsHeader.jsx` (analytics integrated into [src/components/VaultBanner.jsx](./src/components/VaultBanner.jsx) & [src/pages/VaultPage.jsx](./src/pages/VaultPage.jsx))**:
  - 4-cell hairline `StatCell` strip (Total watched, Screen time, Avg rating vs IMDb, Top genre).
  - Collapsible `Accordion` "Insights": 6px flat rating distribution bars + trivia items.
  - Fold in all metrics from `WatchedSummary.jsx`.
- **[MODIFY] [src/components/WatchedMoviesList.jsx](./src/components/WatchedMoviesList.jsx)** (consolidated list view, replacing legacy `MovieList.jsx`):
  - 40×60 thumbnail list rows with subtle `--surface-1` hover highlight.
- **[MODIFY] [src/components/VaultBulkBar.jsx](./src/components/VaultBulkBar.jsx)**:
  - Solid `--surface-2` floating bar with hairline border, `--sh-3`, and clean slide-up.
  - Actions disabled until `selectedCount >= 1`. Exit via Cancel button or `Esc`.
- **[MODIFY] [src/components/RandomPicker.jsx](./src/components/RandomPicker.jsx)**:
  - Restyle modal presentation using design tokens without emoji chips.

---

### Phase 6: Recommendations & Calm AI Chat
*Commit: `feat(ai): editorial recommendation list + calm chat`*

- **[MODIFY] [src/pages/AIPage.jsx](./src/pages/AIPage.jsx)**:
  - Clean header: H1 "Recommended for You" + micro text "Powered by Gemini · synced 115 films" + refresh `IconButton`.
  - Underline `Tabs`: *Picks* | *Chat* with unique `layoutId="ai-tabs"`.
  - Remove ambient colored aura blobs.
- **[MODIFY] [src/components/MovieRecommendations.jsx](./src/components/MovieRecommendations.jsx)**:
  - Convert recommendations into **ranked list rows**:
    - Outlined rank numeral (`01`, `02`, `03` in `--text-3`).
    - 100×150 poster thumbnail.
    - Title H3 + meta line (`94% match` green 600, IMDb, year, genres).
    - AI explanation with 2px brass left-border ("Because you liked...").
    - Actions: `＋ Vault` secondary-sm, `Details` ghost-sm, `⋯` menu.
    - Mobile breakpoint (<640px): 96px poster + text, rank as micro-label above title, 3-line clamped explanation, icon-only actions.
  - Controls: `Mood` single-select `Menu` (clean text labels without emojis), `Sort` `Menu`, stale hash refresh quiet button, and `ModelUsageBadge` showing the active/cached Gemini model (`gemini-4-hydrogen`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-3.8-flash`) or `Local Ranker (Offline Fallback)`.
  - Taste profile: Collapsed `Accordion` ("Why these picks?") with flat brass-on-surface bars.
- **[MODIFY] [src/components/AIChat.jsx](./src/components/AIChat.jsx)**:
  - Centered 720px column. User bubbles in `--surface-2`, assistant in `--surface-1` with hairline border, active model status bar (`.chat-model-bar`), and per-reply model pill.
  - Clean 3-dot typing indicator and primary send `IconButton`.

---

### Phase 7: Movie Details & Feedback States
*Commit: `style(details): restyle movie page + feedback states`*

- **[MODIFY] [src/components/MovieDetails.jsx](./src/components/MovieDetails.jsx)** & [src/pages/MoviePage.jsx](./src/pages/MoviePage.jsx):
  - Restyle with hero backdrop scrim, `--fs-hero` / H1 title, brass rating badges, and action buttons.
- **[MODIFY] [src/components/StarRating.jsx](./src/components/StarRating.jsx)**:
  - Brass stars (`--accent`), crisp hover states, no glow shadows.
- **[MODIFY] [src/components/Loader.jsx](./src/components/Loader.jsx)**, [ErrorMessage.jsx](./src/components/ErrorMessage.jsx), [EmptyState.jsx](./src/components/EmptyState.jsx):
  - Standardize on `Skeleton.jsx` and neutral feedback states with quiet typography.

---

### Phase 8: Motion & Performance Optimization
*Commit: `perf: motion system + lazy media + content-visibility`*

- Enforce `prefers-reduced-motion: reduce`:
  - Disable Ken Burns zoom and auto-advance.
  - Restrict reveals to opacity fades (<= 150ms) without transforms.
  - Skip count-up animations.
- Apply `content-visibility: auto` and `contain-intrinsic-size: 1px 320px` to carousel rows.
- Ensure all portal hover previews produce CLS = 0.
- Memoize list rows and poster components.

---

### Phase 9: A11y, QA Verification & Cleanup
*Commit: `docs: refresh README for redesign`*

- **Dead Code Cleanup:** Delete unreferenced legacy files (`src/components/Box.jsx`, `src/components/Search.jsx`, `src/components/NumResults.jsx`, `src/components/WatchedSummary.jsx`).
- **[MODIFY] [README.md](./README.md)**: Update documentation reflecting the streaming-grade redesign, design tokens, and consolidated hierarchy.

---

## 5. Strict Verification & Acceptance Criteria

### Automated Build & Code Audits
1. **Production Build:**
   ```powershell
   npm run build
   ```
   Must exit with code 0 and zero TypeScript/Vite/bundling errors.
2. **Token Purity Audit:**
   - `git grep -nE "#38bdf8|sky-[0-9]|cyan" -- src/` → 0 hits.
   - `git grep -nE "border-radius:\s*(9999px|50%)" -- src/` → whitelist only progress segments + typing dots.
   - Emoji in JSX strings grep → 0 hits.

### Performance, Motion & Layout QA
1. **Hover Preview & Scroller Integrity:**
   - Preview never clipped at any viewport edge.
   - Row scroll, edge mask fade, and snap behavior completely unaffected while preview is open.
   - Cumulative Layout Shift (CLS) = 0.
2. **Responsive Breakpoints:**
   - Verified at 360px, 768px, 1280px, and 1920px with zero horizontal overflow.
3. **Reduced-Motion Verification:**
   - Under reduced-motion preference, all transforms and Ken Burns animations are disabled; auto-advance is halted.
4. **Keyboard & Accessibility:**
   - Skip-link present.
   - `aria-current="page"` on active navigation links.
   - `Menu` and `Modal` manage roving focus and restore focus to trigger on close.
   - All 115-film features (ratings, notes, bulk operations, Letterboxd CSV/JSON portability, randomizer, AI picks & chat) fully operational.

---

## 6. Post-Overhaul Architecture & UI Extensions (v4.0–v4.2 Additions)

Following completion of the v1.2 visual overhaul, the core services and presentation layer received major recommendation, import-safety, and resilience upgrades while preserving every design token and layout constraint in Sections 1–5:

- **Deterministic Match Percentages & Badges ([src/components/MovieRecommendations.jsx](./src/components/MovieRecommendations.jsx) + [src/services/rankerService.js](./src/services/rankerService.js))**:
  - Recommendation match percentages (`50–99%`) are mathematically locked by the local 11-feature logistic ranker (`scoreCandidate`), never overwritten by LLM output.
  - Up to 2–3 deterministic **Match Reason Badges** (`🧬 High Taste-Twin Match`, `🎬 Favorite Filmmaker`, `🎯 Core Theme Match`, `💎 Personal Cult Pick`, `🎪 Genre Bullseye`, `⭐ Critical Acclaim`) render seamlessly within existing recommendation row metadata without breaking mobile line clamping.
- **On-Device Float16 Collaborative Map & 5-Bucket Retrieval ([src/services/embeddingService.js](./src/services/embeddingService.js), [src/services/tmdbService.js](./src/services/tmdbService.js))**:
  - Lazy runtime loader fetches `/models/item_embeddings_f16.bin` (`CVEM v1`, `25,000 × 64`) once per session, computes vault-relative weight cutoffs (`1e-6 * maxAbsWeight`), clusters up to 4 mass-weighted Spherical K-Means personas (`computePersonaDetails`, log-sum-exp mixture `beta = 20`) blended (`0.75 / 0.25`) with on-device `64×64` Ridge fold-in (`lambda = 20`, `ridgeMinItems = 10`, scale-invariant `normW`), builds negative repulsion maps, normalizes positive `collabSim` via pool-independent `catalog-max` (`minCatalogSize = 50`, smoothstep `[0, 0.02]` damping to `0.35`), injects Bucket E embedding neighbors, and appends Bucket D recent releases (`18`-month window) with **2 reserved Top-15 slots**.
- **Hardened CSV Date, Cluster & Rewatch Pipeline ([src/services/csvImport.js](./src/services/csvImport.js))**:
  - Wired into [src/components/BackupManagerModal.jsx](./src/components/BackupManagerModal.jsx), [src/components/MovieCard.jsx](./src/components/MovieCard.jsx), and [src/pages/VaultPage.jsx](./src/pages/VaultPage.jsx) for strict `Watched Date` > `Date` priority, calendar rollover rejection, clustered bulk-import detection (`isBulkImported: true`), and diary rewatch deduplication.
- **H1 Resilient Gemini Cascade ([src/services/geminiService.js](./src/services/geminiService.js), [src/services/geminiChatService.js](./src/services/geminiChatService.js), [src/services/geminiExplanationService.js](./src/services/geminiExplanationService.js))**:
  - Routes curation (`HIGH`) and fast chat/mood parsing (`MEDIUM`/`3.5-flash-lite`) with `35,000 ms` `gemini-4-hydrogen` timeouts, H1 error-specific cooldowns, 30-minute `localStorage` model persistence, and deterministic ranker fallback on total cloud exhaustion.
- **Automated Regression Suite ([tests/](./tests))**:
  - Initially verified at **99 / 99** assertions across 12 `node --test` suites at v4.2, and expanded through v5.1 to **274 / 274** passing assertions across **31** `node --test` suites alongside `npm run build` (`vite build`, `2309` modules).

---

## 7. v4.3–v5.0 Production Overhaul: Editorial Navigation, Live Discovery, Onboarding, Portability, Cloud Sync & Film Oracle Extensions

Building directly on the neutral streaming token system (`#0b0b0c` obsidian canvas, `#141416` / `#1c1d20` surfaces, `#f4f4f2` ivory typography, `#e2b13c` warm brass strictly reserved for stars/active highlights) without re-introducing any AI-demo purple/cyan glows, v4.3 through v5.0 upgrade every route and global modal cleanly:

### 7.1 Restrained Editorial Navigation & Global Modal Hub ([`NavBar.jsx`](./src/components/NavBar.jsx), [`navHelpers.js`](./src/services/navHelpers.js), [`App.jsx`](./src/App.jsx))
- **Primary Route Labels:** Desktop header and `.mobile-stream-bar` expose three streamlined destinations (`Discover` -> `/`, `Vault` -> `/vault`, `Oracle` -> `/ai`) plus a global search trigger (`Search`, keyboard shortcuts `⌘K`/`Ctrl K` or `/` outside editable inputs).
- **Consolidated Library Utility Menu (`Menu` primitive in `NavBar.jsx`):** Exposes **Taste Calibration (30)** (`onOpenTasteDeck`), **Import / Export Ratings** (`onOpenBackup`), **Pick Random Film** (`onOpenRandomPicker`), and an auth-aware **Cloud Sync** entry (`getCloudSyncBadgeLabel` switching cleanly between `"Local Backup"`, `"Cloud Sync"`, `"Syncing..."`, and `"Synced"`), while dedicated Watchlist pill displays tabular counts (`formatVaultNavCount`).
- **Global Coordinated Modals (`App.jsx`):** Manages `SearchModal`, `RandomPicker`, `BackupManagerModal`, `QuickRateModal`, `TasteDeckModal`, and `CloudSyncModal` centrally so quick rating, import preview, taste calibration, and cloud sign-in behave uniformly from any route.

### 7.2 Live Home Discovery Hub & Genre Mosaic ([`DashboardPage.jsx`](./src/pages/DashboardPage.jsx), [`dashboardService.js`](./src/services/dashboardService.js), [`HomePosterGrid.jsx`](./src/components/HomePosterGrid.jsx))
- **Zero-Collision Unwatched Spotlights & Carousels:** `loadHomeDiscoveryFeeds` populates `HeroBillboard` (`buildHeroSlides`, rejecting Unsplash placeholders and normalizing `w1280` backdrops) and cross-row-deduplicated TMDB discovery carousels (`excludeSeenAndPlaced` with `buildSeenCollisionSet`), falling back seamlessly to `FALLBACK_ROWS` when offline or unconfigured.
- **Filterable "All Films" Poster Wall (`HomePosterGrid.jsx`):** Renders a genre-tabbed mosaic grid (`collectCatalogMosaic`) showing 24 posters initially (`visibleCount`) with progressive pagination and inline `QuickRateModal` triggers without cluttering Hero or carousels.

### 7.3 First-Visit Rapid Taste Deck & 10-Tier Quick Rating ([`TasteDeckModal.jsx`](./src/components/TasteDeckModal.jsx), [`tasteDeckService.js`](./src/services/tasteDeckService.js), [`QuickRateModal.jsx`](./src/components/QuickRateModal.jsx), [`ratingTiers.js`](./src/services/ratingTiers.js))
- **Non-Intrusive First-Open Onboarding (`shouldAutoShowTasteOnboarding`):** Automatically opens `TasteDeckModal` in `"grid"` mode once on initial visit strictly when `watched.length < 3` and `localStorage.getItem("cinemavault_taste_onboarding_dismissed_v1") !== "true"`; returning users (`watched.length >= 3`) or users who dismiss/press Escape never hit an onboarding loop, while the deck remains launchable on demand from `NavBar`, `DashboardPage`, and `AIPage`.
- **30-Film Interleaved Multi-Genre Deck (`buildTasteDeck`):** Interleaves `CORE_TASTE_DECK` across genres (`Sci-Fi`, `Action`, `Crime`, `Drama`, `Animation`, `Romance`, etc.) topped up from optional live TMDB pools while excluding already-watched movies across IMDb, TMDB, and normalized `title::year` keys.
- **Zero-Fabricated-Rating Guarantee (`ratingTiers.js` & `quickReviewTags.js`):** Shares `RATING_TIERS` (`10★` Masterpiece down to `1★` Severe Dislike) between `QuickRateModal` and `TasteDeckModal`; `prepareQuickRatePayload` and `prepareWatchlistPayload` ensure unrated additions never silently invent placeholder `5★` or `7★` scores. Shared contextual praise and critique chips ([quickReviewTags.js](./src/services/quickReviewTags.js): `QUICK_REVIEW_TAGS`, `getContextualQuickTags`, `hasQuickTagInNote`, `toggleQuickTagInNote`) power 1-click tag toggles across both `QuickRateModal` (`maxLength = 200`, AI-note placeholder) and `MovieDetails.jsx` without duplicating inline tag arrays.

### 7.4 Vault Analytics, True `1★–10★` Histogram & Lossless Schema v2 Portability ([`VaultBanner.jsx`](./src/components/VaultBanner.jsx), [`vaultStats.js`](./src/services/vaultStats.js), [`BackupManagerModal.jsx`](./src/components/BackupManagerModal.jsx), [`vaultPortability.js`](./src/services/vaultPortability.js))
- **True `1★–10★` Distribution (`buildRatingHistogramBins`):** Tallies every integer bin from `10★` down to `1★` without clamping scores `< 6`, surfacing critical dislike signals (`1★–4★`) alongside high favorites in Vault Insights.
- **Schema v2 Portability & Pre-Import Diff Preview:**
  - JSON export (`buildBackupJsonPayload`) writes `{ schemaVersion: 2, app: "CinemaVault", exportedAt, watched, watchlist, preferences: { userRegion, userWatchProviders, tasteRules: normalizedRules } }`, supporting Replace-mode clearing when empty while preserving legacy backups lacking `preferences.tasteRules`, and CSV exports support full CinemaVault columns and Letterboxd 10-scale + `Review` format (`buildRatingsCsv`).
  - `summarizeImportDiff` previews added watched entries, updated ratings, new watchlist saves, and skipped duplicates before applying across **Merge & Update**, **Add New Only**, or **Replace Vault** modes — collapsing cross-ID duplicates (`tmdb_<id>` vs `tt...` via `isSameMovie`) losslessly so watch dates and metadata survive — while `resolveCsvRowFallbackRecord` prevents silent `5★`/`7★` fabrication on unrated rows and `triggerFileDownload` revokes ObjectURLs after export.
  - **Lazy Series-Guarded Vault TMDB Backfill ([`tmdbService.js`](./src/services/tmdbService.js), [`AppContext.jsx`](./src/context/AppContext.jsx), [`MovieDetails.jsx`](./src/components/MovieDetails.jsx)):** On mount (800ms deferred, `maxItems: 40`, `maxLookups: 15`, checked keys persisted in `cinemavault_tmdb_backfill_checked_v1`), `backfillMissingTmdbIds` resolves missing movie IDs via IMDb `/3/find` + strict `±1`-year title/year search, tags/skips TV series via `isSeriesVaultItem` and TMDB `tv_results`, preserves `"N/A"` posters, and halts cleanly on HTTP `429` (`onHttpError`), while `addWatched` hydrates newly quick-rated TMDB entries asynchronously via `fetchTmdbMovieDetails`. Across candidate enrichment (`applyDetailsToCandidate`, Bucket E `fetchEmbeddingCandidates`, `bridgeTmdbToOmdb`) and `mergeBackfilledMovieMetadata`, rich fields (`cast`, `writers`, `tagline`, `originCountry`, `spokenLanguages`, `mpaaRating`, `runtimeMinutes`, `keywordNames`, `collectionId`, `collectionName`, and overview fallbacks) are preserved cleanly without overwriting existing `userNote` strings.

### 7.5 Canonical Cross-ID Identity & Race-Safe Search ([`movieIdentity.js`](./src/services/movieIdentity.js), [`searchService.js`](./src/services/searchService.js), [`SearchModal.jsx`](./src/components/SearchModal.jsx))
- **`isSameMovie`, `upsertMovieEntry` & `removeMovieEntries` (`movieIdentity.js`):** Unifies `imdb:`, `tmdb:`, `rawid:`, and normalized `ty:<title>::<year>` lookups across `AppContext.jsx`, `dashboardService.js`, and `MovieRecommendations.jsx`, while explicitly guarding against same-year title collisions when IMDb or TMDB IDs differ.
- **Debounced Race-Safe Catalog Search (`searchService.js` & `SearchModal.jsx`):** Uses `AbortController` + request sequence tracking over OMDb (`fetchOmdbJson`) and TMDB (`fetchTmdbJson`) via `apiTransport.js`, overlaying saved Vault/Watchlist status badges and instant `QuickRateModal` shortcuts cleanly.

### 7.6 Opt-In Multi-User Cloud Sync Modal & Guest-First Merge ([`CloudSyncModal.jsx`](./src/components/CloudSyncModal.jsx), [`supabaseClient.js`](./src/services/supabaseClient.js), [`vaultSyncService.js`](./src/services/vaultSyncService.js))
- **Guest-First Continuity:** Zero forced login gates; when `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are unset, `CloudSyncModal` explains that Local-First Guest Mode is active without degrading any Vault or Oracle feature.
- **Magic-Link Sync & Lossless Local Merge:** Signed-in users see connected account email, last-sync timestamp, live status badge (`Syncing...` / `Synced` / `Sync Error`), watched/watchlist counters, manual sync trigger, and non-destructive Sign Out (retaining all local films in browser storage). First sign-in merges guest ratings cleanly into Postgres (`profiles` + `user_vault_items` under RLS) via `mergeLocalAndCloudVault`.

### 7.7 Film Oracle Progressive Controls, Match Vibe, Steerable Taste Rules, Collection Guard & 10-Pick Rotation ([`MovieRecommendations.jsx`](./src/components/MovieRecommendations.jsx), [`moodPolicy.js`](./src/services/moodPolicy.js), [`tasteRulesService.js`](./src/services/tasteRulesService.js), [`oracleViewHelpers.js`](./src/services/oracleViewHelpers.js))
- **Progressive Filter Setup & Drawer (`renderStudioDeck`):** Renders the `MOOD_OPTIONS` selector grid (`Any Vibe`, `Mind-Bending`, `Dark Thriller`, `Fun Popcorn`, `Comfort Watch`, `Hidden Gem`), inline free-text **"Match Vibe"** form (`"like Drive but quieter"` with `parseFreeTextMoodWithGemini` + offline `parseFreeTextMoodFallback` and `formatActiveVibeNote` feedback), collapsible **"Where to watch"** region (`AVAILABLE_REGIONS`) & provider matrix (`POPULAR_WATCH_PROVIDERS` with `PROVIDER_FAMILY_MAP` alias expansion), a collapsible **"Taste Rules"** studio drawer (`cinemavault_taste_rules_v1`, stored outside `safeSetItem`'s `purgeOrder`) for **Auto-Draft Rules from Vault** (`draftTasteRulesWithGemini` + offline fallback preserving pinned rules), adding Prefer/Avoid directives (up to `8`), inline editing, pinning, toggling active/paused, and deleting (wired end-to-end across `buildBucketAParams` unqualified `without_genres` with broad-genre blacklist guard, `rankCandidatePool` `+0.6`/`-3.5` logit adjustments, `buildDiversifiedGeminiShortlist` avoid filtering, `verifyAndScoreWildcardPicks`, `generateProfileHash` `_tr_` hashing, `buildGeminiReRankPrompt`, and `AIChat` `sendChatMessage`), **"Find Picks" / "Update Picks"**, and **"Start over"** reset. Closing the `"Mood & Streaming"` drawer triggers `shouldAutoRefreshOnDrawerClose` whenever the profile/region/mood hash changed.
- **10-Pick Curated List (`DEFAULT_RECOMMENDATION_COUNT = 10`, Floor `7`), Franchise Collection Guard & Signal-Rich Compact Prompting:**
  - Renders up to 10 editorial rows backed by `cinemavault_smart_cache_v4` (`>= MIN_VALID_CACHE_COUNT = 7`) and region-, filter-, note-, & taste-rule-aware `generateProfileHash(..., moodFilters, userRegion, watched, tasteRules)` (hashing normalized `userNote` via `hashStringFnv1a` inside `buildWatchedHashSegment` and active rules via `buildTasteRulesHashSegment` while preserving empty-note / empty-rule hashes).
  - `buildGeminiReRankPrompt` unpacks nested `{ movie, weight, zScore }` entries in `buildMovieIdentityLookup` & `selectMoodStratifiedAnchors`, surfaces real `userStats || ratingStats` & `topDirectors`, adds `[Series]` tags + `userNote` (`<= 180` chars; `120` on streak) across anchors/dislikes/near-misses, emits `USER'S STEERABLE TASTE RULES (Follow strictly)` (never trimmed under prompt compaction), emits `USER'S WATCHLIST` (`<= 8`), expands vault coverage via `buildExtendedVaultContextSections` (`ADDITIONAL TOP FAVORITES` `11–25`, `LOVED SERIES / ANIME`, and deduplicated `ADDITIONAL VIEWER NOTES` for all remaining noted watches), strips numeric `Match: XX%` and `#1–#15` anchoring bias alongside `Collection:` tags and explicit `Franchise rule:` sequel/collection diversity guidance across a **39-candidate stratified shortlist** (`buildDiversifiedGeminiShortlist`: `25` core + `8` cold `2024–2026` + `6` outliers) under a `<= 20,000`-char adaptive compaction guard (`PROMPT_CHAR_BUDGET = 19200`, `PROMPT_CHAR_LIMIT = 20000`), and allows **0–2 optional `wildcardPicks`** strictly verified against TMDB/vault/provider/mood/avoid-rule gates (`verifyAndScoreWildcardPicks`) while enforcing two-pass soft **`selectWithSoftVarietyCaps`** (`maxPerDirector = 2`, `maxPerCollection = 1`) + automatic shortfall backfill into the 10-pick result.
  - Numeric `% match` badges render conditionally only when `matchScore !== null` and `hasMeaningfulScoreSpread` holds (`scoreValues.length > 1`, `new Set(scoreValues).size > 1`, spread `>= 4` points), keeping ties or unrated fallbacks quiet rather than noisy.
  - Each card pairs sanitized prose (`sanitizeOracleReason`) with clickable **"Because you rated"** anchor chips (`resolveRecommendationAnchors(rec, watched, 3)` linking directly to `/movie/<id>` with thumbnail & personal star rating), inline streaming availability (`streamProviders` + `freeProviders`), **"About these picks"** model/cache/hydration provenance popover (`formatRecBadgeSummary`), **Trailer** watch links, **Add to Watchlist**, **"Already seen"** (opens `QuickRateModal` via `already_seen` action without penalizing disliked taste signals), and **Not for me** dismissal feedback reasons (`Too slow`, `Not my genre`, `Predictable`).
  - Clicking **Refresh** rotates via `nextRefreshExcludeState` (`seenIds` capped at `120`, TMDB discover pages cycling `1..5`) with ranker exhaustion padding so repeated refreshes surface fresh picks cleanly; sparse strict moods surface a `moodShortfall` banner with a `"Widen vibe & filters"` recovery action.

### 7.8 Serverless API Proxies, Person Filmography Explorer & Updated Automated Verification ([`api/*.js`](./api), [`apiTransport.js`](./src/services/apiTransport.js), [`personService.js`](./src/services/personService.js), [`tests/`](./tests))
- **Clickable Cast & Crew Filmography (`MovieDetails.jsx`, `PersonFilmographyModal.jsx`, `PersonFilmographyExplorer.jsx`, `PersonPage.jsx`, `src/styles/person.css`):** Selecting any Starring Cast card or creative credit (**Director**, **Screenplay & Writers**, **Cinematography (DoP)**, **Original Score**) opens `PersonFilmographyModal` (`zIndex: 8500`, strictly below `QuickRateModal` at `9999` with `shouldCloseMovieDetailOnEscape` & nested-dialog Escape guards) displaying portraits, Vault affinity stats (`Watched`, `Avg ★`, `Watchlist`), department tabs (`resolvePersonDefaultDepartment`), status filters, sorting, `+ Save`, and `★ Rate`; clicking `"View Full Profile →"` navigates to `/person/:id?dept=<tab>` (`buildPersonProfileRoute`) reusing session-cached TMDB data. `api/tmdb.js` allows `/3/search/person` and `/3/person/<id>[/movie_credits]` cleanly.
- All client API traffic routes transparently through `/api/gemini`, `/api/tmdb`, `/api/tmdb-batch` (chunked 40-ID server fan-out + 30-day client IndexedDB cache in `getMovieDetailsBatch`, aborting batch loops on HTTP `429` and invoking `options.onHttpError`), and `/api/omdb` serverless proxies in production (`vite build` emits zero upstream secrets across **`2309` modules**), while direct `VITE_*` keys remain supported seamlessly for local Vite development.
- `npm test` (`node --test`) verifies **`274 / 274`** passing assertions across **`31`** unit and integration test suites (`tests/*.test.js`).
