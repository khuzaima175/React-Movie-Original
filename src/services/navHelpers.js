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

export function hasBrowserHistory(historyLike = globalThis.history) {
  return Number(historyLike?.state?.idx) > 0;
}

export function goBackOrHome(navigate, canGoBack = hasBrowserHistory()) {
  if (typeof navigate !== "function") return;
  if (canGoBack) {
    navigate(-1);
  } else {
    navigate("/", { replace: true });
  }
}

export function formatDocumentTitle(section) {
  const cleaned = typeof section === "string" ? section.trim() : "";
  return cleaned ? `${cleaned} | CinemaVault` : "CinemaVault";
}

export function resolveMenuAlignment(
  preferredAlign = "right",
  triggerRect = null,
  viewportWidth = 0,
  panelWidth = 260
) {
  const normalized = preferredAlign === "left" ? "left" : "right";
  if (!triggerRect || !viewportWidth) return normalized;

  const margin = 16;
  const fitsRight = triggerRect.right - panelWidth >= margin;
  const fitsLeft = triggerRect.left + panelWidth <= viewportWidth - margin;

  if (normalized === "right" && !fitsRight && fitsLeft) {
    return "left";
  }
  if (normalized === "left" && !fitsLeft && fitsRight) {
    return "right";
  }
  return normalized;
}

export function getAccountNavState({
  hasCloudConfig = false,
  cloudUser = null,
  cloudProfile = null,
  cloudSyncStatus = "idle"
} = {}) {
  if (!hasCloudConfig) {
    return {
      visible: false,
      isSignedIn: false,
      label: "Guest",
      initial: "",
      to: "/auth",
      syncTone: "idle"
    };
  }

  if (!cloudUser) {
    return {
      visible: true,
      isSignedIn: false,
      label: "Sign In",
      initial: "",
      to: "/auth",
      syncTone: "idle"
    };
  }

  const displayName = String(cloudProfile?.displayName || "").trim();
  const email = String(cloudUser.email || "").trim();
  const label = displayName || email.split("@")[0] || "Account";
  const initial = (displayName || email || "A").charAt(0).toUpperCase();
  const syncTone =
    cloudSyncStatus === "synced"
      ? "synced"
      : cloudSyncStatus === "syncing"
        ? "syncing"
        : cloudSyncStatus === "error"
          ? "error"
          : "ready";

  return {
    visible: true,
    isSignedIn: true,
    label,
    initial,
    to: "/account",
    syncTone
  };
}

export function getPrimaryNavDestinations() {
  return [
    { to: "/", label: "Discover", end: true },
    { to: "/explore", label: "Explore", end: false },
    { to: "/vault", label: "Vault", end: false },
    { to: "/ai", label: "Oracle", end: false },
    { to: "/together", label: "Together", end: false }
  ];
}

/**
 * Validates an 11-character YouTube video ID and returns a privacy-enhanced embed URL.
 */
export function buildTrailerEmbedUrl(trailerKey = "") {
  const clean = String(trailerKey || "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(clean)) return null;
  return `https://www.youtube-nocookie.com/embed/${clean}?autoplay=1&rel=0`;
}
