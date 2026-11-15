# Rating Studio 10-Star Cinema Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the boxy, emoji-heavy `1–10` number keypad in `MovieDetails` and `QuickRateModal` with a unified, tactile **10-Star Cinema Stage + Synchronized Light Track** (`StarRatingStage`) that synchronizes tier colors, wave-cascade star animations, and de-boxed calibration metadata.

**Architecture:** Extract pure star-wave and rail-fill math (`computeStarStageMetrics`) into `src/services/ratingStudioService.js` and enrich `src/services/ratingTiers.js` with vector-friendly `tone` and `shortLabel` fields while keeping existing properties backward-compatible. Build a reusable `<StarRatingStage />` component in `src/components/StarRatingStage.jsx` driven by CSS custom properties (`--tier-color`, `--tier-bg`, `--tier-border`, `--tier-glow`) and wire it into both `src/components/MovieDetails.jsx` and `src/components/QuickRateModal.jsx`.

**Tech Stack:** React 18, Lucide React SVG icons, CSS custom properties & keyframe/spring transitions, Node.js built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-15-rating-studio-star-stage-design.md`

## Global Constraints

- Do not alter `watched`, `watchlist`, `ratingBreakdown`, or `watchMeta` persistence schemas or Supabase sync behavior (`vaultSyncService.js`).
- Do not render OS emojis (`🏆`, `✨`, `🍿`, `👍`, `😐`, `📉`, `⚠️`, `🚫`, `⛔`, `💀`, `⭐`) in `StarRatingStage`, `MovieDetails` Rating Studio / Saved Vault Card, or `QuickRateModal`; use custom SVG stars and vector icons instead.
- All active stars, hover wave states, progress rail fills, and tick numerals must inherit `--tier-color` / `--tier-bg` / `--tier-border` from `getRatingTier(activeScore)` so the header and the `1–10` track never clash in color.
- Preserve WAI-ARIA `role="radiogroup"`, `role="radio"`, `aria-checked`, `aria-label="Rate N out of 10"`, roving `tabIndex`, and keyboard navigation (`ArrowRight`, `ArrowUp`, `ArrowLeft`, `ArrowDown`, `Home`, `End`).
- Must fit within the `340px` desktop sidebar (`MovieDetails.jsx`) and `390px` mobile viewport with zero horizontal overflow.

## Review Focus

1. **Unrated (`0` / `null`) vs. Hovered vs. Selected state transitions:** When `userRating === 0` and `hoverRating === 0`, `computeStarStageMetrics(0, 0)` returns `activeScore: 0`, `fillPercent: 0`, all 10 stars with `isFilled: false`, `isCurrent: false`, `isWaveNeighbor: false`, and roving `tabIndex: 0` on star `1` (`-1` on `2..10`).
2. **Hover-preview override and mouse-leave restoration:** When `userRating === 7` and the user hovers star `4` (`hoverRating === 4`), `activeScore` reflects `4` (`Flawed`, orange `#f97316`, `fillPercent: 40`, wave centered on `4` with neighbors `3` and `5`); when the pointer leaves (`hoverRating === 0`), `activeScore` immediately restores to `7` (`Good Watch`, cyan `#06b6d4`, `fillPercent: 70`).
3. **Boundary wave neighbors (`1` and `10`) and out-of-range inputs:** Selecting or hovering `1` marks only star `2` as `isWaveNeighbor: true`; selecting or hovering `10` marks only star `9` as `isWaveNeighbor: true`; clamping handles negative, fractional, or `> 10` inputs without throwing or producing `fillPercent > 100`.
4. **Saved Vault card & `QuickRateModal` emoji-free parity:** Saving a rating in `MovieDetails` switches to `.vault-saved-status-card`, which displays the score and tier label (`shortLabel`) with a vector star/emblem instead of `savedTier.icon` emoji; opening `QuickRateModal` renders `<StarRatingStage compact />` without OS emojis.
5. **Responsive `340px` sidebar & `390px` mobile layout integrity:** All 10 star buttons and `1..10` tick numerals fit inside a single row with `min-width: 0` and no horizontal scrollbar on both desktop (`1440x900`) and mobile (`390x844`).

