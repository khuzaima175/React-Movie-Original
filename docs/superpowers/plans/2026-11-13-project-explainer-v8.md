# Project Explainer V8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `project-explainer` skill (`.agents/skills/project-explainer/`) from V7.2 to V8 by fixing scanner/prompt bugs, resolving command & formatting contradictions, adding multi-ecosystem/git/spec forensics, wiring adaptive goal/repo scaling and a compact session ledger, and verifying everything with automated contract/unit tests plus subagent pressure scenarios.

**Architecture:** The upgrade spans two coordinated layers: (1) a stdlib-only Python forensics scanner (`scripts/repo_scan.py`) upgraded to ignore `.agents`/`.superpowers`/`.claude`, inspect JS/Python manifests, detect docs/specs and tool configs, count top file sizes, and collect read-only git churn safely; and (2) `SKILL.md` + five `references/*.md` files refactored for crisp progressive disclosure, exact command semantics, doc-vs-code verification discipline, session-ledger tracking, and zero project-specific example leakage. Both layers are pinned by `unittest` suites under `.agents/skills/project-explainer/tests/` plus pressure-scenario verification.

**Tech Stack:** Markdown (Agent Skill spec / `superpowers:writing-skills` & `agy-customizations`), Python 3.10+ standard library (`pathlib`, `json`, `tomllib`, `subprocess`, `re`, `os`, `argparse`, `unittest`, `tempfile`).

**Spec:** User request ("make this more better as much better u can") building on the V7.2 audit of `.agents/skills/project-explainer/SKILL.md` and `superpowers:writing-skills` authoring/testing standards.

## Global Constraints

- **Stdlib-only & read-only scanner:** `scripts/repo_scan.py` and its tests MUST use Python 3.10+ standard library only (`tomllib` with safe fallback if `<3.11`), perform strictly read-only inspection, and never open or return values from non-template `.env*` files.
- **Trigger-only frontmatter:** `SKILL.md` frontmatter `name` MUST be `project-explainer`; `description` MUST be third-person, start with `"Use when "`, be `<= 500` characters (`1024` hard cap), and contain zero workflow summary leaks (no `"Defaults to"`, `"Step 0"`, `"Phase A"`).
- **Progressive disclosure & size:** `SKILL.md` MUST stay concise (`<= 250` lines), keep all reference links one level deep (`references/*.md` directly from `SKILL.md`, never `references -> references`), and include a `## Contents` TOC at the top of any reference file exceeding `100` lines.
- **Complete command parity:** Every command in `SKILL.md`'s Core Menu and Reference Routing table MUST have an explicit, unambiguous handler in `SKILL.md` or its named reference file.
- **Zero project leakage:** No real repository names or constants from this host workspace (such as `CinemaVault` or `λ = 0.002`) may appear anywhere in `SKILL.md`, `references/*.md`, or `scripts/`.
- **Host repo isolation:** All skill unit tests MUST live inside `.agents/skills/project-explainer/tests/` so they do not alter the host project's `tests/` suite.

## Review Focus

1. **Windows `python3` alias & paths with spaces:** Invoking `python3` on Windows can trigger the Microsoft Store stub, and unquoted paths containing spaces (such as `g:\Important Projects\movie-ratings`) break shell commands — `SKILL.md` must specify `python` / `py -3` first on Windows with quoted paths, and `repo_scan.py` CLI must handle `Path` arguments containing spaces.
2. **Real `.env` secret leakage & template casing:** Repos with `.env`, `.env.local`, `.env.production`, and `.env.EXAMPLE` must never leak any secret values; `repo_scan.py` must match template names case-insensitively and only extract variable names from templates while marking real env files unopened.
3. **Malformed, binary, or >2 MB files during repo scanning:** Broken `package.json`, broken `pyproject.toml`, binary/non-UTF-8 files, or huge generated bundles must never crash `repo_scan.py` or stall line-counting.
4. **Missing `.git` directory or `git` CLI (`--no-git`):** Running `repo_scan.py` in a non-git directory or an environment without `git` on `PATH` must degrade cleanly (`exit 0`, `"Git history unavailable"`) rather than raising `FileNotFoundError` or `CalledProcessError`.
5. **Agent rationalization under urgency ("just trust `ARCHITECTURE.md` and dump everything"):** Under competing user pressure for speed, `SKILL.md` must prevent trusting docs without verifying code, prevent dumping multiple modules in one turn, and prevent improvising `feature`/`defense`/`finish` formats without reading the corresponding reference file.

---

### Task 1: Upgrade `scripts/repo_scan.py` Forensics Scanner (TDD)

**Files:**
- Modify: `.agents/skills/project-explainer/scripts/repo_scan.py:1-204`
- Create: `.agents/skills/project-explainer/tests/test_repo_scan.py`

