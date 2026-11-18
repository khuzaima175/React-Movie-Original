# Public Launch Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CinemaVault safe and presentable to publish on GitHub and share on LinkedIn from a single codebase supporting two modes: a clean **Public / Commercial Edition** (no debug/model telemetry, Flash-Lite–first 500/day quota protection, optional Bring-Your-Own-Key, calm on-device fallback, sample vault, clean docs/repo, verified-clean secrets) and a **Personal / Debug Edition** for the owner (`?debug=1` sticky toggle or `VITE_APP_EDITION=personal` / `vite --mode personal` with full Gemini model bars, chips, cooldown reasons, and `gemini-4-hydrogen`-first curation).

**Architecture:** Seven phases, each independently shippable and leaving `npm test` and `npm run build` green. Pure logic goes into small testable service helpers (the repo's existing pattern, `node --test` on `src/services/*` and `api/*`); React/CSS changes are thin wrappers over those helpers and are verified manually in the browser. AI availability uses three layers so public traffic fits a 500 req/day Flash-Lite quota without breaking: (1) Vercel `/api/gemini` shared proxy using Flash-Lite first with per-IP (`30`) and global (`450`) daily caps, (2) optional browser-only "Bring Your Own Gemini Key" (`localStorage` -> direct Google SDK, zero server relay), and (3) automatic degradation to the on-device hybrid ranker with a calm notice.

**Tech Stack:** React 18, Vite 5, Tailwind v4 + hand CSS (`src/styles/*`, `src/index.css`), Vercel Functions (`api/*.js`), Node built-in test runner, Supabase (optional sync).

**Spec:** The audit from the review conversation, condensed in "Audit Findings" below. This plan is its own spec; there is no separate design doc.

## Audit Findings (the requirements)

| # | Finding | Evidence | Task |
|---|---------|----------|------|
| A1 | Current TMDB + OMDb keys equal keys that exist in pushed git history; Gemini key is clean | History scan (OMDb in 20 commits, TMDB in `08cd710`/`16379d3`) | T1 |
| A2 | Raw Gemini model slugs and cascade telemetry shown to users (chat bar, per-message chip, "About these picks", loading step, enhancing pill) — needs separation between Public and Personal editions | `AIChat.jsx` L384-403, L514-525; `MovieRecommendations.jsx` L193, L1120, L1124-1139; `oracleViewHelpers.js` `formatRecBadgeSummary` | T2-T4 |
| A3 | `/api/gemini` forwards unbounded prompt/config; rate limits are per cold-start isolate; 500/day Flash-Lite shared quota can be exhausted without BYOK overflow | `api/gemini.js` L69-73, `api/_security.js` L151-183, `apiTransport.js` | T5-T7 |
| A4 | Cascade/allowlist model IDs not verified against a live key; `CURATION_MODEL_CASCADE` tries `gemini-4-hydrogen` before 500/day `gemini-3.5-flash-lite` | `geminiService.js` L61-87, `api/gemini.js` L4-14 | T2, T8 |
| A5 | Stale `gh-pages` deploy scripts, unused testing deps, CRA eslint config | `package.json` | T9 |
| A6 | `MoviePage` Back button breaks on direct links | `MoviePage.jsx` L27-29 | T10 |
| A7 | Mobile bulk bar overlaps bottom nav; footer padding breakpoint mismatch | `vault.css` L694-710, `nav-discover.css` L243-256, `App.jsx` L228 | T11 |
| A8 | Vault "no match" state shows trivia and dead chips | `VaultPage.jsx` L303, `EmptyState.jsx` | T12 |
| A9 | Emoji remain in UI (`🍅`, `⛔`, chat error strings) against the no-emoji design rule | `MovieDetails.jsx` L1155, `ErrorMessage.jsx`, `geminiChatService.js` L126-137 | T4, T13 |
| A10 | No per-route titles, no Open Graph tags (bad LinkedIn preview) | `index.html` | T15, T16 |
| A11 | Empty vault gives visitors nothing to look at | `App.jsx` auto taste-deck, `VaultPage` empty state | T17-T18 |
| A12 | 1.4 MB single JS chunk | `npm run build` warning | T19 |
| A13 | Dead files/CSS/imports, duplicate backup modal, stale "3-bucket" copy | `TrailerModal.jsx`, `geminiExplanationService.js`, `index.css` legacy blocks | T20 |
| A14 | Docs: LLM preamble in `SPEC.md`, duplicate `summary.md`, conflicting test counts, no `LICENSE`, compare-tray storage mismatch, outdated screenshot | `SPEC.md` L1-16, `README.md` vs `summary.md` | T21, T23 |
| A15 | Tracked `.agents/` skill files, stale branches/worktree, `origin/gh-pages` | `git ls-files .agents` (38 files), `git branch -a` | T22 |
| A16 | Oracle Studio Deck (`Mood & Streaming` view) looks flat/dull: 6 text-only dark rectangles, no icons or visual cinema depth | User screenshot, `MovieRecommendations.jsx` L585-780, `oracle.css` L94-280 | T14 |

## Global Constraints

- Node ESM (`"type": "module"`); tests live in `tests/*.test.js` and run with `npm test` (`node --test`).
- No new runtime dependencies. Dev-dependency removals only (T8).
- UI has **no emoji** and gold (`--accent`) is reserved for stars, scores and focus rings (`SPEC.md` token rules).
- Never print secret values in logs, test output or commits; scripts report key *names* and CLEAN/FOUND only.
- Docs must not hard-code test counts or module counts.
- Production browser bundle must contain no API keys; `rg "AIzaSy" build/` must return nothing.
- Preserve each file's existing line endings (many files are CRLF); do not reformat unrelated lines.
- Conventional commits: `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`, `docs(scope): ...`, `test(scope): ...`.
- **Work on branch `chore/public-launch-polish`.** Never force-push or delete remote branches without explicit user confirmation (T22).

## Review Focus

1. **Visitor with an empty vault and an exhausted/absent Gemini quota** must still get ten picks, a calm notice, and an optional link to supply their own Gemini key (owned by T4, T7; pinned by `describePipelineNotice` tests).
2. **Odd request bodies to `/api/gemini`** (missing `contents`, array `contents`, `config: null`, oversized prompt) must return 4xx, never 500 and never reach Google (T5 tests).
3. **Sample vault then sign-in, and "Clear sample"**: sample rows must not sync to Supabase and clearing must leave real ratings untouched (T18 tests).
4. **Public vs Personal edition separation**: in the default Public build, no `gemini-` substring or raw telemetry renders in any default UI label, and curation prioritizes `gemini-3.5-flash-lite`; `?debug=1` (sticky) or `VITE_APP_EDITION=personal` enables Personal/Debug UI + `gemini-4-hydrogen`-first curation (T2, T3 tests).
5. **Direct load of `/movie/:id` then Back** must go home, not do nothing (T10 test).
6. **Optional BYOK**: saving a user Gemini key routes AI calls directly via Google SDK without hitting `/api/gemini` or syncing the key to Supabase; clearing it reverts cleanly to the shared proxy (T7 tests).

---

## Phase 0: Safety Gate

### Task 1: Secrets-in-history guard and working branch

**Files:**
- Create: `scripts/check_secrets_in_history.mjs`
- Create: `tests/secretsGuard.test.js`
- Modify: `package.json` (add script `"check:secrets": "node scripts/check_secrets_in_history.mjs"`)

**Interfaces:**
- Produces: `parseEnvText(text: string): Array<{ key: string, value: string }>` exported from the script (skips blanks, `#` comments, empty values and placeholders matching `/^your_.*_here$/i`; strips surrounding quotes). `isScannable(entry: { key: string, value: string }): boolean` true when key matches `/KEY|TOKEN|SECRET/i` and `value.length >= 8`.

- [ ] **Step 1: Commit the existing WIP on a new branch**

Run: `git switch -c chore/public-launch-polish; npm test; npm run build`
Expected: both exit 0 (tests all pass, build green). Then `git add src/components/MovieCard.jsx src/components/MovieDetailEffects.jsx src/components/MovieDetails.jsx src/services/posterFlight.js` and `git commit -m "feat(ui): poster flight transition into detail page"`.

- [ ] **Step 2: Write failing tests in `tests/secretsGuard.test.js`**
  - `parseEnvText ignores comments, blanks, empty values and your_*_here placeholders`: input with `# c`, `A=`, `B=your_x_here`, `C="abc12345"` returns `[{ key: "C", value: "abc12345" }]`.
  - `isScannable accepts 8-char OMDb-style values and rejects URLs and short values`: `{key:"VITE_OMDB_KEY",value:"ab12cd34"}` true; `{key:"VITE_SUPABASE_URL",value:"https://x.supabase.co"}` false; `{key:"VITE_X_KEY",value:"abc"}` false.

- [ ] **Step 3: Run `node --test tests/secretsGuard.test.js`** — Expected: FAIL (module missing).

- [ ] **Step 4: Implement the script.** Importing it must not run the scan (guard main with `import.meta.url === pathToFileURL(process.argv[1]).href`). Main reads `.env` and `.env.local` if present, and for each scannable entry runs `git log --all -S<value> --format=%h` via `execFileSync` (array args, no shell). It prints one line per key `KEY: CLEAN` or `KEY: FOUND in N commit(s)` (never the value) and exits `1` if any FOUND.

- [ ] **Step 5: Run `node --test tests/secretsGuard.test.js`** — Expected: PASS.

- [ ] **Step 6: Run the real gate: `npm run check:secrets`**
Expected: every line `CLEAN`, exit 0. **If any line says FOUND, STOP**: that key is still a historical key. Regenerate it at the provider, update `.env`/Vercel env, and re-run until all CLEAN. (Per the earlier scan, the TMDB and OMDb values were in history; confirm they were regenerated, not just the old ones disabled.)

- [ ] **Step 7: Commit** `git add scripts/check_secrets_in_history.mjs tests/secretsGuard.test.js package.json && git commit -m "chore(security): add secrets-in-history guard script"`

---

## Phase 1: Public vs Personal Edition & UI Telemetry

### Task 2: Edition/debug flags, quota-smart cascade order, and clean Oracle labels

**Files:**
- Create: `src/services/debugFlags.js`
- Create: `tests/debugFlags.test.js`
- Modify: `src/services/geminiService.js` (`getCurationCascade` + call sites)
- Modify: `src/services/oracleViewHelpers.js` (`formatRecBadgeSummary`, new `buildOracleLoadingSteps`)
- Modify: `tests/oracleViewHelpers.test.js` (existing tests at L49-92 and L203-217)
- Modify: `src/components/MovieRecommendations.jsx` (L178-194 loading steps, L583 badge summary, L1120 enhancing pill, cascade selection)
- Modify: `src/App.jsx` (call `syncDebugFlagFromSearch()` on mount so `?debug=1` / `?debug=0` persists)

**Interfaces:**
- Produces in `debugFlags.js`:
  - `isPersonalEdition({ mode, edition } = {}): boolean` — true when `edition === "personal"` or `mode === "personal"` (defaults read `import.meta.env?.VITE_APP_EDITION`, `import.meta.env?.MODE`, `globalThis.process?.env?.VITE_APP_EDITION`). Default build returns `false` (Public / Commercial Edition).
  - `syncDebugFlagFromSearch({ search, storage } = {}): boolean | null` — if URL query has `debug=1`, writes `"1"` to `cv_debug_ui` in `storage` and returns `true`; if `debug=0`, deletes `cv_debug_ui` and returns `false`; otherwise returns `null`. Gives the owner a sticky Personal/Debug toggle on the live public URL without affecting other visitors.
  - `isDebugUiEnabled({ search, storage, personal } = {}): boolean` — true when `personal ?? isPersonalEdition()` is true, OR `search` contains `debug=1`, OR (`search` does not contain `debug=0` and `storage.getItem("cv_debug_ui") === "1"`). Must NOT depend on `import.meta.env.DEV` so local dev matches production unless `"personal"` or `?debug=1` is active.
- Produces in `geminiService.js`:
  - `PUBLIC_CURATION_CASCADE` (`["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-3.8-flash", "gemini-4-hydrogen"]`) and `getCurationCascade({ personal = isPersonalEdition() } = {}): string[]` returning `CURATION_MODEL_CASCADE` when `personal` is true (keeping Hydrogen first for the owner's debug/personal edition) and `PUBLIC_CURATION_CASCADE` when false (prioritizing your 500/day `gemini-3.5-flash-lite` quota for public users).
- Produces in `oracleViewHelpers.js`:
  - `formatRecBadgeSummary(modelInfo, isCacheValid = false, queuedModel = null, { debug = false } = {}): { freshnessLabel, freshnessTone, modelLabel, hydrationLabel, tooltip }`. With `debug: true` behaviour is today's. With `debug: false`: `modelLabel` is `"AI Curated"` when `modelInfo?.model` is set (also when `isFallback`), otherwise `"On-Device Engine"`; `tooltip` is built only from `"Curated by AI from a shortlist verified against TMDB"` or `"Ranked on-device from your taste profile"`, plus `"Saved from your last session"` when cached, plus `Metadata: <hydrationLabel>` when present. No slugs, token counts, pipeline names or cooldown lists.
  - `buildOracleLoadingSteps({ watchedCount: number, queuedModel: string | null, debug?: boolean }): string[]` returning four strings; step 4 is `"Curating your final 10 picks..."` normally, `"Ranking your final picks on-device..."` when `queuedModel` is null, and `Curating final picks via ${formatModelDisplayName(queuedModel)}...` only when `debug`.

- [ ] **Step 1: Write failing tests**
  - `tests/debugFlags.test.js`: `isDebugUiEnabled({}) === false`; `({ search: "?debug=1" }) === true`; `({ search: "?debug=0", storage: { getItem: () => "1" } }) === false`; `({ storage: { getItem: () => "1" } }) === true`; `({ personal: true }) === true`; `syncDebugFlagFromSearch` persists/clears `"cv_debug_ui"` safely even if storage throws.
  - In `tests/oracleViewHelpers.test.js`: update the three existing `formatRecBadgeSummary` tests to pass `{ debug: true }` as 4th arg (assertions unchanged); add `formatRecBadgeSummary default mode never leaks model slugs` (assert `modelLabel === "AI Curated"` and no `/gemini|\d{4}|429|500KB/i`); add `default mode without a model labels On-Device Engine`; add `buildOracleLoadingSteps` tests.
  - In `tests/geminiDualEngine.test.js`: add `getCurationCascade puts flash-lite first in public edition and hydrogen first in personal edition`.

- [ ] **Step 2: Run `node --test tests/debugFlags.test.js tests/oracleViewHelpers.test.js tests/geminiDualEngine.test.js`** — Expected: FAIL.

- [ ] **Step 3: Implement `debugFlags.js`, `getCurationCascade`, `formatRecBadgeSummary`, and `buildOracleLoadingSteps`** in the files above.

- [ ] **Step 4: Wire `App.jsx` and `MovieRecommendations.jsx`**: call `syncDebugFlagFromSearch()` once in `App.jsx` on mount; in `MovieRecommendations.jsx`, compute `const debug = isDebugUiEnabled();`, pass `getCurationCascade({ personal: isPersonalEdition() })` to curation calls and `queuedModel` lookup, use `buildOracleLoadingSteps`, pass `{ debug }` to `formatRecBadgeSummary`, change L1120 enhancing pill to `debug ? "Enhancing with Gemini curation…" : "Refining picks with AI…"`, and render `badgeSummary.tooltip` inside the popover only when `debug`.

- [ ] **Step 5: Run `node --test tests/debugFlags.test.js tests/oracleViewHelpers.test.js tests/geminiDualEngine.test.js`** — Expected: PASS.

- [ ] **Step 6: Commit** `git commit -am "feat(editions): split public vs personal debug modes and hide model telemetry"` (include new files with `git add`).

### Task 3: Hide model bar and per-message model chip in chat

**Files:**
- Modify: `src/components/AIChat.jsx` (L384-403 model bar, L514-528 bubble tag, imports L9-16 and L25 `Cpu`)

**Interfaces:**
- Consumes: `isDebugUiEnabled()` from Task 2.

- [ ] **Step 1: Gate both elements** behind `const debug = isDebugUiEnabled();` — render `.chat-model-bar` and `.bubble-model-tag` only when `debug`; keep the bubble meta row's timestamp always. Clean any imports only if unused.

- [ ] **Step 2: Manual check** — `npm start`, open `/ai?tab=chat`: no model bar or chip. Open `/ai?tab=chat&debug=1`: bar and chip appear and stay visible when navigating across tabs; `?debug=0` hides them again.

- [ ] **Step 3: Run `npm run build`** — Expected: exit 0, no new warnings.

- [ ] **Step 4: Commit** `git commit -am "feat(chat): gate model telemetry bar and chips behind personal/debug mode"`

### Task 4: Calm capacity messaging, no emoji in chat errors

**Files:**
- Modify: `src/services/geminiChatService.js` (L121-138 catch block)
- Modify: `src/services/oracleViewHelpers.js` (new `describePipelineNotice`)
- Modify: `src/components/MovieRecommendations.jsx` (render notice under the toolbar)
- Create: `tests/chatErrors.test.js`
- Modify: `tests/oracleViewHelpers.test.js`

**Interfaces:**
- Produces: `mapChatErrorToMessage(error: unknown): string` exported from `geminiChatService.js`. Mapping, first match wins: message/`errorCode` matches `/RESOURCE_EXHAUSTED|quota|All chat models failed|PROXY_RATE_LIMIT/i` → `"Shared AI companion is at capacity right now. Try again in a few minutes, or use your own free Gemini key."`; `/API Key|401/i` → `"The AI service is not configured on this deployment."`; `/network|fetch/i` → `"Connection issue. Check your internet and try again."`; otherwise `"Something went wrong. Please try again in a moment."` No emoji in any string.
- Produces: `describePipelineNotice(modelInfo: object | null | undefined): string | null` returning `"Shared AI curation is at capacity, so these picks come from your on-device taste model."` when `modelInfo?.pipeline === "ranker-fallback"`, else `null`.

- [ ] **Step 1: Write failing tests** — `tests/chatErrors.test.js` covering each mapping above, including `{ message: "All chat models failed" }`, `{ errorCode: "PROXY_RATE_LIMIT" }`, and that no returned string matches `/\p{Extended_Pictographic}/u`. In `oracleViewHelpers.test.js`: `describePipelineNotice` returns the string for `{ pipeline: "ranker-fallback", model: null }`, `null` for `{ pipeline: "gemini-curation", model: "x" }`, and `null` for `null`.

- [ ] **Step 2: Run `node --test tests/chatErrors.test.js tests/oracleViewHelpers.test.js`** — Expected: FAIL.

- [ ] **Step 3: Implement** both functions; make `sendChatMessage`'s catch return `mapChatErrorToMessage(error)`. Ensure `executeCascade` returning `null` (proxy rate-limited) still surfaces as "All chat models failed" so it maps to the capacity message.

- [ ] **Step 4: Render the notice** in `MovieRecommendations.jsx` as a `role="status"` line using the existing `.mood-parse-note` class, shown when `describePipelineNotice(effectiveModelInfo)` is non-null and results are visible. (Task 7 will attach an inline `"Use your own key"` button next to this notice.)

- [ ] **Step 5: Run `npm test`** — Expected: all pass.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(ai): friendly capacity notices and emoji-free chat errors"`

---

## Phase 2: API Hardening

### Task 5: Request guard for `/api/gemini`

**Files:**
- Create: `api/_geminiGuard.js`
- Modify: `api/gemini.js` (L51-73)
- Modify: `tests/apiProxy.test.js`

**Interfaces:**
- Produces: constants `MAX_GEMINI_CONTENT_CHARS = 60000`, `MAX_GEMINI_OUTPUT_TOKENS = 16384`; `sanitizeGeminiRequest(body: object): { ok: true, contents: unknown, config: object } | { ok: false, status: 400 | 413, error: string }`. Rules: `contents` undefined/null/empty-string → `{ ok:false, status:400 }`; `JSON.stringify(contents).length > MAX_GEMINI_CONTENT_CHARS` → `status: 413`; `config` non-object/`null` becomes `{}`; `tools`, `toolConfig`, `cachedContent` are deleted from config; `maxOutputTokens` is set to `MAX_GEMINI_OUTPUT_TOKENS` when absent and clamped down to it when larger.

- [ ] **Step 1: Write failing tests** in `tests/apiProxy.test.js` (use the existing `createMockRes` and `aiFactory` pattern from the neighbouring gemini test): `api/gemini rejects oversized prompts with 413 without calling the model`; `api/gemini rejects missing contents with 400`; `api/gemini strips tools and clamps maxOutputTokens before forwarding` (capture the `generateContent` arguments: no `tools` key, `config.maxOutputTokens === 16384` for input `1000000`, and `=== 16384` when absent); `api/gemini treats config:null as empty config`.

- [ ] **Step 2: Run `node --test tests/apiProxy.test.js`** — Expected: new tests FAIL.

- [ ] **Step 3: Implement `sanitizeGeminiRequest`** and call it in `api/gemini.js` after model validation, returning `res.status(result.status).json({ error })` on failure and forwarding `result.contents`/`result.config` on success. Model allowlist and Argon gating stay unchanged.

- [ ] **Step 4: Run `node --test tests/apiProxy.test.js`** — Expected: PASS (existing gemini tests still pass).

- [ ] **Step 5: Commit** `git add api/_geminiGuard.js api/gemini.js tests/apiProxy.test.js && git commit -m "feat(api): bound Gemini proxy prompt size, output tokens and tools"`

### Task 6: Durable, optional shared rate limiting with daily caps

**Files:**
- Create: `api/_rateStore.js`
- Modify: `api/_security.js` (`enforceApiSecurity` becomes async)
- Modify: `api/gemini.js`, `api/tmdb.js`, `api/tmdb-batch.js`, `api/omdb.js` (`await enforceApiSecurity(...)`)
- Modify: `.env.example`
- Modify: `tests/apiProxy.test.js` (any direct `enforceApiSecurity` callers must `await`)

**Interfaces:**
- Produces: `createRateStore({ env = process.env, fetchFn = fetch } = {}): { durable: boolean, hit(key: string, { limit: number, windowSec: number }): Promise<{ allowed: boolean, remaining: number, retryAfterSec: number }> }`. When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are both set, `durable: true` and `hit` POSTs `${URL}/pipeline` with `[["INCR", key], ["EXPIRE", key, windowSec, "NX"]]` and a `Bearer` header; on any fetch/parse failure it falls back to the in-memory limiter (fail-open). Otherwise `durable: false` using the existing in-memory sliding window.
- Produces: `enforceApiSecurity(req, res, options): Promise<boolean>` — same semantics as today, now awaiting the store. For the `gemini` bucket, when the store is `durable`, additionally enforce `GEMINI_DAILY_PER_IP` (default `30`) per IP per 86400 s and `GEMINI_DAILY_GLOBAL` (default `450`, sized for a 500 req/day Flash-Lite free tier with safety headroom) globally per 86400 s. Any limit hit returns `429` with `errorCode: "PROXY_RATE_LIMIT"` and `Retry-After`, exactly like today (the client already treats this as "stop cascade, use ranker" and offers BYOK in Task 7).

- [ ] **Step 1: Write failing tests**: `rateStore uses memory when Upstash env is missing` (`durable === false`, third hit within limit 2 is denied); `rateStore posts INCR+EXPIRE pipeline to Upstash and denies when count exceeds limit` (fake `fetchFn` returns `[{result: 3},{result: 1}]` for limit 2 → `allowed:false`, assert Authorization header and URL, never log token); `rateStore falls back to memory when Upstash fetch throws`; `gemini handler returns 429 PROXY_RATE_LIMIT when the global daily cap is hit` (inject a stub store through `req.rateStore`).

- [ ] **Step 2: Run `node --test tests/apiProxy.test.js`** — Expected: new tests FAIL.

- [ ] **Step 3: Implement `_rateStore.js`**, allow tests to inject a store via `req.rateStore` (same pattern as `req.fetchFn`/`req.aiFactory`), convert `enforceApiSecurity` to async, and update the four handlers plus any test callers (`rg "enforceApiSecurity" api tests`).

- [ ] **Step 4: Document env vars** in `.env.example` (commented): `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `GEMINI_DAILY_PER_IP`, `GEMINI_DAILY_GLOBAL`, with a note that the proxy works without them (per-instance limits only).

- [ ] **Step 5: Run `npm test`** — Expected: all pass.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(api): optional Upstash-backed rate limits with Gemini daily caps"`

### Task 7: Optional "Bring Your Own Gemini Key" (BYOK) for quota overflow & self-hosters

**Files:**
- Modify: `src/services/apiTransport.js` (client-side user key storage + `resolveGeminiKey` precedence)
- Create: `src/components/GeminiKeyModal.jsx`
- Create: `tests/geminiKeyStorage.test.js`
- Modify: `src/components/MovieRecommendations.jsx` (subtle key trigger in toolbar + `"Use your own key"` action on the Task 4 capacity notice)
- Modify: `src/components/AIChat.jsx` (subtle key status/trigger in header + capacity error helper)

**Interfaces:**
- Produces in `apiTransport.js`:
  - `USER_GEMINI_KEY_STORAGE = "cv_user_gemini_key"`
  - `getUserGeminiKey(storage = globalThis.localStorage): string` — returns trimmed string or `""` safely (try/catch).
  - `setUserGeminiKey(key: string, storage = globalThis.localStorage): string` — trims key; if non-empty writes to `cv_user_gemini_key`, if empty removes the key; returns the stored value.
  - `hasUserGeminiKey(storage = globalThis.localStorage): boolean`
  - Update `resolveGeminiKey(options = {})`: returns `getUserGeminiKey(options.storage)` first if non-empty, otherwise build-time `VITE_GEMINI_KEY`. Existing `createGeminiClient` calls therefore switch automatically from `/api/gemini` proxy to direct browser→Google calls using the visitor's own quota—never sending their key to Vercel or Supabase.
- Produces: `<GeminiKeyModal isOpen={boolean} onClose={fn} onChanged={fn} />` using existing `Modal` + `Button` UI primitives, masked input with Show/Hide toggle, Save / Clear Key actions, direct link to Google AI Studio (`https://aistudio.google.com/apikey`), and explicit privacy notice (*"Stored only in this browser's localStorage and sent only to Google AI."*).

- [ ] **Step 1: Write failing tests** in `tests/geminiKeyStorage.test.js`:
  - `setUserGeminiKey trims and saves; empty string removes key`
  - `resolveGeminiKey prefers stored user key over VITE_GEMINI_KEY`
  - `getUserGeminiKey returns empty string if storage throws`
  - `clear/empty user key falls back cleanly without side effects`

- [ ] **Step 2: Run `node --test tests/geminiKeyStorage.test.js`** — Expected: FAIL.

- [ ] **Step 3: Implement** storage helpers + `resolveGeminiKey` update in `apiTransport.js`, create `GeminiKeyModal.jsx`, and wire unobtrusive triggers in `MovieRecommendations.jsx` (including next to the Task 4 capacity notice) and `AIChat.jsx` (showing `"Personal key active"` when set, never showing the key value).

- [ ] **Step 4: Run `npm test; npm run build`** — Expected: all pass; `rg "cv_user_gemini_key" src/services/vaultSyncService.js api/` confirms no sync or server code reads or forwards user keys.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(ai): optional browser-only Bring Your Own Gemini Key (BYOK)"`

### Task 8: Verify cascade model IDs against a live key

**Files:**
- Create: `scripts/list_gemini_models.mjs`
- Modify (only if IDs are unavailable): `src/services/geminiService.js` L61-87, `api/gemini.js` L4-14, `tests/geminiDualEngine.test.js`, `tests/apiProxy.test.js`

**Interfaces:**
- Produces: CLI `node scripts/list_gemini_models.mjs` reading `GEMINI_API_KEY || VITE_GEMINI_KEY` from `.env`, calling `ai.models.list()`, and printing for each ID in `CURATION_MODEL_CASCADE` and `FAST_INTERACTIVE_CASCADE` either `OK` or `MISSING` (never the key).

- [ ] **Step 1: Implement the script** (imports the two cascade arrays from `src/services/geminiService.js`; exit `0` always, informational).

- [ ] **Step 2: Run it** — `node scripts/list_gemini_models.mjs`. Expected: a table of `OK`/`MISSING`.

- [ ] **Step 3 (conditional): For every `MISSING` ID**, remove it from both cascades (`CURATION_MODEL_CASCADE`, `PUBLIC_CURATION_CASCADE`, `FAST_INTERACTIVE_CASCADE`), `MODEL_DISPLAY_NAMES`, and `ALLOWED_GEMINI_MODELS`, and update the tests that enumerate them. Keep at least two working models per cascade. If everything is `OK`, change nothing.

- [ ] **Step 4: Run `npm test`** — Expected: all pass.

- [ ] **Step 5: Commit** `git add -A && git commit -m "chore(ai): add model availability check and prune unavailable IDs"`

### Task 9: Clean package.json tooling & add Personal edition scripts

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Confirm unused**: `rg "@testing-library|gh-pages|eslintConfig" src tests scripts` shows no source usage.

- [ ] **Step 2: Edit `package.json`**: delete scripts `predeploy` and `deploy`, devDependency `gh-pages`, dependencies `@testing-library/jest-dom`, `@testing-library/react`, `@testing-library/user-event`, `prop-types` only if `rg "prop-types" src` is empty, and the `eslintConfig` block. Add `"start:personal": "vite --mode personal"` and `"build:personal": "vite build --mode personal"`. Run `npm install` to refresh the lockfile.

- [ ] **Step 3: Run `npm test; npm run build; npm run build:personal`** — Expected: all exit 0.

- [ ] **Step 4: Commit** `git add package.json package-lock.json && git commit -m "chore(deps): drop stale tooling and add personal edition Vite scripts"`

---

## Phase 3: UI/UX Fixes

### Task 10: Back-or-home navigation helper

**Files:**
- Modify: `src/services/navHelpers.js`
- Modify: `tests/navHelpers.test.js`
- Modify: `src/pages/MoviePage.jsx` (L27-29), `src/pages/PersonPage.jsx` (L146-152), `src/pages/ComparePage.jsx` (L86)

**Interfaces:**
- Produces: `goBackOrHome(navigate: (to: number | string, opts?: object) => void, canGoBack: boolean): void` — calls `navigate(-1)` when `canGoBack`, else `navigate("/", { replace: true })`. Produces `hasBrowserHistory(historyLike = globalThis.history): boolean` — true when `historyLike?.state?.idx > 0` (React Router stores the stack index there).

- [ ] **Step 1: Write failing tests**: `goBackOrHome navigates -1 when history exists`; `goBackOrHome goes home with replace when it does not`; `hasBrowserHistory is false for idx 0, missing state and undefined history; true for idx 2`.

- [ ] **Step 2: Run `node --test tests/navHelpers.test.js`** — Expected: FAIL.

- [ ] **Step 3: Implement both helpers**; replace the three call sites with `goBackOrHome(navigate, hasBrowserHistory())` (and the `Escape` handler path via `onCloseMovie`).

- [ ] **Step 4: Run `node --test tests/navHelpers.test.js`** — Expected: PASS. **Manual:** paste `http://localhost:3000/movie/tt0816692` into a fresh tab, press Back in-app → lands on Discover.

- [ ] **Step 5: Commit** `git add -A && git commit -m "fix(nav): back button falls back to home on direct links"`

### Task 11: Mobile bulk bar and footer clearance

**Files:**
- Modify: `src/styles/vault.css` (after L710)
- Modify: `src/App.jsx` (L228 footer class)
- Create: `tests/layoutRegression.test.js`

- [ ] **Step 1: Write failing regression pin** in `tests/layoutRegression.test.js` reading CSS/JSX as text: `vault.css contains a max-width: 900px rule that offsets .vault-bulk-floating-bar above the mobile tab bar` (regex for a `@media (max-width: 900px)` block mentioning `.vault-bulk-floating-bar` and `bottom: calc(`), and `App footer uses a 900px breakpoint for desktop padding` (file contains `min-[901px]:pb-8` and not `md:pb-8`).

- [ ] **Step 2: Run `node --test tests/layoutRegression.test.js`** — Expected: FAIL.

- [ ] **Step 3: Implement**: in `vault.css` add `@media (max-width: 900px) { .vault-bulk-floating-bar { bottom: calc(7.2rem + env(safe-area-inset-bottom, 0px)); width: calc(100vw - 2rem); justify-content: center; } }`; in `App.jsx` change `pb-28 md:pb-8` to `pb-28 min-[901px]:pb-8`.

- [ ] **Step 4: Run `node --test tests/layoutRegression.test.js`** — Expected: PASS. **Manual** at 390 px and 820 px wide: enter Vault → Manage Selection, select a film: the bar sits above the tab bar; scroll to the footer: its text is fully visible.

- [ ] **Step 5: Commit** `git commit -am "fix(layout): clear mobile tab bar for bulk bar and footer"` (add the new test).

### Task 12: Vault empty-filter state

**Files:**
- Modify: `src/pages/VaultPage.jsx` (L302-313)
- Delete (only if no importers remain): `src/components/EmptyState.jsx`

- [ ] **Step 1: Replace** the `<EmptyState .../>` in the `filter-empty-card` with a heading `"No films match your filters"`, a one-line hint, and the existing "Reset Filters" button (reuse `.btn-clear-filters-cta`; fix the class mismatch — `vault.css` defines `.btn-clear-filters-cta` and `.btn-empty-cta`, the page uses `btn-empty-cta` for the other states; verify each class used exists in CSS with `rg`).

- [ ] **Step 2: Remove the import**, then `rg -l "EmptyState" src` — if only `EmptyState.jsx` itself remains (ignore `exploreService.js`/`ExplorePage.jsx` matches that are variable names like `showEmptyState`), delete the file.

- [ ] **Step 3: Manual**: Vault with entries → search "zzzz": clean message, Reset restores the grid.

- [ ] **Step 4: Run `npm run build`** — Expected: exit 0.

- [ ] **Step 5: Commit** `git add -A && git commit -m "fix(vault): replace trivia empty state with a clear no-match message"`

### Task 13: Emoji sweep

**Files:**
- Modify: `src/components/MovieDetails.jsx` (L1155 `🍅`), `src/components/ErrorMessage.jsx`

- [ ] **Step 1: Replace** the `🍅` span with a lucide icon (`Gauge`, `size={16}`, `aria-hidden`) keeping class `score-emoji` renamed to `score-icon`; update the matching CSS selector if one exists (`rg "score-emoji" src`). Replace `⛔` in `ErrorMessage.jsx` with lucide `AlertCircle`.

- [ ] **Step 2: Verify**: `rg -n "[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]" src --glob "*.jsx"` returns only intentional occurrences (the `★`/`✓` glyphs and chat prompt strings are not emoji; the ranker's badge strings are in `.js` and allowed by SPEC).

- [ ] **Step 3: Run `npm run build`** — Expected: exit 0. **Manual**: movie page shows the Rotten Tomatoes card with the new icon.

- [ ] **Step 4: Commit** `git commit -am "style(ui): replace remaining emoji with icons"`

### Task 14: Editorial Cinema Polish on Oracle Studio Deck

**Files:**
- Modify: `src/services/oracleViewHelpers.js` (pure helper `selectStudioBackdropPoster(watched)`)
- Modify: `tests/oracleViewHelpers.test.js`
- Modify: `src/components/MovieRecommendations.jsx` (Studio Deck JSX: mood icons, active check indicator, subtle library backdrop wash, command-bar vibe input + quick-fill vibe examples, iconified summary bars)
- Modify: `src/styles/oracle.css` (refined card contrast, `.vibe-icon-box`, `.studio-deck-backdrop`, `.mood-example-pills`, zero neon/AI glow per `SPEC.md`)

**Interfaces:**
- Produces in `oracleViewHelpers.js`: `selectStudioBackdropPoster(watched: object[]): string | null` — picks the highest user-rated film (`userRating` desc, tie-break `dateWatched` desc) that has a valid `poster` URL (`poster && poster !== "N/A"`), returning its poster URL or `null`.

- [ ] **Step 1: Write failing tests** in `tests/oracleViewHelpers.test.js`:
  - `selectStudioBackdropPoster returns highest-rated film poster ignoring N/A posters`
  - `selectStudioBackdropPoster returns null for empty or posterless watched arrays`

- [ ] **Step 2: Run `node --test tests/oracleViewHelpers.test.js`** — Expected: FAIL.

- [ ] **Step 3: Implement** `selectStudioBackdropPoster` in `oracleViewHelpers.js`, verify PASS.

- [ ] **Step 4: Polish Studio Deck in `MovieRecommendations.jsx` & `oracle.css`** (strictly restrained cinema aesthetic, **no** cyan glow, **no** emoji):
  - Map each of the 6 `MOOD_OPTIONS` to a crisp Lucide icon (`Film`, `Orbit`, `Moon`, `Flame`, `Heart`, `Gem` — verify exports first) inside `.vibe-icon-box`, plus a subtle corner check dot/badge when active and higher-contrast card surface + warm hairline on hover/active.
  - Render a low-opacity blurred `<img>` backdrop wash (`opacity: 0.10`, dark gradient mask fading into `--surface-1`, `pointer-events: none`) inside `.ai-studio-deck` header from `selectStudioBackdropPoster(watched)` (if present) so the deck has organic cinema texture rather than a flat gray box.
  - Upgrade `.mood-query-form` into a command-bar strip with leading `SlidersHorizontal`/`Search` icon + 3 subtle clickable example vibe chips below (`"like Drive but quieter"`, `"90s neo-noir"`, `"smart sci-fi under 2h"`).
  - Add leading icons (`Tv` / `SlidersHorizontal`) to the "Where to watch" and "Taste Rules" rows and keep the subtle bottom library summary integrated cleanly.

- [ ] **Step 5: Run `npm test; npm run build`** — Expected: all pass, clean build. **Manual check**: inspect `/ai` before and after loading picks at 1440 px and 390 px — balanced contrast, crisp icons, zero neon/AI clutter.

- [ ] **Step 6: Commit** `git add -A && git commit -m "style(oracle): add editorial cinema depth and icons to Studio Deck"`

### Task 15: Route-level document titles

**Files:**
- Modify: `src/services/navHelpers.js`, `tests/navHelpers.test.js`
- Create: `src/hooks/useDocumentTitle.js`
- Modify: `src/pages/DashboardPage.jsx`, `VaultPage.jsx`, `AIPage.jsx`, `NotFoundPage.jsx`

**Interfaces:**
- Produces: `formatDocumentTitle(section?: string): string` → `"CinemaVault"` when empty, else `` `${section} | CinemaVault` ``. Produces hook `useDocumentTitle(section?: string): void` setting `document.title` in an effect and restoring `"CinemaVault"` on unmount.

- [ ] **Step 1: Write failing tests**: `formatDocumentTitle("My Vault") === "My Vault | CinemaVault"`, `formatDocumentTitle() === "CinemaVault"`, `formatDocumentTitle("  ") === "CinemaVault"`.

- [ ] **Step 2: Run `node --test tests/navHelpers.test.js`** — Expected: FAIL.

- [ ] **Step 3: Implement** helper and hook; call `useDocumentTitle("Discover")`, `("My Vault")`, `("Film Oracle")`, `("Page not found")` in the four pages.

- [ ] **Step 4: Run `node --test tests/navHelpers.test.js`** — Expected: PASS. **Manual:** browser tab titles change per route.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(seo): per-route document titles"`

### Task 16: Open Graph and Twitter meta for LinkedIn previews

**Files:**
- Create: `scripts/siteUrl.mjs`, `tests/siteUrl.test.js`
- Modify: `vite.config.js` (small `transformIndexHtml` plugin), `index.html`, `.env.example`

**Interfaces:**
- Produces: `resolveSiteUrl(env: Record<string, string | undefined>): string` — returns `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` when set, else `env.VITE_SITE_URL` stripped of trailing slashes, else `""`.

- [ ] **Step 1: Write failing tests**: Vercel host wins and is prefixed with `https://`; `VITE_SITE_URL="https://a.dev/"` returns `https://a.dev`; neither set returns `""`.

- [ ] **Step 2: Run `node --test tests/siteUrl.test.js`** — Expected: FAIL.

- [ ] **Step 3: Implement** `resolveSiteUrl`; in `vite.config.js` add an `html-site-url` plugin replacing the literal `__SITE_URL__` in `index.html` with `resolveSiteUrl(process.env)`.

- [ ] **Step 4: Add tags to `index.html`**: `og:type=website`, `og:site_name=CinemaVault`, `og:title`, `og:description` (reuse the meta description, one sentence: "Track films, build a taste model on your device, and get verified AI-curated picks."), `og:image=__SITE_URL__/og-image.png`, `og:url=__SITE_URL__/`, `twitter:card=summary_large_image`. Document `VITE_SITE_URL` in `.env.example`. (`public/og-image.png` is produced in Task 23.)

- [ ] **Step 5: Run `node --test tests/siteUrl.test.js; npm run build`** — Expected: PASS and `rg "__SITE_URL__" build/index.html` returns nothing.

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(seo): Open Graph tags with build-time site URL"`

---

## Phase 4: Sample Vault Demo Mode

### Task 17: Sample vault data builder

**Files:**
- Create: `src/services/sampleVaultService.js`
- Create: `tests/sampleVaultService.test.js`

**Interfaces:**
- Consumes: `CORE_TASTE_DECK` (`tasteDeckService.js`), `prepareQuickRatePayload(movie, rating, now)` and `prepareWatchlistPayload(movie)` (`ratingTiers.js`), `computeZScoredWeights(watched)` (`scoringUtils.js`).
- Produces: `buildSampleVault({ now = Date.now() } = {}): { watched: object[], watchlist: object[] }`. Uses a fixed id→rating map over `CORE_TASTE_DECK`: at least 14 rated films spanning ratings 2–10 (include two ratings ≤ 4 so repulsion and negative keywords are exercised), at least 3 with a short `userNote`, `dateWatched` staggered newest-to-oldest across ~18 months (each strictly before `now`), and 6 unrated watchlist films disjoint from the watched set. Every record carries `isSample: true`. Produces `isSampleItem(movie): boolean` and `SAMPLE_VAULT_MIN_WATCHED = 14`.

- [ ] **Step 1: Write failing tests**: `buildSampleVault returns >=14 rated films with integer ratings 1-10 and at least two <= 4`; `at least three samples carry a note`; `watchlist has >=6 films and shares no imdbID with watched`; `every record has isSample true and a unique imdbID from CORE_TASTE_DECK`; `dates are all before now and span more than 365 days`; `computeZScoredWeights on the sample is non-degenerate (some positive and some negative weight)`; `isSampleItem is false for ordinary records`.

- [ ] **Step 2: Run `node --test tests/sampleVaultService.test.js`** — Expected: FAIL.

- [ ] **Step 3: Implement** the builder and helpers per the interface.

- [ ] **Step 4: Run `node --test tests/sampleVaultService.test.js`** — Expected: PASS.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(demo): sample vault builder"`

### Task 18: Load/clear sample vault in context, sync guard, and UI entry points

**Files:**
- Modify: `src/context/AppContext.jsx` (new `loadSampleVault`, `clearSampleVault`, exposed in provider value L1210-1266)
- Modify: `src/services/vaultSyncService.js` (`mapLocalMovieToDbRow` / `mapDbRowToLocalMovie`: only if `isSample` is not already round-tripped)
- Modify: `tests/vaultSyncService.test.js`
- Create: `src/components/SampleVaultBanner.jsx`
- Modify: `src/components/TasteDeckModal.jsx` (header button), `src/pages/VaultPage.jsx` (empty watched state), `src/components/MovieRecommendations.jsx` (empty-vault CTA next to "Taste Calibration"), `src/pages/VaultPage.jsx` and `src/pages/AIPage.jsx` (render banner)

**Interfaces:**
- Consumes: `buildSampleVault`, `isSampleItem` (Task 17).
- Produces on `useApp()`: `loadSampleVault(): { ok: boolean, reason?: "signed-in" | "vault-not-empty" }` — refuses when `cloudUser` is set or `watched.length >= 3`; otherwise merges the sample arrays into `watched` and `watchlist` via functional `setWatched` / `setWatchlist` updates (`upsertMovieEntry` over the sample items) so `watchedRef.current` stays consistent in a single commit and the existing background TMDB hydration effect enriches them in batches. `clearSampleVault(): void` — filters out every item where `isSampleItem` is true via `setWatched` / `setWatchlist`; never touches other items. `hasSampleData: boolean` derived from the lists.
- Produces: `<SampleVaultBanner />` shown only when `hasSampleData`, text `"You are exploring a sample vault."` with a `"Clear sample data"` button.

- [ ] **Step 1: Write failing tests** in `tests/vaultSyncService.test.js`: `isSample survives a local → DB row → local round trip` (assert the mapped-back movie has `isSample === true`) — if it already passes, keep it as a regression pin and skip the mapping change.

- [ ] **Step 2: Run `node --test tests/vaultSyncService.test.js`** — Expected: FAIL only if `isSample` was dropped.

- [ ] **Step 3: Implement** the context functions with the guards above, and `isSample` metadata packing if needed.

- [ ] **Step 4: Implement UI**: buttons labelled `"Try a sample vault"` (secondary variant) that call `loadSampleVault()` then close the modal / stay on the page; hide them when `cloudUser` is set or `watched.length >= 3`. Add the banner to Vault and Oracle pages.

- [ ] **Step 5: Run `npm test; npm run build`** — Expected: all pass.

- [ ] **Step 6: Manual walkthrough** (fresh browser profile, `localStorage` cleared): taste deck opens → "Try a sample vault" → Vault shows 14 films, Insights populated → Oracle "Find Picks" returns ten picks with "Because you rated" chips → "Clear sample data" empties the vault; rate one real film first, then clear sample: the real film remains.

- [ ] **Step 7: Commit** `git add -A && git commit -m "feat(demo): one-click sample vault with clear and sync guard"`

---

## Phase 5: Code Health

### Task 19: Route-level code splitting

**Files:**
- Modify: `src/App.jsx` (imports L15-22, routes L197-222)
- Create: `src/components/RouteFallback.jsx`

- [ ] **Step 1: Convert** `ExplorePage`, `ComparePage`, `MoviePage`, `PersonPage`, `VaultPage`, `AIPage` to `React.lazy(() => import(...))`; keep `DashboardPage` and `NotFoundPage` eager. Wrap `<Routes>` in `<Suspense fallback={<RouteFallback />}>` inside the keyed `motion.div`. `RouteFallback` is a centered 2 px loading bar/skeleton using existing `.cv-skel` styles.

- [ ] **Step 2: Run `npm run build`** — Expected: exit 0; main chunk is clearly below the previous 1,408 kB and several route chunks are emitted. Record before/after sizes in the commit body.

- [ ] **Step 3: Manual**: navigate through every route and the person modal; throttle network to "Slow 3G" once and confirm the fallback appears instead of a blank screen; with the dev server stopped after load, navigate to an uncached route and confirm `ErrorBoundary` shows its retry UI.

- [ ] **Step 4: Commit** `git add -A && git commit -m "perf(app): lazy-load route pages"`

### Task 20: Dead code, legacy CSS, stale copy

**Files:**
- Delete (after proving unused): `src/components/TrailerModal.jsx`, `src/services/geminiExplanationService.js`
- Modify: `src/components/SearchModal.jsx` (L33 `apiKey`), `src/components/BackupManagerModal.jsx` (L141 `apiKey`), `src/pages/VaultPage.jsx` (local `BackupManagerModal` + `isBackupOpen`), `src/components/RandomPicker.jsx` (unused `AnimatePresence`), `src/components/WatchedMoviesList.jsx` (unused `Film`), `src/services/geminiService.js` (L2883, L2990), `src/index.css` (legacy CRA blocks)

- [ ] **Step 1: Prove unused**: `rg -n "TrailerModal|geminiExplanationService" src tests` returns only the files' own definitions; then delete both. For `apiKey`: `rg -n "apiKey" src/context` is empty, so remove the destructure and the `apiKey` argument passes (`searchCatalogMovies` defaults it to `""`).

- [ ] **Step 2: Remove the duplicate modal** in `VaultPage.jsx` (App already mounts one): drop the `BackupManagerModal` import, `isBackupOpen` state, and the fallback branch, so `onOpenBackup` is the only path.

- [ ] **Step 3: Update copy**: change the progress string to `"Finding candidates across your taste profile..."`, delete the success `console.log` at L2990 (keep warnings). `rg -n "3-bucket|3-Bucket" tests` is empty, so no test change is needed.

- [ ] **Step 4: Legacy CSS**: for each candidate selector (`.search-container`, `.search`, `.type-filter`, `.num-results`, `.main`, `.box`, `.box-content`, `.btn-toggle`, `.theater-step`, `.step-text`, `.nav-bar`, `.nav-left`, `.nav-right`, `.nav-vault-quick`, `.backup-modal-overlay`, `.logo`), run `rg "className=.*<selector-without-dot>\b" src --glob "*.jsx"`. Delete a rule block only when there are zero hits; leave anything referenced. Do this in small batches.

- [ ] **Step 5: Run `npm test; npm run build`** — Expected: both exit 0; CSS bundle size does not grow. **Manual visual smoke** of Discover, Explore, Vault, Oracle, Movie, Compare at 1440 px and 390 px: no layout regressions.

- [ ] **Step 6: Commit** `git add -A && git commit -m "chore: remove dead components, legacy CSS and stale copy"`

---

## Phase 6: Docs, Repo Hygiene, Launch Assets

### Task 21: Docs cleanup, README promotion, LICENSE

**Files:**
- Modify: `SPEC.md` (delete L1-17), `README.md` (replaced by the content of `summary.md`), `LOCAL_MODEL_GUIDE.md`, `ARCHITECTURE.md`
- Delete: `summary.md`
- Create: `LICENSE`, `tests/docsHygiene.test.js`

- [ ] **Step 1: Write failing `tests/docsHygiene.test.js`**:
  - `SPEC.md starts with a markdown heading` (first non-empty line matches `/^# /`).
  - `no top-level doc hard-codes test counts` for `README.md`, `SPEC.md`, `ARCHITECTURE.md`, `LOCAL_MODEL_GUIDE.md`: no match of `/\b3\d\d\s*(?:\/|of)\s*3\d\d\b/` nor `/3\d\d(?:%2F)3\d\d/`.
  - `README has no placeholder clone URL and no Hydrogen badge`: does not contain `your-repo-url` and does not contain `4_Hydrogen`.
  - `LICENSE exists and starts with "MIT License"`.
  - `summary.md is gone`.

- [ ] **Step 2: Run `node --test tests/docsHygiene.test.js`** — Expected: FAIL.

- [ ] **Step 3: Implement**: delete the `SPEC.md` preamble; copy `summary.md` over `README.md` then fix it: clone URL `https://github.com/khuzaima175/React-Movie-Original.git` and `cd React-Movie-Original`, remove the self-link `README.md` bullet in "Documentation", replace the Hydrogen badge with a neutral `Google_Gemini` badge, replace the hard-coded test-count badge with a static `Tests-node--test` badge, document the two editions (**Public** default vs **Personal/Debug** via `?debug=1` or `VITE_APP_EDITION=personal`) and optional BYOK ("Personal AI Key") setting, and add the screenshot section placeholder `## Screenshots` (filled in Task 23). Replace test/module counts in `LOCAL_MODEL_GUIDE.md` (L4, L241, L246) and wherever the test flags in `ARCHITECTURE.md` with the generic phrase "run `npm test`". Fix the compare-tray storage statement in `SPEC.md` (L548) and README to say `sessionStorage` (matches `AppContext.jsx` L228). Create `LICENSE` (MIT, year 2026, holder `Khuzaima`). `git rm summary.md`.

- [ ] **Step 4: Run `node --test tests/docsHygiene.test.js`** — Expected: PASS.

- [ ] **Step 5: Verify docs vs reality**: `rg -n "localStorage.*cinemavault_compare|311|314" README.md SPEC.md ARCHITECTURE.md LOCAL_MODEL_GUIDE.md` returns no stale claims.

- [ ] **Step 6: Commit** `git add -A && git commit -m "docs: clean SPEC preamble, promote README, add LICENSE, drop test counts"`

### Task 22: Repo hygiene (needs explicit user confirmation for remote actions)

**Files:**
- Modify: `.gitignore`
- Untrack: `.agents/`, `.superpowers/`

- [ ] **Step 1: Ignore local agent tooling**: append `.agents/` and `.superpowers/` to `.gitignore`, then `git rm -r --cached .agents .superpowers` and commit `chore: stop tracking local agent tooling`.

- [ ] **Step 2: Local cleanup (safe):** list `git branch --merged main` and `git worktree list`; show the user the list. After the user approves, delete merged local branches with `git branch -d` and remove the worktree with `git worktree remove .worktrees/research-hub` (only after confirming `feat/research-hub` has nothing unmerged: `git log main..feat/research-hub --oneline` empty, otherwise ask).

- [ ] **Step 3: Remote cleanup — ASK THE USER FIRST, do not run unprompted:** propose `git push origin --delete gh-pages` (static pages cannot run `/api/*`) and deleting merged remote feature branches. Run only the ones the user confirms.

- [ ] **Step 4: History scrub (optional, user decision):** all old keys are deactivated and Task 1 proved the current keys are clean, so a rewrite is optional and cosmetic. Present the two options (keep history as is; or `git filter-repo --invert-paths --path .env` plus force-push) and do nothing without an explicit choice.

- [ ] **Step 5: Run `npm run check:secrets; npm test`** — Expected: all CLEAN, all pass.

### Task 23: Screenshots, social image and README gallery

**Files:**
- Create: `assets/screenshots/{discover,explore,vault,oracle,movie-rating-studio,compare}.png`, `public/og-image.png` (1200x630)
- Modify: `README.md` (replace `assets/movie_vault.png` hero and fill `## Screenshots`)
- Delete: `assets/movie_vault.png` once no longer referenced

- [ ] **Step 1: Prepare data**: fresh browser profile, load the sample vault (Task 18), set region to US.

- [ ] **Step 2: Capture** each route at 1440x900 (delegate to the browser subagent): Discover with hero, Explore with two filters active, Vault with Insights open, Oracle with ten picks, a movie page with the 10-star rating stage hovered at 9, Compare with three films. Confirm no model names or debug bars are visible.

- [ ] **Step 3: Build `public/og-image.png`** (1200x630): a crop of the Oracle or Vault screenshot over the dark `--bg` (`#0d0e11`) with the "CinemaVault" wordmark; keep text legible at 600 px wide.

- [ ] **Step 4: Update README** hero and gallery table; `rg "movie_vault" .` returns nothing, then delete the old file.

- [ ] **Step 5: Run `node --test tests/docsHygiene.test.js`** — Expected: PASS.

- [ ] **Step 6: Commit** `git add -A && git commit -m "docs: fresh screenshots and social preview image"`

### Task 24: Final verification and deploy checklist

- [ ] **Step 1: Full local verification**: `npm test` (all pass), `npm run build` (exit 0), `npm run build:personal` (exit 0), `npm run check:secrets` (all CLEAN), `rg "AIzaSy" build/` (no output), `rg -n "gemini-" build/assets/*.js -c` (informational: slugs may remain in code but must not render in default Public UI).

- [ ] **Step 2: Vercel environment (Two Editions)**:
  - **Public / Commercial deployment** (shared LinkedIn link): set `GEMINI_API_KEY`, `TMDB_API_KEY`, `OMDB_API_KEY` (server-side only, no `VITE_` prefix), `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (strongly recommended so `GEMINI_DAILY_PER_IP=30` and `GEMINI_DAILY_GLOBAL=450` enforce the 500/day Flash-Lite ceiling across instances), and `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` if sync is enabled. Do **not** set `VITE_APP_EDITION=personal` or any `VITE_GEMINI_KEY` / `VITE_TMDB_KEY` / `VITE_OMDB_KEY`.
  - **Personal / Debug mode (two options):** either visit your public URL once with `?debug=1` (persisted locally for you via `cv_debug_ui`) OR deploy a second private Vercel project from the exact same repo with `VITE_APP_EDITION=personal` (enables all model telemetry + `gemini-4-hydrogen` primary cascade by default).

- [ ] **Step 3: Production smoke test** on the deployed URL in a clean browser: Discover loads posters; search works (`Ctrl+K`); load sample vault; Oracle returns ten picks with friendly labels and no model names; chat replies; test BYOK modal saving/clearing a personal key; `?debug=1` reveals the model bar and persists across tab navigation; `?debug=0` hides it cleanly; direct-load a `/movie/tt0816692` URL then Back goes home; paste the URL into LinkedIn's Post Inspector and confirm title, description and image render.

- [ ] **Step 4: Abuse check**: `curl -s -X POST <url>/api/gemini -H "Content-Type: application/json" -d "{}"` returns 403 (no browser origin); with a spoofed `Origin` header and a 100 KB prompt returns 413.

- [ ] **Step 5: Merge**: open a PR from `chore/public-launch-polish` to `main`; after review, merge, then flip the repository visibility to public.

---

## Deferred (not in this plan, by decision)

- **Poster-flight timing** (`PosterArrival`): the ghost holds position while details load by design and is capped at 4.5 s; no user-visible bug reproduced, so no change.
- **Z-index token consolidation** (`.taste-deck-backdrop` 80 vs modals 8500/9999 vs toast 999999): cosmetic, no reachable overlap found; revisit if a stacking bug appears.
- **Cloudflare Turnstile** on the proxy: only needed if the Upstash daily caps in Task 6 prove insufficient.

## Self-Review

1. **Spec coverage:** A1→T1; A2→T2-T4; A3→T5-T7; A4→T2+T8; A5→T9; A6→T10; A7→T11; A8→T12; A9→T4+T13; A10→T15-T16; A11→T17-T18; A12→T19; A13→T20; A14→T21+T23; A15→T22; A16→T14. Final gate and dual-edition deploy → T24. No finding lacks a task.
2. **Step scan:** code steps carry signatures and pinned values; bodies appear nowhere except exact copy strings the user will see.
3. **Type consistency:** `isDebugUiEnabled` / `isPersonalEdition` / `syncDebugFlagFromSearch` (T2) reused cleanly in T3 and T19/App; `resolveGeminiKey` (T7) extends existing `apiTransport.js` contract without altering callers; `selectStudioBackdropPoster` (T14) pure over `watched`; `buildSampleVault`/`isSampleItem` (T17) reused in T18; `goBackOrHome`/`hasBrowserHistory` (T10) used consistently; `enforceApiSecurity` becomes async in T6 and all four handlers are updated in the same task.
4. **Review Focus** items map to T4+T7 (1), T5 (2), T18 (3), T2 (4), T10 (5), T7 (6).
5. **Proportion:** each task is one reviewable deliverable; UI-only tasks use manual verification where unit tests would only mirror JSX.
