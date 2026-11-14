# Final Ownership Pack (`finish` or After Final Module)

Load this file when all modules are complete or when the user types `finish`. Generate all 12 sections clearly from the **Session Ledger** (`Carry-Forward` state, `M0 trace anchor`, cumulative `Open issues`, and recorded `Quiz`/`Defense` results).

Write every section in **plain, everyday English** (short clear sentences, real concrete numbers, zero unexplained jargon or forced analogies) so the user can actually study and speak from this pack.

---

## 1. 60-Second Spoken Pitch
A natural, first-person overview (`"This project solves X by doing Y..."`, ~100–140 words) in easy spoken English ready for an interviewer, examiner, or lead engineer.

## 2. 5-Minute End-to-End Walkthrough
Reuse the exact pinned **`M0 trace anchor`** from the Session Ledger and trace it step by step from initial input through every core module to the final output, explaining what changes at each stage in plain English.

## 3. Top 10 Hardest Defense Questions
The 10 toughest questions a skeptical reviewer will ask about this specific codebase, each paired with a natural **20-second (2–3 sentence)** honest first-person answer in easy English. Every headline feature gets at least one how, one why-not, and one what-if.

## 4. Math Cheat-Sheet
For every important formula in the project (clean and readable):
- **Formula (Unicode)** → **Plain-English meaning** → **1 step-by-step worked calculation** → **Edge case where it breaks**.
*(If the project has no custom math, write “No custom formulas in this project.”)*

## 5. Knobs Cheat-Sheet
A clear table of key constants, thresholds, and config flags:
`Knob / Constant | Location | Effect of Raising | Effect of Lowering`

## 6. Load-Bearing Code & Environment Map
Only what truly matters:
- **Core files & entrypoints:** `file → 1-line responsibility in plain words`
- **Required env vars & secret names:** Variable name + what it unlocks + what fails if missing (never print secret values).
- **External services & storage:** Databases, caches, third-party APIs, and what happens when offline or full.

## 7. Verification Status Summary
- `✅ Verified in session:` Claims proven by code inspection or test execution.
- `❓ Unverified:` Claims that still lack automated tests or runtime proof.
- `🔒 Needs approval:` Checks requiring destructive, paid, or external execution.

## 8. Prioritized Open Issues Register
All cumulative `⚠️ Mismatch` items, unverified guarantees, security risks, and dependency risks from the **Session Ledger** `Open issues`, deduped and ordered from highest to lowest severity with a 1-line fix for each.
*(If the session `goal` is `audit`, format as a formal Risk Register table: `Severity | Finding & Evidence | Missing Control | Cheapest Mitigation`.)*

## 9. Simplification & Dead-Code Candidates
Up to 5 highest-impact code, file, or abstraction candidates that look unnecessary, rated by removal confidence (`high` / `medium` / `low`) alongside the exact check required before deleting.

## 10. “Can't Defend Yet” List
Be honest using the **Session Ledger**: name the 2 to 3 topics where the user showed the lowest confidence during `quiz`/`defense` or where code/test evidence was incomplete, plus how to close each gap in 10 minutes.

## 11. Definition of Done Scorecard
Grade each ownership dimension strictly from recorded **Session Ledger** evidence (`✅` proven in `quiz`/`defense`, `❌` attempted but shaky, or `❓` not quizzed/defended yet — **never guess `✅` or `❌` for an untested module; mark `❓` and name the module to test**):

1. **Pitch:** Can explain the project clearly in 60 seconds.
2. **Trace:** Can walk through one real request from start to finish.
3. **Coordinates:** Can name the key files/modules and what each one owns.
4. **Failure Modes:** Can name the main edge cases and how the system fails.
5. **Safe Change:** Can point to where to edit and how to verify nothing broke.
6. **Honest Defense:** Can answer hard reviewer questions clearly without bluffing.
7. **Evidence:** Can point to real tests or exact code lines for key claims.

## 12. If Rebuilding Tomorrow
If the user had to rebuild this system from scratch:
- **Optimal build order:** Which 3 pieces to build first and why.
- **Architectural fixes:** What to design differently.
- **What to drop:** What complexity to leave out completely.
- **First test:** The single highest-value test to write on day one.

---

**Optional Save:** After presenting the pack, end with one line:
> “Want me to save this Final Ownership Pack to `OWNERSHIP_GUIDE.md` in the repo root? `[Needs approval]`”
