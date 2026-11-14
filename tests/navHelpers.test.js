import test from "node:test";
import assert from "node:assert/strict";
import {
  getSearchShortcutHint,
  getCloudSyncBadgeLabel,
  formatVaultNavCount
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
