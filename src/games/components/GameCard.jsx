import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Bookmark, Check, Gamepad2, Star, Trophy } from "lucide-react";
import { useGameVault } from "../context/GameVaultContext";
import { flyToVault } from "../../services/flyToVault";
import { EASE } from "../../motion";

export default function GameCard({ game, showMatch = true, index = 0, enableLayout = false }) {
  const { playedById, backlogIds, setRateTarget, toggleBacklogGame } = useGameVault();
  const prefersReducedMotion = useReducedMotion();
  if (!game?.igdbId) return null;

  const logged = playedById.get(game.igdbId);
  const inBacklog = backlogIds.has(game.igdbId);
  const primaryReason = Array.isArray(game.matchReasons) && game.matchReasons.length > 0
    ? game.matchReasons[0]
    : "";

  const staggerDelay = Math.min(index, 12) * 0.03;

  return (
    <motion.article
      layout={enableLayout && !prefersReducedMotion ? "position" : false}
      className="gv-card"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.34, delay: staggerDelay, ease: EASE }}
    >
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

        <div className="gv-card-sheen" aria-hidden="true" />
        <div className="gv-card-cover-vignette" aria-hidden="true" />

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

        {(logged?.status === "platinum" || logged?.status === "playing" || logged?.hoursPlayed > 0) && (
          <div className="gv-card-bottom-strip">
            {logged.status === "platinum" && (
              <span className="gv-mini-status is-platinum">
                <Trophy size={10} aria-hidden="true" /> 100%
              </span>
            )}
            {logged.status === "playing" && (
              <span className="gv-mini-status is-playing">Playing</span>
            )}
            {logged.hoursPlayed > 0 && (
              <span className="gv-mini-status tabular-num">{logged.hoursPlayed}h</span>
            )}
          </div>
        )}
      </Link>

      <div className="gv-card-body">
        <Link to={`/game/${game.igdbId}`} className="gv-card-title" title={game.title}>
          {game.title}
        </Link>

        <div className="gv-card-meta">
          {game.year && <span className="tabular-num">{game.year}</span>}
          {game.genres?.length > 0 && (
            <>
              {game.year && <span aria-hidden="true">·</span>}
              <span className="truncate">{game.genres[0]}</span>
            </>
          )}
        </div>

        {showMatch && primaryReason && (
          <div className="gv-card-reasons">
            <span className="gv-reason-chip">{primaryReason}</span>
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
              onClick={(e) => {
                if (!inBacklog && game.coverUrl) flyToVault(e.currentTarget, game.coverUrl);
                toggleBacklogGame(game);
              }}
              title={inBacklog ? "Remove from Backlog" : "Save to Backlog"}
              aria-label={inBacklog ? "Remove from Backlog" : "Save to Backlog"}
            >
              {inBacklog ? <Check size={13} aria-hidden="true" /> : <Bookmark size={13} aria-hidden="true" />}
              <span>{inBacklog ? "Saved" : "Backlog"}</span>
            </button>
          )}
        </div>
      </div>
    </motion.article>
  );
}
