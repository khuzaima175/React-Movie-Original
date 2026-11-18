export const DEBUG_UI_STORAGE_KEY = "cv_debug_ui";

function resolveStorage(options = {}) {
  if (options && "storage" in options) {
    return options.storage || null;
  }
  try {
    if (typeof globalThis.localStorage !== "undefined" && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function resolveSearch(options = {}) {
  if (options && typeof options.search === "string") {
    return options.search;
  }
  try {
    return typeof globalThis.location?.search === "string" ? globalThis.location.search : "";
  } catch {
    return "";
  }
}

function readDebugQueryParam(search = "") {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
    if (!params.has("debug")) return null;
    const raw = String(params.get("debug") || "").trim().toLowerCase();
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  } catch {
    return null;
  }
  return null;
}

/**
 * True when running the explicit Personal edition build (`VITE_APP_EDITION=personal` or `vite --mode personal`).
 * Default public/commercial builds always return false.
 */
export function isPersonalEdition(options = {}) {
  const mode =
    options && "mode" in options
      ? options.mode
      : import.meta.env?.MODE || "";
  const edition =
    options && "edition" in options
      ? options.edition
      : import.meta.env?.VITE_APP_EDITION || globalThis.process?.env?.VITE_APP_EDITION || "";

  return (
    String(edition || "").trim().toLowerCase() === "personal" ||
    String(mode || "").trim().toLowerCase() === "personal"
  );
}

/**
 * Synchronizes sticky URL overrides (`?debug=1` / `?debug=0`) into localStorage so the owner
 * can toggle Personal/Debug UI across routes without affecting public visitors.
 */
export function syncDebugFlagFromSearch(options = {}) {
  const queryOverride = readDebugQueryParam(resolveSearch(options));
  if (queryOverride === null) return null;

  const store = resolveStorage(options);
  try {
    if (queryOverride) {
      store?.setItem?.(DEBUG_UI_STORAGE_KEY, "1");
    } else {
      store?.removeItem?.(DEBUG_UI_STORAGE_KEY);
    }
  } catch {
    // ignore unavailable or read-only storage
  }
  return queryOverride;
}

/**
 * Controls whether internal Gemini model names, cascade bars, and telemetry tooltips render.
 * Explicitly independent of `import.meta.env.DEV` so local builds match public UI by default.
 */
export function isDebugUiEnabled(options = {}) {
  const personal =
    options && "personal" in options
      ? Boolean(options.personal)
      : isPersonalEdition(options);
  if (personal) return true;

  const queryOverride = readDebugQueryParam(resolveSearch(options));
  if (queryOverride !== null) return queryOverride;

  const store = resolveStorage(options);
  try {
    return store?.getItem?.(DEBUG_UI_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
