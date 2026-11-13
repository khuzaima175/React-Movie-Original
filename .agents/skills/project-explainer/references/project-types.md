# Project Types, Learning Order, and Hotspots

Use this reference during **Step 0.2** and **Step 0.3** to order modules by **learning dependency** (never by folder layout) and to spot domain-specific bugs early.

## Goal Emphasis Shift

| Active Goal | What to Emphasize Across Modules | Brief Card Focus (`Main catch` & `How to check`) |
|---|---|---|
| `explain` / `defend` *(default)* | Design choices, tradeoffs, weak spots, and reviewer traps. | **Main catch:** biggest assumption or `⚠️ Mismatch`; **How to check:** hand-trace or smallest proof check. |
| `debug` | Execution flow, state mutations, race conditions, and edge cases. | **Main catch:** state mutation, null/NaN edge, or silent fallback; **How to check:** reproduce or assert failing boundary input. |
| `extend` | Module boundaries, coupling, invariants, and safe extension points. | **Main catch:** hidden callers, tight coupling, or fragile invariants; **How to check:** test downstream caller behavior after change. |
| `simplify` | Accidental complexity, dead scaffolding, and removable abstractions. | **Main catch:** redundant wrappers, unused config, or dead branches; **How to check:** `git grep` / caller check before deletion. |
| `audit` | Trust boundaries, untrusted inputs, secrets, missing validation, and risky dependencies. | **Main catch:** unvalidated input, missing authz, or secret/dep risk; **How to check:** negative/abuse input check or lockfile audit. |

## Doc/Spec Verification Checklist

When `README.md`, `SPEC.md`, `ARCHITECTURE.md`, or comments make factual claims, treat them as unverified until cross-checked against code:

- **Constants & formulas:** Re-derive exact coefficients, weights, timeouts, and thresholds against enforcing lines.
- **Routes, signatures & inputs:** Confirm documented endpoints, CLI flags, and schemas actually exist and reject malformed data.
- **Auth & trust boundaries:** Verify middleware, role checks, or rate limits are actually wired into every claimed path.
- **Env vars & feature flags:** Confirm every documented env var name and fallback matches what the code reads at runtime.

## Architecture Order & Hotspot Matrix

| Project Type | Recommended Module Order | High-Priority Hotspots to Check |
|---|---|---|
| **Web / Full-stack** | Data model → server domain logic → auth/session state → UI state → deploy | Session handling, caching bugs, race conditions, missing timeouts, broken authz (IDOR), SSRF. |
| **Recommender / Ranking** | Ingestion → profile math → candidate generation → scoring/ranking → cache | Magic weights, time-decay curves, normalization bugs, cold-start fallbacks, stale cache. |
| **ML Pipeline / Data Science** | Dataset/schema → feature engineering → model/loss → evaluation → serving | Train/test data leakage, target leakage, metric mismatch, unseeded randomness, training-serving skew. |
| **LLM / Agent App** | Context/prompts → retrieval (RAG) → tool definitions → output parsing/validation → fallbacks | Prompt injection, excessive tool permissions, unvalidated JSON output, leaked API keys, runaway retry loops/cost. |
| **Data / ETL Pipeline** | Sources → parsing/transforms → storage/sinks → scheduling → data quality checks | Missing idempotency (duplicate rows on retry), schema drift, partial failure state, bad join keys, timezone windows. |
| **Backend / API Service** | Request routing/validation → domain rules → persistence/DB → concurrency/queues | Missing DB transactions, N+1 queries, missing rate limits, naive retries without backoff, broken authz. |
| **Mobile / Frontend App** | Navigation/entry → state management → network/sync → offline cache → rendering | Stale state, race conditions on fast clicks, cache invalidation, unguarded null data, offline retry bugs. |
| **Game / Simulation** | Main loop → state/physics step → collision/rules → rendering → input handling | Frame-rate tied physics (missing `Δt`), collision tunneling, unseeded RNG, floating-point drift. |
| **CLI / Library / SDK** | Public API surface → core engine → config/env resolution → plugins/extensions | Flag/config precedence bugs, breaking return types, swallowed exit codes, unsafe plugin execution. |
| **Infra / DevOps / IaC** | Provisioning → network/IAM → deployment pipeline → secret injection → monitoring | Overly broad IAM (`*`), blast radius on re-run, state drift, plaintext secrets in logs/state. |
| **Smart Contracts / Web3** | Storage state → access control → value/token flows → oracle/external calls → upgrades | Reentrancy, integer rounding/precision loss, stale oracle prices, missing access modifiers, front-running (MEV). |
| **Research / Numerical Code** | Mathematical model → numerical solver → experiment runner → metrics/plots | Division by near-zero, matrix instability, hardcoded hyperparameters, unpinned random seeds, cherry-picked splits. |
