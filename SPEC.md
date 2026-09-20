# CinemaVault — "Streaming-Grade" Frontend Overhaul (v1.2 Deep-Dive Specification & Plan)

**Target Application:** CinemaVault (`khuzaima175/React-Movie-Original`)  
**Objective:** Replace the "AI-demo" aesthetic (cyan `#38bdf8` glows, gradient pills, orb background, emoji chips, badge clutter) with a restrained, content-first, streaming-platform-grade frontend. Retain 100% of existing features, data structures, and services with zero regressions, consolidating secondary controls into accessible menus and introducing portal-based hover-preview cards and synchronized motion.

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

- **[MODIFY] [index.html](file:///g:/Important%20Projects/movie-ratings/index.html)**:
  - Load Google Font **Inter** (400, 500, 600, 700, 800) with `display=swap`.
  - Set `<meta name="theme-color" content="#0b0b0c">`, preconnect to `fonts.gstatic.com`, add brass SVG favicon.
- **[MODIFY] [src/index.css](file:///g:/Important%20Projects/movie-ratings/src/index.css)**:
  - Complete rewrite of `:root` with neutral streaming tokens, z-scale, and font definitions.
  - Configure Tailwind v4 `@theme` block.
  - Global scrollbar: `scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent`.
  - Delete legacy cyan glows, gradient borders, orb styling, and pill radius overrides.
- **[MODIFY] [src/components/AnimatedBackground.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/AnimatedBackground.jsx)**:
  - Delete gradient orbs and animated grid lines.
  - Render static subtle vignette (`radial-gradient(1200px 400px at 50% -10%, rgba(255,255,255,.03), transparent)`).
- **[NEW] [src/motion.js](file:///g:/Important%20Projects/movie-ratings/src/motion.js)**:
  - Export motion presets: `EASE`, `reveal`, `stagger`, `cardIn`, `springHover`.
- **[MODIFY] [src/services/geminiService.jsx](file:///g:/Important%20Projects/movie-ratings/src/services/geminiService.jsx)**:
  - Recolor `getFallbackPoster` SVG to tokens (charcoal `#141416`, brass stroke `#e2b13c`, text `--text-2`) while keeping logic and caching untouched.

---

### Phase 2: Core UI Primitives (`src/components/ui/*`)
*Commit: `feat(ui): add button/menu/tabs/modal primitives`*

- **[NEW] [src/components/ui/Button.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ui/Button.jsx)**:
  - Variants: `primary` (white), `secondary` (translucent gray), `ghost` (hairline border), `quiet` (borderless text-only).
  - Sizes: `sm`, `md`. Interactive `scale: 0.98` press feedback, 120ms background transitions.
- **[NEW] [src/components/ui/IconButton.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ui/IconButton.jsx)**:
  - Accessible square button for icon triggers with built-in `aria-label` and brass focus ring.
- **[NEW] [src/components/ui/Menu.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ui/Menu.jsx)**:
  - Accessible dropdown with `role="menu"`, Escape key, outside click handling, roving tabindex, and keyboard arrow navigation.
  - Supports standard actions (`role="menuitem"`) and multi-select items (`role="menuitemcheckbox"` with `aria-checked`).
- **[NEW] [src/components/ui/Tabs.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ui/Tabs.jsx)**:
  - Underline tabs with 2px brass active indicator sliding via Framer Motion `layoutId`.
- **[NEW] [src/components/ui/Modal.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ui/Modal.jsx)**:
  - Backdrop fade + panel entrance animation (`scale: 0.96 -> 1`, 200ms) with Esc handling, focus return, and `role="dialog"`.
- **[NEW] [src/components/ui/Skeleton.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ui/Skeleton.jsx)**:
  - Neutral `--surface-2` shimmer sweep for poster, text, and cell loading states.
- **[NEW] [src/components/ui/SectionHeader.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ui/SectionHeader.jsx)**:
  - Section header with H2 title on left and hover-revealed quiet link on right.
- **[NEW] [src/components/ui/StatCell.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ui/StatCell.jsx)**:
  - Clean hairline-bordered stat cell displaying micro-label, tabular H2 value, and muted delta text.
- **[NEW] [src/components/ui/Accordion.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ui/Accordion.jsx)**:
  - Collapsible container with smooth height animation for secondary metrics and taste explanations.

---

### Phase 3: Shell Architecture & Global Modals
*Commit: `feat(shell): text-link nav, overflow menus, page transitions`*

- **[MODIFY] [src/components/Logo.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/Logo.jsx)**:
  - Clean SVG vault-dial / film glyph in brass accent (`--accent`) + "CinemaVault" 700 / `-0.02em`.
- **[MODIFY] [src/components/NavBar.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/NavBar.jsx)**:
  - 64px header: transparent over billboard, transitioning to `rgba(11,11,12,.92)` + `backdrop-filter: blur(10px)` + bottom hairline on scroll (>40px).
  - Navigation links: text links (`Home`, `My Vault`, `Recommendations`) with brass sliding underline tabs. Tabular counts (`My Vault 115`).
  - Right group: search `IconButton` (opens modal), profile/overflow `Menu` containing: *Watchlist (count)*, *Random Picker*, *Import/Export Portability*, *Manage Vault*, *GitHub Link*.
  - Mobile bottom navigation using unified token styling.
- **[MODIFY] [src/components/Main.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/Main.jsx)**:
  - Standardize container, gutter, and section-gap tokens with `min-height: calc(100vh - var(--nav-h))`.
- **[MODIFY] [src/App.jsx](file:///g:/Important%20Projects/movie-ratings/src/App.jsx)**:
  - Wire global modals (`SearchModal`, `BackupManagerModal`, `RandomPickerModal`).
  - Route transitions via `<Routes location={location} key={location.pathname}>` wrapped in `AnimatePresence mode="wait"`.
  - Scroll-to-top on route change.
  - Slim editorial footer (hairline top, micro logo, OMDb/Gemini attribution, "Built by Khuzaima").
- **[MODIFY] [src/components/SearchModal.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/SearchModal.jsx)**:
  - 640px modal at 15vh, borderless 1.25rem input over hairline, 40×60 poster thumbnail list, footer micro text (`↑↓ navigate · ↵ open · esc close`).
- **[MODIFY] [src/components/BackupManagerModal.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/BackupManagerModal.jsx)**:
  - Restyle using `Modal.jsx`, `Tabs.jsx`, and `Button.jsx` primitives while keeping all CSV/Letterboxd/JSON import/export and merge logic intact.
- **[MODIFY] [src/components/ToastNotification.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ToastNotification.jsx)**:
  - Top-center placement under navbar (slide-down 8px) with hairline border, `--sh-2`, and `--z-toast: 90` to avoid bulk bar collision.
- **[MODIFY] [src/components/ErrorBoundary.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ErrorBoundary.jsx)**:
  - Restyle crash boundary with design tokens, neutral icon, and secondary retry button.

---

### Phase 4: Home, Billboard & Portal-Based Hover Preview
*Commit: `feat(home): billboard hero + hover-preview rows`*

- **[NEW] [src/components/HoverPreviewCard.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/HoverPreviewCard.jsx)**:
  - Portaled to `document.body`, `position: fixed`, `z-index: var(--z-hover)`.
  - Triggered on 250ms dwell; spring-expands smoothly from trigger rect to preview bounds (`scale: 1 -> 1.05`, width ≈320px).
  - Viewport clamping with 16px safe margins (vertical flip if clearance < 300px).
  - Closes on scroll, wheel, resize, route change, Escape, or pointer leave with 150ms grace timer.
  - Mobile touch support: 450ms long-press.
- **[MODIFY] [src/components/MovieCard.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/MovieCard.jsx)**:
  - Variant API: `variant="row" | "grid" | "list"`.
  - `variant="row"`: card never scales, passes trigger rect on 250ms dwell to `HoverPreviewCard`. Rating corner chip (`rgba(0,0,0,.7)`).
  - `variant="grid"`: standard card with hover overlay actions.
- **[MODIFY] [src/components/HeroBillboard.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/HeroBillboard.jsx)**:
  - Height: `clamp(520px, 78vh, 720px)` full-bleed backdrop.
  - Synchronized motion: `--hero-slide: 9s` driving auto-advance and Ken Burns zoom (`scale: 1 -> 1.06` over 9s) with 700ms crossfade.
  - Pauses on hover, `:focus-within`, and `document.hidden`.
  - Backdrop source fallback: blur-cover composition (poster `object-fit: cover` + `scale(1.25)` + `blur(48px) saturate(.9)` under scrims).
  - Container: micro-label "Featured", title in `--fs-hero`, meta row (brass ★, year, runtime, muted genres), 2-line clamped overview with "More" toggle, primary white `Details` button + secondary `＋/✓ Vault` button.
- **[MODIFY] [src/components/MovieCarouselRow.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/MovieCarouselRow.jsx)**:
  - Native horizontal scroll with edge fade mask (`mask-image`), hidden scrollbar, scroll-snap.
  - Row hover reveals quiet arrow buttons (`scrollBy(0.9 * clientWidth)`) and `SectionHeader` with "See all →".
  - Section scroll-reveal with Framer Motion `whileInView` (`once: true, margin: "-80px"`).
- **[MODIFY] [src/components/PosterImage.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/PosterImage.jsx)**:
  - Explicit aspect ratio (`2/3`), `loading="lazy"`, `decoding="async"`, skeleton placeholder.
- **[MODIFY] [src/pages/DashboardPage.jsx](file:///g:/Important%20Projects/movie-ratings/src/pages/DashboardPage.jsx)**:
  - Clean section gaps and structured catalogue rows.

---

### Phase 5: Vault Page & Analytics
*Commit: `feat(vault): compact analytics + menu-based filters`*

- **[MODIFY] [src/pages/VaultPage.jsx](file:///g:/Important%20Projects/movie-ratings/src/pages/VaultPage.jsx)**:
  - Top-right `⋯ Manage` Menu (Portability, "Select titles..." entering bulk mode, Clear).
  - `Genre` multi-select `Menu` (shows active count + clear option).
  - `Sort` dropdown `Menu`.
  - Grid view uses `MovieCard variant="grid"`, list view uses `WatchedMoviesList`.
  - Search input with max-width 320px.
- **[MODIFY] [src/components/VaultBanner.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/VaultBanner.jsx)**:
  - Single-row editorial header: H1 "My Vault" + meta line (`115 films · 237h 27m · ★ 8.1 avg`) + taste tagline.
  - Underline `Tabs` for *Watched (count)* and *Plan to Watch (count)* with unique `layoutId="vault-tabs"`.
- **[MODIFY] [src/components/VaultAnalyticsHeader.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/VaultAnalyticsHeader.jsx)**:
  - 4-cell hairline `StatCell` strip (Total watched, Screen time, Avg rating vs IMDb, Top genre).
  - Collapsible `Accordion` "Insights": 6px flat rating distribution bars + trivia items.
  - Fold in all metrics from `WatchedSummary.jsx`.
- **[MODIFY] [src/components/WatchedMoviesList.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/WatchedMoviesList.jsx)** & [src/components/MovieList.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/MovieList.jsx):
  - 40×60 thumbnail list rows with subtle `--surface-1` hover highlight.
- **[MODIFY] [src/components/VaultBulkBar.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/VaultBulkBar.jsx)**:
  - Solid `--surface-2` floating bar with hairline border, `--sh-3`, and clean slide-up.
  - Actions disabled until `selectedCount >= 1`. Exit via Cancel button or `Esc`.
- **[MODIFY] [src/components/RandomPicker.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/RandomPicker.jsx)**:
  - Restyle modal presentation using design tokens without emoji chips.

---

### Phase 6: Recommendations & Calm AI Chat
*Commit: `feat(ai): editorial recommendation list + calm chat`*

- **[MODIFY] [src/pages/AIPage.jsx](file:///g:/Important%20Projects/movie-ratings/src/pages/AIPage.jsx)**:
  - Clean header: H1 "Recommended for You" + micro text "Powered by Gemini · synced 115 films" + refresh `IconButton`.
  - Underline `Tabs`: *Picks* | *Chat* with unique `layoutId="ai-tabs"`.
  - Remove ambient colored aura blobs.
- **[MODIFY] [src/components/MovieRecommendations.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/MovieRecommendations.jsx)**:
  - Convert recommendations into **ranked list rows**:
    - Outlined rank numeral (`01`, `02`, `03` in `--text-3`).
    - 100×150 poster thumbnail.
    - Title H3 + meta line (`94% match` green 600, IMDb, year, genres).
    - AI explanation with 2px brass left-border ("Because you liked...").
    - Actions: `＋ Vault` secondary-sm, `Details` ghost-sm, `⋯` menu.
    - Mobile breakpoint (<640px): 96px poster + text, rank as micro-label above title, 3-line clamped explanation, icon-only actions.
  - Controls: `Mood` single-select `Menu` (clean text labels without emojis), `Sort` `Menu`, stale hash refresh quiet button.
  - Taste profile: Collapsed `Accordion` ("Why these picks?") with flat brass-on-surface bars.
- **[MODIFY] [src/components/AIChat.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/AIChat.jsx)**:
  - Centered 720px column. User bubbles in `--surface-2`, assistant in `--surface-1` with hairline border.
  - Clean 3-dot typing indicator and primary send `IconButton`.

---

### Phase 7: Movie Details & Feedback States
*Commit: `style(details): restyle movie page + feedback states`*

- **[MODIFY] [src/components/MovieDetails.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/MovieDetails.jsx)** & [src/pages/MoviePage.jsx](file:///g:/Important%20Projects/movie-ratings/src/pages/MoviePage.jsx):
  - Restyle with hero backdrop scrim, `--fs-hero` / H1 title, brass rating badges, and action buttons.
- **[MODIFY] [src/components/StarRating.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/StarRating.jsx)**:
  - Brass stars (`--accent`), crisp hover states, no glow shadows.
- **[MODIFY] [src/components/Loader.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/Loader.jsx)**, [ErrorMessage.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/ErrorMessage.jsx), [EmptyState.jsx](file:///g:/Important%20Projects/movie-ratings/src/components/EmptyState.jsx):
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
- **[MODIFY] [README.md](file:///g:/Important%20Projects/movie-ratings/README.md)**: Update documentation reflecting the streaming-grade redesign, design tokens, and consolidated hierarchy.

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
