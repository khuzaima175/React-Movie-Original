import test from "node:test";
import assert from "node:assert/strict";
import {
  diffWatchlistProviders,
  buildWeeklyDigestEmail,
  signUnsubscribeToken,
  verifyUnsubscribeToken
} from "../api/_alertHelpers.js";

test("diffWatchlistProviders treats null previous snapshot as baseline with zero Day-1 alerts", () => {
  const res = diffWatchlistProviders({
    previousProviderIds: null,
    currentProviderIds: [8, 337],
    userPreferredProviderIds: [8, 337]
  });
  assert.equal(res.isBaseline, true);
  assert.deepEqual(res.newlyAvailableIds, []);
});

test("diffWatchlistProviders detects only newly arrived providers matching user preferences", () => {
  const res = diffWatchlistProviders({
    previousProviderIds: [337],
    currentProviderIds: [337, 8, 15], // Netflix (8) & Hulu (15) arrived
    userPreferredProviderIds: [8, 337] // User only has Netflix & Disney+
  });
  assert.equal(res.isBaseline, false);
  assert.deepEqual(res.newlyAvailableIds, [8]);
});

test("diffWatchlistProviders expands provider aliases (e.g. Amazon 9 vs 119, Max 384 vs 1899)", () => {
  const res = diffWatchlistProviders({
    previousProviderIds: [],
    currentProviderIds: [119],
    userPreferredProviderIds: [9]
  });
  assert.equal(res.isBaseline, false);
  assert.deepEqual(res.newlyAvailableIds, [119]);
});

test("buildWeeklyDigestEmail returns null on empty notifications and escapes HTML safely", () => {
  assert.equal(
    buildWeeklyDigestEmail({
      displayName: "Alex",
      notifications: [],
      siteUrl: "https://cinemavault.app",
      unsubscribeUrl: "https://cinemavault.app/api/unsubscribe-digest?token=abc"
    }),
    null
  );

  const email = buildWeeklyDigestEmail({
    displayName: "Alex",
    notifications: [
      {
        title: "<script>alert(1)</script> & Heat",
        provider_name: "Netflix",
        watch_link: "https://www.themoviedb.org/movie/949/watch"
      }
    ],
    siteUrl: "https://cinemavault.app",
    unsubscribeUrl: "https://cinemavault.app/api/unsubscribe-digest?token=abc"
  });
  assert.ok(email);
  assert.match(email.subject, /Watchlist/i);
  assert.ok(!email.html.includes("<script>"));
  assert.ok(email.html.includes("&lt;script&gt;"));
  assert.ok(email.html.includes("Netflix"));
});

test("signUnsubscribeToken and verifyUnsubscribeToken round-trip and reject tampered tokens", () => {
  const secret = "test_hmac_secret_value";
  const token = signUnsubscribeToken("user-uuid-123", secret);
  assert.equal(verifyUnsubscribeToken(token, secret), "user-uuid-123");
  assert.equal(verifyUnsubscribeToken(`${token}tampered`, secret), null);
  assert.equal(verifyUnsubscribeToken("badformat", secret), null);
});
