import { createClient } from "@supabase/supabase-js";
import { verifyUnsubscribeToken } from "./_alertHelpers.js";

function getServiceSupabase() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader?.("Allow", "GET");
    return res.status(405).send("Method not allowed");
  }

  const token = typeof req.query?.token === "string" ? req.query.token : "";
  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    return res.status(400).send("Invalid or expired unsubscribe link.");
  }

  const supabase = getServiceSupabase();
  if (supabase) {
    await supabase
      .from("profiles")
      .update({ alert_email_enabled: false, alert_frequency: "off" })
      .eq("id", userId);
  }

  res.setHeader?.("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(
    `<!DOCTYPE html><html><body style="background:#0b0b0c;color:#f4f4f2;font-family:sans-serif;padding:48px;text-align:center;">
      <h1>Unsubscribed</h1>
      <p style="color:#b6b6b2;">You won't receive CinemaVault weekly watchlist digest emails anymore. You can re-enable them anytime in your Account settings.</p>
    </body></html>`
  );
}
