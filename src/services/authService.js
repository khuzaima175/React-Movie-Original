export const MIN_PASSWORD_LENGTH = 8;
export const SUPPORTED_OAUTH_PROVIDERS = Object.freeze(["google"]);
export const OAUTH_RETURN_TO_STORAGE_KEY = "cv_auth_return_to";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pure validator for all CinemaVault auth forms:
 * `signin` | `signup` | `magic` | `forgot` | `reset`.
 */
export function validateAuthForm({
  mode = "signin",
  email = "",
  password = "",
  confirmPassword = "",
  displayName = ""
} = {}) {
  const fieldErrors = {};
  const trimmedEmail = String(email || "").trim().toLowerCase();
  const rawPassword = String(password || "");
  const rawConfirm = String(confirmPassword || "");
  const trimmedName = String(displayName || "").trim();

  if (mode !== "reset") {
    if (!trimmedEmail) {
      fieldErrors.email = "Email address is required.";
    } else if (!EMAIL_RE.test(trimmedEmail)) {
      fieldErrors.email = "Enter a valid email address.";
    }
  }

  if (mode === "signin") {
    if (!rawPassword) {
      fieldErrors.password = "Password is required.";
    }
  } else if (mode === "signup" || mode === "reset") {
    if (rawPassword.length < MIN_PASSWORD_LENGTH) {
      fieldErrors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (rawConfirm !== rawPassword) {
      fieldErrors.confirmPassword = "Passwords do not match.";
    }
  }

  if (mode === "signup" && trimmedName.length > 60) {
    fieldErrors.displayName = "Display name must be 60 characters or fewer.";
  }

  const firstError = Object.values(fieldErrors)[0] || "";
  return {
    ok: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    message: firstError
  };
}

/**
 * Translates raw Supabase Auth errors into concise, clear user-facing copy.
 */
export function normalizeAuthError(error) {
  const raw = String(error?.message || error || "").trim();
  const lower = raw.toLowerCase();

  if (!raw) return "Authentication failed. Please try again.";
  if (lower.includes("invalid login credentials")) {
    return "Incorrect email or password. Double-check your credentials or reset your password.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email address using the link sent to your inbox before signing in.";
  }
  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "An account with this email already exists. Try signing in or resetting your password.";
  }
  if (
    lower.includes("rate limit") ||
    lower.includes("over_email_send_rate_limit") ||
    lower.includes("too many requests") ||
    lower.includes("only request this after")
  ) {
    return "Too many email requests in a short window. Please wait a minute and try again.";
  }
  if (lower.includes("password should be at least") || lower.includes("weak_password")) {
    return `Choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).`;
  }
  if (lower.includes("same_password") || lower.includes("different from the old password")) {
    return "New password must be different from your current password.";
  }
  if (lower.includes("expired") || lower.includes("otp_expired")) {
    return "That link has expired. Request a fresh link and try again.";
  }
  return raw;
}

export async function signUpWithEmailPassword(
  supabase,
  { email, password, displayName = "", emailRedirectTo } = {}
) {
  if (!supabase?.auth) {
    return { ok: false, needsEmailConfirmation: false, alreadyRegistered: false, user: null, error: "Cloud accounts are not configured." };
  }

  const trimmedEmail = String(email || "").trim().toLowerCase();
  const trimmedName = String(displayName || "").trim().slice(0, 60);
  const { data, error } = await supabase.auth.signUp({
    email: trimmedEmail,
    password: String(password || ""),
    options: {
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
      ...(trimmedName ? { data: { display_name: trimmedName } } : {})
    }
  });

  if (error) {
    const lower = String(error.message || "").toLowerCase();
    return {
      ok: false,
      needsEmailConfirmation: false,
      alreadyRegistered: lower.includes("already registered"),
      user: null,
      error: normalizeAuthError(error)
    };
  }

  const user = data?.user || null;
  const session = data?.session || null;

  // Supabase obfuscates duplicate signups when email confirmation is enabled by returning empty identities[]
  if (user && Array.isArray(user.identities) && user.identities.length === 0) {
    return {
      ok: false,
      needsEmailConfirmation: false,
      alreadyRegistered: true,
      user: null,
      error: "An account with this email already exists. Try signing in or resetting your password."
    };
  }

  return {
    ok: true,
    needsEmailConfirmation: Boolean(user && !session),
    alreadyRegistered: false,
    user: user ? { id: user.id, email: user.email || trimmedEmail } : null,
    error: null
  };
}

