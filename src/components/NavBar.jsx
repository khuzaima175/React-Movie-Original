import { NavLink } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { Film, Search, Sparkles, Bookmark } from "lucide-react";

export default function NavBar({ onOpenSearch }) {
  const { watched, watchlist } = useApp();

  return (
    <>
      {/* Top Header Navigation Bar */}
      <nav className="nav-bar" aria-label="Main Navigation">
        <div className="nav-brand-group">
          <NavLink to="/" className="logo" style={{ textDecoration: "none" }} aria-label="CinemaVault Home">
            <Film className="logo-icon" size={24} aria-hidden="true" />
            <h1>CinemaVault</h1>
          </NavLink>
        </div>

        {/* Desktop Navigation Links */}
        <div className="nav-links desktop-nav-links" role="navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
            aria-label="Home cinema dashboard"
          >
            <Film className="nav-link-icon" size={16} aria-hidden="true" />
            <span className="nav-link-text">Home</span>
          </NavLink>

          <NavLink
            to="/vault"
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
            aria-label={`My Vault (${watched.length} items)`}
          >
            <Bookmark className="nav-link-icon" size={16} aria-hidden="true" />
            <span className="nav-link-text">My Vault</span>
            {watched.length > 0 && (
              <span className="nav-badge" aria-label={`${watched.length} movies in vault`}>
                {watched.length}
              </span>
            )}
          </NavLink>

          <NavLink
            to="/ai"
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
            aria-label="AI Oracle recommendations"
          >
            <Sparkles className="nav-link-icon" size={16} aria-hidden="true" />
            <span className="nav-link-text">AI Oracle</span>
          </NavLink>
        </div>

        {/* Right Action Items: Search & Watchlist */}
        <div className="nav-right">
          <button
            className="nav-search-trigger"
            onClick={onOpenSearch}
            aria-label="Open movie search modal"
            title="Search movies (Ctrl+K)"
          >
            <Search size={16} aria-hidden="true" />
            <span className="search-text">Search movies...</span>
            <kbd className="search-kbd">⌘K</kbd>
          </button>

          {watchlist.length > 0 && (
            <NavLink
              to="/vault?tab=watchlist"
              className="nav-vault-quick"
              aria-label={`Watchlist (${watchlist.length} saved)`}
              title="Watchlist"
            >
              <Bookmark size={15} aria-hidden="true" />
              <span className="nav-badge">{watchlist.length}</span>
            </NavLink>
          )}
        </div>
      </nav>

      {/* Mobile Glassmorphic Bottom Navigation Bar */}
      <div className="mobile-bottom-bar" role="navigation" aria-label="Mobile Bottom Navigation">
        <NavLink
          to="/"
          end
          className={({ isActive }) => "mobile-nav-link" + (isActive ? " active" : "")}
        >
          <Film size={20} aria-hidden="true" />
          <span>Home</span>
        </NavLink>

        <NavLink
          to="/vault"
          className={({ isActive }) => "mobile-nav-link" + (isActive ? " active" : "")}
        >
          <div className="mobile-nav-icon-wrap">
            <Bookmark size={20} aria-hidden="true" />
            {watched.length > 0 && (
              <span className="mobile-nav-badge">{watched.length}</span>
            )}
          </div>
          <span>My Vault</span>
        </NavLink>

        <NavLink
          to="/ai"
          className={({ isActive }) => "mobile-nav-link" + (isActive ? " active" : "")}
        >
          <Sparkles size={20} aria-hidden="true" />
          <span>AI Oracle</span>
        </NavLink>
      </div>
    </>
  );
}


