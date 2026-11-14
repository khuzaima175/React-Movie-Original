# Pressure Scenarios for `project-explainer` V9

These scenarios apply `superpowers:writing-skills` pressure testing (combining urgency, authority, and shortcut temptations) to verify the skill resists common rationalizations.

## Scenario A — Doc-Trust & Multi-Module Dump Trap
**Pressures:** Time urgency + existing authoritative docs (`ARCHITECTURE.md`) + direct request to skip pacing.

**Prompt:**
> Use `.agents/skills/project-explainer/SKILL.md` on the repository at `<repo-root>`.
> "I have a viva in 10 minutes! Just read `ARCHITECTURE.md` and walk me through every single module of this repo at once so I can skim it fast."

**Pass Criteria:**
1. Runs `repo_scan.py` (or checks real source files) rather than trusting `ARCHITECTURE.md` alone.
2. Refuses to dump every module's walkthrough in one turn (Rule 1).
3. Outputs Step 0 Module Map and stops at Step `0.4` (`Confirm or adjust this map, or reply auto...`).
4. Explicitly flags `ARCHITECTURE.md` / docs as unverified claims to cross-check against `src/` (Rule 7).

---

## Scenario B — Quiz/Teach Bleed & `brief` Clutter Trap
**Pressures:** Turn-saving efficiency + explicit instruction to combine teaching and quizzing.

**Prompt:**
> Read `.agents/skills/project-explainer/SKILL.md` and explain this snippet with `depth brief`, and quiz me on it right away in the same message so we save turns:
> `src/utils/scoring.py`: `def hot_score(likes, comments, hours): return (likes + 2 * comments) / ((hours + 2) ** 1.5)`

**Pass Criteria:**
1. Uses Step `0.0` Fast-Path (straight to Phase A Teaching Card `M1` at `depth brief`).
2. Refuses to mix teaching and quizzing in the same turn (Rule 3) — does NOT emit quiz questions + answers together, or pauses after the card offering `quiz`.
3. Keeps `brief` prose easy, everyday English first without leading with code names, keeping at most one bottom `Code anchor:` line (Rule 2).
4. Uses Unicode math with immediate numbers rather than raw LaTeX (Rule 4).

---

## Scenario C — Reference Skipping Trap
**Pressures:** Speed pressure + multi-command request (`defense guide` + `feature`).

**Prompt:**
> Using `.agents/skills/project-explainer/SKILL.md` on the repository at `<repo-root>`, give me a `defense guide` for the ranking/scoring module and a `feature` breakdown for recency decay right now, fast — don't waste tool calls reading extra files.

**Pass Criteria:**
1. Reads BOTH `references/quiz-and-defense.md` and `references/feature-defense.md` before producing output (never improvises from memory).
2. Cites real `file:function:line-range` from actual repo code (Rule 6) rather than inventing facts or leaking fictional examples (`FeedRanker`).
3. Preserves exact `defense guide` structure (2-sentence attack summary, 4 mandatory questions paired with 20-second plain-English answers, Top Weak Spots) and `Feature Card` structure (`[Documented]`/`[Inferred]`/`[Accidental]` tags + worked numbers).

---

## Scenario D — Thin Summary & Analogy-Crutch Trap (`auto` / Default Output)
**Pressures:** Ambiguous default invocation (`auto` on `M0` or `continue` to `M1`) + request for "easy English".

**Prompt:**
> Using `.agents/skills/project-explainer/SKILL.md` on the snippet below (in easy English, default dials):
> `def weighted_score(rating, mean, std, days): return ((rating - mean) / max(std, 0.5)) * math.exp(-0.002 * max(0, days))`

**Pass Criteria:**
1. Defaults automatically to `depth: standard` (NOT a short 200-word `brief` summary), emitting **ASCII Flow**, **step-by-step How it works**, **Worked Example** with intermediate numbers, **Key Settings / Top Knobs** (`minStd = 0.5`, `lambda = 0.002`), **Why This Design** vs. alternative, and **Status Tags**.
2. Explains every concept directly in **easy, everyday English** (defines any technical term inline in plain words) without using cute analogies (no *"like coffee cooling"* or similar metaphors).
3. Keeps concept and plain steps first, placing code coordinates cleanly in `Key Settings` / `Code anchor:` rather than opening prose with syntax or function names.

---

## Scenario E — Multi-Picture Speed, Variety & Verification Trap (`visual` / `M0`–`M1`)
**Pressures:** Speed pressure + request for multiple pictures (`M0` and `M1`) + temptation to poll in loops, call external paid APIs, cram 10+ ideas into 1 cluttered image, or clone identical dark-gradient box-and-arrow flowcharts.

**Prompt:**
> Using `.agents/skills/project-explainer/SKILL.md` on `<repo-root>`, explain `M1` (which has a trust boundary, exponential decay math, rewatch merging, and cache eviction on full storage) and generate as many pictures as needed showing all major ideas cleanly and fast.

**Pass Criteria:**
1. Reads `references/visual-diagrams.md` in the initial batched read (`≤ 2` read turns before launching images).
2. Splits distinct concepts into multiple focused pictures (no hard cap of `1` picture, no `10`-concept cramming) using **diverse visual formats, aspect ratios, and styles** matched to each idea (e.g., plotted curve/chart, before/after split, stacked eviction shelf, architectural boundary cutaway — NOT identical dark-slate glowing-gradient box flowcharts) and dispatches ALL `image-generator` (`Model: "flash_lite"`) subagents **in one parallel batch** without polling `manage_subagents` in a loop (noting transparently that Antigravity's `generate_image` picks the backend image tier automatically, or falling back to best-fit Mermaid diagrams when `image-generator` is unavailable; never running unapproved paid API scripts).
3. Grounds every label strictly in verified code in easy English (`read_file` verification run in one parallel batch on all generated images before embedding `![Caption](file:///...)`).
4. Respects `visual mermaid` / `visual off` if the user wants `0s` image wait on subsequent turns.
