import test from "node:test";
import assert from "node:assert/strict";
import { parseEnvText, isScannable } from "../scripts/check_secrets_in_history.mjs";

test("parseEnvText ignores comments, blanks, empty values and your_*_here placeholders", () => {
  const input = [
    "# c",
    "",
    "   ",
    "A=",
    "B=your_x_here",
    'C="abc12345"',
    "D='xyz98765'"
  ].join("\n");

  assert.deepEqual(parseEnvText(input), [
    { key: "C", value: "abc12345" },
    { key: "D", value: "xyz98765" }
  ]);
});

test("isScannable accepts 8-char OMDb-style values and rejects URLs and short values", () => {
  assert.equal(isScannable({ key: "VITE_OMDB_KEY", value: "ab12cd34" }), true);
  assert.equal(isScannable({ key: "VITE_SUPABASE_URL", value: "https://x.supabase.co" }), false);
  assert.equal(isScannable({ key: "VITE_X_KEY", value: "abc" }), false);
});