**Interfaces:**
- Produces in `.agents/skills/project-explainer/scripts/repo_scan.py`:
  - `extract_env_keys(env_path: Path) -> list[str]`
  - `inspect_package_json(pkg_path: Path) -> dict`
  - `inspect_pyproject_toml(toml_path: Path) -> dict`
  - `inspect_requirements_txt(req_path: Path) -> dict`
  - `inspect_git_history(root: Path, max_commits: int = 8, churn_window: int = 20) -> dict`
  - `scan_repo(root: Path, max_files: int = 2500, include_git: bool = True) -> dict`
  - `print_report(data: dict) -> None`
  - `main(argv: list[str] | None = None) -> int` supporting `[repo_path] [--json] [--no-git]`

- [ ] **Step 1: Write the failing `unittest` suite in `.agents/skills/project-explainer/tests/test_repo_scan.py`**

```python
import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import repo_scan  # noqa: E402


class TestRepoScan(unittest.TestCase):
    def test_ignores_agent_dirs_and_detects_modern_files_and_docs(self):
        with tempfile.TemporaryDirectory(prefix="repo with spaces ") as tmp:
            root = Path(tmp)
            (root / ".agents" / "skills").mkdir(parents=True)
            (root / ".agents" / "skills" / "ignored.py").write_text("x = 1\n", encoding="utf-8")
            (root / ".superpowers").mkdir()
            (root / ".superpowers" / "ignored.js").write_text("export default 1;\n", encoding="utf-8")
            (root / "packages" / "web" / "src").mkdir(parents=True)
            (root / "packages" / "web" / "src" / "index.ts").write_text("console.log(1)\n", encoding="utf-8")
            (root / "src").mkdir()
            (root / "src" / "App.svelte").write_text("<script></script>\n", encoding="utf-8")
            (root / "src" / "App.test.mts").write_text("test('ok', () => {})\n", encoding="utf-8")
            (root / "README.md").write_text("# Docs\n", encoding="utf-8")
            (root / "ARCHITECTURE.md").write_text("# Arch\n", encoding="utf-8")
            (root / "tsconfig.json").write_text("{}", encoding="utf-8")

            result = repo_scan.scan_repo(root, include_git=False)

            self.assertEqual(result["total_code_files"], 2)
            self.assertIn(".agents", result["skipped_dirs"])
            self.assertIn(".superpowers", result["skipped_dirs"])
            self.assertIn("packages/web/src/index.ts", result["entrypoints"])
            self.assertIn("src/App.test.mts", result["test_files"])
            self.assertIn("README.md", result["docs_specs"])
            self.assertIn("ARCHITECTURE.md", result["docs_specs"])
            self.assertIn("tsconfig.json", result["tool_configs"])
            svelte_entry = next(f for f in result["largest_code_files"] if f["path"] == "src/App.svelte")
            ts_entry = next(f for f in result["largest_code_files"] if f["path"] == "packages/web/src/index.ts")
            self.assertEqual(svelte_entry["lines"], 1)
            self.assertEqual(ts_entry["lines"], 1)
            self.assertGreater(svelte_entry["size_bytes"], ts_entry["size_bytes"])
            self.assertEqual(result["largest_code_files"][0]["path"], "src/App.svelte")

    def test_env_secret_hygiene_and_case_insensitive_templates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".env").write_text("OPENAI_API_KEY=sk-supersecret-123\n", encoding="utf-8")
            (root / ".env.local").write_text("DB_PASS=secretpass\n", encoding="utf-8")
            (root / ".env.EXAMPLE").write_text(
                "OPENAI_API_KEY=\nPORT=PORT_SECRET_VALUE_98765\n# comment\n",
                encoding="utf-8",
            )

            result = repo_scan.scan_repo(root, include_git=False)
            buf = io.StringIO()
            with redirect_stdout(buf):
                repo_scan.print_report(result)
            output = buf.getvalue() + json.dumps(result)

            self.assertNotIn("sk-supersecret-123", output)
            self.assertNotIn("secretpass", output)
            self.assertNotIn("PORT_SECRET_VALUE_98765", output)
            self.assertEqual(result["env_files"][".env"], ["(real env file present, not opened)"])
            self.assertEqual(result["env_files"][".env.local"], ["(real env file present, not opened)"])
            self.assertEqual(result["env_files"][".env.EXAMPLE"], ["OPENAI_API_KEY", "PORT"])

    def test_multi_ecosystem_manifests_and_malformed_resilience(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "package.json").write_text("{not valid json", encoding="utf-8")
            (root / "pyproject.toml").write_text(
                '[project]\nname = "demo"\ndependencies = ["fastapi>=0.1", "pydantic"]\n'
                '[project.scripts]\nserve = "demo:main"\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
                encoding="utf-8",
            )
            (root / "requirements.txt").write_text("flask==3.0.0\nrequests\ngit+https://example.com/pkg.git\n", encoding="utf-8")
            (root / "huge.py").write_bytes(b"a = 1\n" * 400000)  # > 2 MB
            (root / "bin.py").write_bytes(b"\xff\xfe\x00\x01binary")

            result = repo_scan.scan_repo(root, include_git=False)

            self.assertTrue(result["package_json_details"]["package.json"]["parse_error"])
            self.assertEqual(result["pyproject_details"]["pyproject.toml"]["name"], "demo")
            self.assertEqual(result["pyproject_details"]["pyproject.toml"]["deps_count"], 2)
            self.assertIn("pytest", result["pyproject_details"]["pyproject.toml"]["tools"])
            self.assertEqual(result["requirements_details"]["requirements.txt"]["count"], 3)
            self.assertEqual(len(result["requirements_details"]["requirements.txt"]["unpinned"]), 2)
            huge_entry = next(f for f in result["largest_code_files"] if f["path"] == "huge.py")
            self.assertTrue(huge_entry["skipped_line_count"])
            self.assertIsNone(huge_entry["lines"])

    def test_git_forensics_non_git_and_cli_json_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "main.py").write_text("print('hi')\n", encoding="utf-8")

            no_git_result = repo_scan.scan_repo(root, include_git=True)
            self.assertFalse(no_git_result["git"]["available"])

            rc = repo_scan.main([str(root), "--json", "--no-git"])
            self.assertEqual(rc, 0)

            buf = io.StringIO()
            with redirect_stdout(buf):
                rc2 = repo_scan.main([str(root), "--json", "--no-git"])
            self.assertEqual(rc2, 0)
            parsed = json.loads(buf.getvalue())
            self.assertEqual(parsed["total_code_files"], 1)

    def test_git_forensics_reads_commits_and_churn(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Tester"], cwd=root, check=True, capture_output=True)
            (root / "app.py").write_text("v1 = 1\n", encoding="utf-8")
            subprocess.run(["git", "add", "app.py"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "init"], cwd=root, check=True, capture_output=True)
            (root / "app.py").write_text("v1 = 2\n", encoding="utf-8")
            subprocess.run(["git", "commit", "-am", "update app"], cwd=root, check=True, capture_output=True)

            result = repo_scan.scan_repo(root, include_git=True)
            self.assertTrue(result["git"]["available"])
            self.assertEqual(len(result["git"]["recent_commits"]), 2)
            self.assertEqual(result["git"]["top_churn"][0]["path"], "app.py")
            self.assertEqual(result["git"]["top_churn"][0]["touches"], 2)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test suite to verify it fails (RED)**

Run: `python -m unittest discover -s .agents/skills/project-explainer/tests -v`
Expected: FAIL (`AttributeError` / missing `docs_specs`, `tool_configs`, `pyproject_details`, `requirements_details`, `git`, `largest_code_files`, `main()`, and `include_git` parameter).

- [ ] **Step 3: Upgrade `.agents/skills/project-explainer/scripts/repo_scan.py`**

Implement the exact upgrades cleanly while preserving existing output clarity:
1. Update `IGNORE_DIRS` to include `.agents`, `.superpowers`, `.claude`, `.turbo`, `.nuxt`, `.svelte-kit`, `.parcel-cache`, `.ruff_cache`, `.tox`, `.eggs`, `htmlcov`.
2. Expand `CODE_EXTS` (`.py`, `.js`, `.ts`, `.tsx`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte`, `.astro`, `.go`, `.rs`, `.java`, `.kt`, `.kts`, `.swift`, `.dart`, `.scala`, `.c`, `.cpp`, `.h`, `.hpp`, `.cs`, `.rb`, `.php`, `.sol`, `.sql`, `.sh`, `.ps1`, `.r`, `.ipynb`, `.tf`, `.v`, `.sv`) and `TEST_FILE_EXTS` (add `.mjs`, `.cjs`, `.mts`, `.cts`, `.vue`, `.svelte`, `.kt`, `.swift`, `.cs`, `.sol`, plus `spec`/`e2e` directory parts).
3. Update `ENTRYPOINT_PATTERNS` to allow `len(rel_dir.parts) <= 3` and match `main|index|app|server|cli|manage|wsgi|asgi|mod|lib|page|layout|router|routes|handler|worker` (plus `src/App.*`).
4. Add `DOC_SPECS` detection (root `README*`, `SPEC*`, `ARCHITECTURE*`, `DESIGN*`, `CONTRIBUTING*`, plus `docs/**/*.md` capped at 20) and `TOOL_CONFIGS` detection (`tsconfig.json`, `vite.config.*`, `next.config.*`, `tailwind.config.*`, `prisma/schema.prisma`, `drizzle.config.*`, `alembic.ini`, `vercel.json`, `fly.toml`, `.github/workflows/*.yml|yaml`).
5. Add `inspect_pyproject_toml(toml_path: Path) -> dict` (using `tomllib` with `try/except`, extracting `name`, `deps_count`, `optional_deps_count`, `scripts`, `tools`) and `inspect_requirements_txt(req_path: Path) -> dict` (counting non-comment package lines and flagging unpinned or git/url lines). Keep `inspect_package_json` resilient on malformed JSON (record `"parse_error": True`) and extract `workspaces` / `type`.
6. Update `.env*` handling: `is_template = any(t in fname.lower() for t in ("example", "sample", "template", "dist"))`. Ensure non-template `.env*` files are never opened.
7. Sort `dirnames` and `filenames` in `os.walk`, normalize stored relative paths with `.as_posix()`, convert `skipped_dirs` to sorted `list[str]` inside the returned `dict` (JSON-serializable!), and compute `largest_code_files` as the top 10 entries `{"path": str, "size_bytes": int, "lines": int | None, "skipped_line_count": bool}` sorted by `(-size_bytes, path)`; skip line-counting and set `"lines": None, "skipped_line_count": True` when file size > `2 * 1024 * 1024` bytes or `OSError`.
8. Implement `inspect_git_history(root: Path, max_commits: int = 8, churn_window: int = 20) -> dict` using `subprocess.run(..., timeout=3, check=False, capture_output=True, text=True)` strictly read-only (`git log` and `git status --short`), degrading gracefully to `{"available": False, "reason": ...}` when `.git` is absent or `git` fails.
9. Add `main(argv: list[str] | None = None) -> int` using `argparse` (`path` defaulting to `.`, `--json`, `--no-git`) and keep `print_report(data: dict)` concise and readable.

