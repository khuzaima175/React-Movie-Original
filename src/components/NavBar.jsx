import { NavLink } from "react-router-dom";
import { useApp } from "../context/AppContext";

export default function NavBar() {
  const { watched, watchlist } = useApp();

  return (
    <nav className="nav-bar">
      <div className="nav-left">
        <NavLink to="/" className="logo" style={{ textDecoration: "none" }}>
          <span>🎬</span>
          <h1>CinemaVault</h1>
        </NavLink>

        <div className="nav-links">
          <NavLink
            to="/"
            end
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
          >
            <span className="nav-link-icon">🔍</span>
            <span className="nav-link-text">Search</span>
          </NavLink>

          <NavLink
            to="/vault"
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
          >
            <span className="nav-link-icon">🎬</span>
            <span className="nav-link-text">My Vault</span>
            {watched.length > 0 && (
              <span className="nav-badge">{watched.length}</span>
            )}
          </NavLink>

          <NavLink
            to="/ai"
            className={({ isActive }) => "nav-link" + (isActive ? " active" : "")}
          >
            <span className="nav-link-icon">🤖</span>
            <span className="nav-link-text">AI Oracle</span>
          </NavLink>
        </div>
      </div>

      <div className="nav-right">
        {watchlist.length > 0 && (
          <NavLink to="/vault?tab=watchlist" className="nav-vault-quick">
            📋 Watchlist <span className="nav-badge">{watchlist.length}</span>
          </NavLink>
        )}
      </div>
    </nav>
  );
}