---

### Task 1: Pure Star Stage Wave Metrics & Tier Metadata

**Files:**
- Modify: `src/services/ratingTiers.js:1-114`
- Modify: `src/services/ratingStudioService.js:1-90`
- Test: `tests/ratingStudioService.test.js`

**Interfaces:**
- Produces:
  - `getRatingTier(rating: number | null | undefined) -> { label: string, shortLabel: string, tone: string, icon: string, desc: string, color: string, bg: string, border: string, glow: string }` in `src/services/ratingTiers.js`
  - `computeStarStageMetrics(selectedRating: number | null | undefined, hoverRating?: number | null | undefined) -> { activeScore: number, selectedScore: number, hoverScore: number, isHovering: boolean, fillPercent: number, stars: Array<{ score: number, isFilled: boolean, isSelected: boolean, isCurrent: boolean, isWaveNeighbor: boolean, distance: number, staggerMs: number, tabIndex: 0 | -1 }> }` in `src/services/ratingStudioService.js`

- [ ] **Step 1: Write the failing test in `tests/ratingStudioService.test.js`**

```javascript
import { getRatingTier } from "../src/services/ratingTiers.js";
import { computeStarStageMetrics } from "../src/services/ratingStudioService.js";

test("computeStarStageMetrics computes unrated, selected, and hover-override wave states and roving tabIndex", () => {
  const unrated = computeStarStageMetrics(0, 0);
  assert.equal(unrated.activeScore, 0);
  assert.equal(unrated.fillPercent, 0);
  assert.equal(unrated.isHovering, false);
  assert.equal(unrated.stars.length, 10);
  assert.equal(unrated.stars[0].tabIndex, 0);
  assert.ok(unrated.stars.slice(1).every((s) => s.tabIndex === -1));
  assert.ok(unrated.stars.every((s) => !s.isFilled && !s.isCurrent && !s.isWaveNeighbor));

  // Selected 7/10, hover 4/10 overrides activeScore and centers wave on 4 (neighbors 3 and 5)
  const hovered = computeStarStageMetrics(7, 4);
  assert.equal(hovered.activeScore, 4);
  assert.equal(hovered.selectedScore, 7);
  assert.equal(hovered.isHovering, true);
  assert.equal(hovered.fillPercent, 40);
  assert.equal(hovered.stars[3].isCurrent, true); // score 4
  assert.equal(hovered.stars[2].isWaveNeighbor, true); // score 3
  assert.equal(hovered.stars[4].isWaveNeighbor, true); // score 5
  assert.equal(hovered.stars[5].isFilled, false); // score 6 not filled while hovering 4
  assert.equal(hovered.stars[6].isSelected, true); // score 7 retains selected marker & roving tabIndex
  assert.equal(hovered.stars[6].tabIndex, 0);

  // Boundary wave at 10/10 only marks 9 as neighbor and clamps out-of-range inputs
  const boundaryTen = computeStarStageMetrics(14, 0);
  assert.equal(boundaryTen.activeScore, 10);
  assert.equal(boundaryTen.fillPercent, 100);
  assert.equal(boundaryTen.stars[9].isCurrent, true);
  assert.equal(boundaryTen.stars[8].isWaveNeighbor, true);

  const tier7 = getRatingTier(7);
  assert.equal(tier7.shortLabel, "Good Watch");
  assert.equal(tier7.tone, "cyan");
  assert.equal(getRatingTier(10).shortLabel, "Masterpiece");
  assert.equal(getRatingTier(0).tone, "unrated");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ratingStudioService.test.js`
Expected: FAIL with `SyntaxError: The requested module '../src/services/ratingStudioService.js' does not provide an export named 'computeStarStageMetrics'`

- [ ] **Step 3: Implement `shortLabel` + `tone` in `src/services/ratingTiers.js` and `computeStarStageMetrics` in `src/services/ratingStudioService.js`**