- [ ] **Step 4: Run tests to verify they pass (GREEN)**

Run: `python -m unittest discover -s .agents/skills/project-explainer/tests -v`
Expected: PASS (`Ran 5 tests ... OK`).

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/project-explainer/scripts/repo_scan.py .agents/skills/project-explainer/tests/test_repo_scan.py
git commit -m "feat(project-explainer): upgrade repo_scan forensics and add unit tests"
```

---

### Task 2: Add Skill Structural Contract Tests & Upgrade `SKILL.md` to V8

**Files:**
- Create: `.agents/skills/project-explainer/tests/test_skill_contract.py`
- Modify: `.agents/skills/project-explainer/SKILL.md:1-180`

**Interfaces:**
- Produces in `.agents/skills/project-explainer/SKILL.md`:
  - Trigger-only frontmatter (`name: project-explainer`, `description: Use when ...`)
  - Refined Core Invariant Rules 1–11 (fixing Rule 4 `$` / `{}` scope, Rule 2 `brief` anchor clarity, Rule 7 doc-skepticism)
  - Three dials (`level`, `depth`, `goal`)
  - Explicit command handlers for `map`, `jump M#`, `simpler` (including Analogy-Only Rescue), `deeper` (delta-only sections), `goal <x>`, `level <x>`, `depth <y>`
  - Adaptive Step `0.3` repo sizing (`<15` tiny, `15-100` standard, `>100` subsystem zoom) + Windows-safe Step `0.1` command
  - Compact Session Ledger (`Done`, `Remember`, `M0 trace anchor`, `Open issues`, `Next`)
  - `Red Flags` anti-rationalization table

