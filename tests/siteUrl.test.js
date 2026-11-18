import test from "node:test";
import assert from "node:assert/strict";
import { resolveSiteUrl } from "../scripts/siteUrl.mjs";

test("resolveSiteUrl prefers VERCEL_PROJECT_PRODUCTION_URL prefixed with https://", () => {
  assert.equal(
    resolveSiteUrl({
      VERCEL_PROJECT_PRODUCTION_URL: "cinemavault.vercel.app/",
      VITE_SITE_URL: "https://other.dev"
    }),
    "https://cinemavault.vercel.app"
  );
});

test("resolveSiteUrl strips trailing slashes from VITE_SITE_URL and returns empty when unset", () => {
  assert.equal(resolveSiteUrl({ VITE_SITE_URL: "https://a.dev///" }), "https://a.dev");
  assert.equal(resolveSiteUrl({}), "");
});
