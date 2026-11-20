let cachedClient = null;
let cachedSignature = "";
let pendingClientPromise = null;

function readSupabaseEnv() {
  const env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};
  const url = String(env.VITE_SUPABASE_URL || "").trim();
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || "").trim();
  return { url, key };
}

/**
 * Returns true when public Supabase project credentials are configured for browser auth/sync.
 */
export function hasSupabaseConfig() {
  const { url, key } = readSupabaseEnv();
  return Boolean(url && key);
}

/**
 * Checks synchronously whether the browser likely holds an active Supabase session token
 * or incoming auth redirect params (`#access_token=`, `?code=`, `type=recovery`) so pure
 * guest visitors do not download the Supabase JS SDK on initial page load.
 */
export function hasStoredSupabaseSession() {
  if (typeof window === "undefined") return false;
  try {
    const hash = String(window.location?.hash || "");
    const search = String(window.location?.search || "");
    if (
      hash.includes("access_token=") ||
      hash.includes("refresh_token=") ||
      hash.includes("type=recovery") ||
      hash.includes("type=signup") ||
      hash.includes("type=magiclink") ||
      search.includes("code=") ||
      search.includes("mode=reset")
    ) {
      return true;
    }
    if (typeof localStorage !== "undefined") {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && /^sb-[a-z0-9-]+-auth-token/i.test(key)) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Returns the already-initialized singleton Supabase client synchronously, or null
 * if unconfigured or not yet loaded.
 */
export function getSupabaseClient() {
  const { url, key } = readSupabaseEnv();
  if (!url || !key) return null;
  const signature = `${url}::${key}`;
  if (cachedClient && cachedSignature === signature) {
    return cachedClient;
  }
  return null;
}

/**
 * Lazily imports `@supabase/supabase-js` and returns the singleton Supabase client,
 * keeping the ~110 KB SDK out of the initial guest bundle.
 */
export async function getSupabaseClientAsync() {
  const { url, key } = readSupabaseEnv();
  if (!url || !key) return null;

  const signature = `${url}::${key}`;
  if (cachedClient && cachedSignature === signature) {
    return cachedClient;
  }

  if (!pendingClientPromise || cachedSignature !== signature) {
    cachedSignature = signature;
    pendingClientPromise = import("@supabase/supabase-js")
      .then(({ createClient }) => {
        cachedClient = createClient(url, key, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true
          }
        });
        return cachedClient;
      })
      .catch((err) => {
        pendingClientPromise = null;
        console.warn("Failed to load Supabase client:", err?.message || err);
        return null;
      });
  }

  return pendingClientPromise;
}