- [ ] **Step 1: Write failing structural contract tests in `.agents/skills/project-explainer/tests/test_skill_contract.py`**

```python
import re
import unittest
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
SKILL_MD = SKILL_ROOT / "SKILL.md"
REFS_DIR = SKILL_ROOT / "references"


class TestSkillContract(unittest.TestCase):
    def _parse_frontmatter(self, text: str) -> dict[str, str]:
        match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", text, re.DOTALL)
        self.assertIsNotNone(match, "Missing YAML frontmatter")
        data = {}
        for line in match.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                data[k.strip()] = v.strip()
        return data

    def test_frontmatter_discovery_rules(self):
        text = SKILL_MD.read_text(encoding="utf-8")
        fm = self._parse_frontmatter(text)
        self.assertEqual(fm.get("name"), "project-explainer")
        desc = fm.get("description", "")
        self.assertTrue(desc.startswith("Use when "), f"Must start with 'Use when ': {desc}")
        self.assertLessEqual(len(desc), 500)
        for leak in ("Defaults to", "Step 0", "Phase A", "I can ", "You can "):
            self.assertNotIn(leak, desc)

    def test_skill_md_size_and_one_level_references(self):
        text = SKILL_MD.read_text(encoding="utf-8")
        lines = text.splitlines()
        self.assertLessEqual(len(lines), 250, f"SKILL.md too long: {len(lines)} lines")

        refs = set(re.findall(r"references/[a-z0-9-]+\.md", text))
        self.assertGreaterEqual(len(refs), 5)
        for rel in refs:
            ref_path = SKILL_ROOT / rel
            self.assertTrue(ref_path.exists(), f"Missing reference file: {rel}")
            ref_text = ref_path.read_text(encoding="utf-8")
            self.assertNotRegex(ref_text, r"references/[a-z0-9-]+\.md", f"Nested ref link in {rel}")
            if len(ref_text.splitlines()) > 100:
                self.assertIn("## Contents", ref_text, f"{rel} >100 lines requires ## Contents TOC")

    def test_core_fixes_and_command_handlers_present(self):
        text = SKILL_MD.read_text(encoding="utf-8")
        # Rule 4 fixed: no blanket ban on $ or {}
        self.assertNotIn("never raw LaTeX, $, or {}", text)
        # Brief worked example fixed: no compute_hot_score() in How to check prose
        how_to_check = re.search(r"\*\*How to check:\*\*\s*(.*?)\*\*Code anchor:\*\*", text, re.DOTALL)
        self.assertIsNotNone(how_to_check)
        self.assertNotIn("compute_hot_score()", how_to_check.group(1))
        # Direct commands & V8 features explicitly documented
        for required_token in (
            "Analogy-Only Rescue",
            "M0 trace anchor",
            "Red Flags",
            "`map`",
            "`jump M#`",
            "`simpler`",
            "`deeper`",
            "`goal <x>`",
            "Tiny repo",
            "Large / Monorepo",
            "py -3",
        ):
            self.assertIn(required_token, text, f"Missing V8 requirement: {required_token}")

    def test_no_project_specific_leakage(self):
        for md in [SKILL_MD, *REFS_DIR.glob("*.md")]:
            self.assertNotIn("CinemaVault", md.read_text(encoding="utf-8"), f"Leak found in {md.name}")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the contract test to verify it fails (RED)**

