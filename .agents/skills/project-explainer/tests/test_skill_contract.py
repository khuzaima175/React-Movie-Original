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
