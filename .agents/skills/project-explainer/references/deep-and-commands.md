# Standard/Deep Teaching Additions & Specialized Commands

Load this file when `depth` is set to `standard` or `deep`, when the user runs `deeper`, or when the user runs `code`, `trace`, `change`, `security`, `simplify`, `deps`, or `prove`.

## Contents
- 1. Teaching Additions at `standard` Depth
- 2. Teaching Additions at `deep` Depth
- 3. Specialized Command Protocols (`code`, `trace`, `change`, `security`, `simplify`, `deps`, `prove`)

---

## 1. Teaching Additions at `standard` Depth (~500–850 words total)

Start with the **Phase A Brief Card**, then append:
*(When entered via `deeper` on the current module, emit ONLY these newly added sections — do not repeat the Brief Card.)*

- **ASCII Flow Diagram:** A compact visual path (`Input ──► Step 1 ──► Step 2 ──► Output`).
- **Worked Example:** Up to 4 numbered steps showing intermediate values at each stage.
- **Top 2 Knobs:** Constant/config name, `file:line`, and what happens when raised vs. lowered.
- **Why This Design:** A one-line *why this design* explaining the choice over real alternatives.
- **Status Tags:** Label key parts with `[Load-bearing]`, `[Optional]`, `[Likely accidental]`, or `[Needs validation]`.
- **Trust & Dependency Note:** 1 to 2 sentences if the module handles untrusted input, secrets, external calls, or relies heavily on a third-party package.

---

## 2. Teaching Additions at `deep` Depth (No word cap, structured)

Include all `standard` sections, plus:
*(When entered via `deeper` from `standard` on the current module, emit ONLY the newly added sections below — do not repeat the Brief Card or `standard` additions.)*

- **The 7-Step Math Ladder** (for every formula in the module):
  1. *Plain sentence:* What the formula achieves in everyday words.
  2. *Physical analogy:* One concrete real-world comparison.
  3. *Unicode formula + Legend:* Clean Unicode equation with every symbol, unit, and valid range defined.
  4. *Worked numbers:* Step-by-step arithmetic with realistic inputs.
  5. *Sensitivity check:* What happens to the output if the main parameter is doubled or halved?
  6. *Break point:* The exact edge case (0, negative, huge number, `null`, `NaN`) where the formula misleads or crashes. (Example: for `(Likes + 2 × Comments) ÷ (Hours + 2)^1.5`, if a timestamp is more than 2 hours in the future, `Hours + 2` goes negative: `NaN` in JavaScript, or a complex number—then a `TypeError` when sorting—in Python. Test with `+3 hours`, not `+5 minutes`.)
  7. *Code vs. Math check:* Does `file:function:line` actually implement this exact formula, or is there a `⚠️ Mismatch`?
- **All Knobs & Magic Numbers:** Every tunable parameter or hardcoded threshold in the module.
- **Key-Function Walkthrough:** Execution walkthrough citing `file:function:line-range`.
- **Change Impact & Tests to Add:** What breaks if touched, and exact unit/integration test cases to write.
- **Security & Dependency Pass:** Trust boundaries, missing validation, load-bearing libraries, and upgrade risks.
- **Accidental Complexity List:** Over-engineered or dead pieces with removal confidence (`high` / `medium` / `low`).

---

## 3. Specialized Command Protocols

### `code`
Show the minimal code coordinates for the current module now that the concept is clear:
- **Main file & entry function:** `file:function:line-range`
- **Called by (upstream):** Direct callers.
- **Calls into (downstream):** Key internal helpers or external libraries.
- **Where to edit:** The exact spot for common modifications.

### `trace <flow>`
Follow one concrete request or data path end-to-end across modules:
- Use numbered hops (`Hop 1 → Hop 2 → Hop 3...`).
- At each hop state: **Logical role** + **Data shape change** + `file:function:line-range` + **Main failure mode** + **Async/error/fallback branch** (what happens if this hop times out, throws, or falls back silently).
- Budget: ≤ 400 words (up to 600 words if crossing more than 5 module boundaries).

### `change <goal>`
Give a safe modification plan in ≤ 200 words (offer `deeper` if complex; never turn into a quiz):
1. **Where to touch:** Exact files/functions.
2. **Smallest safe change:** The minimal diff or logic adjustment.
3. **Blast radius (what could break):** Callers, state assumptions, or schemas affected.
4. **Safe rollout / rollback check:** When touching persisted state, schemas, or external APIs, state how to guard behind a feature flag or verify safe rollback.
5. **How to verify:** Exact existing test to run + 1 new test to add.

### `security`
Run a practical security review (≤ 250 words for current module; ≤ 500 words for whole project). Never declare the code “secure”:
- **Untrusted inputs:** Where user/external data enters.
- **Trust boundaries & privileged actions:** Auth checks, DB writes, shell/eval calls, file access, network requests.
- **Secrets (names/locations only):** Env vars or config files referenced (flag any hardcoded literals immediately without printing secret values).
- **Concrete abuse path & missing validation:** How an attacker or bad input breaks it, and the 1-line fix.

### `simplify`
List candidates for deletion or simplification:
- Group by confidence: `high` (dead/unused), `medium` (redundant wrapper), `low` (suspicious but possibly needed externally).
- For every item, state the **exact check required before deleting** (e.g., `git grep`, route check, dynamic import check).

### `deps`
Audit load-bearing dependencies:
- **Package & job:** What core behavior it provides.
- **Risk profile:** Unpinned version, outdated major release, install-script hooks (`postinstall`), or abandoned package.
- **Blast radius:** What breaks if removed or upgraded.

### `prove`
Show the strongest hard evidence for the current module:
- **Enforcing code:** Exact `file:function:line-range` for core claims.
- **Test evidence:** Existing test files/cases and command output (if run).
- **Predict the Output micro-check:** Walk one concrete edge input through the actual code/formula and compare predicted vs. implemented result (flagging any `⚠️ Mismatch`).
- **Unproven gap:** What is still only assumed or docs-based, and how to prove it.