In `src/services/ratingTiers.js`, add `shortLabel` (e.g. `"Masterpiece"` for `10`, matching `label` for `1..9` and `"Select Score"` for `UNRATED_TIER`) and `tone` (`10: "zenith"`, `9: "gold"`, `8: "emerald"`, `7: "cyan"`, `6: "violet"`, `5: "slate"`, `4: "amber"`, `3..1: "crimson"`, `UNRATED_TIER: "unrated"`).
In `src/services/ratingStudioService.js`, implement `computeStarStageMetrics(selectedRating, hoverRating)`:
- Clamp positive finite integers `selectedScore` and `hoverScore` into `0..10`; `activeScore = hoverScore > 0 ? hoverScore : selectedScore`.
- `fillPercent = activeScore * 10`.
- For each `score` in `1..10`: `distance = activeScore > 0 ? Math.abs(score - activeScore) : Infinity`, `isFilled = activeScore > 0 && score <= activeScore`, `isSelected = selectedScore > 0 && score === selectedScore`, `isCurrent = activeScore > 0 && score === activeScore`, `isWaveNeighbor = activeScore > 0 && distance === 1`, `staggerMs = isFilled ? (score - 1) * 18 : 0`, `tabIndex = (selectedScore > 0 ? score === selectedScore : score === 1) ? 0 : -1`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ratingStudioService.test.js`
Expected: PASS (`# fail 0`)

- [ ] **Step 5: Commit**

```bash
git add src/services/ratingTiers.js src/services/ratingStudioService.js tests/ratingStudioService.test.js
git commit -m "feat(rating): add computeStarStageMetrics wave math and tier tone metadata"
```

---

### Task 2: Reusable `StarRatingStage`, De-boxed Studio Deck & `QuickRateModal` Integration

**Files:**
- Create: `src/components/StarRatingStage.jsx`
- Modify: `src/components/MovieDetails.jsx:785-1005`
- Modify: `src/components/QuickRateModal.jsx:100-156`
- Modify: `src/index.css:3008-3230, 6960-7160`

**Interfaces:**
- Consumes:
  - `computeStarStageMetrics(selectedRating, hoverRating)` from `src/services/ratingStudioService.js`
  - `getRatingTier(rating)` from `src/services/ratingTiers.js`
- Produces:
  - `export default function StarRatingStage({ value, hoverValue, onChange, onHoverChange, calibration, onSelectAnchor, compact = false, titleLabel = "Rating Studio", ariaLabel = "Rate this film from 1 to 10" })` in `src/components/StarRatingStage.jsx`

- [ ] **Step 1: Create `src/components/StarRatingStage.jsx`**

Build `<StarRatingStage />` with:
- Root container `.star-rating-stage` (`is-compact` when `compact === true`, `has-score` when `activeScore > 0`) setting inline CSS variables `--tier-color: activeTier.color`, `--tier-bg: activeTier.bg`, `--tier-border: activeTier.border`, `--tier-glow: activeTier.glow`.
- **Hero Score Stage (`.star-stage-hero`):**
  - Left column: giant tabular score readout (`activeScore > 0 ? activeScore : "—"` + `/ 10`) paired with a sculpted SVG star crest (no OS emojis).
  - Right column: tier title (`activeTier.label`), tier description (`activeTier.desc`), and when `!compact && calibration?.summaryText`, an inline calibration pill (`calibration.summaryText`).
