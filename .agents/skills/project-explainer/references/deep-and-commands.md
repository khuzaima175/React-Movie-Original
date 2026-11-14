# Standard/Deep Teaching Additions & Specialized Commands

Load this file when `depth` is `deep` (or when switching `brief → standard`), when the user runs `deeper`, or when the user runs `code`, `trace`, `change`, `security`, `simplify`, `deps`, or `prove`.

Write every section below in **easy, everyday English**: short sentences, common words, inline plain-English definitions for any technical term, and concrete numbers instead of forced analogies.

## Contents
- 1. Teaching Additions at `standard` Depth (Default)
- 2. Teaching Additions at `deep` Depth
- 3. Specialized Command Protocols (`code`, `trace`, `change`, `security`, `simplify`, `deps`, `prove`)

---

## 1. Teaching Additions at `standard` Depth (Default, ~450–750 words total)

`standard` is the default depth for Phase A teaching (`M0` and `M1+`).
*(If the session was in `brief` mode and the user ran `deeper` to reach `standard`, emit ONLY these newly added sections — do not repeat the Brief Card already shown.)*

- **ASCII Flow Diagram:** A clear visual path (`Input ──► Step 1 ──► Step 2 ──► Output`).
- **Step-by-Step Mechanics:** 3 to 5 numbered steps explaining what each step does and why, in easy everyday English.
- **Worked Example:** Step-by-step inputs, intermediate numbers at every stage, and final output.
- **Key Settings (Top 2–3 Knobs):** Setting/constant name, `file:line`, current value, and what changes when raised vs. lowered.
- **Why This Design:** Real alternative a reviewer would expect, why this choice won, and what it costs.
- **Status Tags:** Label key parts with `[Load-bearing]`, `[Optional]`, `[Likely accidental]`, or `[Needs validation]`.
- **Trust & Dependency Note:** 1 to 2 plain sentences if the module handles untrusted user input, secret names, external APIs, or a major third-party package.

---

## 2. Teaching Additions at `deep` Depth (No word cap, structured)

Include all `standard` sections, plus:
*(When entered via `deeper` from `standard` on the current module, emit ONLY the newly added sections below — do not repeat the `standard` sections already shown.)*

- **The 7-Step Math Ladder** (for every formula in the module, in plain words with concrete numbers):
  1. *Plain sentence:* What the formula achieves in everyday words.
  2. *Plain-English intuition:* Why each piece of the formula behaves the way it does (direct explanation of cause and effect — no forced analogies).
  3. *Unicode formula + Legend:* Clean Unicode equation with every symbol, unit, and valid range defined in plain words.
  4. *Worked numbers:* Step-by-step arithmetic with realistic inputs showing every intermediate value.
  5. *Sensitivity check:* What happens to the result if the main parameter is doubled or halved (with numbers).
  6. *Break point:* The exact edge case (`0`, negative, huge number, `null`, `NaN`) where the formula misleads or crashes. (Example: for `(Likes + 2 × Comments) ÷ (Hours + 2)^1.5`, if a timestamp is more than 2 hours in the future, `Hours + 2` goes negative: `NaN` in JavaScript, or a complex number—then a `TypeError` when sorting—in Python. Test with `+3 hours`, not `+5 minutes`.)
  7. *Code vs. Math check:* Does `file:function:line` actually implement this exact formula, or is there a `⚠️ Mismatch`?
- **All Knobs & Magic Numbers:** Every tunable parameter or hardcoded threshold in the module (`name`, `value`, `file:line`, effect).
- **Key-Function Walkthrough:** Step-by-step execution walkthrough citing `file:function:line-range`, explained plainly before citing code details.
- **Change Impact & Tests to Add:** What breaks if touched, and exact unit/integration test cases to write.
- **Security & Dependency Pass:** Trust boundaries, missing input checks, load-bearing libraries, and upgrade risks.
- **Accidental Complexity List:** Over-engineered or dead pieces with removal confidence (`high` / `medium` / `low`).

---

## 3. Specialized Command Protocols

### `code`
Show the minimal code coordinates for the current module now that the idea is clear:
- **Main file & entry function:** `file:function:line-range`
- **Called by (upstream):** Direct callers.
- **Calls into (downstream):** Key internal helpers or external libraries.
- **Where to edit:** The exact spot for common changes.

### `trace <flow>`
Follow one concrete request or data path end-to-end across modules:
- Use numbered hops (`Hop 1 → Hop 2 → Hop 3...`).
- At each hop state in plain words: **What happens (plain role)** + **How the data changes** + `file:function:line-range` + **Main failure mode** + **Async/error/fallback branch** (what happens if this hop times out, throws, or falls back silently).
- Budget: ~350–600 words so every hop is clear and complete.

### `change <goal>`
Give a safe modification plan (~200–350 words; offer `deeper` if complex; never turn into a quiz):
1. **Where to touch:** Exact files and functions.
2. **Smallest safe change:** The minimal edit or logic change, explained clearly.
3. **What could break (blast radius):** Callers, saved state assumptions, or schemas affected.
4. **Safe rollout / rollback check:** When touching saved data, schemas, or external APIs, state how to guard behind a setting/flag or verify safe rollback.
5. **How to verify:** Exact existing test to run + 1 new test to add.

### `security`
Run a practical security review (~250–350 words for current module; ~500 words for whole project) in plain English. Never call the code “secure”:
- **Untrusted inputs:** Where user or external data enters.
- **Trust boundaries & privileged actions:** Auth checks, DB writes, shell/eval calls, file access, network calls.
- **Secrets (names/locations only):** Env vars or config files referenced (flag hardcoded literals immediately without printing secret values).
- **Concrete abuse path & missing checks:** How bad input or an attacker breaks it, and the exact fix.

### `simplify`
List candidates for deletion or simplification:
- Group by confidence: `high` (dead/unused), `medium` (redundant wrapper), `low` (suspicious but possibly needed elsewhere).
- For every item, state the **exact check required before deleting** (e.g., `git grep`, route check, dynamic import check).

### `deps`
Audit load-bearing third-party packages:
- **Package & job:** What core behavior it handles.
- **Risk profile:** Unpinned version, outdated major version, install-script hooks (`postinstall`), or unmaintained package.
- **Blast radius:** What breaks if removed or upgraded.

### `prove`
Show the strongest hard evidence for the current module:
- **Enforcing code:** Exact `file:function:line-range` for core claims.
- **Test evidence:** Existing test files/cases and command output (if run).
- **Predict the Output micro-check:** Walk one concrete edge input step by step through the real code/formula and compare predicted vs. actual result (flagging any `⚠️ Mismatch`).
- **Unproven gap:** What is still only assumed or docs-based, and the cheapest check to prove it.
