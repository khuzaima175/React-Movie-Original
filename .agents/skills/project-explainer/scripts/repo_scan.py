#!/usr/bin/env python3
"""
Read-only repository forensics scanner for Project Explainer (V8).
Lists entrypoints, manifests, lockfiles, docs/specs, tool configs, test files,
largest source files, risky install hooks, git churn (optional), and .env
template variable NAMES only (never opens real .env files).
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
import subprocess
import sys

try:
    import tomllib  # Python 3.11+
except ImportError:  # pragma: no cover
    tomllib = None

IGNORE_DIRS = {
    ".git", "node_modules", "dist", "build", ".next", "out", "coverage",
    "htmlcov", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "venv", ".venv", ".tox", ".eggs", "target", "vendor",
    ".idea", ".vscode", ".agent", ".agents", ".superpowers", ".claude", ".cursor",
    ".turbo", ".nuxt", ".svelte-kit", ".parcel-cache", ".worktrees",
}

MANIFESTS = {
    "package.json", "pyproject.toml", "requirements.txt", "Pipfile",
    "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "composer.json",
    "Gemfile", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    "Makefile",
}

LOCKFILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
    "poetry.lock", "Pipfile.lock", "uv.lock", "Cargo.lock", "go.sum",
    "composer.lock", "Gemfile.lock",
}

CODE_EXTS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
    ".vue", ".svelte", ".astro", ".go", ".rs", ".java", ".kt", ".kts",
    ".swift", ".dart", ".scala", ".c", ".cpp", ".h", ".hpp", ".cs",
    ".rb", ".php", ".sol", ".sql", ".sh", ".ps1", ".r", ".ipynb",
    ".tf", ".v", ".sv",
}

TEST_FILE_EXTS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
    ".vue", ".svelte", ".go", ".rs", ".java", ".kt", ".swift", ".cs",
    ".rb", ".php", ".sol",
}

TEST_DIR_PARTS = {"test", "tests", "__tests__", "spec", "e2e"}

ENTRYPOINT_PATTERNS = re.compile(
    r"^(main|index|app|server|cli|manage|wsgi|asgi|mod|lib|page|layout|router|routes|handler|worker)\."
    r"(py|js|ts|tsx|jsx|mjs|cjs|mts|vue|svelte|astro|go|rs|java|kt|rb|php|sh)$",
    re.IGNORECASE,
)

TEST_PATTERNS = re.compile(
    r"(^test_.*|.*_test\.[^.]+|.*\.(test|spec)\.[^.]+)$",
    re.IGNORECASE,
)

DOC_ROOT_RE = re.compile(
    r"^(README|SPEC|ARCHITECTURE|DESIGN|CONTRIBUTING)(\.[^.]+)?$",
    re.IGNORECASE,
)

TOOL_CONFIG_RE = re.compile(
    r"^(tsconfig(\.[^.]+)?\.json|vite\.config\.[^.]+|next\.config\.[^.]+|"
    r"tailwind\.config\.[^.]+|drizzle\.config\.[^.]+|alembic\.ini|"
    r"vercel\.json|fly\.toml)$",
    re.IGNORECASE,
)

RISKY_NPM_HOOKS = {"preinstall", "install", "postinstall", "preuninstall", "postuninstall"}
ENV_KEY_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")
REQ_PINNED_RE = re.compile(r"(==|~=|>=|<=|!=|===|<|>|\s@\s)")
MAX_LINE_COUNT_BYTES = 2 * 1024 * 1024


def extract_env_keys(env_path: Path) -> list[str]:
    """Read ONLY variable names from an env template file; never read or return values."""
    keys: list[str] = []
    try:
        with env_path.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                match = ENV_KEY_RE.match(stripped)
                if match:
                    keys.append(match.group(1))
    except OSError:
        pass
    return keys


def inspect_package_json(pkg_path: Path) -> dict:
    """Extract scripts, module type, workspaces, dependency counts, and risky hooks."""
    info: dict = {
        "parse_error": False,
        "type": None,
        "workspaces": False,
        "scripts": {},
        "deps_count": 0,
        "dev_deps_count": 0,
        "risky_hooks": [],
        "unpinned": [],
    }
    try:
        data = json.loads(pkg_path.read_text(encoding="utf-8", errors="ignore"))
        if not isinstance(data, dict):
            info["parse_error"] = True
            return info
        info["type"] = data.get("type")
        info["workspaces"] = bool(data.get("workspaces"))
        scripts = data.get("scripts", {}) or {}
        if isinstance(scripts, dict):
            info["scripts"] = {k: v for k, v in list(scripts.items())[:15]}
            info["risky_hooks"] = [k for k in scripts if k in RISKY_NPM_HOOKS]

        deps = data.get("dependencies", {}) or {}
        dev_deps = data.get("devDependencies", {}) or {}
        info["deps_count"] = len(deps) if isinstance(deps, dict) else 0
        info["dev_deps_count"] = len(dev_deps) if isinstance(dev_deps, dict) else 0

        merged = {}
        if isinstance(deps, dict):
            merged.update(deps)
        if isinstance(dev_deps, dict):
            merged.update(dev_deps)
        for name, ver in merged.items():
            if isinstance(ver, str) and (
                ver in ("*", "latest") or ver.startswith(("http:", "https:", "git+", "github:"))
            ):
                info["unpinned"].append(f"{name} ({ver})")
    except Exception:
        info["parse_error"] = True
    return info


def inspect_pyproject_toml(toml_path: Path) -> dict:
    """Extract project name, dependency counts, console scripts, and tool keys."""
    info: dict = {
        "parse_error": False,
        "name": None,
        "deps_count": 0,
        "optional_deps_count": 0,
        "scripts": {},
        "tools": [],
    }
    if tomllib is None:
        info["parse_error"] = True
        return info
    try:
        data = tomllib.loads(toml_path.read_text(encoding="utf-8", errors="ignore"))
        project = data.get("project", {}) or {}
        info["name"] = project.get("name")
        deps = project.get("dependencies", []) or []
        info["deps_count"] = len(deps) if isinstance(deps, list) else 0
        opt_deps = project.get("optional-dependencies", {}) or {}
        if isinstance(opt_deps, dict):
            info["optional_deps_count"] = sum(
                len(v) for v in opt_deps.values() if isinstance(v, list)
            )
        scripts = project.get("scripts", {}) or {}
        if isinstance(scripts, dict):
            info["scripts"] = {k: v for k, v in list(scripts.items())[:15]}
        tool = data.get("tool", {}) or {}
        if isinstance(tool, dict):
            info["tools"] = sorted(tool.keys())
    except Exception:
        info["parse_error"] = True
    return info


def inspect_requirements_txt(req_path: Path) -> dict:
    """Count requirements and flag unpinned or remote package lines."""
    info: dict = {"parse_error": False, "count": 0, "unpinned": []}
    try:
        for raw in req_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw.split("#", 1)[0].strip()
            if not line or line.startswith(("-r", "-c", "--", "-e ")):
                continue
            info["count"] += 1
            if line.startswith(("http:", "https:", "git+")) or not REQ_PINNED_RE.search(line):
                info["unpinned"].append(line)
    except OSError:
        info["parse_error"] = True
    return info


def inspect_git_history(root: Path, max_commits: int = 8, churn_window: int = 20) -> dict:
    """Collect recent commit summaries, dirty status count, and top churned files."""
    if not (root / ".git").exists():
        return {"available": False, "reason": "not a git repository"}

    def _run_git(args: list[str]) -> subprocess.CompletedProcess[str] | None:
        try:
            return subprocess.run(
                ["git", "-C", str(root), *args],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=3,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None

    log_res = _run_git(["log", f"-n{max_commits}", "--format=%h %ad %s", "--date=short"])
    if log_res is None or log_res.returncode != 0:
        return {"available": False, "reason": "git history unavailable"}

    commits = [line.strip() for line in log_res.stdout.splitlines() if line.strip()]
    status_res = _run_git(["status", "--short"])
    dirty_count = (
        len([line for line in status_res.stdout.splitlines() if line.strip()])
        if status_res and status_res.returncode == 0
        else 0
    )

    churn_res = _run_git(["log", f"-n{churn_window}", "--name-only", "--format="])
    counts: Counter[str] = Counter()
    if churn_res and churn_res.returncode == 0:
        for line in churn_res.stdout.splitlines():
            cleaned = line.strip()
            if cleaned:
                counts[cleaned] += 1

    top_churn = [
        {"path": path, "touches": touches}
        for path, touches in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:8]
    ]
    return {
        "available": True,
        "recent_commits": commits,
        "dirty_files": dirty_count,
        "top_churn": top_churn,
    }


def _count_file_lines(full_path: Path) -> tuple[int, int | None, bool]:
    """Return (size_bytes, lines_or_none, skipped_line_count)."""
    try:
        size_bytes = full_path.stat().st_size
    except OSError:
        return 0, None, True
    if size_bytes > MAX_LINE_COUNT_BYTES:
        return size_bytes, None, True
    try:
        with full_path.open("rb") as f:
            line_count = sum(1 for _ in f)
        return size_bytes, line_count, False
    except OSError:
        return size_bytes, None, True


def scan_repo(root: Path, max_files: int = 2500, include_git: bool = True) -> dict:
    """Walk root safely and return structured read-only repository forensics."""
    result: dict = {
        "root": str(root.resolve()),
        "total_code_files": 0,
        "truncated": False,
        "manifests": [],
        "lockfiles": [],
        "entrypoints": [],
        "test_files": [],
        "docs_specs": [],
        "tool_configs": [],
        "env_files": {},
        "package_json_details": {},
        "pyproject_details": {},
        "requirements_details": {},
        "largest_code_files": [],
        "top_dirs": [],
        "skipped_dirs": [],
        "git": {"available": False, "reason": "skipped (--no-git)"} if not include_git else {},
    }
    skipped_dirs: set[str] = set()
    code_candidates: list[dict] = []

    try:
        result["top_dirs"] = sorted(
            [
                p.name
                for p in root.iterdir()
                if p.is_dir() and p.name not in IGNORE_DIRS and not p.name.startswith(".")
            ]
        )
    except OSError:
        pass

    for dirpath, dirnames, filenames in os.walk(root):
        skipped_dirs.update(d for d in dirnames if d in IGNORE_DIRS)
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORE_DIRS)
        filenames.sort()
        rel_dir = Path(dirpath).relative_to(root)

        for fname in filenames:
            if result["total_code_files"] >= max_files:
                result["truncated"] = True
                break

            rel_path = (rel_dir / fname).as_posix() if str(rel_dir) != "." else fname
            full_path = Path(dirpath) / fname
            suffix = Path(fname).suffix.lower()

            if fname in MANIFESTS:
                result["manifests"].append(rel_path)
                if fname == "package.json":
                    result["package_json_details"][rel_path] = inspect_package_json(full_path)
                elif fname == "pyproject.toml":
                    result["pyproject_details"][rel_path] = inspect_pyproject_toml(full_path)
                elif fname == "requirements.txt":
                    result["requirements_details"][rel_path] = inspect_requirements_txt(full_path)

            if fname in LOCKFILES:
                result["lockfiles"].append(rel_path)

            if fname.startswith(".env"):
                is_template = any(t in fname.lower() for t in ("example", "sample", "template", "dist"))
                result["env_files"][rel_path] = (
                    extract_env_keys(full_path)
                    if is_template
                    else ["(real env file present, not opened)"]
                )
                continue

            if (len(rel_dir.parts) == 0 and DOC_ROOT_RE.match(fname)) or (
                len(rel_dir.parts) >= 1 and rel_dir.parts[0].lower() == "docs" and suffix == ".md"
            ):
                if len(result["docs_specs"]) < 20:
                    result["docs_specs"].append(rel_path)

            if (
                TOOL_CONFIG_RE.match(fname)
                or rel_path == "prisma/schema.prisma"
                or (rel_path.startswith(".github/workflows/") and suffix in {".yml", ".yaml"})
            ):
                result["tool_configs"].append(rel_path)

            is_test = False
            if TEST_PATTERNS.match(fname) or any(part in TEST_DIR_PARTS for part in rel_dir.parts):
                if suffix in TEST_FILE_EXTS:
                    result["test_files"].append(rel_path)
                    is_test = True

            if ENTRYPOINT_PATTERNS.match(fname) and len(rel_dir.parts) <= 3:
                result["entrypoints"].append(rel_path)

            if suffix in CODE_EXTS and not is_test:
                result["total_code_files"] += 1
                size_bytes, lines, skipped_lc = _count_file_lines(full_path)
                code_candidates.append(
                    {
                        "path": rel_path,
                        "size_bytes": size_bytes,
                        "lines": lines,
                        "skipped_line_count": skipped_lc,
                    }
                )

        if result["truncated"]:
            break

    result["skipped_dirs"] = sorted(skipped_dirs)
    result["largest_code_files"] = sorted(
        code_candidates, key=lambda item: (-item["size_bytes"], item["path"])
    )[:10]
    if include_git:
        result["git"] = inspect_git_history(root)
    return result


def print_report(data: dict) -> None:
    """Print a compact, human-readable repository forensics summary."""
    print("=== REPO FORENSICS SCAN (READ-ONLY) ===")
    print(f"Root: {data['root']}")
    print(f"Top-level folders: {', '.join(data['top_dirs']) or '(none)'}")
    trunc_note = " (stopped at cap: 2500)" if data["truncated"] else ""
    print(f"Source files counted (non-test): {data['total_code_files']}{trunc_note}")
    print(f"Skipped folders: {', '.join(data['skipped_dirs']) or '(none)'}")

    print("\n[Manifests & Build Files]")
    print("  " + (", ".join(data["manifests"]) if data["manifests"] else "None found"))

    print("\n[Lockfiles]")
    print("  " + (", ".join(data["lockfiles"]) if data["lockfiles"] else "⚠️ None found (dependencies may be unpinned)"))

    print("\n[Docs & Specs (Unverified Claims — Check Against Code)]")
    print("  " + (", ".join(data["docs_specs"]) if data["docs_specs"] else "None found"))

    print("\n[Tool & CI Configs]")
    print("  " + (", ".join(data["tool_configs"]) if data["tool_configs"] else "None found"))

    print("\n[Likely Entrypoints]")
    print("  " + (", ".join(data["entrypoints"][:20]) if data["entrypoints"] else "None matched standard names"))

    if data["largest_code_files"]:
        print("\n[Largest Source Files]")
        for item in data["largest_code_files"][:10]:
            line_str = "skipped (>2MB)" if item["skipped_line_count"] else f"{item['lines']} lines"
            print(f"  - {item['path']} ({line_str}, {item['size_bytes']} bytes)")

    print(f"\n[Tests Found: {len(data['test_files'])}]")
    for tf in data["test_files"][:15]:
        print(f"  - {tf}")
    if len(data["test_files"]) > 15:
        print(f"  ... and {len(data['test_files']) - 15} more test files")

    if data["package_json_details"]:
        print("\n[package.json Inspection]")
        for path, info in data["package_json_details"].items():
            if info["parse_error"]:
                print(f"  File: {path} (⚠️ parse error)")
                continue
            print(f"  File: {path} (deps: {info['deps_count']}, devDeps: {info['dev_deps_count']}, type: {info['type'] or 'commonjs'})")
            if info["scripts"]:
                scripts_str = ", ".join(f"{k}: '{v}'" for k, v in info["scripts"].items())
                print(f"    Scripts: {scripts_str}")
            if info["risky_hooks"]:
                print(f"    ⚠️ Risky install hooks: {', '.join(info['risky_hooks'])}")
            if info["unpinned"]:
                print(f"    ⚠️ Unpinned/remote packages: {', '.join(info['unpinned'])}")

    if data["pyproject_details"]:
        print("\n[pyproject.toml Inspection]")
        for path, info in data["pyproject_details"].items():
            if info["parse_error"]:
                print(f"  File: {path} (⚠️ parse error)")
                continue
            print(f"  File: {path} (name: {info['name'] or '?'}, deps: {info['deps_count']}, optional: {info['optional_deps_count']})")
            if info["tools"]:
                print(f"    Tools: {', '.join(info['tools'])}")

    if data["requirements_details"]:
        print("\n[requirements.txt Inspection]")
        for path, info in data["requirements_details"].items():
            print(f"  File: {path} (packages: {info['count']}, unpinned/remote: {len(info['unpinned'])})")

    print("\n[Environment Files (Variable Names Only — Values Redacted)]")
    if data["env_files"]:
        for env_file, keys in data["env_files"].items():
            print(f"  {env_file}: {', '.join(keys) if keys else '(no keys found)'}")
    else:
        print("  None found")

    git_info = data.get("git", {})
    print("\n[Recent Git Activity]")
    if git_info.get("available"):
        print(f"  Dirty files: {git_info.get('dirty_files', 0)}")
        for c in git_info.get("recent_commits", []):
            print(f"  - {c}")
        if git_info.get("top_churn"):
            churn_str = ", ".join(f"{x['path']} ({x['touches']}x)" for x in git_info["top_churn"])
            print(f"  Top churn: {churn_str}")
    else:
        print(f"  {git_info.get('reason', 'Git history unavailable')}")
    print("=======================================")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read-only repository forensics scanner")
    parser.add_argument("path", nargs="?", default=".", help="Repository path to scan")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text report")
    parser.add_argument("--no-git", action="store_true", help="Skip git history inspection")
    args = parser.parse_args(argv)

    target = Path(args.path)
    if not target.exists():
        print(f"Error: Path '{target}' does not exist.", file=sys.stderr)
        return 1

    data = scan_repo(target, include_git=not args.no_git)
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print_report(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
