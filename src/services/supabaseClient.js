import { createClient } from "@supabase/supabase-js";

let cachedClient = null;
let cachedSignature = "";

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
 * Lazily returns the singleton Supabase JS client, or null when cloud sync is unconfigured.
 */
export function getSupabaseClient() {
  const { url, key } = readSupabaseEnv();
  if (!url || !key) return null;

  const signature = `${url}::${key}`;
  if (!cachedClient || cachedSignature !== signature) {
    cachedClient = createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });
    cachedSignature = signature;
  }
  return cachedClient;
}
