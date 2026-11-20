import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Trash2,
  User
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { validateAuthForm, MIN_PASSWORD_LENGTH } from "../services/authService";
import { Button } from "../components/ui/Button";
import "../styles/auth.css";

function formatSyncTime(isoString) {
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

export default function AccountPage() {
  useDocumentTitle("Account & Sync");
  const navigate = useNavigate();
  const {
    hasCloudConfig,
    cloudUser,
    cloudProfile,
    isAuthLoading,
    initAuthSession,
    cloudSyncStatus,
    lastSyncedAt,
    cloudError,
    syncCloudNow,
    updateDisplayName,
    updatePassword,
    signOutCloud,
    watched = [],
    watchlist = [],
    tasteRules = []
  } = useApp();

  const [displayName, setDisplayName] = useState(cloudProfile?.displayName || "");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState({ type: "", text: "" });

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState({ type: "", text: "" });

  const [confirmClearSignOut, setConfirmClearSignOut] = useState(false);

  useEffect(() => {
    if (hasCloudConfig) {
      initAuthSession?.();
    }
  }, [hasCloudConfig, initAuthSession]);

  useEffect(() => {
    setDisplayName(cloudProfile?.displayName || "");
  }, [cloudProfile?.displayName]);

  async function handleSaveProfile(e) {
    e.preventDefault();
    setProfileMsg({ type: "", text: "" });
    setIsSavingProfile(true);
    try {
      const res = await updateDisplayName(displayName);
      if (res?.ok) {
        setProfileMsg({ type: "success", text: "Profile display name saved." });
      } else {
        setProfileMsg({ type: "error", text: res?.error || "Could not update profile." });
      }
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPasswordMsg({ type: "", text: "" });
    const check = validateAuthForm({
      mode: "reset",
      password: newPassword,
      confirmPassword
    });
    if (!check.ok) {
      setPasswordMsg({ type: "error", text: check.message });
      return;
    }

    setIsSavingPassword(true);
    try {
      const res = await updatePassword(newPassword);
      if (res?.ok) {
        setNewPassword("");
        setConfirmPassword("");
        setPasswordMsg({ type: "success", text: "Password updated successfully." });
      } else {
        setPasswordMsg({ type: "error", text: res?.error || "Could not update password." });
      }
    } finally {
      setIsSavingPassword(false);
    }
  }

  async function handleSignOut(clearLocal = false) {
    await signOutCloud({ clearLocal });
    navigate("/", { replace: true });
  }

  if (isAuthLoading) {
    return (
      <div className="account-page-shell">
        <div className="page-rail flex items-center justify-center gap-[1rem] py-[8rem] text-[1.45rem] text-[#b6b6b2]">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          <span>Loading your account...</span>
        </div>
      </div>
    );
  }

  if (!cloudUser) {
    return (
      <div className="account-page-shell">
        <div className="page-rail max-w-[56rem]">
          <div className="account-card">
            <span className="auth-kicker">Guest Mode</span>
            <h1 className="auth-headline text-[3rem]">Sign in to sync your vault</h1>
            <p className="auth-lead text-[1.45rem]">
              You&apos;re currently browsing in Guest Mode with {watched.length} watched ratings and {watchlist.length} watchlist films saved in this browser.
            </p>
            <div className="flex flex-wrap gap-[1rem] pt-[0.6rem]">
              <Button variant="accent" className="px-[2rem] py-[1rem] text-[1.4rem]" onClick={() => navigate("/auth")}>
                Sign In or Create Account
              </Button>
              <Button variant="secondary" className="px-[1.8rem] py-[1rem] text-[1.4rem]" onClick={() => navigate("/")}>
                Back to Discover
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isSyncing = cloudSyncStatus === "syncing";

  return (
    <div className="account-page-shell">
      <div className="page-rail">
        <header className="account-header">
          <div>
            <span className="auth-kicker">Connected Account</span>
            <h1 className="auth-headline mt-[0.5rem]">
              {cloudProfile?.displayName || cloudUser.email}
            </h1>
            <p className="mt-[0.5rem] mb-0 text-[1.35rem] text-[#9e9e99]">
              {cloudUser.email} · Last synced: {formatSyncTime(lastSyncedAt)}
            </p>
          </div>
          <div className="flex items-center gap-[1rem]">
            <Button
              variant="accent"
              icon={isSyncing ? Loader2 : RefreshCw}
              disabled={isSyncing}
              className="px-[1.8rem] py-[0.95rem] text-[1.35rem]"
              onClick={() => syncCloudNow?.()}
            >
              {isSyncing ? "Syncing..." : "Sync Now"}
            </Button>
          </div>
        </header>

        {cloudError && (
          <div className="auth-alert is-error mb-[2rem]" role="alert">
            <AlertCircle size={16} className="shrink-0 mt-[0.2rem]" aria-hidden="true" />
            <span>{cloudError}</span>
          </div>
        )}

        <div className="account-grid">
          <section className="account-card is-full" aria-label="Synced library summary">
            <div className="flex items-center justify-between gap-[1rem]">
              <h2 className="account-card-title flex items-center gap-[0.9rem]">
                <Cloud size={18} className="text-emerald-400" aria-hidden="true" />
                Cloud Vault Summary
              </h2>
              <span className="text-[1.2rem] font-semibold px-[1rem] py-[0.35rem] rounded-[0.6rem] bg-emerald-500/12 border border-emerald-500/30 text-emerald-300">
                {cloudSyncStatus === "syncing"
                  ? "Syncing..."
                  : cloudSyncStatus === "error"
                    ? "Sync Error"
                    : "Synced"}
              </span>
            </div>
            <div className="account-stat-row">
              <div className="account-stat-box">
                <span className="account-stat-label">Watched Vault</span>
                <strong className="account-stat-val tabular-num">{watched.length}</strong>
              </div>
              <div className="account-stat-box">
                <span className="account-stat-label">Watchlist</span>
                <strong className="account-stat-val tabular-num">{watchlist.length}</strong>
              </div>
              <div className="account-stat-box">
                <span className="account-stat-label">Taste Rules</span>
                <strong className="account-stat-val tabular-num">{tasteRules.length}</strong>
              </div>
            </div>
          </section>

          <section className="account-card" aria-label="Profile details">
            <h2 className="account-card-title">Profile Details</h2>
            {profileMsg.text && (
              <div className={`auth-alert ${profileMsg.type === "error" ? "is-error" : "is-success"}`}>
                {profileMsg.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                <span>{profileMsg.text}</span>
              </div>
            )}
            <form className="auth-form" onSubmit={handleSaveProfile}>
              <div className="auth-field">
                <label htmlFor="account-display-name" className="auth-label">
                  Display Name
                </label>
                <div className="auth-input-wrap">
                  <User size={16} className="auth-input-icon" aria-hidden="true" />
                  <input
                    id="account-display-name"
                    type="text"
                    className="auth-input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your display name"
                    maxLength={60}
                  />
                </div>
              </div>
              <Button
                type="submit"
                variant="secondary"
                disabled={isSavingProfile}
                className="self-start px-[1.8rem] py-[0.95rem] text-[1.35rem]"
              >
                {isSavingProfile ? "Saving..." : "Save Profile"}
              </Button>
            </form>
          </section>

          <section className="account-card" aria-label="Change password">
            <h2 className="account-card-title">Password &amp; Security</h2>
            {passwordMsg.text && (
              <div className={`auth-alert ${passwordMsg.type === "error" ? "is-error" : "is-success"}`}>
                {passwordMsg.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                <span>{passwordMsg.text}</span>
              </div>
            )}
            <form className="auth-form" onSubmit={handleChangePassword}>
              <div className="auth-field">
                <label htmlFor="account-new-password" className="auth-label">
                  New Password
                </label>
                <div className="auth-input-wrap">
                  <KeyRound size={16} className="auth-input-icon" aria-hidden="true" />
                  <input
                    id="account-new-password"
                    type="password"
                    className="auth-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div className="auth-field">
                <label htmlFor="account-confirm-password" className="auth-label">
                  Confirm New Password
                </label>
                <div className="auth-input-wrap">
                  <KeyRound size={16} className="auth-input-icon" aria-hidden="true" />
                  <input
                    id="account-confirm-password"
                    type="password"
                    className="auth-input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <Button
                type="submit"
                variant="secondary"
                disabled={isSavingPassword}
                className="self-start px-[1.8rem] py-[0.95rem] text-[1.35rem]"
              >
                {isSavingPassword ? "Updating..." : "Update Password"}
              </Button>
            </form>
          </section>

          <section className="account-card is-full" aria-label="Sign out options">
            <h2 className="account-card-title">Session &amp; Device Privacy</h2>
            <p className="m-0 text-[1.35rem] text-[#9e9e99] leading-[1.55]">
              Signing out keeps your local copy on this device by default so you can continue offline as a guest. On a shared computer, choose &ldquo;Sign Out &amp; Clear Browser Data&rdquo; — your cloud vault stays safely stored under {cloudUser.email}.
            </p>
            <div className="account-signout-row">
              <Button
                variant="secondary"
                icon={LogOut}
                disabled={isSyncing}
                className="px-[1.8rem] py-[1rem] text-[1.35rem]"
                onClick={() => handleSignOut(false)}
              >
                Sign Out (Keep Local Copy)
              </Button>

              {!confirmClearSignOut ? (
                <Button
                  variant="ghost"
                  icon={Trash2}
                  disabled={isSyncing}
                  className="px-[1.6rem] py-[1rem] text-[1.35rem] text-red-300 hover:text-red-200"
                  onClick={() => setConfirmClearSignOut(true)}
                >
                  Sign Out &amp; Clear Browser Data
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-[0.9rem]">
                  <span className="text-[1.25rem] text-red-300">Clear this browser&apos;s local cache?</span>
                  <Button
                    variant="secondary"
                    disabled={isSyncing}
                    className="px-[1.4rem] py-[0.8rem] text-[1.25rem] border-red-500/40 text-red-200"
                    onClick={() => handleSignOut(true)}
                  >
                    Yes, Sign Out &amp; Clear
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-[1.2rem] py-[0.8rem] text-[1.25rem]"
                    onClick={() => setConfirmClearSignOut(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
