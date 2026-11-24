import test from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_SEARCH_TEMPLATES,
  resolveProviderLaunchUrl
} from "../src/services/watchLinkService.js";

test("uses verified HTTPS watchProviderLink (JustWatch) when present", () => {
  const res = resolveProviderLaunchUrl({
    providerId: 8,
    providerName: "Netflix",
    title: "Arrival",
    year: "2016",
    watchProviderLink: "https://www.themoviedb.org/movie/329865-arrival/watch?locale=US"
  });

  assert.equal(res.mode, "justwatch");
  assert.equal(
    res.href,
    "https://www.themoviedb.org/movie/329865-arrival/watch?locale=US"
  );
  assert.match(res.label, /Netflix/i);
});

test("falls back to provider search URL with proper UTF-8 encoding when watchProviderLink is absent", () => {
  const res = resolveProviderLaunchUrl({
    providerId: 8,
    providerName: "Netflix",
    title: "Amélie",
    year: "2001",
    watchProviderLink: null
  });

  assert.equal(res.mode, "provider-search");
  assert.ok(PROVIDER_SEARCH_TEMPLATES[8]);
  assert.equal(res.href, "https://www.netflix.com/search?q=Am%C3%A9lie");
});

test("falls back to JustWatch search for unknown provider IDs without watchProviderLink", () => {
  const res = resolveProviderLaunchUrl({
    providerId: 999999,
    providerName: "IndieFlix",
    title: "Spider-Man: Across the Spider-Verse",
    year: "2023",
    watchProviderLink: null
  });

  assert.equal(res.mode, "web-search");
  assert.equal(
    res.href,
    "https://www.justwatch.com/us/search?q=Spider-Man%3A%20Across%20the%20Spider-Verse%202023"
  );
});

test("rejects unsafe non-HTTPS schemes in watchProviderLink", () => {
  const res = resolveProviderLaunchUrl({
    providerId: 8,
    providerName: "Netflix",
    title: "Se7en",
    year: "1995",
    watchProviderLink: "javascript:alert(1)"
  });

  assert.equal(res.mode, "provider-search");
  assert.equal(res.href, "https://www.netflix.com/search?q=Se7en");
});
