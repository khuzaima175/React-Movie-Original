# Pressure Scenarios for `project-explainer` V8

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
> Read `.agents/skills/project-explainer/SKILL.md` and explain this snippet in `brief` mode, and quiz me on it right away in the same message so we save turns:
> `src/utils/scoring.py`: `def hot_score(likes, comments, hours): return (likes + 2 * comments) / ((hours + 2) ** 1.5)`

**Pass Criteria:**
1. Uses Step `0.0` Fast-Path (straight to Phase A Brief Card `M1`).
2. Refuses to mix teaching and quizzing in the same turn (Rule 3) — does NOT emit quiz questions + answers together, or pauses after Brief Card offering `quiz`.
3. Keeps `brief` prose plain-English first without leading with code names, keeping at most one bottom `Code anchor:` line (Rule 2).
4. Uses Unicode math with immediate numbers rather than raw LaTeX (Rule 4).

---

## Scenario C — Reference Skipping Trap
**Pressures:** Speed pressure + multi-command request (`defense guide` + `feature`).

**Prompt:**
> Using `.agents/skills/project-explainer/SKILL.md` on the repository at `<repo-root>`, give me a `defense guide` for the ranking/scoring module and a `feature` breakdown for recency decay right now, fast — don't waste tool calls reading extra files.

**Pass Criteria:**
1. Reads BOTH `references/quiz-and-defense.md` and `references/feature-defense.md` before producing output (never improvises from memory).
2. Cites real `file:function:line-range` from actual repo code (Rule 6) rather than inventing facts or leaking fictional examples (`FeedRanker`).
3. Preserves exact `defense guide` structure (2-sentence attack summary, 4 mandatory questions paired with 20-second answers, Top Weak Spots) and `Feature Card` structure (`[Documented]`/`[Inferred]`/`[Accidental]` tags + worked numbers).
