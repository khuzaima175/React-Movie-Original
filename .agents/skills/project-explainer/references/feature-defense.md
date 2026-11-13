# Feature defense (`feature <name>`, `feature <name> challenge`, `why <decision>`)

An intelligent reviewer asks four things about any non-obvious feature: how it was built, why this design and not another, what breaks it, and how you know it works. Modules explain the system; this file prepares the user to be interrogated on its headline features.

## Choosing features
At Step 0, list 3-6 headline features: algorithms, pipelines, caches, integrations, anything a reviewer would call impressive or suspicious. Skip CRUD and UI chrome.

## Two-Mode Flow
- **Default (`feature <name>`):** Output the **Feature Card** first (with `[Documented]`, `[Inferred]`, or `[Accidental]` tags), then end with: *"In your words, was that choice intentional or AI-picked — and would you like to drill `quiz` or `defense` on it?"*
- **Challenge (`feature <name> challenge`):** Ask `"In your words, why this design?"` **first** and stop to wait. Once the user answers (or says `pass`), compare their reasoning against the code evidence, then show the full Feature Card.

## Feature Card (`feature <name>`, about 300 words)
- **What it does:** one sentence.
- **How it's built:** three plain steps, then data in → data out. File/function only in `code` or `deep` mode.
- **Why this design:** the problem, the alternative a competent reviewer would name, why this won, and what it costs. Tag the reasoning `[Documented]` (spec, comment, or commit says so), `[Inferred]` (you are guessing), or `[Accidental]` (no reason found).
- **Why these numbers:** each constant: value, what it controls, effect of raising or lowering, and whether it was tuned or guessed.
- **What breaks it:** two failures, one input edge case and one scale or dependency case.
- **How do you know:** the test or check, or the smallest one to add.
- **Expect these questions:** one how, one why-not-X, one what-if.

## `why <decision>` (about 150 words)
One choice or constant: problem → best real alternative → tradeoff accepted → break condition → evidence tag.

## Rules
- Never invent the author's reasoning. If the user doesn't remember and the evidence is silent, say `[Inferred]` and give the strongest reason the code supports.
- Alternatives must be ones a reviewer would actually raise. Beating a strawman is the weakest defense.
- "I guessed this value; here is how I'd tune it" beats a fake justification. Reviewers detect fake ones.
- Put a worked number on every constant.

## Example (fictional illustrative format — FeedRanker)
**Feature: time-decay ranking (`Score = (Likes + 2 × Comments) ÷ (Hours + 2)^1.5`).** Newer, higher-effort posts stay ahead of stale viral ones.
**Why this design:** `[Inferred]` Alternatives are pure chronological order (buries great posts after minutes) or linear decay (drops to zero abruptly). Power-law decay keeps a 1h post with 10 likes & 5 comments at `20 ÷ 3^1.5 ≈ 3.85`, beating a 22h post with 100 likes & 10 comments (`120 ÷ 24^1.5 ≈ 1.02`).
**Why gravity = 1.5 and offset = 2:** Offset `+ 2` prevents dividing by zero on brand-new posts (`0h` → `÷ 2^1.5 ≈ 2.83`); gravity `1.5` halves visibility roughly every few hours. `[Needs validation]` No tuning benchmark found in repo.
**What breaks it:** A future-skewed timestamp (`Hours ≤ −2`) turns the base negative → `NaN` in JS or complex/`TypeError` on sort in Python. `[Needs test]`
**Expect:** "Why power-law instead of exponential decay?" / "How did you pick 1.5 and 2×?" / "What happens when a client clock is 3 hours fast?"
