# Final Ownership Pack (`finish` or After Final Module)

Load this file when all modules are complete or when the user types `finish`. Generate all 12 sections clearly so the user can use this document as their permanent study and review sheet.

---

## 1. 60-Second Spoken Pitch
A natural, first-person overview (`"This project solves X by doing Y..."`) ready to speak aloud to an interviewer, examiner, or lead engineer.

## 2. 5-Minute End-to-End Walkthrough
Reuse the concrete example from `M0` and trace it cleanly from initial input through every core module to the final output, connecting the mental models built during the session.

## 3. Top 10 Hardest Defense Questions
The 10 toughest questions a skeptical reviewer will ask about this specific codebase, each paired with a concise, honest 20-second first-person answer. Every headline feature gets at least one how, one why-not, and one what-if.

## 4. Math Cheat-Sheet
For every important formula in the project:
- **Formula (Unicode)** → **Plain-English meaning** → **1 worked calculation** → **Edge case where it breaks**.
*(If the project has no custom math, write “No custom formulas in this project.”)*

## 5. Knobs Cheat-Sheet
A table of tunable constants, thresholds, and config flags:
`Knob / Constant | Location | Effect of Raising | Effect of Lowering`

## 6. Load-Bearing Code & Environment Map
Only what truly matters:
- **Core files & entrypoints:** `file → 1-line responsibility`
- **Required env vars & secret names:** Variable name + purpose + what fails if missing (never print secret values).
- **External services & storage:** Databases, queues, third-party APIs, and failure behavior when offline.

## 7. Verification Status Summary
- `✅ Verified in session:` Claims proven by code inspection or test execution.
- `❓ Unverified:` Claims that still lack automated tests or runtime proof.
- `🔒 Needs approval:` Checks requiring destructive, paid, or external execution.

## 8. Prioritized Open Issues Register
All cumulative `⚠️ Mismatch` items, unverified guarantees, security risks, and dependency risks gathered in Carry-Forward blocks, ordered from highest to lowest severity with a 1-line fix for each.
*(If the session `goal` is `audit`, format as a formal Risk Register table: `Severity | Finding & Evidence | Missing Control | Cheapest Mitigation`.)*

## 9. Simplification & Dead-Code Candidates
Code, files, or abstractions that appear unnecessary, rated by removal confidence (`high` / `medium` / `low`) alongside the exact verification check required before deleting.

## 10. “Can't Defend Yet” List
Be honest: name the 2 to 3 topics where the user showed the lowest confidence during `quiz`/`defense` or where repository evidence was incomplete, plus how to close each gap in 10 minutes.

## 11. Definition of Done Scorecard
Grade each ownership dimension `✅` (proven in `quiz`/`defense`), `❌` (attempted but shaky), or `❓` (not quizzed yet—name the specific module to test):

1. **Pitch:** Can pitch the project clearly in 60 seconds.
2. **Trace:** Can trace one real request or data path end-to-end.
3. **Coordinates:** Can name the load-bearing files/modules and their jobs.
4. **Failure Modes:** Can name the main edge cases and how the system fails.
5. **Safe Change:** Can state where to make a change and how to test it.
6. **Honest Defense:** Can answer skeptical reviewer questions without bluffing.
7. **Evidence:** Can point to concrete tests or enforcing lines for key claims.

## 12. If Rebuilding Tomorrow
If the user had to rebuild this system from scratch:
- **Optimal build order:** Which 3 pieces to build first.
- **Architectural fixes:** What to design differently.
- **What to drop:** What complexity to leave out entirely.
- **First test:** The single highest-leverage test to write on day one.
