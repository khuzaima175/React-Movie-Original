# Rating Studio 10-Star Cinema Stage Design

**Date:** 2026-11-15
**Status:** Approved

## 1. Intent & Why
Rating films is the core heart of CinemaVault, yet the current `Rating Studio` sidebar on `MovieDetails` (and `QuickRateModal`) feels like a stiff calculator form:
1. **Color Clash & OS Emojis:** Selecting `7/10` or `4/10` paints the top tier banner in neon cyan (`#06b6d4`) or orange (`#f97316`) with system emojis (`👍`, `⚠️`), while the `1–10` buttons below remain hardcoded to muddy yellow-gold (`rgba(229, 184, 75, 0.08)`).
2. **Flat Number Keypad vs. Tactile Stars:** Ten cramped number boxes with a `4px` dot underneath lack the emotional, spatial reward of lighting up cinema stars.
3. **Box-in-Box Clutter:** 26+ bordered rectangles are stacked inside a single `340px` sidebar, giving every element equal visual noise.

This design replaces the number keypad and emoji banner with a **Sculpted 10-Star Cinema Stage + Synchronized Light Track** that restores stars as the tactile hero, synchronizes color and motion across the entire card, and de-boxes the surrounding layout.

## 2. Goals, Non-Goals & Anti-Goals
- **Goals:**
  - **De-boxed Hero Score Stage:** Combine the score readout (`7` `/ 10`), tier title & description (`Good Watch — Solid craft, enjoyable & well-made`), and Vault percentile badge (`Top 92% of your Vault`) into one cohesive atmospheric stage with a subtle radial glow (`--tier-color`, `--tier-bg`, `--tier-border`, `--tier-glow`) and crisp vector tier emblems instead of OS emojis.
  - **10-Star Wave-Cascade Track (`StarRatingStage`):**
    - 10 custom SVG stars (`role="radiogroup"`, `aria-label="Rate this film from 1 to 10"`, roving `tabIndex`, `ArrowRight`/`ArrowUp`, `ArrowLeft`/`ArrowDown`, `Home`, `End` keyboard navigation) plus pointer/touch scrub support.
    - **Wave physics:** When star `activeScore` (`hoverRating || userRating`) is active, star `N === activeScore` scales to `1.26x` (`translateY(-3px)`) with a specular drop-shadow glow; neighbor stars `|N - activeScore| === 1` crest to `1.11x` (`translateY(-1.5px)`); filled stars `N <= activeScore` illuminate in `--tier-color` with staggered transition timing; clicking triggers a crisp star-pop keyframe animation.
    - **Synchronized Progress Rail & Ticks:** Directly beneath the 10 stars sits a slim continuous light track (`0%` to `100%` width proportional to `activeScore / 10`) and tabular `1..10` tick numerals that light up in `--tier-color` in lockstep with the stars above.
  - **De-boxed Studio Deck & Saved Card Parity:**
    - Replace the boxed calibration panel with a clean inline calibration footer (`Same tier: Madagascar · Madagascar 3`) separated by a subtle hairline divider.
    - Streamline Quick Review Tags, Craft Breakdown / Watch Log drawer triggers, and the review notes pad into a cohesive, low-noise editorial surface.
    - Update the saved Vault status card (`vault-saved-status-card` in `MovieDetails.jsx`) and `QuickRateModal.jsx` to use the same vector tier badge and 10-star wave track so OS emojis and plain number grids are eliminated everywhere.
- **Non-Goals:**
  - Modifying `watched` / `watchlist` / `ratingBreakdown` / `watchMeta` persistence schemas or Supabase sync (`vaultSyncService.js`).
- **Anti-Goals:**
  - OS emojis (`🏆`, `✨`, `🍿`, `👍`, `😐`, `📉`, `⚠️`, `🚫`, `⛔`, `💀`, `⭐`) rendered in the Rating Studio or `QuickRateModal` UI.
  - Hardcoded gold/yellow fills on `1–10` controls when the active tier is cyan, emerald, violet, slate, orange, or crimson.
  - Horizontal overflow inside the `340px` desktop sidebar or `390px` mobile viewport.

## 3. Approaches Considered
1. **Option 1 (Picked): Sculpted 10-Star Cinema Stage + Synchronized Light Track** — Restores iconic cinema stars with wave-cascade hover physics, a continuous `--tier-color` progress rail with `1–10` ticks, and a unified Hero Score Stage.
2. **Option 2: Ascending Cinema Spectrum Bars** — Tactile equalizer look, but feels more like audio metering than film rating.
3. **Option 3: 5 Giant Half-Step Stars** — Larger individual stars, but odd scores (`7/10`, `9/10`) require half-star cursor targeting.

## 4. Architecture & Interfaces
- **`src/services/ratingStudioService.js` (`computeStarStageMetrics(activeRating, selectedRating, hoverRating)`):**
  - Pure helper returning `{ activeScore, fillPercent, isHovering, stars: Array<{ score, isFilled, isCurrent, isWaveNeighbor, distance, staggerMs }> }` for `1..10` so wave physics, rail fill percentage (`0` to `100`), and roving `tabIndex` are deterministic and unit-tested under `node --test`.
- **`src/services/ratingTiers.js`:**
  - Add semantic `tone` (`"zenith" | "gold" | "emerald" | "cyan" | "violet" | "slate" | "amber" | "crimson" | "unrated"`) and `shortLabel` to each tier in `RATING_TIERS` / `UNRATED_TIER` while keeping existing fields (`label`, `desc`, `color`, `bg`, `border`, `glow`) backward-compatible.
- **`src/components/StarRatingStage.jsx`:**
  - Reusable interactive 10-star wave stage component accepting `{ value, hoverValue, onChange, onHoverChange, calibration, onSelectAnchor, compact = false, ariaLabel }` used in both `MovieDetails.jsx` and `QuickRateModal.jsx`.
- **`src/components/MovieDetails.jsx` & `src/index.css`:**
  - Mount `<StarRatingStage />` inside `.rating-studio-card`, replace emoji tier badges in `.vault-saved-status-card` with vector star/crest chips, and replace `.rating-studio-dial` / `.rating-tier-banner` / `.rating-calibration-bar` box styles with the unified `.star-stage-*` CSS system.
