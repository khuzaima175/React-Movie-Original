import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useApp } from "../context/AppContext";
import {
  Film,
  Gamepad2,
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
  getPrimaryNavDestinations,
  isGamesRoute
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
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
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

  const isGamesMode = isGamesRoute(location.pathname);
  const primaryDestinations = getPrimaryNavDestinations(isGamesMode ? "games" : "movies");
  const searchLabel = isGamesMode ? "Search games" : "Search films";

  return (
    <>
      <header className={`nav-bar-stream ${isScrolled ? "is-scrolled" : ""}`} aria-label="Main Navigation">
        <div className="nav-container page-rail">
          <div className="nav-brand-group">
            <NavLink
              to={isGamesMode ? "/games" : "/"}
              className="brand-logo"
              aria-label={isGamesMode ? "GameVault Home" : "CinemaVault Home"}
            >
              <span>{isGamesMode ? "GameVault" : "CinemaVault"}</span>
            </NavLink>

            <div className="nav-mode-switcher" role="group" aria-label="Media vault switcher">
              <NavLink
                to="/"
                end
                className={`nav-mode-pill ${!isGamesMode ? "active" : ""}`}
                aria-current={!isGamesMode ? "page" : undefined}
              >
                <Film size={13} aria-hidden="true" />
                <span>Movies</span>
              </NavLink>
              <NavLink
                to="/games"
                onMouseEnter={() => onPrefetchRoute?.("/games")}
                onPointerDown={() => onPrefetchRoute?.("/games")}
                onFocus={() => onPrefetchRoute?.("/games")}
                className={`nav-mode-pill ${isGamesMode ? "active" : ""}`}
                aria-current={isGamesMode ? "page" : undefined}
              >
                <Gamepad2 size={13} aria-hidden="true" />
                <span>Games</span>
              </NavLink>
            </div>

            <nav className="nav-links-desktop" role="navigation" aria-label="Primary sections">
              {primaryDestinations.map((item) => (
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
              aria-label={searchLabel}
              title={`${searchLabel} (${shortcutLabel} or /)`}
            >
              <span className="stream-search-left">
                <Search size={15} aria-hidden="true" />
                <span className="search-placeholder">{searchLabel}...</span>
              </span>
              <kbd className="search-shortcut">{shortcutLabel}</kbd>
            </button>
          </div>

          <div className="nav-actions-group">
            {!isGamesMode && (
              <NavLink
                to="/together"
                onPointerDown={() => onPrefetchRoute?.("/together")}
                className="stream-together-mobile-btn"
                aria-label="Watch Together"
                title="Watch Together"
              >
                <Users size={16} aria-hidden="true" />
              </NavLink>
            )}

            <NavLink
              to={isGamesMode ? "/games/vault" : "/vault?tab=watchlist"}
              className="stream-watchlist-btn"
              aria-label={isGamesMode ? "Game Vault & Backlog" : `Watchlist (${watchlist.length} saved)`}
              title={isGamesMode ? "Game Vault & Backlog" : "Watchlist"}
            >
              <Bookmark size={16} aria-hidden="true" />
              {!isGamesMode && watchlistCountLabel && (
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
                  <Menu.Label>{isGamesMode ? "GameVault Tools" : "Library Tools"}</Menu.Label>
                  {isGamesMode ? (
                    <>
                      <Menu.Item icon={Film} onClick={() => navigate("/")}>
                        Switch to CinemaVault (Movies)
                      </Menu.Item>
                      <Menu.Item icon={ArrowUpDown} onClick={() => navigate("/games/vault")}>
                        Import Steam / JSON / CSV
                      </Menu.Item>
                    </>
                  ) : (
                    <>
                      <Menu.Item icon={Gamepad2} onClick={() => navigate("/games")}>
                        Switch to GameVault (Games)
                      </Menu.Item>
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
                    </>
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
        {isGamesMode ? (
          <>
            <MobileTab to="/games" end icon={Gamepad2} label="Discover" />
            <MobileTab
              to="/games/explore"
              icon={SlidersHorizontal}
              label="Explore"
              onPrefetch={() => onPrefetchRoute?.("/games/explore")}
            />
            <MobileTab
              to="/games/vault"
              icon={Bookmark}
              label="Vault"
              onPrefetch={() => onPrefetchRoute?.("/games/vault")}
            />
            <MobileTab
              to="/games/oracle"
              icon={Compass}
              label="Oracle"
              onPrefetch={() => onPrefetchRoute?.("/games/oracle")}
            />
          </>
        ) : (
          <>
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
          </>
        )}

        <button
          type="button"
          className="mobile-tab"
          onClick={onOpenSearch}
          aria-label={searchLabel}
        >
          <Search size={18} aria-hidden="true" />
          <span>Search</span>
        </button>
      </nav>
    </>
  );
}
