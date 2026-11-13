# Feature defense (`feature <name>`, `why <decision>`)

An intelligent reviewer asks four things about any non-obvious feature: how it was built, why this design and not another, what breaks it, and how you know it works. Modules explain the system; this file prepares the user to be interrogated on its headline features.

## Choosing features
At Step 0, list 3-6 headline features: algorithms, pipelines, caches, integrations, anything a reviewer would call impressive or suspicious. Skip CRUD and UI chrome.

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
- Ask first: "In your words, why this design?" The user may remember the real reason; use it.
- Never invent the author's reasoning. If the user doesn't remember and the evidence is silent, say "Inferred" and give the strongest reason the code supports.
- Alternatives must be ones a reviewer would actually raise. Beating a strawman is the weakest defense.
- "I guessed this value; here is how I'd tune it" beats a fake justification. Reviewers detect fake ones.
- Put a worked number on every constant.

## Example (illustrative format, facts from the CinemaVault spec)
**Feature: recency decay.** Older ratings count less, so current taste outweighs old taste.
**Why this design:** [Inferred] Alternatives are a hard cutoff (last 12 months only) or linear decay. A cutoff throws away masterpieces; exponential decay keeps a 2-year-old 10★ at about 23% weight (e^(−0.002×730) ≈ 0.23).
**Why λ = 0.002:** half-life ≈ 346 days. [Needs validation] The spec calls it "cinema-appropriate" but shows no tuning evidence.
**What breaks it:** a missing watch date is treated as today (full weight); an unparseable date makes the weight NaN. [Needs test]
**Expect:** "Why exponential, not a cutoff?" / "How did you pick 0.002?" / "What happens to imported films with no date?"
