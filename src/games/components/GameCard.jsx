import { Link } from "react-router-dom";
import { Bookmark, Gamepad2, Star } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";

export default function GameCard({ game, showMatch = true }) {
  const { playedById, backlogIds, setRateTarget, toggleBacklogGame } = useGameVault();
  if (!game?.igdbId) return null;

  const logged = playedById.get(game.igdbId);
  const inBacklog = backlogIds.has(game.igdbId);

  return (
    <article className="gv-card">
      <Link to={`/game/${game.igdbId}`} className="gv-card-cover-wrap">
        {game.coverUrl ? (
          <img
            src={game.coverUrl}
            alt={game.title}
            loading="lazy"
            className="gv-card-cover"
          />
        ) : (
          <div className="gv-card-placeholder">
            <Gamepad2 size={28} aria-hidden="true" />
            <span>{game.title}</span>
          </div>
        )}

        <div className="gv-card-top-badges">
          {showMatch && Number.isFinite(Number(game.matchScore)) ? (
            <span className="gv-badge-match tabular-num">{game.matchScore}% Match</span>
          ) : (
            <span />
          )}

          {logged?.userRating > 0 ? (
            <span className="gv-badge-rating tabular-num">★ {logged.userRating}</span>
          ) : game.rating10 ? (
            <span className="gv-badge-rating tabular-num">{game.rating10.toFixed(1)}</span>
          ) : null}
        </div>
      </Link>

      <div className="gv-card-body">
        <Link to={`/game/${game.igdbId}`} className="gv-card-title" title={game.title}>
          {game.title}
        </Link>

        <div className="gv-card-meta">
          {game.year && <span>{game.year}</span>}
          {game.genres?.length > 0 && (
            <>
              {game.year && <span aria-hidden="true">·</span>}
              <span>{game.genres.slice(0, 2).join(", ")}</span>
            </>
          )}
        </div>

        {Array.isArray(game.matchReasons) && game.matchReasons.length > 0 && (
          <div className="gv-card-reasons">
            {game.matchReasons.slice(0, 2).map((reason) => (
              <span key={reason} className="gv-reason-chip">
                {reason}
              </span>
            ))}
          </div>
        )}

        <div className="gv-card-footer">
          <button
            type="button"
            className={`gv-card-action ${logged ? "is-active" : ""}`}
            onClick={() => setRateTarget({ ...game, ...(logged || {}) })}
          >
            <Star size={13} aria-hidden="true" />
            <span>{logged?.userRating ? `${logged.userRating}/10` : logged ? "Edit" : "Rate"}</span>
          </button>

          {!logged && (
            <button
              type="button"
              className={`gv-card-action ${inBacklog ? "is-active" : ""}`}
              onClick={() => toggleBacklogGame(game)}
              title={inBacklog ? "Remove from Backlog" : "Save to Backlog"}
              aria-label={inBacklog ? "Remove from Backlog" : "Save to Backlog"}
            >
              <Bookmark size={13} aria-hidden="true" />
              <span>{inBacklog ? "Saved" : "Backlog"}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
