import { getSupabaseClientAsync, hasSupabaseConfig } from "./supabaseClient.js";

async function resolveSupabase(options = {}) {
  if ("supabaseClient" in options) return options.supabaseClient;
  if (!hasSupabaseConfig()) return null;
  return getSupabaseClientAsync();
}

export async function fetchUserNotifications(userId, options = {}) {
  if (!userId) return [];
  const supabase = await resolveSupabase(options);
  if (!supabase) return [];

  const limit = Number(options.limit) || 25;
  const { data, error } = await supabase
    .from("user_notifications")
    .select("id, type, tmdb_id, title, poster, provider_id, provider_name, match_pct, watch_link, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return Array.isArray(data) ? data : [];
}

export async function markNotificationsRead(userId, notificationIds = [], options = {}) {
  const ids = (Array.isArray(notificationIds) ? notificationIds : []).filter(Boolean);
  if (!userId || ids.length === 0) return { ok: true };
  const supabase = await resolveSupabase(options);
  if (!supabase) return { ok: false };

  const { error } = await supabase
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("id", ids);

  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function fetchAlertPreferences(userId, options = {}) {
  if (!userId) return { alertEmailEnabled: false, alertFrequency: "weekly" };
  const supabase = await resolveSupabase(options);
  if (!supabase) return { alertEmailEnabled: false, alertFrequency: "weekly" };

  const { data, error } = await supabase
    .from("profiles")
    .select("alert_email_enabled, alert_frequency")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return { alertEmailEnabled: false, alertFrequency: "weekly" };
  return {
    alertEmailEnabled: Boolean(data.alert_email_enabled),
    alertFrequency: data.alert_frequency || "weekly"
  };
}

export async function updateAlertPreferences(
  userId,
  { alertEmailEnabled = false, alertFrequency = "weekly" } = {},
  options = {}
) {
  if (!userId) return { ok: false, error: "Sign in required." };
  const supabase = await resolveSupabase(options);
  if (!supabase) return { ok: false, error: "Cloud service unavailable." };

  const { error } = await supabase
    .from("profiles")
    .update({
      alert_email_enabled: Boolean(alertEmailEnabled),
      alert_frequency: alertFrequency === "off" ? "off" : "weekly"
    })
    .eq("id", userId);

  return error ? { ok: false, error: error.message } : { ok: true };
}
