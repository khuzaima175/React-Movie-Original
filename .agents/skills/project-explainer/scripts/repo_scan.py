#!/usr/bin/env python3
"""
Read-only repository forensics scanner for Project Explainer (V7.2).
Lists entrypoints, manifests, lockfiles, scripts, test files, risky install hooks,
and .env template variable NAMES only (never opens real .env files).
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

IGNORE_DIRS = {
    ".git", "node_modules", "dist", "build", ".next", "out", "coverage",
    "__pycache__", ".pytest_cache", ".mypy_cache", "venv", ".venv",
    "target", "vendor", ".idea", ".vscode", ".agent", ".cursor"
}

MANIFESTS = {
    "package.json", "pyproject.toml", "requirements.txt", "Pipfile",
    "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "composer.json",
    "Gemfile", "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    "Makefile"
}

LOCKFILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
    "poetry.lock", "Pipfile.lock", "uv.lock", "Cargo.lock", "go.sum",
    "composer.lock", "Gemfile.lock"
}

ENTRYPOINT_PATTERNS = re.compile(
    r"^(main|index|app|server|cli|manage|wsgi|asgi|mod|lib)\."
    r"(py|js|ts|tsx|jsx|go|rs|java|rb|php|sh)$",
    re.IGNORECASE,
)

TEST_PATTERNS = re.compile(
    r"(^test_.*|.*_test\.[^.]+|.*\.(test|spec)\.[^.]+)$",
    re.IGNORECASE,
)

RISKY_NPM_HOOKS = {"preinstall", "install", "postinstall", "preuninstall", "postuninstall"}
ENV_KEY_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=")


def extract_env_keys(env_path: Path) -> list[str]:
    """Read ONLY variable names from an env template file; never read or return values."""
    keys = []
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
    """Extract scripts, dependency counts, and risky install hooks from package.json."""
    info = {"scripts": {}, "deps_count": 0, "dev_deps_count": 0, "risky_hooks": [], "unpinned": []}
    try:
        data = json.loads(pkg_path.read_text(encoding="utf-8", errors="ignore"))
        scripts = data.get("scripts", {}) or {}
        info["scripts"] = {k: v for k, v in list(scripts.items())[:15]}
        info["risky_hooks"] = [k for k in scripts if k in RISKY_NPM_HOOKS]

        deps = data.get("dependencies", {}) or {}
        dev_deps = data.get("devDependencies", {}) or {}
        info["deps_count"] = len(deps)
        info["dev_deps_count"] = len(dev_deps)

        for name, ver in {**deps, **dev_deps}.items():
            if isinstance(ver, str) and (ver in ("*", "latest") or ver.startswith(("http:", "https:", "git+", "github:"))):
                info["unpinned"].append(f"{name} ({ver})")
    except Exception:
        pass
    return info


def scan_repo(root: Path, max_files: int = 2500) -> dict:
    result = {
        "root": str(root.resolve()),
        "total_code_files": 0,
        "truncated": False,
        "manifests": [],
        "lockfiles": [],
        "entrypoints": [],
        "test_files": [],
        "env_files": {},
        "package_json_details": {},
        "top_dirs": [],
        "skipped_dirs": set(),
    }

    try:
        result["top_dirs"] = sorted(
            [p.name for p in root.iterdir() if p.is_dir() and p.name not in IGNORE_DIRS and not p.name.startswith(".")]
        )
    except OSError:
        pass

    for dirpath, dirnames, filenames in os.walk(root):
        result["skipped_dirs"].update(d for d in dirnames if d in IGNORE_DIRS)
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        rel_dir = Path(dirpath).relative_to(root)

        for fname in filenames:
            if result["total_code_files"] >= max_files:
                result["truncated"] = True
                break

            rel_path = str(rel_dir / fname) if str(rel_dir) != "." else fname
            full_path = Path(dirpath) / fname

            if fname in MANIFESTS:
                result["manifests"].append(rel_path)
                if fname == "package.json":
                    result["package_json_details"][rel_path] = inspect_package_json(full_path)

            if fname in LOCKFILES:
                result["lockfiles"].append(rel_path)

            if fname.startswith(".env"):
                is_template = any(t in fname for t in ("example", "sample", "template"))
                result["env_files"][rel_path] = (
                    extract_env_keys(full_path) if is_template
                    else ["(real env file present, not opened)"]
                )
                continue

            if TEST_PATTERNS.match(fname) or "test" in rel_dir.parts or "tests" in rel_dir.parts or "__tests__" in rel_dir.parts:
                if fname.endswith((".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".rb", ".php")):
                    result["test_files"].append(rel_path)

            if ENTRYPOINT_PATTERNS.match(fname) and len(rel_dir.parts) <= 2:
                result["entrypoints"].append(rel_path)

            if fname.endswith((".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".c", ".cpp", ".cs", ".rb", ".php", ".sol", ".v", ".sv")):
                result["total_code_files"] += 1

        if result["truncated"]:
            break

    return result


def print_report(data: dict) -> None:
    print("=== REPO FORENSICS SCAN (READ-ONLY) ===")
    print(f"Root: {data['root']}")
    print(f"Top-level folders: {', '.join(data['top_dirs']) or '(none)'}")
    trunc_note = " (stopped at cap: 2500)" if data["truncated"] else ""
    print(f"Source files counted: {data['total_code_files']}{trunc_note}")
    print(f"Skipped folders: {', '.join(sorted(data['skipped_dirs'])) or '(none)'}")

    print("\n[Manifests & Build Files]")
    print("  " + (", ".join(data["manifests"]) if data["manifests"] else "None found"))

    print("\n[Lockfiles]")
    print("  " + (", ".join(data["lockfiles"]) if data["lockfiles"] else "⚠️ None found (dependencies may be unpinned)"))

    print("\n[Likely Entrypoints]")
    print("  " + (", ".join(data["entrypoints"][:20]) if data["entrypoints"] else "None matched standard names"))

    print(f"\n[Tests Found: {len(data['test_files'])}]")
    for tf in data["test_files"][:15]:
        print(f"  - {tf}")
    if len(data["test_files"]) > 15:
        print(f"  ... and {len(data['test_files']) - 15} more test files")

    if data["package_json_details"]:
        print("\n[package.json Inspection]")
        for path, info in data["package_json_details"].items():
            print(f"  File: {path} (deps: {info['deps_count']}, devDeps: {info['dev_deps_count']})")
            if info["scripts"]:
                scripts_str = ", ".join(f"{k}: '{v}'" for k, v in info["scripts"].items())
                print(f"    Scripts: {scripts_str}")
            if info["risky_hooks"]:
                print(f"    ⚠️ Risky install hooks: {', '.join(info['risky_hooks'])}")
            if info["unpinned"]:
                print(f"    ⚠️ Unpinned/remote packages: {', '.join(info['unpinned'])}")

    print("\n[Environment Files (Variable Names Only — Values Redacted)]")
    if data["env_files"]:
        for env_file, keys in data["env_files"].items():
            print(f"  {env_file}: {', '.join(keys) if keys else '(no keys found)'}")
    else:
        print("  None found")
    print("=======================================")


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    if not target.exists():
        print(f"Error: Path '{target}' does not exist.", file=sys.stderr)
        sys.exit(1)
    print_report(scan_repo(target))
