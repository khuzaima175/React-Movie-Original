import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { validateAuthForm, MIN_PASSWORD_LENGTH } from "../services/authService";
import { Button } from "../components/ui/Button";
import "../styles/auth.css";

const VALID_MODES = new Set(["signin", "signup", "magic", "forgot", "reset"]);

function resolveInitialMode(defaultMode, searchMode, isRecovery) {
  if (isRecovery) return "reset";
  if (searchMode && VALID_MODES.has(searchMode)) return searchMode;
  if (defaultMode && VALID_MODES.has(defaultMode)) return defaultMode;
  return "signin";
}

function hasRecoveryUrlSignal(searchParams) {
  if (searchParams?.get("mode") === "reset") return true;
  if (typeof window !== "undefined") {
    const hash = String(window.location?.hash || "");
    if (hash.includes("type=recovery")) return true;
  }
  return false;
}

export default function AuthPage({ defaultMode = "signin" }) {
  const {
    hasCloudConfig,
    cloudUser,
    isAuthLoading,
    isPasswordRecovery,
    clearPasswordRecovery,
    initAuthSession,
    signInWithPassword,
    signUpWithPassword,
    signInWithEmailOtp,
    sendPasswordReset,
    updatePassword,
    watched = [],
    watchlist = [],
    hasSampleData = false
  } = useApp();

  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [mode, setMode] = useState(() =>
    resolveInitialMode(defaultMode, searchParams.get("mode"), isPasswordRecovery)
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [statusError, setStatusError] = useState("");
  const [statusSuccess, setStatusSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pageTitle =
    mode === "signup"
      ? "Create Account"
      : mode === "forgot"
        ? "Reset Password"
        : mode === "reset"
          ? "Set New Password"
          : "Sign In";
  useDocumentTitle(pageTitle);

  const returnTo = typeof location.state?.from === "string" && location.state.from.startsWith("/")
    ? location.state.from
    : "/";

  useEffect(() => {
    if (hasCloudConfig) {
      initAuthSession?.();
    }
  }, [hasCloudConfig, initAuthSession]);

  useEffect(() => {
    if (isPasswordRecovery) {
      setMode("reset");
    }
  }, [isPasswordRecovery]);

  useEffect(() => {
    const queryMode = searchParams.get("mode");
    if (queryMode && VALID_MODES.has(queryMode) && !isPasswordRecovery) {
      setMode(queryMode);
    }
  }, [searchParams, isPasswordRecovery]);

  useEffect(() => {
    if (cloudUser && !isPasswordRecovery && mode !== "reset" && !hasRecoveryUrlSignal(searchParams)) {
      const isAuthPath = returnTo === "/auth" || returnTo === "/login" || returnTo === "/signup";
      navigate(isAuthPath ? "/account" : returnTo, { replace: true });
    }
  }, [cloudUser, isPasswordRecovery, mode, navigate, returnTo, searchParams]);

  function handleCancelReset() {
    clearPasswordRecovery?.();
    setPassword("");
    setConfirmPassword("");
    switchMode("signin");
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setFieldErrors({});
    setStatusError("");
    setStatusSuccess("");
    setSearchParams({ mode: nextMode }, { replace: true });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatusError("");
    setStatusSuccess("");

    const validation = validateAuthForm({
      mode,
      email,
      password,
      confirmPassword,
      displayName
    });
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      setStatusError(validation.message);
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);
    try {
      if (mode === "signin") {
        const res = await signInWithPassword({ email, password });
        if (!res?.ok) {
          setStatusError(res?.error || "Could not sign in.");
          return;
        }
        navigate(returnTo === "/auth" ? "/account" : returnTo, { replace: true });
      } else if (mode === "signup") {
        const res = await signUpWithPassword({ email, password, displayName });
        if (!res?.ok) {
          setStatusError(res?.error || "Could not create account.");
          return;
        }
        if (res.needsEmailConfirmation) {
          setStatusSuccess(
            `Account created for ${email.trim().toLowerCase()}. Check your inbox (and spam folder) to confirm your email, then sign in.`
          );
          return;
        }
        navigate("/account", { replace: true });
      } else if (mode === "magic") {
        const res = await signInWithEmailOtp(email);
        if (!res?.ok) {
          setStatusError(res?.error || "Could not send magic link.");
          return;
        }
        setStatusSuccess(
          `Magic sign-in link sent to ${email.trim().toLowerCase()}. Open the link in your inbox to connect your vault.`
        );
      } else if (mode === "forgot") {
        const res = await sendPasswordReset(email);
        if (!res?.ok) {
          setStatusError(res?.error || "Could not send password reset email.");
          return;
        }
        setStatusSuccess(
          `If an account exists for ${email.trim().toLowerCase()}, a password reset link is on its way.`
        );
      } else if (mode === "reset") {
        const res = await updatePassword(password);
        if (!res?.ok) {
          setStatusError(res?.error || "Could not update password.");
          return;
        }
        setStatusSuccess("Your password has been updated. Redirecting to your account...");
        navigate("/account", { replace: true });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const realLocalWatchedCount = (watched || []).filter((m) => !m?.isSample).length;
  const realLocalWatchlistCount = (watchlist || []).filter((m) => !m?.isSample).length;

  return (
    <div className="auth-page-shell">
      <div className="page-rail">
        <div className="auth-studio-grid">
          <section className="auth-editorial-panel" aria-label="CinemaVault Cloud Sync overview">
            <span className="auth-kicker">CinemaVault Account</span>
            <h1 className="auth-headline">
              Your film log, synced across every screen.
            </h1>
            <p className="auth-lead">
              Sign in to back up your ratings, notes, watchlist, streaming preferences, taste rules, and personalized Explore catalog — or keep using CinemaVault locally as a guest anytime.
            </p>

            <ul className="auth-benefit-list">
              <li className="auth-benefit-item">
                <Cloud size={18} className="auth-benefit-icon" aria-hidden="true" />
                <div>
                  <span className="auth-benefit-title">Lossless Vault &amp; Preferences Sync</span>
                  <span className="auth-benefit-desc">
                    Watched ratings, 4-aspect craft notes, watchlist items, and Taste Rules merge cleanly without overwriting local history.
                  </span>
                </div>
              </li>
              <li className="auth-benefit-item">
                <Sparkles size={18} className="auth-benefit-icon" aria-hidden="true" />
                <div>
                  <span className="auth-benefit-title">Instant 250-Film Explore Cache</span>
                  <span className="auth-benefit-desc">
                    Your personalized &ldquo;Movies You&apos;ll Like&rdquo; pool syncs to your account so switching devices loads instantly.
                  </span>
                </div>
              </li>
              <li className="auth-benefit-item">
                <ShieldCheck size={18} className="auth-benefit-icon" aria-hidden="true" />
                <div>
                  <span className="auth-benefit-title">Private &amp; Optional by Design</span>
                  <span className="auth-benefit-desc">
                    Protected by Postgres row-level security. Only your account can read or update your rows, and Guest Mode stays 100% unlocked.
                  </span>
                </div>
              </li>
            </ul>
          </section>

          <section className="auth-card" aria-label="Authentication form">
            {!hasCloudConfig ? (
              <div className="flex flex-col gap-[1.6rem]">
                <div className="auth-alert is-info">
                  <AlertCircle size={18} className="shrink-0 mt-[0.15rem]" aria-hidden="true" />
                  <span>
                    Cloud accounts are not configured in this environment. You can continue using CinemaVault in full local-first Guest Mode.
                  </span>
                </div>
                <Button
                  variant="accent"
                  className="w-full justify-center py-[1.1rem] text-[1.4rem]"
                  onClick={() => navigate(returnTo)}
                >
                  Continue as Guest
                </Button>
              </div>
            ) : isAuthLoading ? (
              <div className="flex items-center justify-center gap-[1rem] py-[4rem] text-[1.4rem] text-[#b6b6b2]">
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                <span>Checking your session...</span>
              </div>
            ) : (
              <>
                {(mode === "signin" || mode === "signup") && (
                  <div className="auth-mode-tabs" role="tablist" aria-label="Sign in or create account">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === "signin"}
                      className={`auth-mode-tab ${mode === "signin" ? "is-active" : ""}`}
                      onClick={() => switchMode("signin")}
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === "signup"}
                      className={`auth-mode-tab ${mode === "signup" ? "is-active" : ""}`}
                      onClick={() => switchMode("signup")}
                    >
                      Create Account
                    </button>
                  </div>
                )}

                {mode === "magic" && (
                  <div>
                    <h2 className="m-0 text-[2rem] font-bold text-[#f4f4f2]">Passwordless Magic Link</h2>
                    <p className="mt-[0.5rem] mb-0 text-[1.3rem] text-[#9e9e99]">
                      We&apos;ll email a one-click sign-in link to your inbox.
                    </p>
                  </div>
                )}

                {mode === "forgot" && (
                  <div>
                    <h2 className="m-0 text-[2rem] font-bold text-[#f4f4f2]">Reset your password</h2>
                    <p className="mt-[0.5rem] mb-0 text-[1.3rem] text-[#9e9e99]">
                      Enter your account email and we&apos;ll send a recovery link.
                    </p>
                  </div>
                )}

                {mode === "reset" && (
                  <div>
                    <h2 className="m-0 text-[2rem] font-bold text-[#f4f4f2]">Choose a new password</h2>
                    <p className="mt-[0.5rem] mb-0 text-[1.3rem] text-[#9e9e99]">
                      Pick a strong password with at least {MIN_PASSWORD_LENGTH} characters.
                    </p>
                  </div>
                )}

                {(realLocalWatchedCount > 0 || realLocalWatchlistCount > 0) && mode !== "reset" && (
                  <div className="auth-alert is-info">
                    <Cloud size={16} className="shrink-0 mt-[0.2rem]" aria-hidden="true" />
                    <span>
                      Your local browser holds{" "}
                      <strong>{realLocalWatchedCount} watched</strong> and{" "}
                      <strong>{realLocalWatchlistCount} watchlist</strong> films — they will merge automatically when you sign in.
                      {hasSampleData ? " Demo sample films stay local." : ""}
                    </span>
                  </div>
                )}

                {statusError && (
                  <div className="auth-alert is-error" role="alert">
                    <AlertCircle size={16} className="shrink-0 mt-[0.2rem]" aria-hidden="true" />
                    <span>{statusError}</span>
                  </div>
                )}

                {statusSuccess && (
                  <div className="auth-alert is-success" role="status">
                    <CheckCircle2 size={16} className="shrink-0 mt-[0.2rem]" aria-hidden="true" />
                    <span>{statusSuccess}</span>
                  </div>
                )}

                <form className="auth-form" onSubmit={handleSubmit} noValidate>
                  {mode === "signup" && (
                    <div className="auth-field">
                      <label htmlFor="auth-display-name" className="auth-label">
                        Display Name <span className="text-[#8a8a86] font-normal">(optional)</span>
                      </label>
                      <div className="auth-input-wrap">
                        <User size={16} className="auth-input-icon" aria-hidden="true" />
                        <input
                          id="auth-display-name"
                          type="text"
                          className="auth-input"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="How should we greet you?"
                          autoComplete="name"
                          maxLength={60}
                        />
                      </div>
                      {fieldErrors.displayName && <p className="auth-field-error">{fieldErrors.displayName}</p>}
                    </div>
                  )}

                  {mode !== "reset" && (
                    <div className="auth-field">
                      <label htmlFor="auth-email" className="auth-label">
                        Email Address
                      </label>
                      <div className="auth-input-wrap">
                        <Mail size={16} className="auth-input-icon" aria-hidden="true" />
                        <input
                          id="auth-email"
                          type="email"
                          className="auth-input"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          autoComplete="email"
                          required
                        />
                      </div>
                      {fieldErrors.email && <p className="auth-field-error">{fieldErrors.email}</p>}
                    </div>
                  )}

                  {(mode === "signin" || mode === "signup" || mode === "reset") && (
                    <div className="auth-field">
                      <div className="auth-field-header">
                        <label htmlFor="auth-password" className="auth-label">
                          {mode === "reset" ? "New Password" : "Password"}
                        </label>
                        {mode === "signin" && (
                          <button
                            type="button"
                            className="auth-text-link"
                            onClick={() => switchMode("forgot")}
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
                      <div className="auth-input-wrap">
                        <Lock size={16} className="auth-input-icon" aria-hidden="true" />
                        <input
                          id="auth-password"
                          type={showPassword ? "text" : "password"}
                          className="auth-input has-toggle"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={mode === "signin" ? "Enter your password" : `At least ${MIN_PASSWORD_LENGTH} characters`}
                          autoComplete={mode === "signin" ? "current-password" : "new-password"}
                          required
                        />
                        <button
                          type="button"
                          className="auth-eye-btn"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {fieldErrors.password && <p className="auth-field-error">{fieldErrors.password}</p>}
                    </div>
                  )}

                  {(mode === "signup" || mode === "reset") && (
                    <div className="auth-field">
                      <label htmlFor="auth-confirm-password" className="auth-label">
                        Confirm Password
                      </label>
                      <div className="auth-input-wrap">
                        <KeyRound size={16} className="auth-input-icon" aria-hidden="true" />
                        <input
                          id="auth-confirm-password"
                          type={showPassword ? "text" : "password"}
                          className="auth-input"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter your password"
                          autoComplete="new-password"
                          required
                        />
                      </div>
                      {fieldErrors.confirmPassword && (
                        <p className="auth-field-error">{fieldErrors.confirmPassword}</p>
                      )}
                    </div>
                  )}

                  <Button
                    type="submit"
                    variant="accent"
                    disabled={isSubmitting}
                    icon={isSubmitting ? Loader2 : ArrowRight}
                    className="w-full justify-center py-[1.15rem] text-[1.4rem]"
                  >
                    {isSubmitting
                      ? "Working..."
                      : mode === "signin"
                        ? "Sign In"
                        : mode === "signup"
                          ? "Create Account"
                          : mode === "magic"
                            ? "Send Magic Link"
                            : mode === "forgot"
                              ? "Send Reset Link"
                              : "Update Password"}
                  </Button>
                </form>

                {mode === "reset" ? (
                  <div className="auth-secondary-actions">
                    <Button
                      variant="ghost"
                      className="w-full justify-center py-[0.9rem] text-[1.32rem] text-[#b6b6b2]"
                      onClick={handleCancelReset}
                    >
                      Cancel &amp; Return to Sign In
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="auth-divider">or</div>
                    <div className="auth-secondary-actions">
                      {mode === "magic" || mode === "forgot" ? (
                        <Button
                          variant="secondary"
                          className="w-full justify-center py-[1rem] text-[1.35rem]"
                          onClick={() => switchMode("signin")}
                        >
                          Back to Email &amp; Password Sign In
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          icon={Mail}
                          className="w-full justify-center py-[1rem] text-[1.35rem]"
                          onClick={() => switchMode("magic")}
                        >
                          Sign in with Passwordless Magic Link
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        className="w-full justify-center py-[0.9rem] text-[1.32rem] text-[#b6b6b2]"
                        onClick={() => navigate(returnTo === "/auth" ? "/" : returnTo)}
                      >
                        Continue as Guest
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
