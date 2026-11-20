import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AtSign,
  CheckCircle2,
  Cloud,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Trash2,
  User
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { validateAuthForm, MIN_PASSWORD_LENGTH } from "../services/authService";
import {
  computeProfileTasteVector,
  fetchMyCommunitySettings,
  savePublicProfileSettings,
  validateUsername
} from "../services/communityService";
import { getCanonicalMovieKey } from "../services/vaultSyncService";
import { loadDefaultEmbeddingIndex } from "../services/embeddingService";
import { Button } from "../components/ui/Button";
import "../styles/auth.css";
import "../styles/community.css";

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

  // Opt-in Public Profile (Community Mode) state — defaults strictly private (OFF)
  const [publicHandle, setPublicHandle] = useState("");
  const [publicBio, setPublicBio] = useState("");
  const [isPublicProfile, setIsPublicProfile] = useState(false);
  const [favoriteMovieKeys, setFavoriteMovieKeys] = useState([]);
  const [savedPublicUsername, setSavedPublicUsername] = useState("");
  const [isLoadingCommunity, setIsLoadingCommunity] = useState(false);
  const [isSavingCommunity, setIsSavingCommunity] = useState(false);
  const [communityMsg, setCommunityMsg] = useState({ type: "", text: "" });

  const topRatedCandidates = useMemo(() => {
    return (Array.isArray(watched) ? watched : [])
      .filter((m) => m && !m.isSample && Number(m.userRating) >= 7)
      .sort((a, b) => Number(b.userRating || 0) - Number(a.userRating || 0))
      .slice(0, 16)
      .map((m) => ({
        key: getCanonicalMovieKey(m),
        title: m.title || m.Title || "Untitled",
        rating: m.userRating
      }))
      .filter((item) => Boolean(item.key));
  }, [watched]);

  useEffect(() => {
    if (!cloudUser?.id) return;
    let active = true;
    setIsLoadingCommunity(true);
    fetchMyCommunitySettings(cloudUser.id)
      .then((settings) => {
        if (!active || !settings) return;
        setPublicHandle(settings.username || "");
        setPublicBio(settings.bio || "");
        setIsPublicProfile(Boolean(settings.isPublic));
        setFavoriteMovieKeys(settings.favoriteMovieKeys || []);
        setSavedPublicUsername(settings.isPublic && settings.username ? settings.username : "");
      })
      .finally(() => {
        if (active) setIsLoadingCommunity(false);
      });
    return () => {
      active = false;
    };
  }, [cloudUser?.id]);

  function toggleFavoriteMovieKey(key) {
    setFavoriteMovieKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= 4) return prev;
      return [...prev, key];
    });
  }

  async function handleSaveCommunityProfile(e) {
    e.preventDefault();
    setCommunityMsg({ type: "", text: "" });
    if (isPublicProfile) {
      const check = validateUsername(publicHandle);
      if (!check.ok) {
        setCommunityMsg({ type: "error", text: check.error });
        return;
      }
    }

    setIsSavingCommunity(true);
    try {
      let tasteVector = null;
      if (isPublicProfile && watched.length >= 3) {
        try {
          const idx = await loadDefaultEmbeddingIndex();
          if (idx) tasteVector = computeProfileTasteVector(watched, idx);
        } catch {
          // non-fatal: profile can still be saved without taste vector
        }
      }

      const res = await savePublicProfileSettings({
        userId: cloudUser.id,
        displayName: displayName || cloudProfile?.displayName || "",
        username: publicHandle,
        bio: publicBio,
        isPublic: isPublicProfile,
        favoriteMovieKeys,
        tasteVector
      });

      if (res.ok) {
        setPublicHandle(res.profile.username);
        setPublicBio(res.profile.bio);
        setIsPublicProfile(res.profile.isPublic);
        setFavoriteMovieKeys(res.profile.favoriteMovieKeys);
        setSavedPublicUsername(res.profile.isPublic ? res.profile.username : "");
        setCommunityMsg({
          type: "success",
          text: res.profile.isPublic
            ? `Public profile live at /u/${res.profile.username}. Your real ratings and reviews are now visible.`
            : "Your profile is now private. All ratings and reviews have been hidden from public pages."
        });
      } else {
        setCommunityMsg({ type: "error", text: res.error || "Could not save public profile." });
      }
    } finally {
      setIsSavingCommunity(false);
    }
  }

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

          <section className="account-card is-full" aria-label="Public profile community settings">
            <div className="flex flex-wrap items-center justify-between gap-[1rem]">
              <h2 className="account-card-title flex items-center gap-[0.8rem]">
                {isPublicProfile ? (
                  <Globe size={18} className="text-emerald-400" aria-hidden="true" />
                ) : (
                  <Lock size={18} className="text-[#9e9e99]" aria-hidden="true" />
                )}
                Public Profile (Community Mode)
              </h2>
              {savedPublicUsername && (
                <Link
                  to={`/u/${savedPublicUsername}`}
                  className="inline-flex items-center gap-[0.5rem] text-[1.3rem] font-semibold text-emerald-300 hover:text-emerald-200 no-underline"
                >
                  <span>View /u/{savedPublicUsername}</span>
                  <ExternalLink size={14} aria-hidden="true" />
                </Link>
              )}
            </div>

            <p className="m-0 text-[1.35rem] text-[#9e9e99] leading-[1.55]">
              Private by default. Enable Community Mode to get a shareable <code>/u/your_handle</code> profile, show your ratings &amp; written reviews on film pages, and unlock 64-D Taste Twin compatibility with friends. Your email address is never shared.
            </p>

            {communityMsg.text && (
              <div className={`auth-alert ${communityMsg.type === "error" ? "is-error" : "is-success"}`}>
                {communityMsg.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
                <span>{communityMsg.text}</span>
              </div>
            )}

            <form className="auth-form" onSubmit={handleSaveCommunityProfile}>
              <label className="flex items-center gap-[1rem] cursor-pointer text-[1.4rem] text-[#f4f4f2] font-medium">
                <input
                  type="checkbox"
                  checked={isPublicProfile}
                  onChange={(e) => setIsPublicProfile(e.target.checked)}
                  disabled={isLoadingCommunity || isSavingCommunity}
                  className="w-[1.8rem] h-[1.8rem] accent-emerald-500 cursor-pointer"
                />
                <span>Make my ratings, reviews &amp; Top 4 showcase public</span>
              </label>

              <div className="auth-field">
                <label htmlFor="account-public-handle" className="auth-label">
                  Public Handle
                </label>
                <div className="auth-input-wrap">
                  <AtSign size={16} className="auth-input-icon" aria-hidden="true" />
                  <input
                    id="account-public-handle"
                    type="text"
                    className="auth-input"
                    value={publicHandle}
                    onChange={(e) => setPublicHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    placeholder="e.g. cinephile_99"
                    maxLength={24}
                    disabled={isLoadingCommunity || isSavingCommunity}
                  />
                </div>
              </div>

              <div className="auth-field">
                <label htmlFor="account-public-bio" className="auth-label">
                  Short Bio ({publicBio.length}/240)
                </label>
                <textarea
                  id="account-public-bio"
                  rows={2}
                  maxLength={240}
                  value={publicBio}
                  onChange={(e) => setPublicBio(e.target.value)}
                  placeholder="Neo-noir, sci-fi worldbuilding, and late-night thrillers..."
                  disabled={isLoadingCommunity || isSavingCommunity}
                  className="auth-input pl-[1.4rem] py-[1rem] resize-none"
                />
              </div>

              {topRatedCandidates.length > 0 && (
                <div className="auth-field">
                  <span className="auth-label">
                    Top 4 Showcase ({favoriteMovieKeys.length}/4 selected)
                  </span>
                  <div className="account-fav-picker-grid">
                    {topRatedCandidates.map((item) => {
                      const selected = favoriteMovieKeys.includes(item.key);
                      const disabled = !selected && favoriteMovieKeys.length >= 4;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          disabled={disabled || isSavingCommunity}
                          className={`account-fav-chip ${selected ? "is-selected" : ""}`}
                          onClick={() => toggleFavoriteMovieKey(item.key)}
                        >
                          <span>{item.title}</span>
                          <span className="opacity-70 tabular-num">{item.rating}/10</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <Button
                type="submit"
                variant={isPublicProfile ? "accent" : "secondary"}
                disabled={isLoadingCommunity || isSavingCommunity}
                className="self-start px-[1.8rem] py-[0.95rem] text-[1.35rem]"
              >
                {isSavingCommunity
                  ? "Saving..."
                  : isPublicProfile
                    ? "Save & Publish Profile"
                    : "Save Privacy Settings"}
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
