import { NavLink } from "react-router-dom";
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
  Cloud
} from "lucide-react";
import { Menu } from "./ui/Menu";
import {
  getSearchShortcutHint,
  getCloudSyncBadgeLabel,
  formatVaultNavCount
} from "../services/navHelpers";

export default function NavBar({
  onOpenSearch,
  onOpenRandomPicker,
  onOpenBackup,
  onOpenTasteDeck,
  onOpenCloudSync,
  cloudUser = null,
  hasCloudConfig = false,
  cloudSyncStatus = "idle"
}) {
  const { watched = [], watchlist = [] } = useApp();
  const shortcutLabel = getSearchShortcutHint(
    typeof navigator !== "undefined" ? navigator.platform : ""
  );
  const watchlistCountLabel = formatVaultNavCount(watchlist.length);
  const cloudLabel = getCloudSyncBadgeLabel({
    configured: Boolean(hasCloudConfig),
    userEmail: cloudUser?.email || null,
    status: cloudSyncStatus
  });

  return (
    <>
      <header className="nav-bar-stream" aria-label="Main Navigation">
        <div className="nav-container page-rail">
          <div className="nav-brand-group">
            <NavLink to="/" className="brand-logo" aria-label="CinemaVault Home">
              <span>CinemaVault</span>
            </NavLink>

            <nav className="nav-links-desktop" role="navigation" aria-label="Primary sections">
              <NavLink
                to="/"
                end
                className={({ isActive }) => `stream-nav-link ${isActive ? "active" : ""}`}
              >
                Discover
              </NavLink>

              <NavLink
                to="/vault"
                className={({ isActive }) => `stream-nav-link ${isActive ? "active" : ""}`}
              >
                Vault
              </NavLink>

              <NavLink
                to="/ai"
                className={({ isActive }) => `stream-nav-link ${isActive ? "active" : ""}`}
              >
                Oracle
              </NavLink>
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
        <NavLink
          to="/"
          end
          className={({ isActive }) => `mobile-tab ${isActive ? "active" : ""}`}
        >
          <Film size={18} aria-hidden="true" />
          <span>Discover</span>
        </NavLink>

        <NavLink
          to="/vault"
          className={({ isActive }) => `mobile-tab ${isActive ? "active" : ""}`}
        >
          <Bookmark size={18} aria-hidden="true" />
          <span>Vault</span>
        </NavLink>

        <NavLink
          to="/ai"
          className={({ isActive }) => `mobile-tab ${isActive ? "active" : ""}`}
        >
          <Compass size={18} aria-hidden="true" />
          <span>Oracle</span>
        </NavLink>

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
