import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck, ExternalLink } from "lucide-react";
import {
  fetchUserNotifications,
  markNotificationsRead
} from "../services/notificationsService";
import { resolveProviderLaunchUrl } from "../services/watchLinkService";
import "../styles/notifications.css";

export default function NotificationBell({ userId = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      return undefined;
    }
    let active = true;
    setLoading(true);
    fetchUserNotifications(userId)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleEsc = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [isOpen]);

  const unreadIds = useMemo(
    () => items.filter((n) => !n.read_at).map((n) => n.id),
    [items]
  );

  const handleMarkAllRead = async () => {
    if (!userId || unreadIds.length === 0) return;
    const nowIso = new Date().toISOString();
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: nowIso })));
    await markNotificationsRead(userId, unreadIds);
  };

  if (!userId) return null;

  return (
    <div ref={containerRef} className="notif-bell-anchor">
      <button
        type="button"
        className="notif-bell-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={
          unreadIds.length > 0
            ? `Notifications (${unreadIds.length} unread)`
            : "Notifications"
        }
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title="Watchlist Streaming Alerts"
      >
        <Bell size={16} aria-hidden="true" />
        {unreadIds.length > 0 && (
          <span className="notif-bell-dot tabular-num" aria-hidden="true">
            {unreadIds.length > 9 ? "9+" : unreadIds.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="notif-popover" role="dialog" aria-label="Watchlist alerts">
          <div className="notif-popover-head">
            <span>Watchlist Alerts</span>
            {unreadIds.length > 0 && (
              <button
                type="button"
                className="notif-mark-read-btn"
                onClick={handleMarkAllRead}
              >
                <CheckCheck size={13} aria-hidden="true" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          <div className="notif-popover-list">
            {loading ? (
              <p className="notif-empty">Checking streaming alerts...</p>
            ) : items.length === 0 ? (
              <p className="notif-empty">
                No availability alerts yet. Add films to your Watchlist and select your streaming
                providers in Filters &amp; Rules.
              </p>
            ) : (
              items.map((n) => {
                const launch = resolveProviderLaunchUrl({
                  providerId: n.provider_id,
                  providerName: n.provider_name,
                  title: n.title,
                  watchProviderLink: n.watch_link
                });
                return (
                  <div key={n.id} className={`notif-row ${!n.read_at ? "is-unread" : ""}`}>
                    <div className="notif-row-copy">
                      <Link
                        to={`/movie/tmdb_${n.tmdb_id}`}
                        className="notif-row-title"
                        onClick={() => setIsOpen(false)}
                      >
                        {n.title}
                      </Link>
                      <span className="notif-row-sub">
                        Now streaming on <strong>{n.provider_name || "Streaming"}</strong>
                      </span>
                    </div>
                    <a
                      href={launch.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="notif-row-launch"
                      title={launch.label}
                      aria-label={launch.label}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  </div>
                );
              })
            )}
          </div>

          <div className="notif-popover-foot">
            <Link to="/account" onClick={() => setIsOpen(false)}>
              Manage email digest settings →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
