/**
 * Pure presentation helpers for the editorial top navigation bar.
 */

export function getSearchShortcutHint(platform = "") {
  const normalized = String(platform || "").toLowerCase();
  if (/(mac|iphone|ipad|ipod)/.test(normalized)) {
    return "⌘K";
  }
  return "Ctrl K";
}

export function formatVaultNavCount(count) {
  const num = Number(count);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num).toLocaleString("en-US");
}

export function getCloudSyncBadgeLabel({ configured = false, userEmail = null, status = "idle" } = {}) {
  if (!configured) return "Local Backup";
  if (!userEmail) return "Cloud Sync";
  if (status === "syncing") return "Syncing...";
  return "Synced";
}
