import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("vault.css contains a max-width: 900px rule that offsets .vault-bulk-floating-bar above the mobile tab bar", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src/styles/vault.css"), "utf8");
  assert.match(
    css,
    /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.vault-bulk-floating-bar\s*\{[\s\S]*?bottom:\s*calc\(/
  );
});

test("App footer uses a 900px breakpoint for desktop padding", () => {
  const jsx = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  assert.equal(jsx.includes("min-[901px]:pb-8"), true);
  assert.equal(jsx.includes("md:pb-8"), false);
});
