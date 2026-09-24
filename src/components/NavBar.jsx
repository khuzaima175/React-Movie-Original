import { NavLink } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { Film, Search, Sparkles, Bookmark, Dices } from "lucide-react";

export default function NavBar({ onOpenSearch, onOpenRandomPicker }) {
  const { watched = [], watchlist = [] } = useApp();

  return (
    <>
      {/* Top Stream-Grade Navigation Bar */}
      <header className="nav-bar-stream" aria-label="Main Navigation">
        <div className="nav-container">
          {/* Brand Logo */}
          <div className="nav-brand-group">
            <NavLink to="/" className="brand-logo" aria-label="CinemaVault Home">
              <div className="brand-icon-box">
                <Film size={20} className="brand-icon" aria-hidden="true" />
              </div>
              <span className="brand-name">Cinema<span className="brand-accent">Vault</span></span>
            </NavLink>

            {/* Desktop Navigation Links */}
            <nav className="nav-links-desktop" role="navigation">
              <NavLink
                to="/"
                end
                className={({ isActive }) => `stream-nav-link ${isActive ? "active" : ""}`}
              >
                <span>Home</span>
              </NavLink>

              <NavLink
                to="/vault"
                className={({ isActive }) => `stream-nav-link ${isActive ? "active" : ""}`}
              >
                <span>My Vault</span>
                {watched.length > 0 && (
                  <span className="nav-count-badge" aria-label={`${watched.length} titles`}>
                    {watched.length}
                  </span>
                )}
              </NavLink>

              <NavLink
                to="/ai"
                className={({ isActive }) => `stream-nav-link stream-nav-link-ai ${isActive ? "active" : ""}`}
              >
                <Sparkles size={14} className="ai-nav-icon" aria-hidden="true" />
                <span>AI Oracle</span>
              </NavLink>
            </nav>
          </div>

          {/* Right Controls Group */}
          <div className="nav-actions-group">
            {/* Command Palette Search Button */}
            <button
              className="stream-search-btn"
              onClick={onOpenSearch}
              aria-label="Search movies"
              title="Search films, directors, genres (Ctrl+K)"
            >
              <Search size={15} className="search-icon" aria-hidden="true" />
              <span className="search-placeholder">Search films...</span>
              <kbd className="search-shortcut">⌘K</kbd>
            </button>

            {/* Watchlist Quick Link */}
            {watchlist.length > 0 && (
              <NavLink
                to="/vault?tab=watchlist"
                className="stream-watchlist-btn"
                aria-label={`Watchlist (${watchlist.length} saved)`}
                title="View Watchlist"
              >
                <Bookmark size={15} aria-hidden="true" />
                <span className="watchlist-count">{watchlist.length}</span>
              </NavLink>
            )}

            {/* Random Picker Action if Watchlist has items */}
            {watchlist.length > 0 && onOpenRandomPicker && (
              <button
                className="stream-random-btn"
                onClick={onOpenRandomPicker}
                aria-label="Pick random movie from watchlist"
                title="Random Picker 🎲"
              >
                <Dices size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile Stream Bottom Navigation */}
      <nav className="mobile-stream-bar" role="navigation" aria-label="Mobile Navigation">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `mobile-tab ${isActive ? "active" : ""}`}
        >
          <Film size={18} aria-hidden="true" />
          <span>Home</span>
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

        <NavLink
          to="/ai"
          className={({ isActive }) => `mobile-tab ${isActive ? "active" : ""}`}
        >
          <Sparkles size={18} aria-hidden="true" />
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
