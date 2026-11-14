import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

function formatSyncTimestamp(isoString) {
  if (!isoString) return "Not synced yet";
  try {
    return new Date(isoString).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return isoString;
  }
}

export default function CloudSyncModal({ isOpen, onClose }) {
  const {
    hasCloudConfig,
    cloudUser,
    cloudSyncStatus,
    lastSyncedAt,
    cloudError,
    signInWithEmailOtp,
    signOutCloud,
    syncCloudNow,
    watched = [],
    watchlist = []
  } = useApp();

  const [email, setEmail] = useState("");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpSentTo, setOtpSentTo] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setLocalError("");
      setOtpSentTo("");
    }
  }, [isOpen]);

  const activeError = localError || cloudError || "";
  const isSyncing = cloudSyncStatus === "syncing";

  async function handleSendMagicLink(e) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setLocalError("Please enter a valid email address.");
      return;
    }

    setLocalError("");
    setOtpSentTo("");
    setIsSendingOtp(true);
    try {
      const res = await signInWithEmailOtp?.(trimmed);
      if (res?.ok) {
        setOtpSentTo(trimmed);
      } else {
        setLocalError(res?.error || "Could not send sign-in link.");
      }
    } finally {
      setIsSendingOtp(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cloud Vault Sync" size="md">
      <div className="p-6 sm:p-7 flex flex-col gap-5">
        {!hasCloudConfig ? (
          <>
            <div className="flex items-start gap-3.5 p-4 rounded-xl bg-[#1c1d20] border border-white/10">
              <CloudOff size={20} className="text-[#9e9e99] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex flex-col gap-1.5">
                <h3 className="text-sm font-bold text-[#f4f4f2] m-0">
                  Local-First Guest Mode Active
                </h3>
                <p className="text-xs text-[#9e9e99] leading-relaxed m-0">
                  All {watched.length} watched ratings and {watchlist.length} watchlist items live safely in your browser storage. Sign-in is completely optional.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-black/25 border border-white/8 text-xs text-[#9e9e99] leading-relaxed">
              <p className="m-0 mb-2 font-semibold text-[#f4f4f2]">
                Enable Optional Supabase Cloud Sync
              </p>
              <p className="m-0">
                Add <code className="text-[#e2b13c]">VITE_SUPABASE_URL</code> and{" "}
                <code className="text-[#e2b13c]">VITE_SUPABASE_PUBLISHABLE_KEY</code> to your{" "}
                <code className="text-[#e2b13c]">.env.local</code> file and apply the schema migration to unlock multi-device sync.
              </p>
            </div>

            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>
                Continue in Guest Mode
              </Button>
            </div>
          </>
        ) : cloudUser ? (
          <>
            <div className="flex items-start justify-between gap-3 p-4 rounded-xl bg-[#1c1d20] border border-emerald-500/25">
              <div className="flex items-start gap-3">
                <Cloud size={20} className="text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                    Connected Account
                  </span>
                  <span className="text-sm font-bold text-[#f4f4f2] break-all">
                    {cloudUser.email || "Authenticated User"}
                  </span>
                  <span className="text-xs text-[#9e9e99]">
                    Last synced: {formatSyncTimestamp(lastSyncedAt)}
                  </span>
                </div>
              </div>

              <span
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${
                  cloudSyncStatus === "synced"
                    ? "bg-emerald-500/12 border-emerald-500/30 text-emerald-300"
                    : cloudSyncStatus === "syncing"
                    ? "bg-[#e2b13c]/12 border-[#e2b13c]/30 text-[#e2b13c]"
                    : cloudSyncStatus === "error"
                    ? "bg-red-500/12 border-red-500/30 text-red-300"
                    : "bg-white/5 border-white/10 text-[#b6b6b2]"
                }`}
              >
                {cloudSyncStatus === "syncing"
                  ? "Syncing..."
                  : cloudSyncStatus === "synced"
                  ? "Synced"
                  : cloudSyncStatus === "error"
                  ? "Sync Error"
                  : "Ready"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-[#1c1d20] border border-white/8">
                <span className="text-[11px] uppercase tracking-wider text-[#9e9e99] block">
                  Watched Vault
                </span>
                <strong className="text-lg font-extrabold text-[#f4f4f2]">
                  {watched.length} films
                </strong>
              </div>
              <div className="p-3.5 rounded-xl bg-[#1c1d20] border border-white/8">
                <span className="text-[11px] uppercase tracking-wider text-[#9e9e99] block">
                  Saved Watchlist
                </span>
                <strong className="text-lg font-extrabold text-[#f4f4f2]">
                  {watchlist.length} films
                </strong>
              </div>
            </div>

            {activeError && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                <span>{activeError}</span>
              </div>
            )}

            <p className="text-xs text-[#8a8a86] m-0 leading-relaxed">
              Your local changes sync automatically. Signing out keeps all {watched.length + watchlist.length} titles safely in this browser.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <Button
                variant="secondary"
                icon={LogOut}
                onClick={signOutCloud}
                disabled={isSyncing}
              >
                Sign Out
              </Button>
              <Button
                variant="accent"
                icon={isSyncing ? Loader2 : RefreshCw}
                onClick={() => syncCloudNow?.()}
                disabled={isSyncing}
              >
                {isSyncing ? "Syncing..." : "Sync Now"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 p-4 rounded-xl bg-[#1c1d20] border border-white/10">
              <ShieldCheck size={20} className="text-[#e2b13c] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-bold text-[#f4f4f2] m-0">
                  Back Up &amp; Sync Across Devices
                </h3>
                <p className="text-xs text-[#9e9e99] leading-relaxed m-0">
                  Sign in with a passwordless magic link. Your {watched.length} local ratings and {watchlist.length} watchlist items merge losslessly when you connect.
                </p>
              </div>
            </div>

            {otpSentTo && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                <CheckCircle2 size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                <span>
                  Magic sign-in link sent to <strong>{otpSentTo}</strong>. Check your inbox and open the link to complete sync.
                </span>
              </div>
            )}

            {activeError && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                <span>{activeError}</span>
              </div>
            )}

            <form onSubmit={handleSendMagicLink} className="flex flex-col gap-3">
              <label htmlFor="cloud-sync-email" className="text-xs font-semibold text-[#c9c9c4]">
                Email Address
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <Mail
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a8a86]"
                    aria-hidden="true"
                  />
                  <input
                    id="cloud-sync-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#16171a] border border-white/15 text-sm text-[#f4f4f2] placeholder:text-[#6f6f6a] focus:outline-none focus:border-[#e2b13c]/60"
                  />
                </div>
                <Button
                  type="submit"
                  variant="accent"
                  disabled={isSendingOtp}
                  icon={isSendingOtp ? Loader2 : Mail}
                >
                  {isSendingOtp ? "Sending..." : "Send Magic Link"}
                </Button>
              </div>
            </form>

            <div className="flex justify-end pt-1">
              <Button variant="ghost" onClick={onClose}>
                Keep Using Guest Mode
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
