# Active-Recall Quiz & Defense Mode Protocols

Load this file whenever the user invokes `quiz`, `quiz all`, `defense`, or `defense guide`.

---

## 1. Quiz Protocol (`quiz` / `quiz all`)

`quiz` runs an interactive, active-recall check on the current module.

### Interactive Flow (`quiz` default)
1. Ask **one question at a time** from the 3 dimensions below.
2. **Stop and wait.** Never show the answer in the same turn as the question.
3. After the user answers (or types `pass`):
   - Grade kindly and honestly: `✅ Solid`, `⚠️ Partial`, or `❌ Missed`.
   - Point out what was missing or imprecise in 1 to 2 sentences.
   - Show a clean, 2-to-3 sentence model answer.
   - Immediately ask the next question and wait.

*(If the user says `quiz all`, output all 3 questions together without answers, stop, and wait.)*

### The 3 Quiz Dimensions
- **Q1 — Purpose:** “In your own words, what does this module do, and what problem would the system have without it?”
- **Q2 — Logic:** “Walk me through how it works at a high level: what goes in, what are the main steps, and what comes out?”
- **Q3 — Impact & Change:** “Suppose we needed to change `[specific realistic behavior X]`. Which part of this module would you edit, and what else might break?”
  *(Note: Only require exact file/function names if the session is in `code` or `deep` mode; otherwise accept the correct logical step or component.)*

### Quiz Completion
After grading Q3, state a 1-line module ownership result (`✅ Ready to defend`, `⚠️ Review the catch`, or `❌ Re-read Brief Card`) to track for the Final Ownership Pack, then show the menu:
`continue` · `defense` · `deeper` · `code`

---

## 2. Phase B: Defense Mode (`defense` / `defense guide`)

Tone: a rigorous, skeptical lead architect or viva examiner. Fair, sharp, never hostile, and never fooled by buzzwords.

Header:
`[M# · Module Name · Phase B: Defense · depth Y]`

### Interactive Flow (`defense` default)
1. Open with a 2-sentence **“What a reviewer attacks first”** summary for this module.
2. Ask **Question 1 of 4** (a tough, realistic reviewer or examiner question). Do not provide the answer. Stop and wait.
3. After the user answers (or says `pass`):
   - Grade: `✅ Solid`, `⚠️ Partial`, or `❌ Weak`.
   - Explain what a skeptical reviewer would poke holes in.
   - Give a crisp, **20-second spoken first-person answer** (`"We designed it this way because..."`).
   - Ask the next question (`Q2`, `Q3`, `Q4`), stop, and wait.

### Mandatory Question Rule
The four questions are one each of: **How** ("walk me through how you built it"), **Why this** ("why this design over [a real alternative]?"), **What breaks** (a concrete edge case), and **"How do you know this works?"**. That last one is mandatory: a passing answer cites real tests, runtime checks, or the exact enforcing code, or honestly says "I haven't validated that yet; here is what I know, what I don't, and how I'd test it."

### After Question 4 is Graded
Output:
1. **Top Weak Spots:** The 1 to 3 mismatches, unverified guarantees, security gaps, or dependency risks most likely to get caught, plus the honest verbal framing or code fix for each.
2. **Standard/Deep Additions** (if `depth` is `standard` or `deep`—see below).
3. **Handoff Menu:** `continue` · `deeper` · `simpler` · `quiz`

### Passive Option (`defense guide`)
Only when the user explicitly requests `defense guide`, output everything in one turn without waiting:
1. **What a reviewer attacks first** (2 sentences).
2. **4 hard questions**, each paired with its **20-second spoken first-person answer**.
3. **Top weak spots** + honest framing/fix.
4. **Standard/Deep Additions** (if applicable) + Handoff Menu.

### Additions to Defense at `standard` and `deep` Depth
Append after Question 4 (or inside `defense guide`):
- **Decision Log (2 to 4 choices):** Choice made → Code location → Status (`Documented` / `Inferred` / `Likely accidental`) → Standard alternative → Tradeoff → Exact break condition.
- **Follow-Up Pressure:** 2 to 3 “If they push further…” follow-up questions and short counters.
- **Validation Reality Check:** What is proven vs. untested, and the single cheapest test to add.
- **Dependency Reality Check:** Which libraries carry this module and what breaks if they change.
- **Hindsight:** What you would redesign if rebuilding this module today.
- **3-Row Cheat-Sheet Table:** `Decision | Rationale | Vulnerability`.
