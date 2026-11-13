# Project Types, Learning Order, and Hotspots

Use this reference during **Step 0.2** and **Step 0.3** to order modules by **learning dependency** (never by folder layout) and to spot domain-specific bugs early.

## Goal Emphasis Shift

| Active Goal | What to Emphasize Across Modules |
|---|---|
| `explain` / `defend` | Design choices, tradeoffs, weak spots, and reviewer traps. |
| `debug` | Execution flow, state mutations, race conditions, and edge cases. |
| `extend` | Module boundaries, coupling, invariants, and safe extension points. |
| `simplify` | Accidental complexity, dead scaffolding, and removable abstractions. |
| `audit` | Trust boundaries, untrusted inputs, secrets, missing validation, and risky dependencies. |

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
