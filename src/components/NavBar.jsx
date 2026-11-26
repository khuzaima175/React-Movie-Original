import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useApp } from "../context/AppContext";
import {
  Film,
  Search,
  Compass,
  Bookmark,
  Dices,
  SlidersHorizontal,
  ArrowUpDown,
  MoreHorizontal,
  Cloud,
  User,
  Users
} from "lucide-react";
import { Menu } from "./ui/Menu";
import NotificationBell from "./NotificationBell";
import {
  getSearchShortcutHint,
  getCloudSyncBadgeLabel,
  formatVaultNavCount,
  getAccountNavState,
  getPrimaryNavDestinations
} from "../services/navHelpers";

function NavTab({ to, end = false, onPrefetch, children }) {
  return (
    <NavLink
      to={to}
      end={end}
      onMouseEnter={onPrefetch}
      onPointerDown={onPrefetch}
      onFocus={onPrefetch}
      className={({ isActive }) => `stream-nav-link ${isActive ? "active" : ""}`}
    >
      {({ isActive }) => (
        <>
          {children}
          {isActive && (
            <motion.span
              layoutId="nav-underline"
              className="nav-underline"
              transition={{ type: "spring", stiffness: 480, damping: 36 }}
            />
          )}
        </>
      )}
    </NavLink>
  );
}

function MobileTab({ to, end = false, icon: Icon, label, onPrefetch }) {
  return (
    <NavLink
      to={to}
      end={end}
      onTouchStart={onPrefetch}
      onPointerDown={onPrefetch}
      className={({ isActive }) => `mobile-tab ${isActive ? "active" : ""}`}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="mobile-tab-pill"
              className="mobile-tab-pill"
              transition={{ type: "spring", stiffness: 480, damping: 36 }}
            />
          )}
          <Icon size={18} aria-hidden="true" />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

