import test from "node:test";
import assert from "node:assert/strict";
import {
  CRAWLER_UA_PATTERN,
  escapeHtmlAttr,
  buildOgDescriptor,
  renderOgHtml,
  renderOgSvgCard
} from "../api/_ogHelpers.js";

test("escapeHtmlAttr neutralizes quotes, angle brackets, and ampersands against XSS", () => {
  const dirty = `" onmouseover="alert(1)" <script>&`;
  const clean = escapeHtmlAttr(dirty);
  assert.equal(clean.includes("<"), false);
  assert.equal(clean.includes('"'), false);
  assert.match(clean, /&quot;.*&lt;script&gt;&amp;/);
});

test("buildOgDescriptor builds safe fallback when private/missing record and dynamic copy for public links", () => {
  const privateProfile = buildOgDescriptor({
    routeType: "profile",
    param: "secret_user",
    record: null,
    siteUrl: "https://cinemavault.app"
  });
  assert.match(privateProfile.title, /CinemaVault/);
  assert.equal(privateProfile.title.includes("secret_user"), false);

  const room = buildOgDescriptor({
    routeType: "together",
    param: "ABCD2345",
    record: { host_name: "Alex", region: "US" },
    siteUrl: "https://cinemavault.app"
  });
  assert.match(room.title, /Alex/);
  assert.match(room.imageUrl, /\/api\/og-image\?/);

  const html = renderOgHtml(room);
  assert.match(html, /property="og:title"/);
  assert.match(html, /twitter:card" content="summary_large_image"/);
});

test("CRAWLER_UA_PATTERN matches major social bots and ignores normal browsers", () => {
  assert.equal(CRAWLER_UA_PATTERN.test("WhatsApp/2.23.20 A"), true);
  assert.equal(CRAWLER_UA_PATTERN.test("Discordbot/2.0"), true);
  assert.equal(CRAWLER_UA_PATTERN.test("Mozilla/5.0 Chrome/120.0.0.0"), false);
  const svg = renderOgSvgCard({ title: "Alex's Room", subtitle: "Swipe together", kicker: "Watch Together" });
  assert.match(svg, /^<svg /);
});
