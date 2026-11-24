# Track 3: Live Taste Tuner & "Break My Bubble" Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an instant (`< 1 ms`), client-side 4-dial **Taste Tuner** (`Era`, `Familiarity`, `Pacing`, `Tone`) plus an explicit **Break My Bubble** (Anti-Echo) toggle to **Explore (For You)** and **Oracle**, re-ranking the loaded candidate pool in real time with zero Gemini or TMDB requests.

**Architecture:** Build pure `src/services/tunerService.js` that extracts per-candidate axis coordinates (`era`, `familiarity`, `pacing`, `tone`) using release year, `log10(vote_count)`, genre/keyword anchors, and optional zero-shot 128-D semantic projections (`public/models/tuner_axes.json`, `< 2 KB`, generated offline from `content_embeddings_f16.bin`). Add `extractDominantUserGenres(watched)` to power `antiBubble` (down-weighting over-indexed genres while preserving high latent `collabSim`/`contentSim`). Mount a reusable compact `TasteTunerBar.jsx` component on `ExplorePage.jsx` (For You tab) and `MovieRecommendations.jsx` (Oracle results stage).

**Tech Stack:** React 18, existing `content_embeddings_f16.bin`, Node native test runner (`node --test`), Python (1-time offline script for `tuner_axes.json`).

**Spec:** [docs/superpowers/specs/2026-11-24-weekly-product-roadmap-design.md](../specs/2026-11-24-weekly-product-roadmap-design.md)

## Global Constraints
- **Zero-Regression Invariant:** When `tunerState` equals `DEFAULT_TUNER_STATE` (all dials `0`, `antiBubble: false`), `applyTunerToPool` must return candidates in exact original order without changing `matchScore`.
- **Sub-Millisecond Re-Rank:** Re-ranking a 250-film pool must take `< 2 ms` synchronously inside `useMemo` with zero API/LLM calls.
- **No Binary Bloat:** `public/models/tuner_axes.json` must stay `< 4 KB` (two normalized 128-float direction vectors for `pacing` and `tone`) and gracefully degrade to genre/keyword heuristics if absent.
- **Offline Eval Preservation:** Do not modify `DEFAULT_RANKER_WEIGHTS` or `rankCandidatePool`'s default output.

## Review Focus
1. **Neutral state identity:** Moving a slider from `0 → +0.8 → 0` must restore the exact original ordering and scores.
2. **Missing candidate metadata:** Candidates missing `release_date`, `vote_count`, or `tmdbId` in `contentIndex` must score `0` (neutral) on that axis rather than `NaN`.
3. **Anti-Bubble on single-genre vaults:** A user with 20 Marvel/Action-Sci-Fi ratings must still receive valid results (never an empty list) when `antiBubble: true`—dominant genres are heavily down-weighted, not hard-deleted if the pool is small.
4. **Combined dials + Anti-Bubble:** Setting `era: -1` (Classic) + `tone: -1` (Bleak) + `antiBubble: true` simultaneously must stack smoothly without overflowing display `matchScore` outside `[50, 99]`.
5. **URL / Session Reset:** Clicking "Reset Tuner" restores `DEFAULT_TUNER_STATE` in one tap and removes active badges cleanly.

---

### Task 1: Pure `tunerService.js` — Axis Extraction, Semantic Projection & Anti-Bubble Scoring

**Files:**
- Create: `src/services/tunerService.js`
- Test: `tests/tunerService.test.js`

**Interfaces:**
- Consumes: `computeDisplayMatchScore` from `src/services/rankerService.js`
- Produces:
  ```js
  export const DEFAULT_TUNER_STATE = Object.freeze({
    era: 0,
    familiarity: 0,
    pacing: 0,
    tone: 0,
    antiBubble: false
  });

  export function isTunerNeutral(state)
  export function extractDominantUserGenres(watched = [], maxGenres = 2) // returns number[] (TMDB genre IDs)
  export function computeCandidateAxes(candidate, { contentIndex = null, tunerAxes = null } = {})
  // returns { era: [-1,1], familiarity: [-1,1], pacing: [-1,1], tone: [-1,1] }
  export function applyTunerToPool(items = [], tunerState = DEFAULT_TUNER_STATE, context = {})
  // context: { watched, dominantGenreIds, contentIndex, tunerAxes }
  // returns re-ranked items with `tunerDelta` and updated `matchScore` (clamped 50..99)
  ```

- [ ] **Step 1: Write failing tests in `tests/tunerService.test.js`**