export default function NavBar({
  onOpenSearch,
  onOpenRandomPicker,
  onOpenBackup,
  onOpenTasteDeck,
  onOpenCloudSync,
  onPrefetchRoute,
  cloudUser = null,
  hasCloudConfig = false,
  cloudSyncStatus = "idle"
}) {
  const { watched = [], watchlist = [], cloudProfile = null } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const isScrolled = useScrolled();
  const shortcutLabel = getSearchShortcutHint(
    typeof navigator !== "undefined" ? navigator.platform : ""
  );
  const watchlistCountLabel = formatVaultNavCount(watchlist.length);
  const cloudLabel = getCloudSyncBadgeLabel({
    configured: Boolean(hasCloudConfig),
    userEmail: cloudUser?.email || null,
    status: cloudSyncStatus
  });
  const accountNav = getAccountNavState({
    hasCloudConfig: Boolean(hasCloudConfig),
    cloudUser,
    cloudProfile,
    cloudSyncStatus
  });

  return (
    <>
      <header className={`nav-bar-stream ${isScrolled ? "is-scrolled" : ""}`} aria-label="Main Navigation">
        <div className="nav-container page-rail">
          <div className="nav-brand-group">
            <NavLink to="/" className="brand-logo" aria-label="CinemaVault Home">
              <span>CinemaVault</span>
            </NavLink>

            <nav className="nav-links-desktop" role="navigation" aria-label="Primary sections">
              {getPrimaryNavDestinations().map((item) => (
                <NavTab
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onPrefetch={item.to !== "/" ? () => onPrefetchRoute?.(item.to) : undefined}
                >
                  {item.label}
                </NavTab>
              ))}
            </nav>
          </div>

          <div className="nav-search-slot">
            <button
              type="button"
              className="stream-search-btn"
              onClick={onOpenSearch}
              aria-label="Search films"
              title={`Search films (${shortcutLabel} or /)`}
            >
              <span className="stream-search-left">
                <Search size={15} aria-hidden="true" />
                <span className="search-placeholder">Search films...</span>
              </span>
              <kbd className="search-shortcut">{shortcutLabel}</kbd>
            </button>
          </div>

          <div className="nav-actions-group">
            <NavLink
              to="/together"
              onPointerDown={() => onPrefetchRoute?.("/together")}
              className="stream-together-mobile-btn"
              aria-label="Watch Together"
              title="Watch Together"
            >
              <Users size={16} aria-hidden="true" />
            </NavLink>

            <NavLink
              to="/vault?tab=watchlist"
              className="stream-watchlist-btn"
              aria-label={`Watchlist (${watchlist.length} saved)`}
              title="Watchlist"
            >
              <Bookmark size={16} aria-hidden="true" />
              {watchlistCountLabel && (
                <span className="watchlist-count tabular-num">{watchlistCountLabel}</span>
              )}
            </NavLink>

            <NotificationBell userId={cloudUser?.id || null} />

            {accountNav.visible && (
              <NavLink
                to={accountNav.to}
                state={accountNav.isSignedIn ? undefined : { from: `${location.pathname}${location.search || ""}` }}
                className={`nav-account-btn ${accountNav.isSignedIn ? "is-signed-in" : ""}`}
                aria-label={accountNav.isSignedIn ? `Account (${accountNav.label})` : "Sign In"}
                title={accountNav.isSignedIn ? `${accountNav.label} · Account & Sync` : "Sign in or create account"}
              >
                {accountNav.isSignedIn ? (
                  <>
                    <span className="nav-account-avatar" aria-hidden="true">
                      {accountNav.initial}
                    </span>
                    <span
                      className={`nav-account-dot is-${accountNav.syncTone}`}
                      aria-hidden="true"
                    />
                  </>
                ) : (
                  <>
                    <User size={14} aria-hidden="true" />
                    <span className="nav-account-label">Sign In</span>
                  </>
                )}
              </NavLink>
            )}

            {(onOpenBackup || onOpenTasteDeck || onOpenRandomPicker || onOpenCloudSync) && (
              <Menu>
                <Menu.Trigger
                  className="nav-utility-trigger"
                  aria-label="Library tools and preferences"
                  title="More tools"
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </Menu.Trigger>
                <Menu.Panel align="right">
                  <Menu.Label>Library Tools</Menu.Label>
                  <Menu.Item icon={Users} onClick={() => navigate("/community")}>
                    Community &amp; Taste Twins
                  </Menu.Item>
                  <Menu.Item icon={Users} onClick={() => navigate("/together")}>
                    Watch Together
                  </Menu.Item>
                  {onOpenTasteDeck && (
                    <Menu.Item icon={SlidersHorizontal} onClick={onOpenTasteDeck}>
                      Taste Calibration (30)
                    </Menu.Item>
                  )}
                  {onOpenBackup && (
                    <Menu.Item icon={ArrowUpDown} onClick={onOpenBackup}>
                      Import / Export Ratings
                    </Menu.Item>
                  )}
                  {(watchlist.length > 0 || watched.length > 0) && onOpenRandomPicker && (
                    <Menu.Item icon={Dices} onClick={onOpenRandomPicker}>
                      Pick Random Film
                    </Menu.Item>
                  )}
                  {onOpenCloudSync && (
                    <>
                      <Menu.Divider />
                      <Menu.Item icon={Cloud} onClick={onOpenCloudSync}>
                        {cloudLabel}
                      </Menu.Item>
                    </>
                  )}
                </Menu.Panel>
              </Menu>
            )}
          </div>
        </div>
      </header>

      <nav className="mobile-stream-bar" role="navigation" aria-label="Mobile Navigation">
        <MobileTab to="/" end icon={Film} label="Discover" />
        <MobileTab
          to="/explore"
          icon={SlidersHorizontal}
          label="Explore"
          onPrefetch={() => onPrefetchRoute?.("/explore")}
        />
        <MobileTab
          to="/vault"
          icon={Bookmark}
          label="Vault"
          onPrefetch={() => onPrefetchRoute?.("/vault")}
        />
        <MobileTab
          to="/ai"
          icon={Compass}
          label="Oracle"
          onPrefetch={() => onPrefetchRoute?.("/ai")}
        />

        <button
          type="button"
          className="mobile-tab"
          onClick={onOpenSearch}
          aria-label="Search"
        >
          <Search size={18} aria-hidden="true" />
          <span>Search</span>
        </button>
      </nav>
    </>
  );
}
