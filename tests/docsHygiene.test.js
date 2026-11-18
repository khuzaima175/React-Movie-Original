import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function readDoc(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("SPEC.md starts with a markdown heading", () => {
  const firstLine = readDoc("SPEC.md")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  assert.match(firstLine || "", /^# /);
});

test("no top-level doc hard-codes test counts", () => {
  for (const doc of ["README.md", "SPEC.md", "ARCHITECTURE.md", "LOCAL_MODEL_GUIDE.md"]) {
    const body = readDoc(doc);
    assert.equal(/\b3\d\d\s*(?:\/|of)\s*3\d\d\b/.test(body), false, `${doc} should not hard-code test counts`);
    assert.equal(/3\d\d%2F3\d\d/i.test(body), false, `${doc} badge should not hard-code test counts`);
  }
});

test("README has no placeholder clone URL and no Hydrogen badge", () => {
  const readme = readDoc("README.md");
  assert.equal(readme.includes("your-repo-url"), false);
  assert.equal(readme.includes("4_Hydrogen"), false);
});

test("LICENSE exists and starts with MIT License", () => {
  const license = readDoc("LICENSE");
  assert.equal(license.trimStart().startsWith("MIT License"), true);
});

test("summary.md has been promoted and removed", () => {
  assert.equal(fs.existsSync(path.join(process.cwd(), "summary.md")), false);
});