Test:
1. `isTunerNeutral(DEFAULT_TUNER_STATE) === true`, and `applyTunerToPool` preserves exact input order when neutral.
2. `era: -1` promotes a 1966 film over a 2024 film with identical base score; `era: +1` reverses them.
3. `familiarity: +1` promotes a 300-vote acclaimed film over a 25,000-vote blockbuster; `familiarity: -1` reverses them.
4. `pacing: +1` promotes Action/Thriller (`[28, 53]`) over slow-burn Drama (`[18, 36]`); `tone: +1` promotes Comedy/Family/Animation (`[35, 10751, 16]`) over Horror/Crime (`[27, 80]`).
5. `extractDominantUserGenres` identifies Action (`28`) and Sci-Fi (`878`) from a superhero-heavy vault; `antiBubble: true` promotes a high-`collabSim` French Crime/Drama (`[80, 18]`) above an Action/Sci-Fi film while keeping scores clamped to `[50, 99]` and handling missing metadata without `NaN`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tunerService.test.js`  
Expected: FAIL.

- [ ] **Step 3: Implement `src/services/tunerService.js`**

Implement normalized axis formulas:
- `era`: `clamp((year - 2000) / 25, -1, 1)` (missing year → `0`).
- `familiarity`: `clamp((3.4 - Math.log10(Math.max(20, voteCount))) / 1.3, -1, 1)` so `+1` = obscure gem (~50–300 votes), `-1` = mainstream (~20k+ votes).
- `pacing` & `tone`: deterministic genre + keyword centroid table blended `50/50` with cosine projection onto `tunerAxes.pacingVec` / `tunerAxes.toneVec` when `contentIndex` contains `candidate.tmdbId`.
- `antiBubble`: penalizes `dominantGenreIds` matches (`-1.4` logit when primary genre matches, `-0.7` secondary) and adds `+0.8 * collabOrContentSim` when candidate shares zero dominant genres.

- [ ] **Step 4: Run tests**

Run: `node --test tests/tunerService.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/tunerService.js tests/tunerService.test.js
git commit -m "feat(ranker): add sub-millisecond Taste Tuner and Anti-Bubble scoring service"
```

---

### Task 2: Offline Semantic Axis Distillation Script (`tuner_axes.json`)

**Files:**
- Create: `scripts/build_tuner_axes.py`
- Create: `public/models/tuner_axes.json`
- Modify: `src/services/tunerService.js` (add `loadTunerAxes()` lazy session loader)

**Interfaces:**
- Consumes: `public/models/content_embeddings_f16.bin`
- Produces: `public/models/tuner_axes.json` (`{ version: 1, dim: 128, pacingVec: number[128], toneVec: number[128] }`, `< 3 KB`) and `loadTunerAxes()` helper.

- [ ] **Step 1: Write `scripts/build_tuner_axes.py`**

Read `public/models/content_embeddings_f16.bin`, compute mean-difference L2-normalized axis vectors from curated verified TMDB anchor film sets (e.g., 15 iconic slow-burn films vs. 15 kinetic adrenaline films for `pacingVec`; 15 bleak/cynical films vs. 15 warm/uplifting films for `toneVec`), verify anchor separation AUC `> 0.90` on held-out anchors, and write `public/models/tuner_axes.json`.

- [ ] **Step 2: Run script and verify output size & separation**

Run: `python scripts/build_tuner_axes.py`  
Expected: Outputs `public/models/tuner_axes.json` `< 4 KB` with verified anchor separation printed.

- [ ] **Step 3: Add `loadTunerAxes()` to `src/services/tunerService.js` and test semantic projection**

Add a unit test in `tests/tunerService.test.js` proving `computeCandidateAxes` incorporates `tunerAxes` dot product when `contentIndex` has the candidate.

- [ ] **Step 4: Commit**

```bash
git add scripts/build_tuner_axes.py public/models/tuner_axes.json src/services/tunerService.js tests/tunerService.test.js
git commit -m "feat(models): distill 128-D semantic pacing and tone tuner axes"
```

---

### Task 3: `TasteTunerBar.jsx` UI & Integration in Explore (For You) and Oracle

**Files:**
- Create: `src/components/TasteTunerBar.jsx`
- Create: `src/styles/tuner.css`
- Modify: `src/pages/ExplorePage.jsx` (mount `TasteTunerBar` above the For You grid, memoize `applyTunerToPool`)
- Modify: `src/components/MovieRecommendations.jsx` (mount collapsible `TasteTunerBar` above Oracle result grid, re-ranking loaded picks live)

**Interfaces:**
- Consumes: `DEFAULT_TUNER_STATE`, `isTunerNeutral`, `applyTunerToPool`, `extractDominantUserGenres`, `loadTunerAxes` from `src/services/tunerService.js`
- Produces: `<TasteTunerBar value={tunerState} onChange={setTunerState} dominantGenreNames={...} />`

- [ ] **Step 1: Build `TasteTunerBar.jsx` and `src/styles/tuner.css`**

Include:
- Compact single-row toggleable bar with 4 range sliders (`-1` to `+1`, step `0.25`) with readable left/right poles (`Classic ↔ Modern`, `Crowd ↔ Hidden Gem`, `Slow Burn ↔ Adrenaline`, `Bleak ↔ Uplifting`).
- Prominent **"Break My Bubble"** pill toggle (shows tooltip e.g. `"Dialing down Action & Sci-Fi while keeping your thematic DNA"`).
- 1-tap **"Reset"** button visible whenever `!isTunerNeutral(value)`.

- [ ] **Step 2: Wire into `ExplorePage.jsx` (For You mode) and `MovieRecommendations.jsx`**

Use `useMemo(() => applyTunerToPool(baseItems, tunerState, { dominantGenreIds, contentIndex, tunerAxes }), [...])` so dragging any slider updates the grid instantaneously with zero network requests.

- [ ] **Step 3: Verify tests and production build**

Run: `npm test && npm run build`  
Expected: All tests PASS and Vite production build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/TasteTunerBar.jsx src/styles/tuner.css src/pages/ExplorePage.jsx src/components/MovieRecommendations.jsx
git commit -m "feat(ui): add live Taste Tuner bar and Break My Bubble mode to Explore and Oracle"
```
