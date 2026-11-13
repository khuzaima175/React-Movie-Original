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

            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = repo_scan.main([str(root), "--json", "--no-git"])
            self.assertEqual(rc, 0)
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

    def test_test_files_excluded_from_entrypoints_and_cover_cpp_shell(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "src").mkdir()
            (root / "src" / "index.ts").write_text("export {}\n", encoding="utf-8")
            (root / "tests").mkdir()
            (root / "tests" / "server.js").write_text("// test server helper\n", encoding="utf-8")
            (root / "tests" / "test_parser.cpp").write_text("int main() { return 0; }\n", encoding="utf-8")
            (root / "tests" / "run_tests.sh").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")

            result = repo_scan.scan_repo(root, include_git=False)
            self.assertNotIn("tests/server.js", result["entrypoints"])
            self.assertIn("tests/server.js", result["test_files"])
            self.assertIn("tests/test_parser.cpp", result["test_files"])
            self.assertIn("tests/run_tests.sh", result["test_files"])
            self.assertEqual(result["total_code_files"], 1)

    def test_git_churn_ignores_ignored_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Tester"], cwd=root, check=True, capture_output=True)
            (root / "src").mkdir()
            (root / ".agents" / "skills").mkdir(parents=True)
            for i in range(3):
                (root / ".agents" / "skills" / "SKILL.md").write_text(f"v{i}\n", encoding="utf-8")
                if i < 2:
                    (root / "src" / "app.py").write_text(f"v{i}\n", encoding="utf-8")
                subprocess.run(["git", "add", "."], cwd=root, check=True, capture_output=True)
                subprocess.run(["git", "commit", "-m", f"commit {i}"], cwd=root, check=True, capture_output=True)

            result = repo_scan.scan_repo(root, include_git=True)
            churn_paths = [item["path"] for item in result["git"]["top_churn"]]
            self.assertNotIn(".agents/skills/SKILL.md", churn_paths)
            self.assertEqual(churn_paths, ["src/app.py"])


if __name__ == "__main__":
    unittest.main()
