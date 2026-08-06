import { NavLink } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { Film, Search, Sparkles, Bookmark, Command } from "lucide-react";

export default function NavBar({ onOpenSearch }) {
  const { watched, watchlist } = useApp();

  return (
    <nav className="nav-bar" aria-label="Main Navigation">
      <div className="nav-brand-row">
        <NavLink to="/" className="logo" style={{ textDecoration: "none" }} aria-label="CinemaVault Home">
          <Film className="logo-icon" size={26} aria-hidden="true" />
          <h1>CinemaVault</h1>
        </NavLink>

        <div className="nav-right mobile-only-right">
          <button
            className="nav-search-trigger"
            onClick={onOpenSearch}
            aria-label="Open command palette search"
          >
            <Search size={16} aria-hidden="true" />
            <span className="search-text">Search movies...</span>
            <kbd className="search-kbd">⌘K</kbd>
          </button>

          {watchlist.length > 0 && (
            <NavLink to="/vault?tab=watchlist" className="nav-vault-quick" aria-label={`Watchlist (${watchlist.length} saved)`}>
              <Bookmark size={15} aria-hidden="true" />
              <span className="nav-badge">{watchlist.length}</span>
            </NavLink>
          )}
        </div>
      </div>

      <div className="nav-links" role="navigation">
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

      <div className="nav-right desktop-only-right">
        <button
          className="nav-search-trigger"
          onClick={onOpenSearch}
          aria-label="Open command palette search (Ctrl+K)"
        >
          <Search size={15} aria-hidden="true" />
          <span className="search-text">Search movies...</span>
          <kbd className="search-kbd">⌘K</kbd>
        </button>

        {watchlist.length > 0 && (
          <NavLink to="/vault?tab=watchlist" className="nav-vault-quick" aria-label={`Watchlist (${watchlist.length} saved)`}>
            <Bookmark size={15} aria-hidden="true" />
            <span className="nav-badge">{watchlist.length}</span>
          </NavLink>
        )}
      </div>
    </nav>
  );
}