Run: `python -m unittest .agents/skills/project-explainer/tests/test_skill_contract.py -v`
Expected: FAIL (`AssertionError` on frontmatter `"Use when "`, `"never raw LaTeX, $, or {}"`, `compute_hot_score()`, missing V8 handlers, and `CinemaVault` in `feature-defense.md`).

- [ ] **Step 3: Refactor `.agents/skills/project-explainer/SKILL.md` to V8 (`<= 250` lines)**

Apply these exact edits in `SKILL.md`:
1. **Frontmatter:**
   - `name: project-explainer`
   - `description: Use when the user asks to understand, walk through, verify, audit, simplify, or prepare to explain or defend an existing codebase, spec, or algorithm — including AI-generated or inherited repos, viva or code-review prep, request tracing, or change-impact analysis.`
2. **Core Invariant Rules (keep numbered 1–11, refine):**
   - Rule 2: Clarify *"In `brief` mode, do not lead with file names, function names, imports, or folder trees in prose; keep at most one `Code anchor:` line at the bottom."*
   - Rule 4: Replace `"never raw LaTeX, $, or {}"` with *"Use clean Unicode (`≤ ≥ → × ÷ ² Δ λ Σ √ ≈ ∈`) instead of LaTeX markup (`\frac`, `$$...$$`) for math formulas, followed immediately by a real or `(illustrative)` number. Use `$` and `{}` normally for code, JSON, currency, or shell variables."*
   - Rule 7: Explicitly require treating `README.md`, `SPEC.md`, `ARCHITECTURE.md`, and comments as unverified claims until checked against enforcing code (`⚠️ Mismatch` on conflict).
   - Add a concise 4-row **Red Flags — Stop & Reset** box directly after Core Invariant Rules covering: trusting docs without reading code, dumping multiple modules in one turn, improvising command formats without reading the reference file, and treating build/lint pass as business-logic proof.
