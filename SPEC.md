# CinemaVault — Frontend Overhaul Specification (v1.2 Design System & Implementation Record)

**Target application:** CinemaVault (`khuzaima175/React-Movie-Original`)

**Objective:** Replace the "AI-demo" aesthetic (cyan glows, gradient pills, orb backgrounds, emoji chips, badge clutter) with a restrained, content-first, streaming-style frontend. Keep existing features, data structures, and services unchanged, consolidate secondary controls into accessible menus, and add portal-based hover previews and synchronized motion.

> **Status (`main` / v6.2 + GameVault Phase 2):** Sections 1–5 describe the v1.2 overhaul. Sections 6–8 record later changes through v6.2 and GameVault Phase 2 (recommender upgrades, Research Hub, Editorial UX Overhaul, `/auth` + `/account` editorial pages, 3-wave progressive Explore `"Movies You'll Like"`, Universal Taste Match, Flagship Film Oracle Tonight's Concierge, Background Curation, opt-in Community Profiles `/u/:username`, and the unified **`Movies ⇄ Games`** GameVault suite on `/games*` + `/game/:id`). The top navigation includes a compact `Movies | Games` switcher alongside mode-aware tabs (`Discover / Explore / Vault / Oracle` + `Together` in Movies mode) and top-right `Sign In` / Account entry. Behavior and data-layer details live in [ARCHITECTURE.md](./ARCHITECTURE.md). Local model details live in [LOCAL_MODEL_GUIDE.md](./LOCAL_MODEL_GUIDE.md). Verification commands are in the README.

---

## 1. System Architecture & Context Wireframes

```mermaid
graph TD
  subgraph Global Shell [App.jsx & AppContext]
    AppProvider --> Shell[NavBar & App Shell]
    Shell --> Routes[Route View Container]
    AppProvider --> GlobalModals[SearchModal / BackupModal / RandomPickerModal / CompareDock / CompareModal]
    AppProvider --> ToastLayer[ToastNotification (Top-Center)]
  end

  subgraph Route Pages
    Routes --> Home[DashboardPage / Discover]
    Routes --> Explore[ExplorePage]
    Routes --> Compare[ComparePage]
    Routes --> Vault[VaultPage]
    Routes --> AI[AIPage / Oracle]
    Routes --> Movie[MoviePage]
    Routes --> Person[PersonPage]
  end

  subgraph Shared UI Primitives
    Button --> Shell & Home & Explore & Compare & Vault & AI & Movie
    IconButton --> Shell & Home & Explore & Compare & Vault & AI & Movie
    Select --> Explore & Vault & AI & Person & GlobalModals
    Menu --> Shell & Vault & AI
    Tabs --> Shell & Vault & AI
    Modal --> GlobalModals
    StatCell --> Vault
    Accordion --> Vault & AI
    ScrollRevealSection --> Home & Vault & AI & Movie
  end

  subgraph Portal Layer
    Home --> HoverPreview[HoverPreviewCard (Portaled to document.body)]
  end
```

### Global Modals & Navigation Wiring

So that every feature (watchlist, portability, random picker, search, manage vault) can be opened from anywhere, including the NavBar menu:
- `App.jsx` coordinates modal open and close state (`isSearchOpen`, `isBackupOpen`, `isRandomPickerOpen`).
- `NavBar` receives `onOpenSearch`, `onOpenBackup`, and `onOpenRandomPicker`.
- `VaultPage` and `DashboardPage` open the same modals without duplicating props.

---

## 2. Token Layer & Tailwind v4 Theme

### `:root` CSS design tokens (`src/index.css`)

```css
:root {
  /* Surfaces (neutral charcoal, not blue-tinted) */
  --bg: #0b0b0c;
  --surface-1: #141416;
  --surface-2: #1c1d20;
  --surface-3: #242528;
  --hairline: rgba(255, 255, 255, 0.08);
  --hairline-strong: rgba(255, 255, 255, 0.16);

  /* Text */
  --text-1: #f4f4f2;
  --text-2: #b6b6b2;
  --text-3: #8a8a86;

  /* Accent and semantic */
  --accent: #e2b13c;                  /* Brass: logo, stars, active underline, focus ring only */
  --accent-dim: rgba(226, 177, 60, 0.14);
  --match: #46d369;                   /* Match-score text only */
  --danger: #e5484d;

  /* Buttons */
  --btn-primary-bg: #f5f5f1;
  --btn-primary-fg: #0b0b0c;
  --btn-primary-hover: #ffffff;
  --btn-secondary-bg: rgba(255, 255, 255, 0.14);
  --btn-secondary-hover: rgba(255, 255, 255, 0.22);

  /* Radius (pills avoided, except progress bars and typing dots) */
  --r-poster: 4px;
  --r-control: 6px;
  --r-card: 8px;
  --r-menu: 10px;
  --r-modal: 14px;

  /* Shadows (black only, no colored glows) */
  --sh-1: 0 1px 2px rgba(0, 0, 0, 0.4);
  --sh-2: 0 4px 12px rgba(0, 0, 0, 0.45);
  --sh-3: 0 12px 32px rgba(0, 0, 0, 0.55);
  --sh-hover: 0 14px 40px rgba(0, 0, 0, 0.65);

  /* Layout */
  --nav-h: 64px;
  --container: 1440px;
  --gutter: 48px;
  --section-gap: 56px;
  --row-gap: 24px;

  /* Z-index */
  --z-nav: 40;
  --z-hover: 50;
  --z-menu: 60;
  --z-bulk: 65;
  --z-modal: 80;
  --z-toast: 90;

  /* Motion */
  --hero-slide: 9s;
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --dur-1: 0.12s;
  --dur-2: 0.2s;
  --dur-3: 0.32s;
  --dur-4: 0.56s;
}

/* Tailwind v4 @theme binding */
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

### Allowed gradients (three only)

1. **Hero scrim:** `linear-gradient(90deg, rgba(11,11,12,.92), rgba(11,11,12,.55) 45%, transparent 75%)` plus `linear-gradient(0deg, var(--bg), transparent 35%)`.
2. **Poster hover overlay:** `linear-gradient(0deg, rgba(0,0,0,.85), transparent 60%)`.
3. **Skeleton shimmer sweep.**

---

## 3. Component Contracts

### 3.1 `HoverPreviewCard.jsx` (portal-based)

- **Problem solved:** The carousel scroller (`overflow-x: auto`) and the edge fade mask clip an expanded preview card and interfere with `scroll-snap`.
- **Portal target:** `createPortal(document.body)`.
- **Props:**
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
- **Lifecycle:**
  - After a 250 ms dwell, renders at `triggerRect` with `position: fixed`.
  - Springs to about 320 px wide with `springHover` (`{ type: "spring", stiffness: 320, damping: 28, mass: 0.8 }`).
  - Clamps to 16 px safe margins. Flips above the trigger when less than 300 px of space remains below.
  - A 150 ms pointer-leave grace timer, shared with any dropdown inside the preview.
  - Closes on scroll, wheel, resize, route change, or Escape.

### 3.2 `MovieCard.jsx` variant API

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
- **Behavior:**
  - `variant="row"`: the card does not scale. After a 250 ms dwell it passes its trigger rect to `HoverPreviewCard`. Rating chip uses `rgba(0,0,0,0.7)`.
  - `variant="grid"`: responsive grid card with hover overlay and quick actions. Supports a manage-mode selection checkbox.
  - `variant="list"`: tabular row, delegated to `WatchedMovieRow`.

### 3.3 `Menu.jsx` (dropdown primitive)

- **Accessibility:**
  - Trigger has `aria-haspopup="menu"`, `aria-expanded={isOpen}`, and `aria-controls`.
  - Panel has `role="menu"`.
  - Action items have `role="menuitem"` and `tabindex={0}`.
  - Multi-select items have `role="menuitemcheckbox"` and `aria-checked={checked}`.
  - Keyboard: `ArrowDown` and `ArrowUp` for roving focus, `Home` and `End`, and `Escape` to close and return focus to the trigger.
- **Animation:** Framer Motion `scale: 0.98 → 1` with fade over 140 ms, origin top-right.

### 3.4 `Tabs.jsx` (underline tabs)

- **Props:** `tabs: Array<{ id: string, label: string, count?: number, icon?: ReactNode }>`, `activeTab: string`, `onChange: (id: string) => void`, `layoutId: string`.
- **Indicator:** 2 px brass underline (`--accent`) that slides between tabs using Framer Motion `layoutId`.

---

## 4. Phased Implementation Plan

### Phase 1: Tokens, Tailwind mapping & global cleanup
*Commit: `chore(theme): replace design tokens with neutral streaming palette`*

- **[MODIFY] [index.html](./index.html)**
  - Load Inter (400, 500, 600, 700, 800) with `display=swap`.
  - Set `<meta name="theme-color" content="#0b0b0c">`, preconnect to `fonts.gstatic.com`, and add a brass SVG favicon.
- **[MODIFY] [src/index.css](./src/index.css)**
  - Rewrite `:root` with the neutral tokens, z-scale, and font definitions.
  - Configure the Tailwind v4 `@theme` block.
  - Global scrollbar: `scrollbar-width: thin; scrollbar-color: var(--surface-3) transparent`.
  - Remove legacy cyan glows, gradient borders, orb styling, and pill-radius overrides.
- **[MODIFY] [src/components/AnimatedBackground.jsx](./src/components/AnimatedBackground.jsx)**
  - Remove gradient orbs and animated grid lines.
  - Render a static vignette: `radial-gradient(1200px 400px at 50% -10%, rgba(255,255,255,.03), transparent)`.
- **[NEW] [src/motion.js](./src/motion.js)**
  - Export motion presets: `EASE`, `reveal`, `stagger`, `cardIn`, `springHover`.
- **[MODIFY] [src/services/geminiService.js](./src/services/geminiService.js)**
  - Recolor the `getFallbackPoster` SVG to the tokens (charcoal `#141416`, brass stroke `#e2b13c`, text `--text-2`). Logic and caching are unchanged.

---

### Phase 2: Core UI primitives (`src/components/ui/*`)
*Commit: `feat(ui): add button/menu/tabs/modal primitives`*

- **[NEW] `Button.jsx`**
  - Variants: `primary` (white), `secondary` (translucent gray), `ghost` (hairline border), `quiet` (text only).
  - Sizes: `sm`, `md`. Press feedback `scale: 0.98`. Background transition 120 ms.
- **[NEW] `IconButton.jsx`**
  - Square icon button with a required `aria-label` and a brass focus ring.
- **[NEW] `Menu.jsx`**
  - Dropdown with `role="menu"`, Escape handling, outside-click close, roving tabindex, and arrow-key navigation. Supports `menuitem` and `menuitemcheckbox` items.
- **[NEW] `Tabs.jsx`**
  - Underline tabs with a 2 px brass indicator that slides via Framer Motion `layoutId`.
- **[NEW] `Modal.jsx`**
  - Backdrop fade, panel entrance (`scale: 0.96 → 1`, 200 ms), Escape handling, focus return, `role="dialog"`.
- **[NEW] `Skeleton.jsx`**
  - `--surface-2` shimmer for poster, text, and cell loading states.
- **[NEW] `SectionHeader.jsx`**
  - H2 title on the left and a quiet link on the right, revealed on hover.
- **[NEW] `StatCell.jsx`**
  - Hairline-bordered cell with a micro label, tabular H2 value, and muted delta text.
- **[NEW] `Accordion.jsx`**
  - Collapsible container with height animation for secondary metrics and explanations.

---

### Phase 3: Shell architecture & global modals
*Commit: `feat(shell): text-link nav, overflow menus, page transitions`*

- **Logo (in [src/components/NavBar.jsx](./src/components/NavBar.jsx))**
  - SVG film/vault glyph in brass, with "CinemaVault" at weight 700 and letter-spacing `-0.02em`.
- **[MODIFY] [src/components/NavBar.jsx](./src/components/NavBar.jsx)**
  - 64 px header. Transparent over the hero, then `rgba(11,11,12,.92)` with `backdrop-filter: blur(10px)` and a bottom hairline after 40 px of scroll.
  - Text links with a brass sliding underline. Tabular counts (for example, `Vault 115`).
  - Right group: search `IconButton`, and a profile/overflow `Menu` with Watchlist (with count), Random Picker, Import/Export, Manage Vault, and the project link.
  - Mobile bottom navigation uses the same tokens.
- **Layout ([src/App.jsx](./src/App.jsx) & `src/pages/*`)**
  - Standard container, gutter, and section-gap tokens. `min-height: calc(100vh - var(--nav-h))`.
- **[MODIFY] [src/App.jsx](./src/App.jsx)**
  - Wires global modals (`SearchModal`, `BackupManagerModal`, `RandomPickerModal`).
  - Route transitions: `<Routes location={location} key={location.pathname}>` inside `AnimatePresence mode="wait"`.
  - Scroll to top on route change.
  - Slim footer: hairline top border, micro logo, OMDb and Gemini attribution.
- **[MODIFY] [src/components/SearchModal.jsx](./src/components/SearchModal.jsx)**
  - 640 px wide, positioned at 15vh. Borderless 1.25rem input on a hairline. Poster list with 40×60 thumbnails. Footer hints: `↑↓ navigate · ↵ open · esc close`.
- **[MODIFY] [src/components/BackupManagerModal.jsx](./src/components/BackupManagerModal.jsx)**
  - Restyled with `Modal`, `Tabs`, and `Button`. CSV, Letterboxd, and JSON import and export logic is unchanged.
- **[MODIFY] [src/components/ToastNotification.jsx](./src/components/ToastNotification.jsx)**
  - Top-center under the navbar, slides down 8 px, hairline border, `--sh-2`, `--z-toast: 90`.
- **[MODIFY] [src/components/ErrorBoundary.jsx](./src/components/ErrorBoundary.jsx)**
  - Restyled with tokens, a neutral icon, and a secondary retry button.

---

### Phase 4: Home, billboard & portal-based hover preview
*Commit: `feat(home): billboard hero + hover-preview rows`*

- **`HoverPreviewCard.jsx`** (integrated with [src/components/MovieCard.jsx](./src/components/MovieCard.jsx))
  - Portaled to `document.body`, `position: fixed`, `z-index: var(--z-hover)`.
  - Opens after a 250 ms dwell. Expands from the trigger rect to about 320 px (`scale: 1 → 1.05`).
  - 16 px viewport margins. Flips vertically when less than 300 px of space remains.
  - Closes on scroll, wheel, resize, route change, Escape, or pointer leave (150 ms grace).
  - Touch: 450 ms long-press.
- **[MODIFY] [src/components/MovieCard.jsx](./src/components/MovieCard.jsx)**
  - Variant API as in Section 3.2.
- **[MODIFY] [src/components/HeroBillboard.jsx](./src/components/HeroBillboard.jsx)**
  - Height `clamp(520px, 78vh, 720px)`, full-bleed backdrop.
  - `--hero-slide: 9s` drives auto-advance and a Ken Burns zoom (`scale: 1 → 1.06` over 9 s) with a 700 ms crossfade.
  - Pauses on hover, `:focus-within`, and `document.hidden`.
  - Backdrop fallback: blurred poster composition (`object-fit: cover`, `scale(1.25)`, `blur(48px) saturate(.9)`) under the scrims.
  - Content: "Featured" label, title at `--fs-hero`, meta row (brass star, year, runtime, genres), a two-line clamped overview with a "More" toggle, a white `Details` button, and a secondary `＋ / ✓ Vault` button.
- **[MODIFY] [src/components/MovieCarouselRow.jsx](./src/components/MovieCarouselRow.jsx)**
  - Native horizontal scroll, edge fade mask, hidden scrollbar, scroll-snap.
  - Quiet arrow buttons on row hover (`scrollBy(0.9 * clientWidth)`), and a `SectionHeader` with "See all →".
  - Reveal on scroll with `whileInView` (`once: true, margin: "-80px"`).
- **[MODIFY] [src/components/PosterImage.jsx](./src/components/PosterImage.jsx)**
  - Fixed 2/3 aspect ratio, `loading="lazy"`, `decoding="async"`, skeleton placeholder.
- **[MODIFY] [src/pages/DashboardPage.jsx](./src/pages/DashboardPage.jsx)**
  - Consistent section gaps and catalogue rows.

---

### Phase 5: Vault page & analytics
*Commit: `feat(vault): compact analytics + menu-based filters`*

- **[MODIFY] [src/pages/VaultPage.jsx](./src/pages/VaultPage.jsx)**
  - Top-right `⋯ Manage` menu (Portability, "Select titles", Clear).
  - Genre multi-select menu showing the active count and a clear option.
  - Sort menu.
  - Grid view uses `MovieCard variant="grid"`. List view uses `WatchedMoviesList`.
  - Search input, 320 px max width.
- **[MODIFY] [src/components/VaultBanner.jsx](./src/components/VaultBanner.jsx)**
  - One-row header: H1 "My Vault", a meta line (for example, `115 films · 237h 27m · ★ 8.1 avg`), and a taste tagline.
  - Underline `Tabs` for Watched (count) and Plan to Watch (count), with `layoutId="vault-tabs"`.
- **Analytics (in `VaultBanner.jsx` and `VaultPage.jsx`)**
  - Four-cell `StatCell` strip: total watched, screen time, average rating vs IMDb, top genre.
  - Collapsible `Accordion` "Insights": 6 px flat rating distribution bars and trivia items.
  - Metrics from `WatchedSummary.jsx` are folded in.
- **[MODIFY] [src/components/WatchedMoviesList.jsx](./src/components/WatchedMoviesList.jsx)**
  - Replaces the legacy `MovieList.jsx`. 40×60 thumbnail rows with a subtle `--surface-1` hover.
- **[MODIFY] [src/components/VaultBulkBar.jsx](./src/components/VaultBulkBar.jsx)**
  - Solid `--surface-2` floating bar with a hairline border, `--sh-3`, and slide-up entry.
  - Actions are disabled until at least one item is selected. Exit with Cancel or Escape.
- **[MODIFY] [src/components/RandomPicker.jsx](./src/components/RandomPicker.jsx)**
  - Restyled with tokens. No emoji chips.

---

### Phase 6: Recommendations & AI chat
*Commit: `feat(ai): editorial recommendation list + calm chat`*

- **[MODIFY] [src/pages/AIPage.jsx](./src/pages/AIPage.jsx)**
  - Header: H1 "Recommended for You", a micro line (`Powered by Gemini · N films synced`), and a refresh `IconButton`.
  - Underline `Tabs`: Picks | Chat, with `layoutId="ai-tabs"`.
  - Ambient colored blobs removed.
- **[MODIFY] [src/components/MovieRecommendations.jsx](./src/components/MovieRecommendations.jsx)**
  - Ranked list rows:
    - Outlined rank numeral (`01`, `02`, `03`) in `--text-3`.
    - 100×150 poster thumbnail.
    - H3 title and meta line: match percentage (`--match`, weight 600) when a score is present, IMDb rating, year, genres.
    - AI explanation with a 2 px brass left border.
    - Actions: `＋ Vault` (secondary, small), `Details` (ghost, small), and `⋯` menu.
    - Under 640 px: 96 px poster, rank as a micro label above the title, three-line clamped explanation, icon-only actions.
  - Controls: Mood single-select menu (text labels, no emoji), Sort menu, a quiet refresh button for stale results, and `ModelUsageBadge` showing the active or cached Gemini model or `Local Ranker (Offline Fallback)`.
  - Taste profile: collapsed `Accordion` "Why these picks?" with flat brass-on-surface bars.
- **[MODIFY] [src/components/AIChat.jsx](./src/components/AIChat.jsx)**
  - Centered 720 px column. User bubbles on `--surface-2`, assistant bubbles on `--surface-1` with a hairline border. Active model status bar (`.chat-model-bar`) and a per-reply model pill.
  - Three-dot typing indicator and a primary send `IconButton`.

---

### Phase 7: Movie details & feedback states
*Commit: `style(details): restyle movie page + feedback states`*

- **[MODIFY] [src/components/MovieDetails.jsx](./src/components/MovieDetails.jsx) & [src/pages/MoviePage.jsx](./src/pages/MoviePage.jsx)**
  - Hero backdrop with scrim, title at `--fs-hero`, brass rating badges, and action buttons.
- **[MODIFY] [src/components/StarRating.jsx](./src/components/StarRating.jsx)**
  - Brass stars (`--accent`), clear hover states, no glow shadows.
- **[MODIFY] [src/components/Loader.jsx](./src/components/Loader.jsx), [ErrorMessage.jsx](./src/components/ErrorMessage.jsx), [EmptyState.jsx](./src/components/EmptyState.jsx)**
  - Use `Skeleton.jsx` for loading and neutral, quiet feedback states.

---

### Phase 8: Motion & performance
*Commit: `perf: motion system + lazy media + content-visibility`*

- Honor `prefers-reduced-motion: reduce`:
  - Disable the Ken Burns zoom and hero auto-advance.
  - Limit reveals to opacity fades of 150 ms or less, with no transforms.
  - Skip count-up animations.
- Apply `content-visibility: auto` and `contain-intrinsic-size: 1px 320px` to carousel rows.
- Hover previews should not cause layout shift (target CLS of 0).
- Memoize list rows and poster components.

---

### Phase 9: Accessibility, QA & cleanup
*Commit: `docs: refresh README for redesign`*

- **Dead code cleanup:** remove unreferenced legacy files (`src/components/Box.jsx`, `src/components/Search.jsx`, `src/components/NumResults.jsx`, `src/components/WatchedSummary.jsx`).
- **[MODIFY] [README.md](./README.md):** document the redesign, the design tokens, and the navigation hierarchy.

---

## 5. Verification & Acceptance Criteria

### Build and code audits

1. **Production build** (must exit 0 with no errors):
   ```bash
   npm run build
   ```
2. **Token purity audit** (should return no hits, except the whitelisted cases noted):
   - `git grep -nE "#38bdf8|sky-[0-9]|cyan" -- src/` → no hits.
   - `git grep -nE "border-radius:\s*(9999px|50%)" -- src/` → only progress segments and typing dots.
   - Emoji check in JSX strings → only the match-reason badge strings defined in the ranker (Section 6), and nothing else.

### Performance, motion & layout

1. **Hover preview and scroller:**
   - The preview is never clipped at a viewport edge.
   - Row scroll, edge mask, and snap are unaffected while a preview is open.
   - CLS measured at 0 during hover previews.
2. **Responsive breakpoints:** checked at 360, 768, 1280, and 1920 px with no horizontal overflow.
3. **Reduced motion:** with the preference set, Ken Burns zoom and auto-advance are disabled and transforms are removed.
4. **Keyboard and accessibility:**
   - Skip link present.
   - `aria-current="page"` on the active nav link.
   - `Menu` and `Modal` manage focus and return it to the trigger on close.
   - Core flows work end to end: ratings, notes, bulk operations, Letterboxd CSV and JSON import and export, random picker, and AI picks and chat.

---

## 6. Post-Overhaul Recommender Changes (v4.0–v4.2)

The design tokens and layout rules from Sections 1–5 are unchanged. The following are the recommender and data-layer changes that were made afterward.

- **Deterministic match scores and badges ([MovieRecommendations.jsx](./src/components/MovieRecommendations.jsx), [rankerService.js](./src/services/rankerService.js)):**
  - Match percentages (50–99%) come from the local logistic ranker, not from the LLM.
  - Up to three match-reason badges appear in each row's metadata: `🧬 High Taste-Twin Match`, `🎬 Favorite Filmmaker`, `🎯 Core Theme Match`, `💎 Personal Cult Pick`, `🎪 Genre Bullseye`, `⭐ Critical Acclaim`. Line clamping on mobile is preserved.
- **Collaborative map and five-bucket retrieval ([embeddingService.js](./src/services/embeddingService.js), [tmdbService.js](./src/services/tmdbService.js)):**
  - `/models/item_embeddings_f16.bin` (CVEM v1, 25,000 × 64) is loaded once per session.
  - Vault-relative weight cutoff (`1e-6 * maxAbsWeight`), up to four Spherical K-Means personas blended with a 64×64 ridge fold-in, repulsion maps for disliked films, `catalog-max` normalization of collaborative similarity with smoothstep damping, Bucket E neighbors, and Bucket D recent releases in an 18-month window with two reserved shortlist slots.
- **Hardened CSV pipeline ([csvImport.js](./src/services/csvImport.js)):**
  - Used by [BackupManagerModal.jsx](./src/components/BackupManagerModal.jsx), [MovieCard.jsx](./src/components/MovieCard.jsx), and [VaultPage.jsx](./src/pages/VaultPage.jsx). Covers `Watched Date` priority over `Date`, calendar rollover rejection, bulk-import clustering (`isBulkImported`), and rewatch deduplication.
- **Gemini cascade ([geminiService.js](./src/services/geminiService.js), [geminiChatService.js](./src/services/geminiChatService.js), [geminiExplanationService.js](./src/services/geminiExplanationService.js)):**
  - Curation uses the high-thinking model with a 35 s timeout. Chat and mood parsing use the fast cascade. Error-specific cooldowns, a 30-minute working-model memory in `localStorage`, and ranker fallback when every cloud model fails.
- **Test suite ([tests/](./tests)):**
  - Run `npm test` for the current count and results. The suite covers the service and API layers as described in the README and ARCHITECTURE.md.

---

## 7. v4.3–v5.2 Feature Set

These features build on the same neutral token system. Brass stays limited to stars and active states. No purple or cyan glows are reintroduced.

### 7.1 Navigation & global modal hub ([NavBar.jsx](./src/components/NavBar.jsx), [navHelpers.js](./src/services/navHelpers.js), [App.jsx](./src/App.jsx))
- **Primary routes:** `Discover` (`/`), `Explore` (`/explore`), `Vault` (`/vault`), and `Oracle` (`/ai`). Search opens with `⌘K` / `Ctrl K`, or `/` outside text fields. `/compare`, `/movie/:id`, and `/person/:id` are reached from within the app.
- **Library menu:** Taste Calibration (30), Import / Export Ratings, Pick Random Film, and Cloud Sync. The Cloud Sync label is one of `Local Backup`, `Cloud Sync`, `Syncing...`, or `Synced` (`getCloudSyncBadgeLabel`). The Watchlist entry shows a tabular count (`formatVaultNavCount`).
- **Global modals and dock (`App.jsx`):** `SearchModal`, `RandomPicker`, `BackupManagerModal`, `QuickRateModal`, `TasteDeckModal`, `CloudSyncModal`, `CompareDock`, and `CompareModal` are managed in one place so they behave the same from any route.

### 7.2 Discover hub & genre mosaic ([DashboardPage.jsx](./src/pages/DashboardPage.jsx), [dashboardService.js](./src/services/dashboardService.js), [HomePosterGrid.jsx](./src/components/HomePosterGrid.jsx))
- **Unwatched spotlights and rows:** `loadHomeDiscoveryFeeds` fills `HeroBillboard` (`buildHeroSlides` rejects placeholder images and normalizes `w1280` backdrops) and TMDB carousels. Titles already in the vault or watchlist are excluded across all rows (`excludeSeenAndPlaced`, `buildSeenCollisionSet`). Offline or unconfigured, the page shows `FALLBACK_ROWS`.
- **All Films grid:** `HomePosterGrid` shows genre tabs and 24 posters at a time (`collectCatalogMosaic`), with paging and `QuickRateModal` from each poster.

### 7.3 First-visit taste deck & rating tiers ([TasteDeckModal.jsx](./src/components/TasteDeckModal.jsx), [tasteDeckService.js](./src/services/tasteDeckService.js), [QuickRateModal.jsx](./src/components/QuickRateModal.jsx), [ratingTiers.js](./src/services/ratingTiers.js))
- **Auto-open:** `TasteDeckModal` opens in grid mode on a first visit when `watched.length < 3` and `cinemavault_taste_onboarding_dismissed_v1` is not `"true"`. It can always be opened from the menu. Dismissing it, or pressing Escape, prevents it from opening again.
- **Deck:** 30 films interleaved across genres (`CORE_TASTE_DECK`, topped up from a live TMDB pool when available). Films already watched are excluded by IMDb ID, TMDB ID, or normalized `title::year`.
- **Rating tiers:** `RATING_TIERS` (10★ "Masterpiece" down to 1★ "Severe Dislike") is shared by `QuickRateModal` and `TasteDeckModal`. `prepareQuickRatePayload` and `prepareWatchlistPayload` never add a rating that the user did not give.
- **Quick review tags ([quickReviewTags.js](./src/services/quickReviewTags.js)):** shared praise and critique chips (`QUICK_REVIEW_TAGS`, `getContextualQuickTags`, `hasQuickTagInNote`, `toggleQuickTagInNote`) used in `QuickRateModal` (200-character limit) and `MovieDetails.jsx`.

### 7.4 Vault analytics & Schema v2 portability ([VaultBanner.jsx](./src/components/VaultBanner.jsx), [vaultStats.js](./src/services/vaultStats.js), [BackupManagerModal.jsx](./src/components/BackupManagerModal.jsx), [vaultPortability.js](./src/services/vaultPortability.js))
- **Rating histogram:** `buildRatingHistogramBins` counts every whole-star bin from 1★ to 10★, including low ratings.
- **Schema v2 JSON:** `buildBackupJsonPayload` writes `{ schemaVersion: 2, app: "CinemaVault", exportedAt, watched, watchlist, preferences: { userRegion, userWatchProviders, tasteRules } }`. Files without `preferences.tasteRules` still import. An empty `tasteRules` array clears rules in Replace mode.
- **CSV:** full CinemaVault columns and a Letterboxd-style 10-point export with a review column (`buildRatingsCsv`).
- **Diff preview:** `summarizeImportDiff` lists added watched entries, updated ratings, new watchlist entries, and skipped duplicates before any change is applied. It supports Merge & Update, Add New Only, and Replace Vault. Cross-ID duplicates (`tmdb_<id>` vs `tt...`, matched with `isSameMovie`) are merged without losing watch dates or metadata.
- **No invented ratings:** `resolveCsvRowFallbackRecord` leaves unrated rows at 0. `triggerFileDownload` revokes object URLs after export.
- **Background TMDB backfill ([tmdbService.js](./src/services/tmdbService.js), [AppContext.jsx](./src/context/AppContext.jsx)):**
  - Runs 800 ms after mount, with `maxItems: 40` and `maxLookups: 15`. Checked keys are stored in `cinemavault_tmdb_backfill_checked_v1`.
  - Resolves missing TMDB IDs through IMDb `/3/find`, then strict title and year (±1 year).
  - Skips TV series (`isSeriesVaultItem`, TMDB `tv_results`).
  - Keeps `"N/A"` posters as they are. Stops on HTTP 429.
  - Adds metadata (cast, writers, tagline, origin country, spoken languages, MPAA rating, runtime, keyword names, collection ID and name, overview fallback) without overwriting `userNote`.
  - `addWatched` also hydrates newly rated films in the background.

### 7.5 Cross-ID identity & search ([movieIdentity.js](./src/services/movieIdentity.js), [searchService.js](./src/services/searchService.js), [SearchModal.jsx](./src/components/SearchModal.jsx))
- **`isSameMovie`, `upsertMovieEntry`, `removeMovieEntries`:** a single identity layer for `imdb:`, `tmdb:`, `rawid:`, and `ty:<title>::<year>` keys across `AppContext`, `dashboardService`, and `MovieRecommendations`. Films with the same title and year are not merged when their IMDb or TMDB IDs differ.
- **Search:** OMDb and TMDB queries run in parallel through `apiTransport.js`, with `AbortController` and request sequencing so stale responses are ignored. Results show Vault and Watchlist status and a `QuickRateModal` shortcut.

### 7.6 Cloud sync ([CloudSyncModal.jsx](./src/components/CloudSyncModal.jsx), [supabaseClient.js](./src/services/supabaseClient.js), [vaultSyncService.js](./src/services/vaultSyncService.js))
- **Local-first:** with no Supabase configuration, `CloudSyncModal` says the app is in local guest mode. Nothing else changes.
- **Sign-in:** email magic link. The modal shows the account email, last sync time, a status (`Syncing...`, `Synced`, `Sync Error`), watched and watchlist counts, a manual sync button, and sign-out. Sign-out keeps all films in local storage.
- **First sign-in:** guest entries are merged into Postgres (`profiles`, `user_vault_items`, under RLS) with `mergeLocalAndCloudVault`.

### 7.7 Oracle controls, Match Vibe, taste rules, and the 10-pick list ([MovieRecommendations.jsx](./src/components/MovieRecommendations.jsx), [moodPolicy.js](./src/services/moodPolicy.js), [tasteRulesService.js](./src/services/tasteRulesService.js), [oracleViewHelpers.js](./src/services/oracleViewHelpers.js))
- **Setup panel:**
  - Mood grid: Any Vibe, Mind-Bending, Dark Thriller, Fun Popcorn, Comfort Watch, Hidden Gem.
  - Free-text "Match Vibe" (for example, "like Drive but quieter"), parsed by Gemini when available and by the offline parser otherwise (`formatActiveVibeNote` shows the result).
  - "Where to watch" region selector and provider list, with alias expansion (`PROVIDER_FAMILY_MAP`).
  - "Taste Rules" drawer, stored in `cinemavault_taste_rules_v1` outside the quota purge order. Supports auto-drafting from the vault (with an offline fallback that keeps pinned rules), up to eight Prefer or Avoid rules, inline editing, pinning, pausing, and deleting.
  - "Find Picks" / "Update Picks" and "Start over". Closing the "Mood & Streaming" drawer refreshes the picks if the settings have changed (`shouldAutoRefreshOnDrawerClose`).
- **Results:**
  - Up to 10 rows, served from `cinemavault_smart_cache_v4` when at least 7 valid picks remain. The cache key includes region, filters, a hash of notes, and a hash of taste rules.
  - The percentage badge appears only when a score is present and the scores vary by at least 4 points. Ties and fallbacks show no number.
  - Each row has: explanation text (`sanitizeOracleReason`), "Because you rated" links (`resolveRecommendationAnchors`, up to three), streaming availability, an "About these picks" panel (`formatRecBadgeSummary`), a trailer link, Add to Watchlist, "Already seen" (opens `QuickRateModal`), and "Not for me" with reasons (Too slow, Not my genre, Predictable).
  - Refresh rotates through unseen candidates (`nextRefreshExcludeState`: up to 120 seen IDs, TMDB pages 1–5). When results run short, the list is padded from the ranked pool.
  - When a strict mood leaves too few matches, a `moodShortfall` notice appears with a "Widen vibe & filters" action.
- **Prompt context** (`buildGeminiReRankPrompt`): taste summary (`userStats`, `topDirectors`), anchors with `[Series]` tags and notes, dislikes and dismissed titles, recent watches, near misses (6–7★), watchlist (up to 8), extra favorites (ranks 11–25), loved series and anime, all remaining viewer notes, and taste rules (never trimmed). Candidates are a 39-title shortlist with cast, themes, tagline, collection, and plot, but no match percentages or rank numbers. The prompt is capped at 20,000 characters.
- **Franchise rule:** at most one film per collection, and no numbered sequel unless an earlier entry is in the vault.
- **Wildcards:** Gemini may propose up to two extra titles. Each one is checked against TMDB, the vault and watchlist, the streaming filter, the mood gate, and avoid-rules before it is shown.
- **Variety caps:** at most two picks per director and one per collection, relaxed only if needed to fill the list.

### 7.8 Serverless proxies, filmography, and tests ([api/*.js](./api), [apiTransport.js](./src/services/apiTransport.js), [personService.js](./src/services/personService.js), [tests/](./tests))
- **Filmography:** clicking a cast member or crew credit (Director, Writers, Cinematography, Score) opens `PersonFilmographyModal` (below `QuickRateModal` in stacking order). It shows department tabs, status filters, sorting, Save, and Rate, and links to `/person/:id?dept=<tab>`.
- **Proxies:** `/api/gemini`, `/api/tmdb`, `/api/tmdb-batch`, and `/api/omdb` in production. `api/tmdb.js` allows the person, keyword, collection, recommendation, and similar-film paths listed in ARCHITECTURE.md. Direct `VITE_*` keys still work for local development.
- **Tests:** `npm test` runs the `node --test` suites in `tests/`. Use its output for the current count.

### 7.9 Rating studio & "Discuss This Film" ([ratingStudioService.js](./src/services/ratingStudioService.js), [StarRatingStage.jsx](./src/components/StarRatingStage.jsx), [filmChatService.js](./src/services/filmChatService.js), [MovieDetails.jsx](./src/components/MovieDetails.jsx), [AIChat.jsx](./src/components/AIChat.jsx), [AIPage.jsx](./src/pages/AIPage.jsx))
- **Ascending 10-bar cinema fader:** interactive 1–10 equalizer-style bar stage with editorial tier color grading, rolling serif score readout, pointer hover preview, and explicit click-to-lock (`Select Rating (1–10)` → `Save X/10 to Vault`).
- **Live calibration:** as the user hovers or locks a score, `computeVaultCalibration` shows their percentile in the vault and a fixed-height two-column strip of up to two films rated the same score (or the nearest score), each linking to its page.
- **Optional details (progressive disclosure):** clicking tags/details expands Quick Review Tags, Craft Breakdown (story, direction, performances, visuals and sound; 1–5 each), Review Note, and Watch Log (format, custom date, rewatch count, spoiler flag). Clearing a field stores a `null` marker (`buildWatchedRatingPayload({ markCleared: true })`) so an older copy from the cloud does not bring it back.
- **Discuss This Film:** from the movie hero or the rating footer, the film is cached in `sessionStorage` (keyed by IMDb ID and TMDB ID) and the app opens `/ai?tab=chat&movie=<key>&tmdbId=<id>&title=<title>`. `AIPage` loads the film from the vault, watchlist, cache, or TMDB/OMDb.
- **Chat context bar:** shows the film and a spoiler toggle. Spoilers are protected by default for unwatched films and allowed for watched ones. Four starter prompts (`buildMovieChatStarterPrompts`). The film dossier is sanitized (`sanitizeLine`) before it goes into the prompt.

### 7.10 Explore workbench & related titles ([ExplorePage.jsx](./src/pages/ExplorePage.jsx), [exploreService.js](./src/services/exploreService.js), [exploreForYouService.js](./src/services/exploreForYouService.js), [SearchModal.jsx](./src/components/SearchModal.jsx), [rabbitHoleService.js](./src/services/rabbitHoleService.js), [CollectionTimeline.jsx](./src/components/CollectionTimeline.jsx), [SimilarFilmsStrip.jsx](./src/components/SimilarFilmsStrip.jsx))
- **URL-synced filters & title/franchise search:** the query string holds the search query (`q`), filters (genres with AND or OR, excluded genres, years and decade presets, runtime presets, minimum rating, minimum votes (150 or more when sorting by rating), language, country, keyword and person search, providers, sort, and hide-watched). Built with `URLSearchParams`, so keywords are not double-encoded. SearchModal bridges directly to `/explore?q=...` via `"View all in Explore"` (`Shift+Enter`).
- **Stable loading:** `deriveExploreViewState` avoids showing stale results during a filter change. If a later page fails, the loaded results stay visible with a retry banner. With hide-watched on, auto-advance goes up to page 3 when page 1 is entirely watched. Active filters appear as removable chips.
- **Related on the movie page:** clicking a genre or keyword opens `/explore` with that filter. When the film belongs to a collection, `CollectionTimeline` lists the installments in release order (`TBA` last) with the current film marked and a watched count. `SimilarFilmsStrip` merges local 64-D vector neighbors with TMDB `/recommendations` (or `/similar` when there are fewer than four results) and tags each card by source.

### 7.11 Compare workbench ([compareService.js](./src/services/compareService.js), [CompareDock.jsx](./src/components/CompareDock.jsx), [CompareModal.jsx](./src/components/CompareModal.jsx), [CompareWorkbench.jsx](./src/components/CompareWorkbench.jsx), [ComparePage.jsx](./src/pages/ComparePage.jsx))
- **Tray:** up to three films. Stored in `sessionStorage` under `cinemavault_compare_v1`, deduplicated across IMDb and TMDB IDs (`toggleCompareItem`). Compare buttons appear on cards, the movie page, similar-film cards, and explore results.
- **Dock:** a floating bar at the bottom right, with poster thumbnails, a slot counter, a quick modal, a link to the full workbench, and Clear. It moves up when the bulk-action bar is visible.
- **Hydration:** `hydrateCompareMovieSlot` loads each film from TMDB and OMDb in parallel. It handles partial data when one source is down and shows an error card for films that cannot be found.
- **Matrix:** `buildCompareMatrix` marks the best value per row, with ties shown as shared. Rows: IMDb, Rotten Tomatoes (0% kept as a real value), Metascore (0 kept), TMDB, shortest runtime, budget, box-office revenue, ROI, your score and note, 64-D taste match (`vaultMatchPct`), and streaming availability in the selected region.
- **Overlap:** shared cast and crew (linked to filmographies), shared genres and keywords (linked to `/explore`), and pairwise 64-D similarity bars (`computeCompareOverlap`).
- **URLs:** `/compare?ids=...` works without the tray. Films can be added or removed in URL mode (`addUrlCompareSlot`, `removeUrlCompareSlot`), and the URL can be copied to share.

---

## 8. v5.3 UX Overhaul & Editorial Primitives

### 8.1 Editorial Dark `<Select>` Primitive ([Select.jsx](./src/components/ui/Select.jsx), [selectHelpers.js](./src/services/selectHelpers.js))
- Replaces all 9 OS-native `<select>` controls across Explore, Vault, Oracle, Cloud Sync, and Person filmography views (`0` native `<select>` elements remain in `src/`).
- Portaled dark-glass listbox (`document.body`) with full keyboard navigation (`ArrowUp`, `ArrowDown`, `Home`, `End`, `Enter`, `Space`, `Escape`), outside `pointerdown` dismiss, `maxWidth: calc(100vw - 24px)`, and post-mount viewport re-measurement so menus never clip on `390px` mobile screens.

### 8.2 Opt-In Smooth Horizontal Row Scrolling ([scrollHelpers.js](./src/services/scrollHelpers.js), [useHorizontalWheelScroll.js](./src/hooks/useHorizontalWheelScroll.js))
- Applied across `MovieCarouselRow`, `SimilarFilmsStrip`, and `CollectionTimeline`.
- Plain vertical wheel scrolling never hijacks page scroll. Users opt in by clicking the subtle **"Scroll row"** pill, clicking the row border/surface, or holding `Shift + Wheel` to smoothly glide via damped `requestAnimationFrame` lerp (`computeWheelTargetScrollLeft`, `stepSmoothScroll`).
- Active row-scroll mode auto-releases on `pointerleave`, outside `pointerdown`, or `Escape`.

### 8.3 Decluttered 2-Tier Film Oracle Studio ([MovieRecommendations.jsx](./src/components/MovieRecommendations.jsx), [OraclePreferencesPopover.jsx](./src/components/OraclePreferencesPopover.jsx), [oracleViewHelpers.js](./src/services/oracleViewHelpers.js))
- **Tier 1 — Sliding Mood Pill Rail:** Single-row compact horizontal rail with a Framer Motion `layoutId="oracle-mood-pill"` active indicator (`Any Vibe`, `Mind-Bending`, `Dark Thriller`, `Fun Popcorn`, `Comfort Watch`, `Hidden Gem`).
- **Tier 2 — Unified Vibe Command Bar:** Single compact row combining the free-text vibe input, **"Filters & Rules"** popover trigger (with live `summarizeOraclePreferences` badge), and primary **"Find Picks"** action.
- **Unified Preferences Popover / Mobile Sheet (`OraclePreferencesPopover.jsx`):** Consolidates **Where to watch** (region + streaming platforms), **Taste Rules** (list, add/edit/pin/pause, Auto-Draft), and **Personal AI Key** (`cv_user_gemini_key`) into a tabbed desktop popover (`<= 640px` renders as a bottom sheet).

### 8.4 Zero-Shift Explore `"Movies You'll Like"` Workbench ([ExplorePage.jsx](./src/pages/ExplorePage.jsx), [exploreForYouService.js](./src/services/exploreForYouService.js))
- Dedicated 2-band `.explore-mode-toolbar` anchors the `[All Catalog | Movies You'll Like]` segmented toggle on the left while `Shuffle`, `Refresh`, and Sort live on the right (`0px` horizontal toggle shift when switching modes).
- Renders a **~250-film** math-powered personalized pool immediately via `onPreliminaryReady` (with deterministic editorial vibe tags) while 1 single Flash-Lite pass refines the top 100 flagship picks in the background.
- Supports instant zero-API client-side Deep Filtering, quality-weighted **Shuffle** (auto-resetting `sortBy: "for_you"`), and 60fps `48`-card incremental pagination (`"Show More Matches"`).

### 8.5 Dynamic Motion & Movie Detail Poster Entrance ([ScrollRevealSection.jsx](./src/components/ScrollRevealSection.jsx), [Tabs.jsx](./src/components/ui/Tabs.jsx), [HeroBillboard.jsx](./src/components/HeroBillboard.jsx), [MovieDetails.jsx](./src/components/MovieDetails.jsx))
- **Movie Detail Poster Entrance:** Replaced the legacy imperative `document.body` `posterFlight.js` ghost clone (which could hang over loading/Metacritic cards and leave `.netflix-modal-poster-wrap` stuck at `opacity: 0` under React 18 StrictMode) with a direct GPU Framer Motion entrance on `.netflix-modal-poster-wrap`.
- **Site-Wide Motion:** Added `ScrollRevealSection` (`viewport={{ once: true, amount: "some" }}`), spring `layoutId` tab underlines in `Tabs.jsx`, pause-aware Ken Burns ambient drift in `HeroBillboard.jsx`, tactile poster hover specular highlight, and GPU `scaleX`/`scaleY` Vault Insights bars — all honoring `prefers-reduced-motion`.

### 8.6 v5.4 Editorial Auth & Account Studio ([AuthPage.jsx](./src/pages/AuthPage.jsx), [AccountPage.jsx](./src/pages/AccountPage.jsx), [NavBar.jsx](./src/components/NavBar.jsx))
- **Routes:** `/auth`, `/login`, `/signup`, and `/account` (all lazy-loaded with route-scoped `src/styles/auth.css`).
- **Guest-First UX:** Top-right NavBar shows a compact `Sign In` pill for guests (or avatar initial + sync status dot when signed in). `/auth` supports Email + Password sign-in/sign-up, Magic Link, Forgot/Reset Password (with cancel escape hatch), guest vault merge summary, and an explicit **"Continue as Guest"** button. `/account` provides Display Name editing, manual Sync Now, Change Password, and **"Sign Out (Keep Local Copy)"** vs **"Sign Out & Clear Browser Data"**.
- **Progressive Explore Status:** `/explore?mode=for-you` renders instant stale-while-revalidate results or Wave 1 poster cards in ~1–3s while displaying a non-blocking progressive stage note (`"Expanding library…"`, `"Polishing top picks with AI…"`).

### 8.7 v5.5 Taste Match, Film Oracle Tonight's Concierge, Background Roaming & Community Profiles
- **Film Companion Layout:** Centered `92rem` chat container; watched Vault references render as compact inline chips while unseen suggestions render as actionable poster cards.
- **Universal `"For You"` Match:** Compact Match `%` + calibrated `Est. X.X/10` tile on Movie Detail pages and Match `%` pills on indexed unseen Search results; Discover's `"Picked For Your Taste"` row mirrors the user's real `"Movies You'll Like"` pool.
- **Flagship Film Oracle Concierge:** 4 Tonight Starter Cards (including an instant `$0.00` Watchlist Tonight ranker), full-bleed `#1 Top Pick Tonight` Spotlight hero, and non-blocking corner job banner + `"View →"` completion toast so users can freely browse the site while curation finishes.
- **Opt-In Community Mode:** Private-by-default toggle in `/account`, lazy `/u/:username` profile page with route-scoped `community.css` (Top 4 Showcase, 64-D Taste Twin %, Unseen Favorites, Rating Histogram, Spoiler-Safe Watch Diary), and CinemaVault Community ratings/reviews on Movie Detail pages.

### 8.8 v5.6 Cinema Rating Fader, Explore Title Search & UI Overhaul
- **Ascending 10-Bar Rating Studio:** Replaced the star row in [StarRatingStage.jsx](./src/components/StarRatingStage.jsx) with an ascending 10-bar cinema fader (`getEditorialScorePalette`), rolling serif score readout, explicit lock-on-click confirmation (`Select Rating (1–10)` → `Save X/10 to Vault`), fixed-height 2-column calibration strip, and progressive review disclosure.
- **Explore Title/Franchise Search & SearchModal Bridge:** Added unified `?q=` title and franchise search across both `"All Catalog"` ([exploreService.js](./src/services/exploreService.js)) and `"Movies You'll Like"` ([exploreForYouService.js](./src/services/exploreForYouService.js)), linked directly from [SearchModal.jsx](./src/components/SearchModal.jsx) (`"View all in Explore"` / `Shift+Enter`).
- **Visual Polish & Container Alignment:** Upgraded motion, card transitions, and hierarchy across `HeroBillboard`, `MovieCarouselRow`, `MovieCard`, `VaultBanner` (`Rating Spread` sparkline), `OracleTopPickSpotlight`, `AIChat`, `BackupManagerModal` CSV onboarding tips, and `MovieCommunitySection` container spacing in [community.css](./src/styles/community.css).

### 8.9 v6.0–v6.1 20-Pick 2-Column Editorial Oracle, EASE^R + SVD Engine & Neural Cold-Start Embeddings
- **20 Curated Picks (`100 → 20`):** Stretched Oracle recommendations from `10 → 20` (`DEFAULT_RECOMMENDATION_COUNT = 20`, `MIN_VALID_CACHE_COUNT = 14`) backed by a `100`-candidate stratified shortlist, the **Exact Sparse EASE^R + SVD (`60/40`)** on-device engine (`easeService.js` + `item_ease_k64.cvea`), and **`v6.1` `11,119 × 128-D` Neural Semantic Embeddings** (`public/models/content_embeddings_f16.bin`, `coldOnly: true`, `+26.7%*` cold-start `NDCG@10` for `2024–2026` releases; full benchmarks & rejected hypotheses in [MODEL_REFINEMENT_LOG.md](./MODEL_REFINEMENT_LOG.md)).
- **Refined 2-Column Editorial Card Grid ([MovieRecommendations.jsx](./src/components/MovieRecommendations.jsx), [OracleTopPickSpotlight.jsx](./src/components/OracleTopPickSpotlight.jsx), [oracle.css](./src/styles/oracle.css), [oracleViewHelpers.js](./src/services/oracleViewHelpers.js)):**
  - Keeps `#01` as the full-bleed `OracleTopPickSpotlight` hero and renders `#02–#20` in an elevated 2-column desktop card grid (`repeat(2, minmax(0, 1fr))`, collapsing to `1fr` at `<= 960px`) with floating rank badges, green match pills, director metadata (`Dir. ...`), grounded 2-sentence `"Why this pick"` editorial blocks (`buildDetailedOracleExplanation` with verified TMDB overview fallback), compact anchor chips, and bottom-aligned card actions.

---

### 8.10 GameVault (`Movies ⇄ Games` Unified Shell, Editorial Polish & Rig-Aware Surfaces)
- **Mode Switcher & Dynamic Shell ([NavBar.jsx](./src/components/NavBar.jsx), [navHelpers.js](./src/services/navHelpers.js), [nav-discover.css](./src/styles/nav-discover.css), [App.jsx](./src/App.jsx)):** Adds a segmented `Movies | Games` switcher (via `isGamesRoute(location.pathname)` and `getPrimaryNavDestinations("movies" | "games")`), swapping brand (`CinemaVault` ↔ `GameVault`), desktop + mobile tab bars, footer copy, and `Ctrl K` / `/` shortcut modal (`SearchModal` ↔ `GameSearchModal`). Intermediate tablet/laptop widths (`901px..1180px`) tighten navbar spacing cleanly with zero horizontal overflow.
- **5 Lazy-Loaded GameVault Views & Shared Primitives ([GameVaultApp.jsx](./src/games/GameVaultApp.jsx), [games.css](./src/games/styles/games.css)):** Shares CinemaVault's neutral dark + brass `--accent` / green `--match` design tokens with zero impact on the Movies entry bundle:
  - **Discover (`/games`):** Full-bleed `GameHeroBillboard` (single-row compact action bar, no scroll-parallax lag/clipping), `GameCarouselRow` with opt-in smooth horizontal scroll & sleek 7–8 poster desktop rows (`content-visibility: auto`), **Popular Blockbusters** & personalized ML rows, **Game Roulette** (`GameRouletteModal.jsx`), and a 3-step first-visit **Rig & Taste Onboarding Wizard** (`GameOnboardingModal.jsx` + `gameRigService.js`: platforms + auto WebGL GPU spec tier + 32 iconic starters).
  - **Explore (`/games/explore`):** `For You (ML)` vs `IGDB Catalog` (defaulting to high-review-floor `Most Popular` blockbusters), `< 1 ms` Neural Taste Tuner (`Intensity`, `Tone`, `Era`, `Familiarity`, `Break My Bubble`), `Hide Played` & `My Rig` compatibility chips, and `React.memo` `GameCard` tiles (`decoding="async"`, zero heavy per-card `backdrop-filter` blur).
  - **Vault (`/games/vault`):** Animated **Gaming DNA** charts (rating histogram, genre bars, platform split), `My Rig & Setup` trigger, duplicate-edition cleaner, Played/Backlog tabs, and Steam AppID / CSV / JSON portability.
  - **Oracle (`/games/oracle`):** `#01` Top Pick Spotlight + 2-column Gemini-curated grid (with locked local ML `matchScore`), mood chips, platform focus, and **Game Companion Chat** tab.
  - **Game Dossier (`/game/:id`):** Ascending 10-bar **Game Rating Studio** (`StarRatingStage` with `mediaNoun="game"`, 5-aspect craft breakdown, quick review tags, `100% Platinum`, dark `-`/`+` playtime stepper, portaled `<Select>` platform dropdown), collapsible IGDB storyline (`"Read full storyline →"`), screenshot lightbox, YouTube trailer modal, and hybrid `Similar Games`.
- Full ML architecture, mathematical formulas, and Movies-vs-Games differences live in **[GAMEVAULT_ML_GUIDE.md](./GAMEVAULT_ML_GUIDE.md)**.

---

*Design and implementation notes are kept in [docs/superpowers/](./docs/superpowers) for earlier versions.*