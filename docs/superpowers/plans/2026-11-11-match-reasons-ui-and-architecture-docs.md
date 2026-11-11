# Match Reasons UI Wiring, Architecture Documentation, and State Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pass deterministic `matchReasons` badges from the ranker through `geminiService.js` to recommendation cards in `MovieRecommendations.jsx`, document the verified zero-leakage 32M benchmark milestones in `ARCHITECTURE.md`, and commit the verified repository state.

**Architecture:** `mergeGeminiExplanationsWithRanker` and the non-LLM ranker fallback in `geminiService.js` attach `matchReasons: Array.isArray(candidate.matchReasons) ? candidate.matchReasons : []` to each recommendation object. `MovieRecommendations.jsx` renders up to 2 subtle badge pills (`rec.matchReasons.slice(0, 2)`) alongside the match score and metadata. `ARCHITECTURE.md` is updated with the zero-leakage 32M benchmark table, pool-relative normalization, and metadata damping details.

**Tech Stack:** React, Tailwind CSS / inline styling, JavaScript (ESM), Node.js test runner (`node --test`), Git.

**Spec:** User prompt instructions (Steps 1–3).

## Global Constraints

- `matchReasons` on recommendation objects must always be an array (never `undefined` or `null`).
- In `MovieRecommendations.jsx`, render at most 2 badges (`rec.matchReasons.slice(0, 2)`) to avoid cluttering card layouts.
- Non-LLM fallback path in `geminiService.js` must also attach `matchReasons`.
- Leave `.data/` untracked in `.gitignore`.
- Full test suite (`npm test`) and production build (`npm run build`) must pass with 0 errors.

## Review Focus

1. **Non-array or empty `matchReasons`**: If a candidate has no badges or malformed features, `matchReasons` safely defaults to `[]` and `MovieRecommendations.jsx` suppresses badge rendering.
2. **LLM fallback robustness**: If Gemini calls fail, the direct ranker fallback returns recommendations with `matchReasons` intact from `rankCandidatePool`.
3. **Card layout stability**: Match badges in `MovieRecommendations.jsx` must wrap gracefully on mobile viewports and match existing pill/badge design tokens.
4. **Documentation integrity**: `ARCHITECTURE.md` must clearly document the NDCG@10 (0.143, +131%), Recall@20 (0.242, +192%), and Novelty (2.24) improvements from 32M collaborative pool-relative scaling and 0.20 metadata damping.
5. **Git staging hygiene**: Only track `src/`, `tests/`, `scripts/`, `ARCHITECTURE.md`, and `public/models/ranker_weights.json`; `.data/` remains completely untracked.

---

### Task 1: Wire `matchReasons` Through `geminiService.js` (TDD)

**Files:**
- Modify: `src/services/geminiService.js:370-410, 520-535`
- Test: `tests/pipelineBugs.test.js`

**Interfaces:**
- Consumes: `rankedItem.matchReasons` produced by `rankCandidatePool` in `src/services/rankerService.js`.
- Produces: `recommendations[i].matchReasons: string[]` on all returned recommendation objects.

- [ ] **Step 1: Write failing test in `tests/pipelineBugs.test.js`**

Add unit test verifying `mergeGeminiExplanationsWithRanker` preserves `matchReasons`:
```javascript
test("mergeGeminiExplanationsWithRanker preserves matchReasons from ranked candidate", () => {
  const geminiResult = {
    tasteProfile: { favoriteGenres: ["Sci-Fi"] },
    recommendations: [
      { tmdbId: 101, title: "Solaris", year: "1972", reason: "Deep atmospheric pacing." }
    ]
  };
  const rankedCandidates = [
    {
      id: 101,
      tmdbId: 101,
      title: "Solaris",
      year: "1972",
      matchScore: 94,
      matchReasons: ["🧬 High Taste-Twin Match", "🎬 Favorite Filmmaker"]
    }
  ];

  const merged = mergeGeminiExplanationsWithRanker(geminiResult, rankedCandidates, {});
  assert.equal(merged.recommendations.length, 1);
  assert.deepEqual(merged.recommendations[0].matchReasons, [
    "🧬 High Taste-Twin Match",
    "🎬 Favorite Filmmaker"
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pipelineBugs.test.js`
Expected: FAIL because `matchReasons` is not yet preserved by `mergeGeminiExplanationsWithRanker`.

