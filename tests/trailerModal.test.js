import test from "node:test";
import assert from "node:assert/strict";
import { buildTrailerEmbedUrl } from "../src/services/navHelpers.js";

test("buildTrailerEmbedUrl validates 11-char YouTube IDs and builds privacy-enhanced embed URL", () => {
  assert.equal(
    buildTrailerEmbedUrl("zSWdZVtXT7E"),
    "https://www.youtube-nocookie.com/embed/zSWdZVtXT7E?autoplay=1&rel=0"
  );
  assert.equal(buildTrailerEmbedUrl("https://evil.com/x"), null);
  assert.equal(buildTrailerEmbedUrl("short"), null);
  assert.equal(buildTrailerEmbedUrl(""), null);
});
