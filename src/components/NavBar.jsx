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
  const vaultCountLabel = formatVaultNavCount(watched.length);
  const watchlistCountLabel = formatVaultNavCount(watchlist.length);
  const cloudLabel = getCloudSyncBadgeLabel({
    configured: Boolean(hasCloudConfig),
    userEmail: cloudUser?.email || null,
    status: cloudSyncStatus
  });

  return (
    <>
      <header className="nav-bar-stream" aria-label="Main Navigation">
        <div className="nav-container">
          <div className="nav-brand-group">
            <NavLink to="/" className="brand-logo" aria-label="CinemaVault Home">
              <Film size={19} className="brand-icon" aria-hidden="true" />
              <span className="brand-name">
                Cinema<span className="brand-accent">Vault</span>
              </span>
            </NavLink>

            <nav className="nav-links-desktop" role="navigation">
              <NavLink
                to="/"
                end
                className={({ isActive }) => `stream-nav-link ${isActive ? "active" : ""}`}
              >
                <span>Discover</span>
              </NavLink>

              <NavLink
                to="/vault"
                className={({ isActive }) => `stream-nav-link ${isActive ? "active" : ""}`}
              >
                <span>Vault</span>
                {vaultCountLabel && (
                  <span className="nav-count-inline" aria-label={`${watched.length} titles`}>
                    {vaultCountLabel}
                  </span>
                )}
              </NavLink>

              <NavLink
                to="/ai"
                className={({ isActive }) => `stream-nav-link ${isActive ? "active" : ""}`}
              >
                <span>Oracle</span>
              </NavLink>
            </nav>
          </div>

          <div className="nav-actions-group">
            <button
              className="stream-search-btn"
              onClick={onOpenSearch}
              aria-label="Search films"
              title={`Search films (${shortcutLabel} or /)`}
            >
              <Search size={14} className="search-icon" aria-hidden="true" />
              <span className="search-placeholder">Search films...</span>
              <kbd className="search-shortcut">{shortcutLabel}</kbd>
            </button>

            {onOpenTasteDeck && (
              <button
                className="nav-taste-cta"
                onClick={onOpenTasteDeck}
                aria-label="Quick Taste Calibration"
                title="Rate 20-30 films fast to sharpen recommendations"
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
                <span>Quick Taste</span>
              </button>
            )}

            {watchlistCountLabel && (
              <NavLink
                to="/vault?tab=watchlist"
                className="stream-watchlist-btn"
                aria-label={`Watchlist (${watchlist.length} saved)`}
                title="Saved Watchlist"
              >
                <Bookmark size={14} aria-hidden="true" />
                <span className="watchlist-count">{watchlistCountLabel}</span>
              </NavLink>
            )}

            {(onOpenBackup || onOpenRandomPicker || onOpenCloudSync) && (
              <Menu>
                <Menu.Trigger
                  className="nav-utility-trigger"
                  aria-label="Library tools and import export"
                  title="Import / Export & Sync"
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </Menu.Trigger>
                <Menu.Panel align="right">
                  <Menu.Label>Library Tools</Menu.Label>
                  {onOpenBackup && (
                    <Menu.Item icon={ArrowUpDown} onClick={onOpenBackup}>
                      Import / Export Ratings
                    </Menu.Item>
                  )}
                  {onOpenTasteDeck && (
                    <Menu.Item icon={SlidersHorizontal} onClick={onOpenTasteDeck}>
                      Rapid Taste Deck (30)
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
          <div className="mobile-icon-wrap">
            <Bookmark size={18} aria-hidden="true" />
            {watched.length > 0 && (
              <span className="mobile-badge">{watched.length}</span>
            )}
          </div>
          <span>Vault</span>
        </NavLink>

        {onOpenTasteDeck && (
          <button
            className="mobile-tab"
            onClick={onOpenTasteDeck}
            aria-label="Quick Taste"
          >
            <SlidersHorizontal size={18} aria-hidden="true" />
            <span>Taste</span>
          </button>
        )}

        <NavLink
          to="/ai"
          className={({ isActive }) => `mobile-tab ${isActive ? "active" : ""}`}
        >
          <Compass size={18} aria-hidden="true" />
          <span>Oracle</span>
        </NavLink>

        <button
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