- [ ] **Step 3: Implement `matchReasons` preservation in `src/services/geminiService.js`**

1. In `mergeGeminiExplanationsWithRanker`:
   Add `matchReasons: Array.isArray(candidate.matchReasons) ? candidate.matchReasons : []` to the returned recommendation item.
2. In `reRankCandidatesWithGemini`:
   In the fallback return path when `!response`, map `topCandidates` to recommendations with `matchReasons: Array.isArray(cand.matchReasons) ? cand.matchReasons : []`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pipelineBugs.test.js`
Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All 62 tests pass.

---

### Task 2: Render `matchReasons` in `MovieRecommendations.jsx`

**Files:**
- Modify: `src/components/MovieRecommendations.jsx:860-915`

**Interfaces:**
- Consumes: `rec.matchReasons` array on each recommendation object.
- Produces: Subtle UI badge pills rendered on recommendation cards.

- [ ] **Step 1: Add match reason badges to recommendation card header**

In `src/components/MovieRecommendations.jsx`, inside `.rec-header` (under `.rec-meta` or before `.rec-reason-box`), add:
```jsx
{Array.isArray(rec.matchReasons) && rec.matchReasons.length > 0 && (
  <div className="rec-match-reasons" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.35rem" }}>
    {rec.matchReasons.slice(0, 2).map((badge, bIdx) => (
      <span
        key={bIdx}
        style={{
          fontSize: "1.05rem",
          fontWeight: 500,
          color: "#d4d4d0",
          background: "rgba(255, 255, 255, 0.06)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          padding: "0.15rem 0.55rem",
          borderRadius: "1rem",
          lineHeight: "1.4"
        }}
      >
        {badge}
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 2: Verify component build and syntax**

Run: `npm run build`
Expected: Succeeded with 0 errors.

---

### Task 3: Update `ARCHITECTURE.md` with Verified 32M Benchmark Table

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Update `Known Gaps` section**
Mark Stage 1 Collaborative Embeddings as resolved with 32M 25k-item float16 model, and update ranker evaluation to reflect real ranker rolling cross-validation.

- [ ] **Step 2: Add Section 3.5: Verified Benchmark Milestones & Scaling Architecture**
Document:
1. **Benchmark Milestone Progress Table**:
   - Small Baseline (NDCG@10: 0.062, Recall@20: 0.083, Novelty: 1.48)
   - Initial 32M (NDCG@10: 0.078, Recall@20: 0.171, Novelty: 1.82)
   - Calibrated 32M Clean (NDCG@10: 0.143 [+131%], Recall@20: 0.242 [+192%], Novelty: 2.24 [+51%])
2. **Pool-Relative Normalization**:
   $$\text{collabScale} = \max(\max_{c \in \text{pool}} \text{collabSim}(c), 0.05), \quad \text{collabSim}_{\text{norm}} = \min(1.0, \frac{\text{collabSim}}{\text{collabScale}})$$
3. **Metadata Gating & Damping**:
   When $\text{hasCollabSignal}$ is true ($|\text{collabSim}| > 0.001$), damping factor $0.20\times$ scales down `genreOverlap` and `bayesianRatingNorm`, eliminating tie-collapse while keeping cold-start metadata at full 1.0x strength.

---

### Task 4: Full Verification & Git Commit

**Files:**
- Commit: `src/`, `tests/`, `scripts/`, `ARCHITECTURE.md`, `public/models/ranker_weights.json`

- [ ] **Step 1: Run complete test suite**

Run: `npm test`
Expected: 62/62 tests PASS with 0 failures.

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: Build passes with 0 errors.

- [ ] **Step 3: Stage and commit verified changes**

Run:
```powershell
git add src/ tests/ scripts/ ARCHITECTURE.md public/models/ranker_weights.json docs/superpowers/
git commit -m "feat(recommender): calibrate 32M collaborative scaling, metadata gating, and match badges"
```
Expected: Clean commit created on current branch.