export async function signInWithEmailPassword(supabase, { email, password } = {}) {
  if (!supabase?.auth) {
    return { ok: false, user: null, error: "Cloud accounts are not configured." };
  }

  const trimmedEmail = String(email || "").trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password: String(password || "")
  });

  if (error) {
    return { ok: false, user: null, error: normalizeAuthError(error) };
  }

  const user = data?.user || null;
  return {
    ok: true,
    user: user ? { id: user.id, email: user.email || trimmedEmail } : null,
    error: null
  };
}

export async function signInWithMagicLink(supabase, { email, emailRedirectTo } = {}) {
  if (!supabase?.auth) {
    return { ok: false, error: "Cloud accounts are not configured." };
  }

  const trimmedEmail = String(email || "").trim().toLowerCase();
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmedEmail,
    options: {
      ...(emailRedirectTo ? { emailRedirectTo } : {})
    }
  });

  if (error) {
    return { ok: false, error: normalizeAuthError(error) };
  }

  return { ok: true, error: null };
}

export async function sendPasswordResetEmail(supabase, { email, redirectTo } = {}) {
  if (!supabase?.auth) {
    return { ok: false, error: "Cloud accounts are not configured." };
  }

  const trimmedEmail = String(email || "").trim().toLowerCase();
  const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
    ...(redirectTo ? { redirectTo } : {})
  });

  if (error) {
    return { ok: false, error: normalizeAuthError(error) };
  }

  return { ok: true, error: null };
}

export async function updateAccountPassword(supabase, { newPassword } = {}) {
  if (!supabase?.auth) {
    return { ok: false, error: "Cloud accounts are not configured." };
  }

  const { error } = await supabase.auth.updateUser({
    password: String(newPassword || "")
  });

  if (error) {
    return { ok: false, error: normalizeAuthError(error) };
  }

  return { ok: true, error: null };
}

export async function updateAccountProfile(supabase, { userId, displayName } = {}) {
  if (!supabase || !userId) {
    return { ok: false, displayName: "", error: "Sign in to update your profile." };
  }

  const cleanName = String(displayName || "").trim().slice(0, 60);
  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        display_name: cleanName || null
      },
      { onConflict: "id" }
    );

  if (error) {
    return { ok: false, displayName: cleanName, error: normalizeAuthError(error) };
  }

  return { ok: true, displayName: cleanName, error: null };
}

function resolveSessionStorage(explicitStorage = null) {
  if (explicitStorage) return explicitStorage;
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

function sanitizeRelativeReturnPath(path) {
  const raw = String(path || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw === "/auth" || raw === "/login" || raw === "/signup") return "/account";
  return raw;
}

/**
 * Persists a safe relative in-app path before redirecting to an external OAuth provider.
 */
export function persistOAuthReturnPath(path, storage = null) {
  const store = resolveSessionStorage(storage);
  if (!store || typeof store.setItem !== "function") return;
  const safePath = sanitizeRelativeReturnPath(path) || "/account";
  try {
    store.setItem(OAUTH_RETURN_TO_STORAGE_KEY, safePath);
  } catch {
    // ignore private browsing storage errors
  }
}

/**
 * Reads and clears any stored OAuth return path, defaulting safely to "/account".
 */
export function consumeOAuthReturnPath(storage = null) {
  const store = resolveSessionStorage(storage);
  if (!store || typeof store.getItem !== "function") return "/account";
  try {
    const raw = store.getItem(OAUTH_RETURN_TO_STORAGE_KEY);
    store.removeItem?.(OAUTH_RETURN_TO_STORAGE_KEY);
    return sanitizeRelativeReturnPath(raw) || "/account";
  } catch {
    return "/account";
  }
}

/**
 * Initiates Supabase OAuth sign-in for an allowlisted provider (currently Google).
 */
export async function signInWithOAuthProvider(
  supabase,
  { provider = "google", redirectTo } = {}
) {
  if (!supabase?.auth || typeof supabase.auth.signInWithOAuth !== "function") {
    return { ok: false, url: null, error: "Cloud accounts are not configured." };
  }

  const normalized = String(provider || "").trim().toLowerCase();
  if (!SUPPORTED_OAUTH_PROVIDERS.includes(normalized)) {
    return { ok: false, url: null, error: `Unsupported sign-in provider: ${normalized || "unknown"}.` };
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: normalized,
    options: {
      ...(redirectTo ? { redirectTo } : {})
    }
  });

  if (error) {
    return { ok: false, url: null, error: normalizeAuthError(error) };
  }

  return { ok: true, url: data?.url || null, error: null };
}
