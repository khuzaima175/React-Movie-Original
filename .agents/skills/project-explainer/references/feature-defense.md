# Feature defense (`feature <name>`, `feature <name> challenge`, `why <decision>`)

An intelligent reviewer asks four things about any non-obvious feature: how it works, why this design and not another, what breaks it, and how you know it works. Modules explain the system; this file prepares the user to explain and defend its headline features in **easy, everyday English**.

## Choosing features
At Step 0, list 3–6 headline features: algorithms, pipelines, caches, integrations, anything a reviewer would call impressive or suspicious. Skip routine CRUD and UI styling.

## Two-Mode Flow
- **Default (`feature <name>`):** Output the **Feature Card** first (with `[Documented]`, `[Inferred]`, or `[Accidental]` tags), then end with: *"In your words, was that choice intentional or AI-picked — and would you like to drill `quiz` or `defense` on it?"*
- **Challenge (`feature <name> challenge`):** Ask `"In your words, why this design?"` **first** and stop to wait. Once the user answers (or says `pass`), compare their answer against the code evidence, then show the full Feature Card.

## Feature Card (`feature <name>`, ~350–500 words, easy everyday English)
Explain every step and constant in plain, clear words (define any technical term inline) with concrete numbers — do not use forced analogies or unexplained buzzwords:
- **What it does:** 1–2 plain sentences.
- **How it's built:** 3–4 clear numbered steps in easy English, showing exact input → intermediate values → output. Cite file/function only in `code` or `deep` mode.
- **Why this design:** The problem, the real alternative a reviewer would name, why this won, and what it costs. Tag the reasoning `[Documented]` (spec, comment, or commit says so), `[Inferred]` (guessed from code), or `[Accidental]` (no reason found).
- **Why these numbers:** Each key number/constant: value, what it controls, effect of raising or lowering it (with a worked example), and whether it was tuned or guessed.
- **What breaks it:** Two failures — one weird input edge case and one scale, timing, or external-API failure.
- **How do you know:** The real test or check that proves it, or the smallest check to add.
- **Expect these questions:** One how, one why-not-X, and one what-if question, each with a quick 1–2 sentence plain-English hint for answering.

## `why <decision>` (~200–300 words, easy everyday English)
One choice or constant: problem → best real alternative → tradeoff accepted → exact break condition → worked number → evidence tag.

## Rules
- Never invent the author's reasoning. If the user doesn't remember and the code/docs are silent, say `[Inferred]` and give the strongest reason the code supports.
- Alternatives must be ones a reviewer would actually raise. Beating a weak strawman fails in real reviews.
- "I guessed this number; here is how I would test and tune it" beats a fake excuse. Reviewers spot fake numbers fast.
- Put a worked number on every constant you explain.

## Example (fictional illustrative format — FeedRanker)
**Feature: time-decay ranking (`Score = (Likes + 2 × Comments) ÷ (Hours + 2)^1.5`).** Keeps newer posts with real discussion ahead of old viral posts.
**How it's built:**
1. Add likes plus `2 ×` comments so discussion counts double.
2. Add `2` to the post's age in hours so brand-new posts (`0` hours old) never divide by zero.
3. Divide engagement by `(Hours + 2)^1.5` so older posts lose score smoothly every hour instead of vanishing all at once.
**Why this design:** `[Inferred]` Chronological order buries good posts in minutes, and a hard 24-hour cutoff causes a sudden cliff. With this formula, a `1h` post (`10` likes, `5` comments) scores `(10 + 10) ÷ 3^1.5 = 20 ÷ 5.196 ≈ 3.85`, beating a `22h` post (`100` likes, `10` comments) at `(100 + 20) ÷ 24^1.5 = 120 ÷ 117.58 ≈ 1.02`.
**Why gravity = `1.5` and offset = `2`:** Offset `+ 2` prevents dividing by zero at `0h` (`÷ 2^1.5 ≈ 2.83`) and stops brand-new posts from spiking unfairly. Gravity `1.5` drops a post's score steadily as hours grow; raising it turns the feed over faster, lowering it keeps popular posts longer. `[Needs validation]` No tuning log found in repo.
**What breaks it:** A bad clock timestamp (`Hours ≤ −2`) makes the base zero or negative (`NaN` in JS or complex/`TypeError` on sort in Python). `[Needs test]` Also fails to show niche posts if every post comes from one giant burst at the same hour.
**Expect:** "Why power-law decay instead of exponential decay?" / "How did you pick `1.5` and `2×`?" / "What happens when a user's device clock is 3 hours ahead?"
