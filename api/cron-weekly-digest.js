import { createClient } from "@supabase/supabase-js";
import {
  buildWeeklyDigestEmail,
  signUnsubscribeToken,
  verifyCronAuthorization
} from "./_alertHelpers.js";

function getServiceSupabase() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function handler(req, res) {
  if (!verifyCronAuthorization(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const resendKey = String(process.env.RESEND_API_KEY || "").trim();
  const supabase = getServiceSupabase();
  if (!resendKey || !supabase) {
    return res.status(200).json({ ok: true, skipped: true, reason: "Missing RESEND_API_KEY or Supabase service credentials" });
  }

  const fromEmail = String(process.env.DIGEST_FROM_EMAIL || "CinemaVault <alerts@cinemavault.app>").trim();
  const siteUrl = String(process.env.VITE_SITE_URL || process.env.SITE_URL || "https://cinemavault.app").trim().replace(/\/+$/, "");

  try {
    const { data: optedInProfiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, display_name, alert_frequency")
      .eq("alert_email_enabled", true)
      .neq("alert_frequency", "off");

    if (profErr) throw profErr;
    if (!optedInProfiles || optedInProfiles.length === 0) {
      return res.status(200).json({ ok: true, emailsSent: 0 });
    }

    const userIds = optedInProfiles.map((p) => p.id);
    const { data: unemailed, error: notifErr } = await supabase
      .from("user_notifications")
      .select("id, user_id, tmdb_id, title, provider_name, watch_link")
      .in("user_id", userIds)
      .is("emailed_at", null)
      .order("created_at", { ascending: false });

    if (notifErr) throw notifErr;

    const byUser = new Map();
    for (const row of unemailed || []) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
      byUser.get(row.user_id).push(row);
    }

    let emailsSent = 0;
    const nowIso = new Date().toISOString();

    for (const prof of optedInProfiles) {
      const userNotes = byUser.get(prof.id) || [];
      if (userNotes.length === 0) continue;

      const { data: userRes } = await supabase.auth.admin.getUserById(prof.id);
      const emailAddr = userRes?.user?.email;
      if (!emailAddr) continue;

      const token = signUnsubscribeToken(prof.id);
      const unsubscribeUrl = `${siteUrl}/api/unsubscribe-digest?token=${encodeURIComponent(token)}`;
      const digest = buildWeeklyDigestEmail({
        displayName: prof.display_name || emailAddr.split("@")[0],
        notifications: userNotes.slice(0, 12),
        siteUrl,
        unsubscribeUrl
      });
      if (!digest) continue;

      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [emailAddr],
          subject: digest.subject,
          html: digest.html,
          text: digest.text
        })
      });

      if (sendRes.ok) {
        emailsSent += 1;
        await supabase
          .from("user_notifications")
          .update({ emailed_at: nowIso })
          .in("id", userNotes.map((n) => n.id));
        await supabase
          .from("profiles")
          .update({ last_digest_sent_at: nowIso })
          .eq("id", prof.id);
      }
    }

    return res.status(200).json({ ok: true, emailsSent });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Weekly digest cron failed" });
  }
}
