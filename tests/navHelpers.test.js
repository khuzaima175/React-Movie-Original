import test from "node:test";
import assert from "node:assert/strict";
import {
  getSearchShortcutHint,
  getCloudSyncBadgeLabel,
  formatVaultNavCount,
  hasBrowserHistory,
  goBackOrHome,
  formatDocumentTitle,
  resolveMenuAlignment,
  getAccountNavState,
  getPrimaryNavDestinations,
  isGamesRoute
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

test("resolveMenuAlignment flips right-aligned menu to left when trigger wraps near left edge on narrow viewport", () => {
  assert.equal(
    resolveMenuAlignment("right", { left: 32, right: 68 }, 390, 260),
    "left"
  );
  assert.equal(
    resolveMenuAlignment("right", { left: 1320, right: 1356 }, 1440, 260),
    "right"
  );
  assert.equal(
    resolveMenuAlignment("left", { left: 300, right: 356 }, 390, 260),
    "right"
  );
});

test("getAccountNavState returns guest sign-in state when signed out and user initial + sync status when signed in", () => {
  const unconfigured = getAccountNavState({ hasCloudConfig: false, cloudUser: null });
  assert.equal(unconfigured.visible, false);

  const guest = getAccountNavState({ hasCloudConfig: true, cloudUser: null, cloudSyncStatus: "idle" });
  assert.equal(guest.visible, true);
  assert.equal(guest.isSignedIn, false);
  assert.equal(guest.label, "Sign In");
  assert.equal(guest.to, "/auth");

  const authed = getAccountNavState({
    hasCloudConfig: true,
    cloudUser: { email: "khuzaima@example.com" },
    cloudProfile: { displayName: "Khuzaima" },
    cloudSyncStatus: "synced"
  });
  assert.equal(authed.visible, true);
  assert.equal(authed.isSignedIn, true);
  assert.equal(authed.initial, "K");
  assert.equal(authed.label, "Khuzaima");
  assert.equal(authed.to, "/account");
  assert.equal(authed.syncTone, "synced");
});

test("getPrimaryNavDestinations includes Watch Together at top level alongside Discover, Explore, Vault, and Oracle", () => {
  const links = getPrimaryNavDestinations();
  assert.deepEqual(links.map((l) => l.to), ["/", "/explore", "/vault", "/ai", "/together"]);
});

test("isGamesRoute detects GameVault routes accurately without matching movie routes", () => {
  assert.equal(isGamesRoute("/games"), true);
  assert.equal(isGamesRoute("/games/explore"), true);
  assert.equal(isGamesRoute("/games/vault"), true);
  assert.equal(isGamesRoute("/games/oracle"), true);
  assert.equal(isGamesRoute("/game/119133"), true);
  assert.equal(isGamesRoute("/"), false);
  assert.equal(isGamesRoute("/explore"), false);
  assert.equal(isGamesRoute("/movie/550"), false);
  assert.equal(isGamesRoute("/gameshow"), false);
});

test("getPrimaryNavDestinations returns GameVault destinations in games mode while preserving default movies mode", () => {
  const movieLinks = getPrimaryNavDestinations("movies");
  assert.deepEqual(movieLinks.map((l) => l.to), ["/", "/explore", "/vault", "/ai", "/together"]);

  const gameLinks = getPrimaryNavDestinations("games");
  assert.deepEqual(gameLinks.map((l) => l.to), [
    "/games",
    "/games/explore",
    "/games/vault",
    "/games/oracle"
  ]);
  assert.equal(gameLinks[0].end, true);
});
