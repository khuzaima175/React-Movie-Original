import test from "node:test";
import assert from "node:assert/strict";
import {
  getSearchShortcutHint,
  getCloudSyncBadgeLabel,
  formatVaultNavCount,
  hasBrowserHistory,
  goBackOrHome,
  formatDocumentTitle
} from "../src/services/navHelpers.js";

test("getSearchShortcutHint adapts shortcut glyph to OS platform", () => {
  assert.equal(getSearchShortcutHint("MacIntel"), "⌘K");
  assert.equal(getSearchShortcutHint("Win32"), "Ctrl K");
  assert.equal(getSearchShortcutHint("Linux x86_64"), "Ctrl K");
  assert.equal(getSearchShortcutHint(""), "Ctrl K");
});

test("formatVaultNavCount formats positive counts concisely and hides zero", () => {
  assert.equal(formatVaultNavCount(0), null);
  assert.equal(formatVaultNavCount(-2), null);
  assert.equal(formatVaultNavCount(35), "35");
  assert.equal(formatVaultNavCount(1240), "1,240");
});

test("getCloudSyncBadgeLabel distinguishes guest, synced user, and syncing states", () => {
  assert.equal(getCloudSyncBadgeLabel({ configured: false }), "Local Backup");
  assert.equal(getCloudSyncBadgeLabel({ configured: true, userEmail: null }), "Cloud Sync");
  assert.equal(
    getCloudSyncBadgeLabel({ configured: true, userEmail: "khuzaima@example.com", status: "syncing" }),
    "Syncing..."
  );
  assert.equal(
    getCloudSyncBadgeLabel({ configured: true, userEmail: "khuzaima@example.com", status: "idle" }),
    "Synced"
  );
});

test("hasBrowserHistory checks React Router state.idx safely", () => {
  assert.equal(hasBrowserHistory({ state: { idx: 0 } }), false);
  assert.equal(hasBrowserHistory({}), false);
  assert.equal(hasBrowserHistory(undefined), false);
  assert.equal(hasBrowserHistory({ state: { idx: 2 } }), true);
});

test("goBackOrHome navigates -1 when history exists and goes home with replace otherwise", () => {
  const calls = [];
  const navigate = (to, opts) => calls.push({ to, opts });

  goBackOrHome(navigate, true);
  assert.deepEqual(calls[0], { to: -1, opts: undefined });

  goBackOrHome(navigate, false);
  assert.deepEqual(calls[1], { to: "/", opts: { replace: true } });
});

test("formatDocumentTitle formats section titles and falls back to CinemaVault", () => {
  assert.equal(formatDocumentTitle("My Vault"), "My Vault | CinemaVault");
  assert.equal(formatDocumentTitle(), "CinemaVault");
  assert.equal(formatDocumentTitle("  "), "CinemaVault");
});
