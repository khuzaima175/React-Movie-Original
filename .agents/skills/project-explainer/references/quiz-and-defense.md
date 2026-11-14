# Active-Recall Quiz & Defense Mode Protocols

Load this file whenever the user invokes `quiz`, `quiz all`, `defense`, or `defense guide`.

Write all questions, feedback, model answers, and spoken defense lines in **plain, easy English** — short sentences, everyday words, and concrete examples rather than buzzwords.

## Contents
- 1. Quiz Protocol (`quiz` / `quiz all`)
- 2. Phase B: Defense Mode (`defense` / `defense guide`)
- 3. Additions to Defense at `standard` and `deep` Depth

---

## 1. Quiz Protocol (`quiz` / `quiz all`)

`quiz` runs an interactive, active-recall check on the current module.

### Interactive Flow (`quiz` default)
1. Ask **one question at a time** from the 3 dimensions below.
2. **Stop and wait.** Never show the answer in the same turn as the question.
3. After the user answers (or types `pass`):
   - Grade kindly and honestly: `✅ Solid`, `⚠️ Partial`, or `❌ Missed`.
   - Point out what was missing or off in 1 to 2 clear sentences.
   - Show a clean, 2-to-4 sentence model answer in easy English.
   - Immediately ask the next question and wait.

*(If the user says `quiz all`, output all 3 questions together without answers, stop, and wait.)*

### The 3 Quiz Dimensions
- **Q1 — Purpose:** “In your own words, what does this module do, and what problem would happen without it?”
- **Q2 — Logic (or Predict the Output):**
  - *Standard:* “Walk me through how it works step by step: what goes in, what changes in the middle, and what comes out?”
  - *Predict the Output (use for math, ranking, or stateful modules):* “Given concrete input `[realistic edge/normal example X]`, what exact output or state change does this module produce, and why?”
- **Q3 — Impact & Change:** “Suppose we needed to change `[specific realistic behavior X]`. Which part of this module would you edit, and what else might break?”
  *(Note: Only require exact file/function names if the session is in `code` or `deep` mode; otherwise accept the right logical step or part.)*

### Quiz Completion
After grading Q3, output a 1-line **Session Ledger** update alongside the menu so `Carry-Forward` and `finish` record real confidence:
`Session Ledger update: M# · Quiz ✅ Ready to defend | ⚠️ Review the catch | ❌ Re-read teaching card · Weak spot: [topic or "none"]`
Menu: `continue` · `defense` · `deeper` · `code`

---

## 2. Phase B: Defense Mode (`defense` / `defense guide`)

Tone: a sharp, fair lead engineer or viva examiner. Direct, practical, never rude, and never fooled by buzzwords.

Header:
`[M# · Module Name · Phase B: Defense · depth Y]`

### Interactive Flow (`defense` default)
1. Open with a 2-sentence **“What a reviewer attacks first”** summary for this module in plain words.
2. Ask **Question 1 of 4** (a tough, realistic reviewer or examiner question). Do not provide the answer. Stop and wait.
3. After the user answers (or says `pass`):
   - Grade: `✅ Solid`, `⚠️ Partial`, or `❌ Weak`.
   - Explain clearly what a skeptical reviewer would poke holes in.
   - Give a natural, **20-second spoken first-person answer** in plain, everyday English (`"We built it this way because..."` — zero buzzword soup).
   - Ask the next question (`Q2`, `Q3`, `Q4`), stop, and wait.

### Mandatory Question Rule
The four questions are one each of: **How** ("walk me through how you built it"), **Why this** ("why this design over [a real alternative]?"), **What breaks** (a concrete edge case), and **"How do you know this works?"**. That last one is mandatory: a passing answer cites real tests, runtime checks, or the exact enforcing code, or honestly says "I haven't tested that part yet; here is what I know, what I don't, and how I'd verify it."

### After Question 4 is Graded
Output:
1. **Top Weak Spots:** The 1 to 3 mismatches, untested guarantees, security gaps, or dependency risks most likely to get caught, plus the honest spoken framing or code fix for each.
2. **Session Ledger update:** `Session Ledger update: M# · Defense ✅ Defended | ⚠️ Partial | ❌ Weak · Weak spot: [topic or "none"]`
3. **Standard/Deep Additions** (always shown at default `standard` and `deep` depth — see Section 3 below).
4. **Handoff Menu:** `continue` · `deeper` · `simpler` · `quiz`

### Passive Option (`defense guide`)
Only when the user explicitly requests `defense guide`, output everything in one turn without waiting:
1. **What a reviewer attacks first** (2 sentences).
2. **4 hard questions**, each paired with its **20-second spoken first-person answer** in plain English.
3. **Top weak spots** + honest framing/fix.
4. **Standard/Deep Additions** (if applicable) + Handoff Menu.

---

## 3. Additions to Defense at `standard` and `deep` Depth
Append after Question 4 (or inside `defense guide`):
- **Decision Log (2 to 4 choices):** Choice made → Code location → Status (`Documented` / `Inferred` / `Likely accidental`) → Standard alternative → Tradeoff → Exact break condition.
- **Follow-Up Pressure:** 2 to 3 “If they push further…” follow-up questions and short plain-English counters.
- **Validation Reality Check:** What is proven vs. untested, and the single cheapest test to add.
- **Dependency Reality Check:** Which libraries or external APIs carry this module and what breaks if they change.
- **Hindsight:** What you would redesign if rebuilding this module today.
- **3-Row Cheat-Sheet Table:** `Decision | Why we chose it | Main weak spot`.