- **10-Star Wave Track (`.star-stage-track-wrap`):**
  - `div.star-stage-radiogroup[role="radiogroup"][aria-label={ariaLabel}]` with `onMouseLeave={() => onHoverChange?.(0)}`.
  - 10 `button.star-stage-btn[role="radio"]` elements driven by `metrics.stars`, with classes `is-filled`, `is-selected`, `is-current`, `is-wave-neighbor`, inline `--stagger-ms: ${star.staggerMs}ms`, keyboard handler (`ArrowRight`/`ArrowUp` -> `Math.min(10, score + 1)`, `ArrowLeft`/`ArrowDown` -> `Math.max(1, score - 1)`, `Home` -> `1`, `End` -> `10`), custom SVG star (`viewBox="0 0 24 24"`, filled polygon + subtle inner highlight bevel), and `.star-stage-num` (`1..10`) underneath each star.
  - Synchronized continuous progress bar `.star-stage-rail` (`<span className="star-stage-rail-fill" style={{ width: `${metrics.fillPercent}%` }} />`) between the stars and tick numerals.
- **Inline Calibration Anchors (`.star-stage-anchors`):**
  - When `!compact && calibration?.anchorMovies?.length > 0`, render a clean hairline row with `"Same tier:"` and clickable anchor chips (`onSelectAnchor?.(anchor)`).

- [ ] **Step 2: Wire `StarRatingStage` into `src/components/MovieDetails.jsx` and `src/components/QuickRateModal.jsx`**

- In `src/components/MovieDetails.jsx`:
  - Replace `.rating-module-header`, `.rating-tier-banner`, `.rating-studio-dial`, and `.rating-calibration-bar` (`lines 869-949`) with `<StarRatingStage value={userRating} hoverValue={hoverRating} onChange={(val) => { setUserRating(val); setHoverRating(0); }} onHoverChange={setHoverRating} calibration={vaultCalibration} onSelectAnchor={(anchor) => anchor.imdbID && navigate(\`/movie/\${encodeURIComponent(anchor.imdbID)}\`)} titleLabel={isWatched ? "Update Vault Entry" : "Rating Studio"} />`.
  - In `.vault-saved-status-card` (`lines 787-807`), replace `{savedTier.icon} {savedTier.label.split("(")[0]}` with a vector `<Star size={13} fill="currentColor" aria-hidden="true" />` and `savedTier.shortLabel || savedTier.label.split("(")[0]`.
- In `src/components/QuickRateModal.jsx`:
  - Replace `.quick-rate-picker-head` and `.quick-rate-number-grid` (`lines 102-154`) with `<StarRatingStage compact value={selectedRating} hoverValue={hoverRating} onChange={setSelectedRating} onHoverChange={setHoverRating} ariaLabel={\`Rate \${title} out of 10\`} />`.

- [ ] **Step 3: Implement `.star-rating-stage` animations & de-boxed studio styles in `src/index.css`**

In `src/index.css`:
- Style `.star-rating-stage`, `.star-stage-hero` (radial backdrop glow `radial-gradient(120% 100% at 0% 0%, var(--tier-bg), transparent 75%)`), `.star-stage-score-num` (`font-size: 3.2rem`, `font-weight: 800`, `color: var(--tier-color)`), `.star-stage-radiogroup` (`grid-template-columns: repeat(10, minmax(0, 1fr))`), `.star-stage-btn` (spring transition `cubic-bezier(0.22, 1, 0.36, 1)`, `.is-current` `transform: translateY(-3px) scale(1.24)`, `.is-wave-neighbor` `transform: translateY(-1.5px) scale(1.1)`, `.is-filled .star-stage-svg` `color: var(--tier-color); filter: drop-shadow(0 0 8px var(--tier-border))`, `@keyframes starStagePop`), `.star-stage-rail` & `.star-stage-rail-fill` (`background: var(--tier-color); box-shadow: var(--tier-glow)`), and de-boxed `.quick-tags-section` / `.studio-drawers-wrap` hairline dividers.

- [ ] **Step 4: Run unit tests and production build to verify**

Run: `npm test && npm run build`
Expected: PASS (`0` failed tests, `vite build` succeeds with `0` errors)

- [ ] **Step 5: Commit**

```bash
git add src/components/StarRatingStage.jsx src/components/MovieDetails.jsx src/components/QuickRateModal.jsx src/index.css
git commit -m "feat(rating-studio): replace number keypad with 10-Star Cinema Stage and wave track"
```