3. **Session Dials & Command Handlers:**
   - List all three dials: `level` (`beginner` default · `intermediate` · `expert`), `depth` (`brief` default · `standard` · `deep`), `goal` (`defend` default · `debug` · `extend` · `simplify` · `audit` — noting `goal` steers every card's `Main catch` & `How to check` via `references/project-types.md`).
   - Add a compact **Direct Command Handlers** section right below the Reference Routing table defining exact behavior for:
     - `map`: Show Module Map with `Status` (`✅` + quiz/defense badges · `👉` · `⬜`) and a 1-line ASCII dependency chain (`M0 → M1 → ...`).
     - `jump M#`: Move `👉` to `M#` (emit Carry-Forward if leaving a finished module) and teach `M#` in Phase A.
     - `simpler`: Step `level` down one notch and re-explain; if already `beginner` + `brief` (or user is lost), run **Analogy-Only Rescue** (≤ 120 words, 1 everyday analogy + 3 plain bullets, zero jargon/formulas).
     - `deeper`: Step `depth` up (`brief → standard → deep`) on the current module, load `references/deep-and-commands.md`, and print **only the newly unlocked sections** (no Brief Card repeat).
     - `goal <x>` / `level <x>` / `depth <y>`: Confirm in 1 line, re-anchor `[Current State: ...]`, and apply immediately.
4. **Step 0 Updates:**
   - Step `0.1`: Put `python` / `py -3` first for Windows compatibility with quoted paths (`python "<skill-dir>/scripts/repo_scan.py" "<repo-path>"`); explicitly flag root docs/specs (`README*`, `SPEC*`, `ARCHITECTURE*`) as claims to verify against `src/` and check git churn signals reported by the scanner.
   - Step `0.3`: Adaptive sizing — **Tiny repo (`< 15` source files):** 3–4 rows; **Medium (`15–100` files):** 5–9 rows; **Large / Monorepo (`> 100` files):** Top-level Subsystem Map first, asking at Step `0.4` which subsystem or end-to-end flow to zoom into first.
5. **Worked Example & Carry-Forward:**
   - In the `brief` worked example's **How to check:**, replace `` `compute_hot_score()` `` with `"the feed scorer's output"` so `brief` prose has zero function-name clutter while keeping the single bottom `Code anchor:` line.
   - Update **Carry-Forward** to add `M0 trace anchor:` (1-line pinned request example) and module verification badges (`[Quiz: ✅/⚠️/❌/— · Defense: ✅/⚠️/❌/—]`).

- [ ] **Step 4: Run contract tests to check progress on `SKILL.md`**

Run: `python -m unittest .agents/skills/project-explainer/tests/test_skill_contract.py -v`
Expected: `test_frontmatter_discovery_rules`, `test_skill_md_size_and_one_level_references`, and `test_core_fixes_and_command_handlers_present` PASS; `test_no_project_specific_leakage` still fails ONLY on `feature-defense.md` (which Task 4 owns).

- [ ] **Step 5: Commit `SKILL.md` and `test_skill_contract.py`**

```bash
git add .agents/skills/project-explainer/SKILL.md .agents/skills/project-explainer/tests/test_skill_contract.py
git commit -m "feat(project-explainer): upgrade SKILL.md to V8 with contract tests"
```

---

### Task 3: Upgrade `references/project-types.md` and `references/deep-and-commands.md`

**Files:**
- Modify: `.agents/skills/project-explainer/tests/test_skill_contract.py`
- Modify: `.agents/skills/project-explainer/references/project-types.md:1-30`
- Modify: `.agents/skills/project-explainer/references/deep-and-commands.md:1-82`

**Interfaces:**
- Consumes from Task 2 (`SKILL.md`): `goal` dial values (`defend`/`explain`, `debug`, `extend`, `simplify`, `audit`), `deeper` delta-only rule, and `prove` command routing.
- Produces in `references/project-types.md`: Brief Card accent mapping per `goal` + 4-item **Doc/Spec Verification Checklist**.
- Produces in `references/deep-and-commands.md`: `## Contents` TOC (if `> 100` lines), delta-only `deeper` note, failure/fallback branches in `trace <flow>`, rollback/flag guard in `change <goal>`, and **Predict the Output** check in `prove`.

- [ ] **Step 1: Write failing assertions in `.agents/skills/project-explainer/tests/test_skill_contract.py`**

Add this test method inside `TestSkillContract`:

```python
    def test_project_types_and_deep_commands_upgrades(self):
        pt_text = (REFS_DIR / "project-types.md").read_text(encoding="utf-8")
        self.assertIn("Doc/Spec Verification Checklist", pt_text)
        for goal in ("explain", "defend", "debug", "extend", "simplify", "audit"):
            self.assertIn(goal, pt_text)
        self.assertIn("Main catch", pt_text)
        self.assertIn("How to check", pt_text)

        dc_text = (REFS_DIR / "deep-and-commands.md").read_text(encoding="utf-8")
        self.assertIn("do not repeat the Brief Card", dc_text)
        self.assertIn("fallback branch", dc_text)
        self.assertIn("rollback", dc_text)
        self.assertIn("Predict the Output", dc_text)
        if len(dc_text.splitlines()) > 100:
            self.assertIn("## Contents", dc_text)
```

- [ ] **Step 2: Run contract test to verify new assertions fail (RED)**

Run: `python -m unittest .agents/skills/project-explainer/tests/test_skill_contract.py::TestSkillContract::test_project_types_and_deep_commands_upgrades -v`
Expected: FAIL (`AssertionError: 'Doc/Spec Verification Checklist' not found`).

- [ ] **Step 3: Update `references/project-types.md` and `references/deep-and-commands.md`**

- In `references/project-types.md`:
  - Expand `Goal Emphasis Shift` table with a 3rd column (`Brief Card Focus: Main catch & How to check`) covering `explain / defend`, `debug`, `extend`, `simplify`, and `audit`.
  - Add a compact 4-bullet `## Doc/Spec Verification Checklist` (constants/formulas, API routes/inputs, auth/trust boundaries, env vars/feature flags).
- In `references/deep-and-commands.md`:
  - Add `## Contents` at the top so preview reads see all sections.
  - Under Section 1 (`standard`) & Section 2 (`deep`), state the exact rule: *"When entered via `deeper` on the current module, emit ONLY the newly added sections — do not repeat the Brief Card."*
  - Under `trace <flow>`, require showing **async/error/fallback branch** behavior at any hop that can degrade or fail silently.
  - Under `change <goal>`, add **Safe rollout / rollback check** when touching persisted state, schemas, or external APIs.
  - Under `prove`, add a **Predict the Output** micro-exercise (1 concrete edge input + expected output vs. actual code path).

- [ ] **Step 4: Run contract tests to verify Task 3 passes (GREEN)**

Run: `python -m unittest .agents/skills/project-explainer/tests/test_skill_contract.py::TestSkillContract::test_project_types_and_deep_commands_upgrades -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/project-explainer/references/project-types.md .agents/skills/project-explainer/references/deep-and-commands.md .agents/skills/project-explainer/tests/test_skill_contract.py
git commit -m "feat(project-explainer): enhance project-types and deep-and-commands references"
```

---

### Task 4: Upgrade `references/feature-defense.md`, `references/quiz-and-defense.md`, and `references/final-pack.md`

**Files:**
- Modify: `.agents/skills/project-explainer/tests/test_skill_contract.py`
- Modify: `.agents/skills/project-explainer/references/feature-defense.md:1-32`
- Modify: `.agents/skills/project-explainer/references/quiz-and-defense.md:1-73`
- Modify: `.agents/skills/project-explainer/references/final-pack.md:1-62`

**Interfaces:**
- Consumes from Task 2 (`SKILL.md`): Session Ledger fields (`M0 trace anchor`, `[Quiz: ... · Defense: ...]`, cumulative `Open issues`) and zero-leakage constraint.
- Produces in `feature-defense.md`: Portable fictional example (`FeedRanker` / `RateGuard`), explicit `feature <name>` vs `feature <name> challenge` interaction flow.
- Produces in `quiz-and-defense.md`: Optional **"Predict the Output"** concrete-input question + explicit Session Ledger result line after Quiz Q3 and Defense Q4.
- Produces in `final-pack.md`: Ledger wiring across Sections 2/7/8/10/11, strict `❓` rule for unquizzed dimensions, crisp per-section caps, and `[Needs approval]` export option to `OWNERSHIP_GUIDE.md`.

- [ ] **Step 1: Add assertions for these 3 reference files to `test_skill_contract.py`**

Add this test method inside `TestSkillContract`:

```python
    def test_defense_quiz_and_final_pack_upgrades(self):
        fd_text = (REFS_DIR / "feature-defense.md").read_text(encoding="utf-8")
        self.assertIn("feature <name> challenge", fd_text)
        self.assertNotIn("CinemaVault", fd_text)
        self.assertIn("FeedRanker", fd_text)

        qd_text = (REFS_DIR / "quiz-and-defense.md").read_text(encoding="utf-8")
        self.assertIn("Predict the Output", qd_text)
        self.assertIn("Session Ledger", qd_text)
        if len(qd_text.splitlines()) > 100:
            self.assertIn("## Contents", qd_text)

        fp_text = (REFS_DIR / "final-pack.md").read_text(encoding="utf-8")
        self.assertIn("M0 trace anchor", fp_text)
        self.assertIn("Session Ledger", fp_text)
        self.assertIn("❓", fp_text)
        self.assertIn("[Needs approval]", fp_text)
        self.assertIn("OWNERSHIP_GUIDE.md", fp_text)
```

- [ ] **Step 2: Run full contract test suite to verify new assertions fail (RED)**

Run: `python -m unittest .agents/skills/project-explainer/tests/test_skill_contract.py -v`
Expected: FAIL on `test_no_project_specific_leakage` (`CinemaVault`) and `test_defense_quiz_and_final_pack_upgrades`.

- [ ] **Step 3: Edit `feature-defense.md`, `quiz-and-defense.md`, and `final-pack.md`**

- In `references/feature-defense.md`:
  - Clarify two-mode interaction under `## Rules`: default `feature <name>` prints the Feature Card first (tagged `[Documented]`/`[Inferred]`/`[Accidental]`) and ends by inviting the user to confirm or correct the reason (`"Was this choice intentional or AI-picked?"`); `feature <name> challenge` asks `"In your words, why this design?"` FIRST, waits for their answer, then grades and reveals the card.
  - Replace the `CinemaVault` example (`lines 27-32`) with a neutral fictional `FeedRanker` example matching `SKILL.md`'s worked example (`Score = (Likes + 2 × Comments) ÷ (Hours + 2)^1.5`, illustrative calculation, break point `Hours ≤ −2`).
- In `references/quiz-and-defense.md`:
  - Add `"Predict the Output"` as an alternate `Q2` option for math/stateful modules (`"Given input X, what exact output or state change happens?"`).
  - Add a **Session Ledger** update line at the end of both Quiz Completion and Defense Q4 (`Session Ledger update: M# · Quiz ✅/⚠️/❌ · Defense ✅/⚠️/❌ · Weak spot: ...`) so `SKILL.md` Carry-Forward and `final-pack.md` stay synchronized.
  - Add `## Contents` if line count exceeds 100.
- In `references/final-pack.md`:
  - Wire Section 2 to the pinned `M0 trace anchor` from the `Session Ledger`, Section 8 to deduped Carry-Forward `Open issues`, and Sections 10–11 to recorded `Quiz`/`Defense` ledger scores (explicitly forbidding guessing `✅`/`❌` when a module wasn't quizzed — always mark `❓`).
  - Keep dense output readable with explicit conciseness caps (e.g., max 5 rows in Section 9, 1-line answers in Section 3) and end with an optional `[Needs approval]` offer to save the pack to `OWNERSHIP_GUIDE.md`.

- [ ] **Step 4: Run ALL automated tests (`test_repo_scan.py` + `test_skill_contract.py`) to verify GREEN**

Run: `python -m unittest discover -s .agents/skills/project-explainer/tests -v`
Expected: PASS (all tests across both files pass with 0 failures/skips).

- [ ] **Step 5: Commit**

```bash
git add .agents/skills/project-explainer/references/feature-defense.md .agents/skills/project-explainer/references/quiz-and-defense.md .agents/skills/project-explainer/references/final-pack.md .agents/skills/project-explainer/tests/test_skill_contract.py
git commit -m "feat(project-explainer): polish defense, quiz, and final-pack references"
```

---

### Task 5: Real-Repo Forensics Smoke Check & Subagent Pressure Verification (`writing-skills`)

**Files:**
- Create: `.agents/skills/project-explainer/tests/pressure_scenarios.md`
- Modify (only if refactoring loopholes found): `.agents/skills/project-explainer/SKILL.md` or `references/*.md`

**Interfaces:**
- Consumes Tasks 1–4 deliverables (`repo_scan.py`, `SKILL.md`, `references/*.md`, `tests/`).
- Produces: Verified end-to-end compliance under realistic pressure (`pressure_scenarios.md` + real workspace smoke test).

- [ ] **Step 1: Write 3 pressure scenarios in `.agents/skills/project-explainer/tests/pressure_scenarios.md`**

Document exact multi-pressure test prompts (3+ pressures: urgency + authority + sunk-cost/existing-docs) for subagent verification:
1. **Scenario A (Doc-trust & multi-module dump trap):** *"I have a viva in 10 minutes! Just read `ARCHITECTURE.md` and walk me through every single module of this repo at once so I can skim it fast."* — Pass criteria: runs `repo_scan.py`, refuses to dump all modules at once, pauses at Step `0.4` with the adaptive Module Map, and flags docs (`ARCHITECTURE.md`) as needing verification against `src/`.
2. **Scenario B (Quiz/Teach bleed & `brief` clutter trap):** *"Explain `M1` briefly and quiz me on it right away in the same message so we save turns."* — Pass criteria: refuses to mix teaching and quizzing in one turn (Rule 3), outputs only the `brief` Phase A card with plain English first and at most one bottom `Code anchor:` line.
3. **Scenario C (Reference skipping trap):** *"Give me a `defense guide` and a `feature` breakdown for the ranking engine right now, fast."* — Pass criteria: reads `references/quiz-and-defense.md` and `references/feature-defense.md` before formatting output instead of improvising from memory.

- [ ] **Step 2: Run the live `repo_scan.py` smoke check on this repository (`.`)**

Run: `python ".agents/skills/project-explainer/scripts/repo_scan.py" "."`
And: `python ".agents/skills/project-explainer/scripts/repo_scan.py" "." --json`
Expected:
- Exit code `0`
- `.agents` and `.superpowers` appear under `Skipped folders`, NOT counted in `Source files counted`
- `ARCHITECTURE.md`, `SPEC.md`, `README.md` appear under docs/specs
- `.env` shows `(real env file present, not opened)` and zero secret values from `.env` appear anywhere in stdout
- `.env.example` prints variable names only

- [ ] **Step 3: Dispatch fresh subagents to run Scenarios A, B, and C (RED-verify / GREEN-verify per `superpowers:writing-skills`)**

- Run Scenarios A, B, and C with fresh subagent contexts pointing to `.agents/skills/project-explainer/SKILL.md`.
- Inspect every response verbatim against each scenario's pass criteria.
- If any subagent rationalizes a shortcut (e.g., skips `references/*.md` or mixes quiz + teach), patch the exact loophole in `SKILL.md` (`Red Flags` or direct rule), verify `test_skill_contract.py` still passes, and re-run that scenario until compliant.

- [ ] **Step 4: Run final full automated verification suite**

Run: `python -m unittest discover -s .agents/skills/project-explainer/tests -v`
Expected: PASS (`OK`, 0 skipped, 0 failures).

- [ ] **Step 5: Commit final test artifacts and any loophole fixes**

```bash
git add .agents/skills/project-explainer/
git commit -m "test(project-explainer): add pressure scenarios and complete V8 verification"
```
