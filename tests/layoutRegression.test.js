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


test("oracle.css renders .recommendation-list-editorial as a 2-column grid on desktop and collapses to 1 column on <=960px", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src/styles/oracle.css"), "utf8");
  assert.match(
    css,
    /\.recommendation-list-editorial\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*960px\)\s*\{[\s\S]*?\.recommendation-list-editorial\s*\{[\s\S]*?grid-template-columns:\s*1fr;/
  );
});

test("vault.css keeps .studio-hero-tier overflow visible for the actions dropdown while clipping .vault-hero-ambient-clip", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "src/styles/vault.css"), "utf8");
  const heroTierMatch = css.match(/\.studio-hero-tier\s*\{[\s\S]*?\}/);
  assert.ok(heroTierMatch, ".studio-hero-tier rule should exist");
  assert.doesNotMatch(heroTierMatch[0], /overflow\s*:\s*hidden/);
  assert.match(heroTierMatch[0], /z-index\s*:\s*20/);
  assert.match(
    css,
    /\.vault-hero-ambient-clip\s*\{[\s\S]*?overflow\s*:\s*hidden;/
  );
});
